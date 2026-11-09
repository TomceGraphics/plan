/**
 * Google Calendar two-way sync engine.
 *
 * Pure logic: every network call goes through the injected `GApi`, so the whole thing is
 * testable against a fake server (see scripts/selftest.ts).
 *
 * Model
 *  - A local calendar with `gId` is linked to that Google calendar.
 *  - Pull: incremental via syncToken (full re-sync on 410). Remote wins, unless the local copy
 *    is `dirty` AND newer than the remote `updated` stamp.
 *  - Push: dirty / never-synced events are POSTed or PATCHed (PATCH only sends fields Plan
 *    manages, so attendees, reminders, conferencing etc. on Google are never clobbered);
 *    local deletions are DELETEd from the tombstone list.
 *  - Recurring series map to one local event (RRULE + EXDATE). Google "exceptions" (modified
 *    instances) become standalone local events tagged with `gMasterId` / `gOrigStart`.
 */
import type { Cal, Ev } from './types';
import { DAY, MIN, parseDay, dayKey } from './time';

export interface GResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
export interface GApi {
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query?: Record<string, string>,
    body?: unknown
  ): Promise<GResponse>;
}

export class AuthError extends Error {
  constructor(msg = 'Google sign-in expired') {
    super(msg);
    this.name = 'AuthError';
  }
}

const enc = encodeURIComponent;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const ok = (s: number): boolean => s >= 200 && s < 300;

// ───────────────────────── date helpers

/** 20261030T090000 in the machine's local time */
export function icsLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
export function icsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
const icsUtc = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

/** Wall-clock time in an IANA zone → epoch ms. */
export function zonedToEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
    const offset = (t: number): number => {
      const parts = fmt.formatToParts(new Date(t));
      const g = (k: string): number => Number(parts.find((p) => p.type === k)?.value);
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
    };
    let t = guess - offset(guess);
    t = guess - offset(t);
    return t;
  } catch {
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  }
}

/** "20261030", "20261030T090000", "…Z" (+ optional TZID) → epoch ms (local midnight for plain dates). */
export function parseIcsStamp(v: string, tzid: string | null): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return new Date(y, mo - 1, d).getTime();
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[7]) return Date.UTC(y, mo - 1, d, h, mi, s);
  if (tzid) return zonedToEpoch(y, mo, d, h, mi, s, tzid);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

export function parseExdateLine(line: string): number[] {
  const i = line.indexOf(':');
  if (i < 0) return [];
  const head = line.slice(0, i);
  const tz = /TZID=([^;:]+)/.exec(head)?.[1] ?? null;
  const out: number[] = [];
  for (const v of line.slice(i + 1).split(',')) {
    const t = parseIcsStamp(v, tz);
    if (t !== null) out.push(t);
  }
  return out;
}

/**
 * Plan expands rules on local wall-clock time ("floating UTC"), so an UNTIL given in UTC is
 * converted to the equivalent local wall-clock stamp on the way in, and back on the way out.
 */
export function untilIn(rule: string): string {
  return rule.replace(/UNTIL=(\d{8})(?:T(\d{6}))?(Z)?/, (_m, date: string, time: string | undefined, z: string | undefined) => {
    if (!time) return `UNTIL=${date}T235959Z`;
    if (!z) return `UNTIL=${date}T${time}Z`;
    const ms = parseIcsStamp(`${date}T${time}Z`, null)!;
    return `UNTIL=${icsLocal(ms)}Z`;
  });
}
export function untilOut(rule: string, allDay: boolean): string {
  return rule.replace(/UNTIL=(\d{8})T(\d{6})Z?/, (_m, date: string, time: string) => {
    if (allDay) return `UNTIL=${date}`;
    const y = Number(date.slice(0, 4));
    const mo = Number(date.slice(4, 6));
    const d = Number(date.slice(6, 8));
    const ms = new Date(y, mo - 1, d, Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6))).getTime();
    return `UNTIL=${icsUtc(ms)}`;
  });
}

// ───────────────────────── mapping

interface GTime {
  ms: number;
  allDay: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gtime(x: any): GTime | null {
  if (x?.dateTime) {
    const ms = Date.parse(x.dateTime);
    return Number.isNaN(ms) ? null : { ms, allDay: false };
  }
  if (x?.date) return { ms: parseDay(x.date).getTime(), allDay: true };
  return null;
}

export interface Remote {
  title: string;
  notes: string;
  location: string;
  start: number;
  end: number;
  allDay: boolean;
  rrule: string | null;
  exdates: number[];
  exceptionOf: string | null;
  origStart: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromGoogle(item: any): Remote | null {
  const s = gtime(item.start);
  const e = gtime(item.end);
  if (!s || !e) return null;
  let rrule: string | null = null;
  const exdates: number[] = [];
  for (const line of (item.recurrence ?? []) as string[]) {
    if (line.startsWith('RRULE:')) rrule ??= untilIn(line.slice(6));
    else if (line.startsWith('EXDATE')) exdates.push(...parseExdateLine(line));
  }
  const minLen = s.allDay ? DAY : 15 * MIN;
  return {
    title: item.summary ?? '',
    notes: item.description ?? '',
    location: item.location ?? '',
    start: s.ms,
    end: e.ms - s.ms >= minLen ? e.ms : s.ms + minLen,
    allDay: s.allDay,
    rrule,
    exdates,
    exceptionOf: item.recurringEventId ?? null,
    origStart: item.originalStartTime ? (gtime(item.originalStartTime)?.ms ?? null) : null
  };
}

/** Event body for POST (insert) or PATCH. PATCH uses explicit nulls so switching all-day ⇄ timed works. */
export function toGoogle(ev: Ev, tz: string, skipExdates: Set<number>, patch: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: ev.title, description: ev.notes, location: ev.location };
  if (ev.allDay) {
    body.start = patch ? { date: dayKey(ev.start), dateTime: null, timeZone: null } : { date: dayKey(ev.start) };
    body.end = patch ? { date: dayKey(ev.end), dateTime: null, timeZone: null } : { date: dayKey(ev.end) };
  } else {
    body.start = { dateTime: new Date(ev.start).toISOString(), timeZone: tz, ...(patch ? { date: null } : {}) };
    body.end = { dateTime: new Date(ev.end).toISOString(), timeZone: tz, ...(patch ? { date: null } : {}) };
  }
  if (!ev.gMasterId) {
    if (ev.rrule) {
      const lines = [`RRULE:${untilOut(ev.rrule, ev.allDay)}`];
      const ex = ev.exdates.filter((x) => !skipExdates.has(x));
      if (ex.length) {
        lines.push(
          ev.allDay
            ? `EXDATE;VALUE=DATE:${ex.map(icsDate).join(',')}`
            : `EXDATE;TZID=${tz}:${ex.map(icsLocal).join(',')}`
        );
      }
      body.recurrence = lines;
    } else if (patch) {
      body.recurrence = null;
    }
  }
  return body;
}

// ───────────────────────── calendar list

export interface GCalendar {
  id: string;
  name: string;
  color: string;
  readOnly: boolean;
  primary: boolean;
}

export async function listGoogleCalendars(api: GApi): Promise<GCalendar[]> {
  const out: GCalendar[] = [];
  let page: string | undefined;
  do {
    const r = await api.request('GET', '/calendar/v3/users/me/calendarList', {
      maxResults: '250', ...(page ? { pageToken: page } : {})
    });
    if (r.status === 401) throw new AuthError();
    if (!ok(r.status)) throw new Error(`Google Calendar error ${r.status}`);
    for (const c of r.body?.items ?? []) {
      if (c.deleted) continue;
      out.push({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor || '#4a5be8',
        readOnly: !(c.accessRole === 'owner' || c.accessRole === 'writer'),
        primary: !!c.primary
      });
    }
    page = r.body?.nextPageToken;
  } while (page);
  return out;
}

// ───────────────────────── one calendar

export interface CalSyncInput {
  cal: Cal;
  /** all local events of this calendar */
  events: Ev[];
  /** Google event ids deleted locally and not yet deleted remotely */
  deletions: string[];
  now: number;
  tz: string;
  newId: () => string;
}
export interface CalSyncResult {
  events: Ev[];
  syncToken: string | null;
  doneDeletions: string[];
  pulled: number;
  pushed: number;
  removed: number;
  errors: string[];
  fullResync: boolean;
}

export async function syncCalendar(api: GApi, inp: CalSyncInput): Promise<CalSyncResult> {
  const gcal = inp.cal.gId!;
  const evPath = `/calendar/v3/calendars/${enc(gcal)}/events`;
  const out = new Map<string, Ev>(inp.events.map((e) => [e.id, e]));
  const byG = new Map<string, Ev>();
  for (const e of out.values()) if (e.gId) byG.set(e.gId, e);

  let token = inp.cal.gSyncToken;
  let full = !token;
  let pulled = 0;
  let pushed = 0;
  let removed = 0;
  const errors: string[] = [];

  // ── pull ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[] = [];
  let nextToken: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    items = [];
    let page: string | undefined;
    let gone = false;
    do {
      const q: Record<string, string> = { maxResults: '250', singleEvents: 'false' };
      if (token) q.syncToken = token;
      if (page) q.pageToken = page;
      const r = await api.request('GET', evPath, q);
      if (r.status === 410) {
        gone = true;
        break;
      }
      if (r.status === 401) throw new AuthError();
      if (!ok(r.status)) throw new Error(`Google Calendar error ${r.status}`);
      items.push(...(r.body?.items ?? []));
      page = r.body?.nextPageToken;
      nextToken = r.body?.nextSyncToken ?? nextToken;
    } while (page);
    if (!gone) break;
    token = null;
    full = true;
  }

  const pendingEx = new Map<string, number[]>();
  const addEx = (master: string, ms: number | null) => {
    if (ms === null) return;
    const a = pendingEx.get(master) ?? [];
    a.push(ms);
    pendingEx.set(master, a);
  };
  const seen = new Set<string>();

  for (const item of items) {
    seen.add(item.id);
    const existing = byG.get(item.id);
    if (item.status === 'cancelled') {
      if (existing) {
        out.delete(existing.id);
        byG.delete(item.id);
        removed++;
        if (existing.gMasterId) addEx(existing.gMasterId, existing.gOrigStart);
      }
      if (item.recurringEventId) addEx(item.recurringEventId, item.originalStartTime ? (gtime(item.originalStartTime)?.ms ?? null) : null);
      continue;
    }
    const p = fromGoogle(item);
    if (!p) continue;
    const remoteUpdated = Date.parse(item.updated ?? '') || inp.now;
    let merged: Ev;
    if (existing) {
      if (existing.gEtag === item.etag) continue; // echo of our own push
      if (existing.dirty && existing.updatedAt > remoteUpdated) continue; // local is newer; pushed below
      merged = {
        ...existing,
        title: p.title, notes: p.notes, location: p.location, start: p.start, end: p.end, allDay: p.allDay,
        rrule: p.rrule,
        exdates: existing.dirty ? [...new Set([...p.exdates, ...existing.exdates])] : p.exdates,
        gEtag: item.etag ?? null, dirty: false, gMasterId: p.exceptionOf, gOrigStart: p.origStart,
        updatedAt: remoteUpdated
      };
    } else {
      merged = {
        id: inp.newId(), calendarId: inp.cal.id, title: p.title, notes: p.notes, location: p.location,
        start: p.start, end: p.end, allDay: p.allDay, rrule: p.rrule, exdates: p.exdates, taskId: null, done: false,
        createdAt: inp.now, updatedAt: remoteUpdated, gId: item.id, gEtag: item.etag ?? null, dirty: false,
        gMasterId: p.exceptionOf, gOrigStart: p.origStart
      };
    }
    out.set(merged.id, merged);
    byG.set(item.id, merged);
    pulled++;
    if (p.exceptionOf) addEx(p.exceptionOf, p.origStart);
  }

  // masters must not also display the instance that Google replaced with an exception
  for (const [masterG, list] of pendingEx) {
    const m = byG.get(masterG);
    if (!m) continue;
    const merged = [...new Set([...m.exdates, ...list])];
    if (merged.length !== m.exdates.length) {
      const n = { ...m, exdates: merged };
      out.set(n.id, n);
      byG.set(masterG, n);
    }
  }

  if (full) {
    for (const e of [...out.values()]) {
      if (e.gId && !seen.has(e.gId) && !e.dirty) {
        out.delete(e.id);
        removed++;
      }
    }
  }

  // ── push ────────────────────────────────────────────────────
  const doneDeletions: string[] = [];
  if (!inp.cal.readOnly) {
    for (const gid of inp.deletions) {
      const r = await api.request('DELETE', `${evPath}/${enc(gid)}`);
      if (r.status === 401) throw new AuthError();
      if (ok(r.status) || r.status === 404 || r.status === 410) doneDeletions.push(gid);
      else errors.push(`delete ${gid}: ${r.status}`);
    }

    const exceptionStarts = new Map<string, Set<number>>();
    for (const e of out.values()) {
      if (e.gMasterId && e.gOrigStart !== null) {
        const s = exceptionStarts.get(e.gMasterId) ?? new Set<number>();
        s.add(e.gOrigStart);
        exceptionStarts.set(e.gMasterId, s);
      }
    }
    const none = new Set<number>();
    for (const orig of [...out.values()]) {
      if (!orig.dirty && orig.gId) continue;
      let e = orig;
      const skip = (e.gId && exceptionStarts.get(e.gId)) || none;
      let r: GResponse;
      if (!e.gId) {
        r = await api.request('POST', evPath, undefined, toGoogle(e, inp.tz, skip, false));
      } else {
        r = await api.request('PATCH', `${evPath}/${enc(e.gId)}`, undefined, toGoogle(e, inp.tz, skip, true));
        if (r.status === 404 || r.status === 410) {
          // gone remotely — recreate it as a fresh event
          r = await api.request('POST', evPath, undefined, toGoogle({ ...e, gMasterId: null }, inp.tz, none, false));
          if (ok(r.status)) e = { ...e, gMasterId: null, gOrigStart: null };
        }
      }
      if (r.status === 401) throw new AuthError();
      if (!ok(r.status)) {
        errors.push(`“${e.title || 'Untitled'}”: ${r.status}`);
        continue;
      }
      const n: Ev = { ...e, gId: r.body?.id ?? e.gId, gEtag: r.body?.etag ?? null, dirty: false };
      out.set(n.id, n);
      pushed++;
    }
  }

  return {
    events: [...out.values()], syncToken: nextToken ?? inp.cal.gSyncToken, doneDeletions,
    pulled, pushed, removed, errors, fullResync: full
  };
}
