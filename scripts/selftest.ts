// Pure-logic self tests: `npm run selftest` (Node ≥ 22.6, no browser needed).
import assert from 'node:assert/strict';
import { expand, nextOccurrence } from '../src/lib/recur';
import { layoutDay } from '../src/lib/layout';
import { fuzzy } from '../src/lib/fuzzy';
import { parseEventText, parseTaskText } from '../src/lib/quickparse';
import { parseTimeInput } from '../src/lib/time';
import type { Cal, Ev } from '../src/lib/types';
import { icsLocal, fromGoogle, parseExdateLine, syncCalendar, toGoogle, untilIn, untilOut, zonedToEpoch, AuthError, type GApi, type GResponse } from '../src/lib/sync';

const ev = (p: Partial<Ev>): Ev => ({
  id: 'x', calendarId: 'c', title: 't', notes: '', location: '', start: 0, end: 0, allDay: false, rrule: null,
  exdates: [], taskId: null, done: false, createdAt: 0, updatedAt: 0, gId: null, gEtag: null, dirty: false,
  gMasterId: null, gOrigStart: null, ...p
});
const T = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

// recurrence: weekly Monday 09:00, across the EU DST change (2026-03-29) wall-clock time must stay 09:00
const weekly = ev({ start: T(2026, 3, 16, 9), end: T(2026, 3, 16, 10), rrule: 'FREQ=WEEKLY;BYDAY=MO' });
const occ = expand([weekly], T(2026, 3, 16), T(2026, 4, 13));
assert.equal(occ.length, 4);
for (const o of occ) assert.equal(new Date(o.start).getHours(), 9);

// exdates drop one occurrence
const ex = ev({ ...weekly, exdates: [T(2026, 3, 23, 9)] });
assert.equal(expand([ex], T(2026, 3, 16), T(2026, 4, 13)).length, 3);

// non-recurring overlap filter
const one = ev({ start: T(2026, 5, 1, 10), end: T(2026, 5, 1, 11) });
assert.equal(expand([one], T(2026, 5, 1), T(2026, 5, 2)).length, 1);
assert.equal(expand([one], T(2026, 5, 2), T(2026, 5, 3)).length, 0);

// all-day recurring keeps midnight boundaries
const ad = ev({ allDay: true, start: T(2026, 1, 1), end: T(2026, 1, 2), rrule: 'FREQ=DAILY' });
const adOcc = expand([ad], T(2026, 1, 1), T(2026, 1, 4));
assert.equal(adOcc.length, 3);
assert.equal(adOcc[1].end - adOcc[1].start, T(2026, 1, 3) - T(2026, 1, 2));
assert.ok(nextOccurrence(weekly, T(2026, 4, 1)) !== null);

// layout: two overlapping + one free event
const L = layoutDay([
  { start: T(2026, 1, 1, 9), end: T(2026, 1, 1, 11) },
  { start: T(2026, 1, 1, 10), end: T(2026, 1, 1, 12) },
  { start: T(2026, 1, 1, 13), end: T(2026, 1, 1, 14) }
]);
assert.equal(L.find((p) => p.item.start === T(2026, 1, 1, 13))!.cols, 1);
assert.equal(L.filter((p) => p.cols === 2).length, 2);

// fuzzy
assert.ok(fuzzy('wkrv', 'Weekly review'));
assert.equal(fuzzy('zzz', 'Weekly review'), null);
assert.ok(fuzzy('rev', 'Weekly review')!.score > fuzzy('wrv', 'Weekly review')!.score - 50);

// time input
assert.equal(parseTimeInput('9'), 540);
assert.equal(parseTimeInput('9:30pm'), 21 * 60 + 30);
assert.equal(parseTimeInput('1415'), 14 * 60 + 15);
assert.equal(parseTimeInput('25:00'), null);

// quick add
const now = new Date(2026, 9, 27, 10, 0); // Tue 27 Oct 2026
const p = parseEventText('Lunch with Ana tomorrow 12:30 for 1h', now, 60);
assert.equal(p.title, 'Lunch with Ana');
assert.equal(p.start, T(2026, 10, 28, 12, 30));
assert.equal(p.end, T(2026, 10, 28, 13, 30));
const r = parseEventText('Standup fri 9-9:30', now, 60);
assert.equal(r.title, 'Standup');
assert.equal(r.start, T(2026, 10, 30, 9));
assert.equal(r.end, T(2026, 10, 30, 9, 30));
const ap = parseEventText('Dentist 3pm', now, 45);
assert.equal(ap.start, T(2026, 10, 27, 15));
assert.equal(ap.end, T(2026, 10, 27, 15, 45));
const day = parseEventText('Birthday 30 oct', now, 60);
assert.equal(day.allDay, true);
assert.equal(day.title, 'Birthday');
const tk = parseTaskText('Send invoice friday !2 ~30m', now);
assert.equal(tk.title, 'Send invoice');
assert.equal(tk.due, '2026-10-30');
assert.equal(tk.priority, 2);
assert.equal(tk.estimate, 30);



// ─────────────────────────── Google sync engine against a fake Google Calendar
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = Record<string, any>;
class FakeGoogle {
  items = new Map<string, Item>();
  version = 100;
  log: { v: number; id: string }[] = [];
  minValid = 0;
  n = 0;
  calls: string[] = [];
  authFail = false;
  put(item: Item): Item {
    this.version++;
    item.etag = `"e${this.version}"`;
    item.updated = new Date(1_800_000_000_000 + this.version * 1000).toISOString();
    item.status ??= 'confirmed';
    this.items.set(item.id, item);
    this.log.push({ v: this.version, id: item.id });
    return item;
  }
  merge(dst: Item, src: Item) {
    for (const [k, v] of Object.entries(src)) {
      if (v === null) delete dst[k];
      else if (typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') {
        this.merge(dst[k], v);
        if (Object.keys(dst[k]).length === 0) delete dst[k];
      } else dst[k] = structuredClone(v);
    }
  }
  api: GApi = {
    request: async (method, path, query, body): Promise<GResponse> => {
      this.calls.push(`${method} ${path.split('/events')[1] ?? path} ${query?.syncToken ? 'inc' : ''}`.replace(/\s+/g, ' ').trim());
      if (this.authFail) return { status: 401, body: {} };
      const m = /\/events(?:\/([^/]+))?$/.exec(path);
      const id = m?.[1] ? decodeURIComponent(m[1]) : null;
      if (method === 'GET') {
        if (query?.syncToken) {
          const v = Number(query.syncToken.slice(3));
          if (v < this.minValid) return { status: 410, body: {} };
          const ids = new Set(this.log.filter((l) => l.v > v).map((l) => l.id));
          return { status: 200, body: { items: [...ids].map((i) => structuredClone(this.items.get(i))), nextSyncToken: `tok${this.version}` } };
        }
        return { status: 200, body: { items: [...this.items.values()].filter((i) => i.status !== 'cancelled').map((i) => structuredClone(i)), nextSyncToken: `tok${this.version}` } };
      }
      if (method === 'POST') {
        const item = this.put({ id: `g${++this.n}`, ...structuredClone(body as Item) });
        return { status: 200, body: structuredClone(item) };
      }
      if (method === 'PATCH') {
        const cur = id ? this.items.get(id) : undefined;
        if (!cur || cur.status === 'cancelled') return { status: 404, body: {} };
        this.merge(cur, body as Item);
        this.put(cur);
        return { status: 200, body: structuredClone(cur) };
      }
      if (method === 'DELETE') {
        const cur = id ? this.items.get(id) : undefined;
        if (!cur || cur.status === 'cancelled') return { status: 410, body: {} };
        cur.status = 'cancelled';
        this.put(cur);
        return { status: 204, body: null };
      }
      return { status: 400, body: {} };
    }
  };
}

const gcal = (p: Partial<Cal> = {}): Cal => ({
  id: 'L', name: 'G', color: '#000', visible: true, sort: 0, gId: 'cal@x', gSyncToken: null, readOnly: false, ...p
});
let idn = 0;
const run = (g: FakeGoogle, cal: Cal, events: Ev[], deletions: string[] = []) =>
  syncCalendar(g.api, { cal, events, deletions, now: 1_800_000_000_000, tz: 'Europe/Skopje', newId: () => `n${++idn}` });

// helpers
assert.equal(zonedToEpoch(2026, 10, 28, 9, 0, 0, 'Europe/Skopje'), Date.UTC(2026, 9, 28, 8, 0, 0)); // CET
assert.equal(zonedToEpoch(2026, 7, 1, 9, 0, 0, 'Europe/Skopje'), Date.UTC(2026, 6, 1, 7, 0, 0)); // CEST
assert.equal(parseExdateLine('EXDATE;TZID=Europe/Skopje:20261102T090000,20261109T090000').length, 2);
assert.equal(parseExdateLine('EXDATE:20261102T080000Z')[0], Date.UTC(2026, 10, 2, 8));
assert.equal(untilOut(untilIn('FREQ=DAILY;UNTIL=20261231T220000Z'), false), 'FREQ=DAILY;UNTIL=20261231T220000Z');
assert.equal(untilOut(untilIn('FREQ=DAILY;UNTIL=20261231'), true), 'FREQ=DAILY;UNTIL=20261231');
assert.equal(fromGoogle({ start: { date: '2026-10-30' }, end: { date: '2026-11-02' }, summary: 'Trip' })!.allDay, true);
assert.equal(fromGoogle({ summary: 'broken' }), null);

// 1) initial pull
const G = new FakeGoogle();
const MON = (d: number, h = 9) => new Date(2026, 9, d, h, 0).getTime();
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
G.put({ id: 'a', summary: 'Dentist', start: { dateTime: new Date(MON(28, 14)).toISOString() }, end: { dateTime: new Date(MON(28, 15)).toISOString() }, attendees: [{ email: 'x@y.z' }] });
G.put({ id: 'trip', summary: 'Trip', start: { date: '2026-10-30' }, end: { date: '2026-11-02' } });
G.put({
  id: 'series', summary: 'Standup', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', `EXDATE:${utc(MON(26 + 14))},${utc(MON(26 + 21))}`],
  start: { dateTime: new Date(MON(26)).toISOString(), timeZone: 'Europe/Skopje' }, end: { dateTime: new Date(MON(26, 10)).toISOString(), timeZone: 'Europe/Skopje' }
});
G.put({
  id: 'series_20261102', recurringEventId: 'series', originalStartTime: { dateTime: new Date(MON(26 + 7)).toISOString() },
  summary: 'Standup (moved)', start: { dateTime: new Date(MON(27, 11)).toISOString() }, end: { dateTime: new Date(MON(27, 12)).toISOString() }
});
G.put({ id: 'series_20261116', recurringEventId: 'series', originalStartTime: { dateTime: new Date(MON(26 + 21)).toISOString() }, status: 'cancelled' });
let cal = gcal();
let r1 = await run(G, cal, []);
assert.equal(r1.events.length, 4);
assert.ok(r1.syncToken?.startsWith('tok'));
assert.equal(r1.pulled, 4);
assert.equal(r1.pushed, 0);
const master = r1.events.find((e) => e.gId === 'series')!;
assert.equal(master.rrule, 'FREQ=WEEKLY;BYDAY=MO');
assert.equal(master.exdates.length, 3); // two EXDATEs (removed instances) + the instance replaced by an exception
const occs = expand([master], MON(26, 0), MON(26 + 29, 0));
assert.equal(occs.length, 2, 'Oct 26 + Nov 23 remain (Nov 2 moved, 9 and 16 removed)');
const moved = r1.events.find((e) => e.gId === 'series_20261102')!;
assert.equal(moved.gMasterId, 'series');
assert.equal(moved.title, 'Standup (moved)');
const trip = r1.events.find((e) => e.gId === 'trip')!;
assert.equal(trip.allDay, true);
assert.equal(trip.end - trip.start, 3 * 86_400_000 + (trip.end - trip.start) % 86_400_000);

// 2) nothing changed → nothing happens (incremental, no pushes)
cal = gcal({ gSyncToken: r1.syncToken });
G.calls = [];
let r2 = await run(G, cal, r1.events);
assert.equal(r2.pulled + r2.pushed + r2.removed, 0);
assert.deepEqual(G.calls, ['GET inc']);

// 3) local create + local edit + local delete
const created = ev({ id: 'new1', calendarId: 'L', title: 'Lunch', start: MON(29, 12), end: MON(29, 13), dirty: false });
const edited = { ...r1.events.find((e) => e.gId === 'a')!, title: 'Dentist (moved)', dirty: true, updatedAt: 1_900_000_000_000 };
const rest = r1.events.filter((e) => e.gId !== 'a' && e.gId !== 'trip');
G.calls = [];
let r3 = await run(G, cal, [...rest, created, edited], ['trip']);
assert.equal(r3.pushed, 2);
assert.deepEqual(r3.doneDeletions, ['trip']);
assert.equal(G.items.get('trip')!.status, 'cancelled');
assert.equal(G.items.get('a')!.summary, 'Dentist (moved)');
assert.ok(G.items.get('a')!.attendees, 'PATCH must not wipe remote-only fields');
const newItem = [...G.items.values()].find((i) => i.summary === 'Lunch')!;
assert.equal(newItem.start.timeZone, 'Europe/Skopje');
assert.ok(newItem.start.dateTime);
assert.equal(r3.events.find((e) => e.id === 'new1')!.gId, newItem.id);
assert.equal(r3.events.find((e) => e.id === 'new1')!.dirty, false);

// 4) echo of our own pushes is ignored on the next pull
cal = gcal({ gSyncToken: r3.syncToken });
let r4 = await run(G, gcal({ gSyncToken: r1.syncToken }), r3.events);
assert.equal(r4.pulled, 0, 'own pushes come back with identical etags');

// 5) remote edit and remote delete are pulled
const aItem = G.items.get('a')!;
aItem.summary = 'Dentist (remote edit)';
G.put(aItem);
G.items.get('new1') ;
const lunch = [...G.items.values()].find((i) => i.summary === 'Lunch')!;
lunch.status = 'cancelled';
G.put(lunch);
let r5 = await run(G, gcal({ gSyncToken: r3.syncToken }), r3.events);
assert.equal(r5.events.find((e) => e.gId === 'a')!.title, 'Dentist (remote edit)');
assert.equal(r5.events.find((e) => e.gId === lunch.id), undefined);

// 6) conflict: local dirty + newer wins and is pushed over the remote version
const a5 = { ...r5.events.find((e) => e.gId === 'a')!, title: 'LOCAL WINS', dirty: true, updatedAt: 9_999_999_999_999 };
const aRem = G.items.get('a')!;
aRem.summary = 'remote older';
G.put(aRem);
let r6 = await run(G, gcal({ gSyncToken: r5.syncToken }), r5.events.map((e) => (e.gId === 'a' ? a5 : e)));
assert.equal(G.items.get('a')!.summary, 'LOCAL WINS');
assert.equal(r6.events.find((e) => e.gId === 'a')!.title, 'LOCAL WINS');

// 7) sync token invalidated (410) → full re-sync; non-dirty events gone from Google disappear locally
const ghost = ev({ id: 'ghost', calendarId: 'L', title: 'Ghost', gId: 'deleted-long-ago', gEtag: '"x"', start: MON(30), end: MON(30, 10) });
G.minValid = G.version + 1;
let r7 = await run(G, gcal({ gSyncToken: 'tok1' }), [...r6.events, ghost]);
assert.equal(r7.fullResync, true);
assert.equal(r7.events.find((e) => e.id === 'ghost'), undefined);
assert.ok(r7.events.find((e) => e.gId === 'a'));

// 8) outgoing mapping: recurring master with exception must not EXDATE the exception's start
const body = toGoogle(
  ev({ title: 'Series', start: MON(26), end: MON(26, 10), rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: [MON(26 + 7), MON(26 + 14)] }),
  'Europe/Skopje', new Set([MON(26 + 7)]), false
);
const rec = body.recurrence as string[];
assert.equal(rec[0], 'RRULE:FREQ=WEEKLY;BYDAY=MO');
assert.equal(rec.length, 2);
assert.ok(rec[1].startsWith('EXDATE;TZID=Europe/Skopje:') && rec[1].includes(icsLocal(MON(26 + 14))) && !rec[1].includes(icsLocal(MON(26 + 7))));
const adBody = toGoogle(ev({ allDay: true, start: new Date(2026, 9, 30).getTime(), end: new Date(2026, 10, 2).getTime() }), 'UTC', new Set(), true) as Item;
assert.deepEqual(adBody.start, { date: '2026-10-30', dateTime: null, timeZone: null });
assert.deepEqual(adBody.end, { date: '2026-11-02', dateTime: null, timeZone: null });

// 9) read-only calendars never push; 401 surfaces as AuthError
G.calls = [];
let r9 = await run(G, gcal({ readOnly: true, gSyncToken: r7.syncToken }), [ev({ id: 'ro', calendarId: 'L', title: 'local only', start: 1, end: 2 })]);
assert.equal(r9.pushed, 0);
assert.ok(!G.calls.some((c) => c.startsWith('POST')));
G.authFail = true;
await assert.rejects(() => run(G, gcal(), []), AuthError);

console.log('selftest: all assertions passed');
