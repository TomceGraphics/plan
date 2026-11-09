import { addDays, startOfDay } from 'date-fns';
import { openDb, select, setDbErrorHandler, write } from './db';
import { googleSignIn, googleSignOut, googleCancel, googleStatus, gApi, onAuthUrl } from './google';
import { uid } from './ids';
import { expand } from './recur';
import { Q } from './sql';
import { AuthError, listGoogleCalendars, syncCalendar, type CalSyncResult, type GCalendar } from './sync';
import { setTheme } from './theme';
import { call } from './tauri';
import { DAY, dayKey, dayStart, minutesOfDay, MIN, msAt, rangeFor, shiftCursor } from './time';
import type { Cal, Ev, Occ, Priority, Settings, Task, ViewMode } from './types';
import { CAL_COLORS, DEFAULT_SETTINGS } from './types';
import { ui } from './ui.svelte';

interface CalRow {
  id: string; name: string; color: string; visible: number; sort: number; g_id: string | null;
  g_sync_token: string | null; read_only: number;
}
interface EvRow {
  id: string; calendar_id: string; title: string; notes: string; location: string; start_ms: number;
  end_ms: number; all_day: number; rrule: string | null; exdates: string; task_id: string | null;
  done: number; created_at: number; updated_at: number; g_id: string | null; g_etag: string | null;
  dirty: number; g_master: string | null; g_orig: number | null;
}
interface TaskRow {
  id: string; title: string; notes: string; due: string | null; priority: number; done: number;
  done_at: number | null; parent_id: string | null; sort: number; estimate: number | null;
  created_at: number; updated_at: number;
}

interface Snapshot {
  label: string;
  calendars: Cal[];
  events: Ev[];
  tasks: Task[];
}

function parseExdates(s: string): number[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Shift a local wall-clock instant by whole days + minutes without DST drift. */
export function shiftWall(ms: number, days: number, minutes: number): number {
  return msAt(addDays(dayStart(ms), days), minutesOfDay(ms) + minutes);
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function shiftByday(rule: string, days: number): string {
  if (!days) return rule;
  return rule.replace(/BYDAY=([A-Z0-9,+-]+)/, (_m, list: string) => {
    const out = list.split(',').map((tok) => {
      const m = /^([+-]?\d*)([A-Z]{2})$/.exec(tok);
      if (!m) return tok;
      const i = WD.indexOf(m[2]);
      return i < 0 ? tok : `${m[1]}${WD[(((i + days) % 7) + 7) % 7]}`;
    });
    return `BYDAY=${out.join(',')}`;
  });
}

class Store {
  calendars = $state.raw<Cal[]>([]);
  events = $state.raw<Ev[]>([]);
  tasks = $state.raw<Task[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  cursor = $state<Date>(startOfDay(new Date()));
  now = $state(Date.now());
  ready = $state(false);
  persisted = $state(false);
  selectedKey = $state<string | null>(null);
  deletions = $state.raw<{ gId: string; gCal: string }[]>([]);
  google = $state({ connected: false, builtinClient: false, busy: false, error: null as string | null, connecting: false, authUrl: null as string | null });
  private syncTimer: ReturnType<typeof setTimeout> | undefined;

  range = $derived(rangeFor(this.settings.view, this.cursor, this.settings.weekStart, this.settings.showWeekends));
  calMap = $derived(new Map(this.calendars.map((c) => [c.id, c])));
  taskMap = $derived(new Map(this.tasks.map((t) => [t.id, t])));
  visibleEvents = $derived(this.events.filter((e) => this.calMap.get(e.calendarId)?.visible !== false));
  occs = $derived(expand(this.visibleEvents, this.range.start.getTime(), this.range.end.getTime()));
  eventsByTask = $derived.by(() => {
    const m = new Map<string, Ev[]>();
    for (const e of this.events) {
      if (!e.taskId) continue;
      const a = m.get(e.taskId);
      if (a) a.push(e);
      else m.set(e.taskId, [e]);
    }
    return m;
  });
  childrenByTask = $derived.by(() => {
    const m = new Map<string, Task[]>();
    for (const t of this.tasks) {
      if (!t.parentId) continue;
      const a = m.get(t.parentId);
      if (a) a.push(t);
      else m.set(t.parentId, [t]);
    }
    for (const a of m.values()) a.sort((x, y) => x.sort - y.sort);
    return m;
  });

  private undoStack: Snapshot[] = [];

  // ───────────────────────── lifecycle

  async init(): Promise<void> {
    setDbErrorHandler((m) => ui.toast(m));
    try {
      this.persisted = await openDb();
      const [cals, evs, tks, sets] = await Promise.all([
        select<CalRow>(Q.loadCalendars),
        select<EvRow>(Q.loadEvents),
        select<TaskRow>(Q.loadTasks),
        select<{ key: string; value: string }>(Q.loadSettings)
      ]);
      this.calendars = cals.map((r) => ({
        id: r.id, name: r.name, color: r.color, visible: !!r.visible, sort: r.sort, gId: r.g_id,
        gSyncToken: r.g_sync_token, readOnly: !!r.read_only
      }));
      this.events = evs.map((r) => ({
        id: r.id, calendarId: r.calendar_id, title: r.title, notes: r.notes, location: r.location,
        start: r.start_ms, end: r.end_ms, allDay: !!r.all_day, rrule: r.rrule || null,
        exdates: parseExdates(r.exdates), taskId: r.task_id, done: !!r.done,
        createdAt: r.created_at, updatedAt: r.updated_at, gId: r.g_id, gEtag: r.g_etag, dirty: !!r.dirty,
        gMasterId: r.g_master, gOrigStart: r.g_orig
      }));
      this.deletions = (await select<{ g_id: string; g_cal: string }>(Q.loadDeletions)).map((d) => ({ gId: d.g_id, gCal: d.g_cal }));
      this.tasks = tks.map((r) => ({
        id: r.id, title: r.title, notes: r.notes, due: r.due, priority: (r.priority as Priority) ?? 0,
        done: !!r.done, doneAt: r.done_at, parentId: r.parent_id, sort: r.sort, estimate: r.estimate,
        createdAt: r.created_at, updatedAt: r.updated_at
      }));
      const s: Record<string, unknown> = {};
      for (const row of sets) {
        try {
          s[row.key] = JSON.parse(row.value);
        } catch {
          /* ignore corrupt setting */
        }
      }
      this.settings = { ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) };
    } catch (e) {
      ui.toast(`Could not open the database: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (this.calendars.length === 0) {
      this.addCalendar('Personal', CAL_COLORS[0]);
      this.addCalendar('Work', CAL_COLORS[1]);
    }
    setTheme(this.settings.theme);
    void call('set_close_to_tray', { enabled: this.settings.closeToTray });
    this.ready = true;
    void this.googleInit();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    write(Q.setSetting, [key, JSON.stringify(value)]);
    if (key === 'theme') setTheme(value as Settings['theme']);
    if (key === 'closeToTray') void call('set_close_to_tray', { enabled: value });
  }

  // ───────────────────────── navigation

  setView(v: ViewMode): void {
    this.setSetting('view', v);
  }
  goTo(d: Date): void {
    this.cursor = startOfDay(d);
  }
  today(): void {
    this.cursor = startOfDay(new Date());
  }
  step(dir: 1 | -1): void {
    this.cursor = shiftCursor(this.settings.view, this.cursor, dir);
  }

  // ───────────────────────── undo

  checkpoint(label: string): void {
    this.undoStack.push({ label, calendars: this.calendars, events: this.events, tasks: this.tasks });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }
  undo(): string | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.restore(snap);
    return snap.label;
  }
  private restore(s: Snapshot): void {
    const cur = { cals: this.calendars, evs: this.events, tks: this.tasks };
    const diff = <T extends { id: string }>(a: T[], b: T[], del: string, save: (x: T) => void, onDel?: (x: T) => void) => {
      const bm = new Map(b.map((x) => [x.id, x]));
      const am = new Map(a.map((x) => [x.id, x]));
      for (const x of a) {
        if (bm.has(x.id)) continue;
        write(del, [x.id]);
        onDel?.(x);
      }
      for (const x of b) if (am.get(x.id) !== x) save(x);
    };
    diff(cur.cals, s.calendars, Q.deleteCalendar, (c) => this.saveCal(c));
    diff(cur.evs, s.events, Q.deleteEvent, (e) => this.saveEv(e), (e) => this.tombstone(e));
    diff(cur.tks, s.tasks, Q.deleteTask, (t) => this.saveTask(t));
    this.calendars = s.calendars;
    this.events = s.events;
    this.tasks = s.tasks;
  }

  // ───────────────────────── calendars

  private saveCal(c: Cal): void {
    write(Q.upsertCalendar, [c.id, c.name, c.color, c.visible ? 1 : 0, c.sort, Date.now(), c.gId, c.gSyncToken, c.readOnly ? 1 : 0]);
  }
  addCalendar(name: string, color?: string): Cal {
    const c: Cal = {
      id: uid(), name, color: color ?? CAL_COLORS[this.calendars.length % CAL_COLORS.length],
      visible: true, sort: this.calendars.length, gId: null, gSyncToken: null, readOnly: false
    };
    this.calendars = [...this.calendars, c];
    this.saveCal(c);
    return c;
  }
  updateCalendar(id: string, patch: Partial<Cal>): void {
    this.calendars = this.calendars.map((c) => {
      if (c.id !== id) return c;
      const n = { ...c, ...patch };
      this.saveCal(n);
      return n;
    });
  }
  async deleteCalendar(id: string): Promise<void> {
    if (this.calendars.length <= 1) {
      ui.toast('You need at least one calendar.');
      return;
    }
    const count = this.events.filter((e) => e.calendarId === id).length;
    const name = this.calMap.get(id)?.name ?? 'calendar';
    const a = await ui.ask({
      title: `Delete “${name}”?`,
      message: count ? `Its ${count} event${count === 1 ? '' : 's'} will be deleted too. You can undo this.` : undefined,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', kind: 'danger' }
      ]
    });
    if (a !== 'delete') return;
    this.checkpoint('delete calendar');
    this.events = this.events.filter((e) => e.calendarId !== id);
    this.calendars = this.calendars.filter((c) => c.id !== id);
    write(Q.deleteEventsOfCalendar, [id]);
    write(Q.deleteCalendar, [id]);
    if (this.settings.defaultCalendar === id) this.setSetting('defaultCalendar', null);
    ui.toast(`Deleted “${name}”`, { label: 'Undo', run: () => void this.undo() });
  }
  defaultCalendarId(): string {
    const d = this.settings.defaultCalendar;
    if (d && this.calMap.has(d)) return d;
    const writable = this.calendars.filter((c) => !c.readOnly);
    return (writable.find((c) => c.visible) ?? writable[0] ?? this.calendars[0]).id;
  }

  // ───────────────────────── events

  /** `local` = a user edit (marks synced events dirty); false for results coming from Google or local-only fields. */
  private saveEv(e: Ev, local = true): void {
    if (local) {
      const c = this.calMap.get(e.calendarId);
      if (c?.gId && !c.readOnly) {
        e.dirty = true;
        this.scheduleSync();
      }
    }
    if (e.gId) write(Q.removeDeletionById, [e.gId]);
    write(Q.upsertEvent, [
      e.id, e.calendarId, e.title, e.notes, e.location, e.start, e.end, e.allDay ? 1 : 0, e.rrule,
      JSON.stringify(e.exdates), e.taskId, e.done ? 1 : 0, e.createdAt, e.updatedAt,
      e.gId, e.gEtag, e.dirty ? 1 : 0, e.gMasterId, e.gOrigStart
    ]);
  }
  /** Remember a local deletion so it can be propagated to Google. */
  private tombstone(e: Ev): void {
    const c = this.calMap.get(e.calendarId);
    if (!e.gId || !c?.gId || c.readOnly) return;
    this.deletions = [...this.deletions.filter((d) => d.gId !== e.gId), { gId: e.gId, gCal: c.gId }];
    write(Q.addDeletion, [e.gId, c.gId]);
    this.scheduleSync();
  }
  private normalize(e: Ev): Ev {
    const minLen = e.allDay ? DAY / 2 : 15 * MIN;
    return e.end - e.start < minLen ? { ...e, end: e.start + (e.allDay ? DAY : 15 * MIN) } : e;
  }
  createEvent(init: Partial<Ev> & { start: number; end: number }, opts: { checkpoint?: boolean } = {}): Ev {
    if (opts.checkpoint !== false) this.checkpoint('create event');
    const now = Date.now();
    const e = this.normalize({
      id: uid(), calendarId: this.defaultCalendarId(), title: '', notes: '', location: '', allDay: false,
      rrule: null, exdates: [], taskId: null, done: false, createdAt: now, updatedAt: now,
      gId: null, gEtag: null, dirty: false, gMasterId: null, gOrigStart: null, ...init
    });
    this.events = [...this.events, e];
    this.saveEv(e);
    return e;
  }
  updateEvent(id: string, patch: Partial<Ev>): Ev | undefined {
    let out: Ev | undefined;
    this.events = this.events.map((e) => {
      if (e.id !== id) return e;
      out = this.normalize({ ...e, ...patch, updatedAt: Date.now() });
      this.saveEv(out);
      return out;
    });
    return out;
  }
  removeEvent(id: string): void {
    const gone = this.events.find((e) => e.id === id);
    if (gone) this.tombstone(gone);
    this.events = this.events.filter((e) => e.id !== id);
    write(Q.deleteEvent, [id]);
  }

  /**
   * Edit one occurrence. For recurring events, `scope` decides whether the whole series
   * shifts ('all') or this occurrence is detached into its own standalone event ('this').
   * `patch.start/end` are the NEW times of the occurrence. Returns the occurrence after the edit.
   */
  editOccurrence(occ: Occ, patch: Partial<Ev>, scope: 'this' | 'all'): Occ {
    const ev = occ.ev;
    if (!occ.recurring) {
      const n = this.updateEvent(ev.id, patch) ?? ev;
      const rec = !!n.rrule;
      return { key: rec ? `${n.id}@${n.start}` : n.id, ev: n, start: n.start, end: n.end, recurring: rec, origStart: n.start };
    }
    if (scope === 'this') {
      const now = Date.now();
      const copy = this.normalize({
        ...ev, ...patch, id: uid(), rrule: null, exdates: [], taskId: null, done: false,
        gId: null, gEtag: null, dirty: false, gMasterId: null, gOrigStart: null,
        start: patch.start ?? occ.start, end: patch.end ?? occ.end, createdAt: now, updatedAt: now
      });
      this.events = [
        ...this.events.map((e) => {
          if (e.id !== ev.id) return e;
          const m = { ...e, exdates: [...e.exdates, occ.origStart], updatedAt: now };
          this.saveEv(m);
          return m;
        }),
        copy
      ];
      this.saveEv(copy);
      return { key: copy.id, ev: copy, start: copy.start, end: copy.end, recurring: false, origStart: copy.start };
    }
    // whole series
    const newStart = patch.start ?? occ.start;
    const newEnd = patch.end ?? occ.end;
    const dd = Math.round((dayStart(newStart) - dayStart(occ.start)) / DAY);
    const dm = minutesOfDay(newStart) - minutesOfDay(occ.start);
    const dur = newEnd - newStart;
    const { start: _s, end: _e, ...rest } = patch;
    void _s;
    void _e;
    const mStart = shiftWall(ev.start, dd, dm);
    const allDay = rest.allDay ?? ev.allDay;
    const rule = rest.rrule !== undefined ? rest.rrule : ev.rrule && dd ? shiftByday(ev.rrule, dd) : ev.rrule;
    const n = this.updateEvent(ev.id, {
      ...rest, rrule: rule, start: mStart, end: allDay ? mStart + Math.max(DAY, Math.round(dur / DAY) * DAY) : mStart + dur,
      exdates: ev.exdates.map((x) => shiftWall(x, dd, dm))
    }) ?? ev;
    const origStart = shiftWall(occ.origStart, dd, dm);
    return { key: `${n.id}@${origStart}`, ev: n, start: newStart, end: newEnd, recurring: true, origStart };
  }

  /** Delete one occurrence (recurring: this one or the whole series). */
  async deleteOccurrence(occ: Occ, silent = false): Promise<boolean> {
    if (this.isReadOnly(occ.ev)) {
      ui.toast('This Google calendar is read-only.');
      return false;
    }
    let scope: 'this' | 'all' = 'all';
    if (occ.recurring) {
      const a = await ui.ask({
        title: 'Delete recurring event',
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'This event', value: 'this' },
          { label: 'All events', value: 'all', kind: 'danger' }
        ]
      });
      if (a !== 'this' && a !== 'all') return false;
      scope = a;
    }
    this.checkpoint('delete event');
    if (occ.recurring && scope === 'this') {
      this.updateEvent(occ.ev.id, { exdates: [...occ.ev.exdates, occ.origStart] });
    } else {
      this.removeEvent(occ.ev.id);
    }
    if (this.selectedKey === occ.key) this.selectedKey = null;
    if (!silent) ui.toast('Event deleted', { label: 'Undo', run: () => void this.undo() });
    return true;
  }

  /** Move/resize with the recurring-scope question. Returns false when cancelled. */
  isReadOnly(ev: Ev): boolean {
    return !!this.calMap.get(ev.calendarId)?.readOnly;
  }

  async moveOccurrence(occ: Occ, start: number, end: number, extra: Partial<Ev> = {}): Promise<boolean> {
    if (this.isReadOnly(occ.ev)) {
      ui.toast('This Google calendar is read-only.');
      return false;
    }
    if (start === occ.start && end === occ.end && Object.keys(extra).length === 0) return false;
    let scope: 'this' | 'all' = 'all';
    if (occ.recurring) {
      const a = await ui.ask({
        title: 'Edit recurring event',
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'This event', value: 'this' },
          { label: 'All events', value: 'all', kind: 'primary' }
        ]
      });
      if (a !== 'this' && a !== 'all') return false;
      scope = a;
    }
    this.checkpoint('move event');
    const n = this.editOccurrence(occ, { ...extra, start, end }, scope);
    this.selectedKey = n.key;
    return true;
  }

  toggleEventDone(ev: Ev): void {
    if (ev.taskId && this.taskMap.has(ev.taskId)) this.toggleTask(ev.taskId);
    else this.updateEvent(ev.id, { done: !ev.done });
  }

  // ───────────────────────── tasks

  private saveTask(t: Task): void {
    write(Q.upsertTask, [
      t.id, t.title, t.notes, t.due, t.priority, t.done ? 1 : 0, t.doneAt, t.parentId, t.sort, t.estimate,
      t.createdAt, t.updatedAt
    ]);
  }
  createTask(init: Partial<Task> & { title: string }, opts: { checkpoint?: boolean } = {}): Task {
    if (opts.checkpoint !== false) this.checkpoint('create task');
    const now = Date.now();
    const t: Task = {
      id: uid(), notes: '', due: null, priority: 0, done: false, doneAt: null, parentId: null,
      sort: now, estimate: null, createdAt: now, updatedAt: now, ...init
    };
    this.tasks = [...this.tasks, t];
    this.saveTask(t);
    return t;
  }
  updateTask(id: string, patch: Partial<Task>): void {
    this.tasks = this.tasks.map((t) => {
      if (t.id !== id) return t;
      const n = { ...t, ...patch, updatedAt: Date.now() };
      this.saveTask(n);
      return n;
    });
    if (patch.title !== undefined) {
      for (const e of this.eventsByTask.get(id) ?? []) this.updateEvent(e.id, { title: patch.title });
    }
  }
  /** Completing a task completes its time blocks (and open subtasks); toggling back reopens it. */
  toggleTask(id: string): void {
    const t = this.taskMap.get(id);
    if (!t) return;
    this.checkpoint(t.done ? 'reopen task' : 'complete task');
    const done = !t.done;
    const affected = [t, ...(done ? (this.childrenByTask.get(id) ?? []).filter((c) => !c.done) : [])];
    const ids = new Set(affected.map((a) => a.id));
    const now = Date.now();
    this.tasks = this.tasks.map((x) => {
      if (!ids.has(x.id)) return x;
      const n = { ...x, done, doneAt: done ? now : null, updatedAt: now };
      this.saveTask(n);
      return n;
    });
    this.events = this.events.map((e) => {
      if (!e.taskId || !ids.has(e.taskId) || e.done === done) return e;
      const n = { ...e, done, updatedAt: now };
      this.saveEv(n, false);
      return n;
    });
  }
  removeTask(id: string): void {
    this.checkpoint('delete task');
    const kids = (this.childrenByTask.get(id) ?? []).map((k) => k.id);
    const ids = new Set([id, ...kids]);
    for (const tid of ids) {
      write(Q.deleteTask, [tid]);
      for (const e of this.eventsByTask.get(tid) ?? []) {
        write(Q.deleteEvent, [e.id]);
        this.tombstone(e);
      }
    }
    this.events = this.events.filter((e) => !e.taskId || !ids.has(e.taskId));
    this.tasks = this.tasks.filter((t) => !ids.has(t.id));
    ui.toast('Task deleted', { label: 'Undo', run: () => void this.undo() });
  }
  /** Time-block a task onto the calendar. */
  timeBlock(task: Task, start: number, end: number, allDay: boolean): Ev {
    this.checkpoint('time-block task');
    return this.createEvent(
      { title: task.title, taskId: task.id, start, end, allDay, done: task.done },
      { checkpoint: false }
    );
  }
  // ───────────────────────── Google Calendar

  private async googleInit(): Promise<void> {
    const st = await googleStatus();
    this.google.connected = st.connected;
    this.google.builtinClient = st.builtinClient;
    if (st.connected) setTimeout(() => void this.syncGoogle(), 1500);
  }

  scheduleSync(): void {
    if (!this.google.connected) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncGoogle(), 6000);
  }

  async googleConnect(clientId?: string, clientSecret?: string): Promise<boolean> {
    this.google.connecting = true;
    this.google.error = null;
    this.google.authUrl = null;
    const off = await onAuthUrl((u) => (this.google.authUrl = u));
    try {
      await googleSignIn(clientId, clientSecret);
      this.google.connected = true;
      const list = await listGoogleCalendars(gApi);
      this.setSetting('googleEmail', list.find((c) => c.primary)?.id ?? null);
      return true;
    } catch (e) {
      const m = String(e instanceof Error ? e.message : e);
      if (!m.includes('cancelled')) this.google.error = m;
      return false;
    } finally {
      off();
      this.google.connecting = false;
      this.google.authUrl = null;
    }
  }
  googleAbort(): void {
    void googleCancel();
  }
  async googleDisconnect(): Promise<void> {
    for (const c of this.calendars.filter((x) => x.gId)) this.unlinkCalendar(c.id);
    try {
      await googleSignOut();
    } catch {
      /* already gone */
    }
    this.google.connected = false;
    this.setSetting('googleEmail', null);
    this.setSetting('googleLastSync', null);
  }

  googleCalendarList(): Promise<GCalendar[]> {
    return listGoogleCalendars(gApi);
  }

  /** Link a Google calendar to an existing local calendar, or create a new local one. */
  linkCalendar(g: GCalendar, localId: string | 'new'): void {
    if (localId === 'new') {
      const c = this.addCalendar(g.name, g.color);
      this.updateCalendar(c.id, { gId: g.id, gSyncToken: null, readOnly: g.readOnly });
    } else {
      this.updateCalendar(localId, { gId: g.id, gSyncToken: null, readOnly: g.readOnly });
    }
    void this.syncGoogle();
  }
  unlinkCalendar(localId: string): void {
    const cal = this.calMap.get(localId);
    if (!cal?.gId) return;
    const g = cal.gId;
    this.events = this.events.map((e) => {
      if (e.calendarId !== localId) return e;
      const n = { ...e, gId: null, gEtag: null, dirty: false, gMasterId: null, gOrigStart: null };
      this.saveEv(n, false);
      return n;
    });
    this.deletions = this.deletions.filter((d) => d.gCal !== g);
    write(Q.clearCalendarDeletions, [g]);
    this.updateCalendar(localId, { gId: null, gSyncToken: null, readOnly: false });
  }

  async syncGoogle(): Promise<void> {
    if (!this.google.connected || this.google.busy) return;
    this.google.busy = true;
    this.google.error = null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      for (const cal of this.calendars.filter((c) => c.gId)) {
        const input = this.events.filter((e) => e.calendarId === cal.id);
        const dels = this.deletions.filter((d) => d.gCal === cal.gId).map((d) => d.gId);
        const res = await syncCalendar(gApi, { cal, events: input, deletions: dels, now: Date.now(), tz, newId: uid });
        this.applySync(cal.id, input, res);
        if (res.errors.length) this.google.error = `Some changes could not be synced: ${res.errors.slice(0, 2).join('; ')}`;
      }
      this.setSetting('googleLastSync', Date.now());
    } catch (e) {
      if (e instanceof AuthError) {
        this.google.connected = false;
        this.google.error = 'Google sign-in expired. Connect again in Settings.';
      } else {
        this.google.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      this.google.busy = false;
    }
  }

  /** Merge a sync result into memory + SQLite without losing edits made while the request was in flight. */
  private applySync(calId: string, input: Ev[], res: CalSyncResult): void {
    const before = new Map(input.map((e) => [e.id, e]));
    const current = new Map(this.events.filter((e) => e.calendarId === calId).map((e) => [e.id, e]));
    const next: Ev[] = [];
    const seen = new Set<string>();
    const cal = this.calMap.get(calId);
    for (const r of res.events) {
      seen.add(r.id);
      const was = before.get(r.id);
      const cur = current.get(r.id);
      if (was && !cur) {
        // deleted locally during the sync: do not resurrect; make sure a freshly created remote copy is removed too
        if (r.gId && !was.gId && cal?.gId) {
          this.deletions = [...this.deletions, { gId: r.gId, gCal: cal.gId }];
          write(Q.addDeletion, [r.gId, cal.gId]);
        }
        continue;
      }
      if (was && cur && cur !== was) {
        const m = { ...cur, gId: r.gId ?? cur.gId, gEtag: r.gEtag ?? cur.gEtag, dirty: true };
        this.saveEv(m, false);
        next.push(m);
        continue;
      }
      if (r !== was) this.saveEv(r, false);
      next.push(r);
    }
    for (const [id, e] of before) {
      if (!seen.has(id) && current.has(id)) write(Q.deleteEvent, [e.id]);
    }
    for (const [id, e] of current) if (!before.has(id)) next.push(e); // created during the sync
    this.events = [...this.events.filter((e) => e.calendarId !== calId), ...next];
    for (const gid of res.doneDeletions) {
      write(Q.removeDeletion, [gid, cal?.gId ?? '']);
      this.deletions = this.deletions.filter((d) => d.gId !== gid);
    }
    if (cal && res.syncToken !== cal.gSyncToken) this.updateCalendar(calId, { gSyncToken: res.syncToken });
  }

  blockLength(task: Task): number {
    return (task.estimate ?? this.settings.defaultLen) * MIN;
  }
  dueKeyToday = $derived(dayKey(this.now));
}

export const store = new Store();
