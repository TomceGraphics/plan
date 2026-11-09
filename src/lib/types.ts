export type ViewMode = 'day' | 'week' | 'month';
export type Priority = 0 | 1 | 2 | 3;
export type ThemeSetting = 'system' | 'light' | 'dark';
export type TaskFilter = 'today' | 'upcoming' | 'all';

export interface Cal {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  sort: number;
  /** Google calendar id when this calendar is synced, else null */
  gId: string | null;
  gSyncToken: string | null;
  readOnly: boolean;
}

export interface Ev {
  id: string;
  calendarId: string;
  title: string;
  notes: string;
  location: string;
  /** epoch ms. All-day events: local midnight of the first day. */
  start: number;
  /** epoch ms, exclusive. All-day events: local midnight of the day after the last day. */
  end: number;
  allDay: boolean;
  /** RRULE body without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  rrule: string | null;
  /** original start times (epoch ms) of removed/detached occurrences */
  exdates: number[];
  taskId: string | null;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  /** Google event id once synced */
  gId: string | null;
  gEtag: string | null;
  /** modified locally since the last successful sync */
  dirty: boolean;
  /** Google: id of the recurring series this standalone instance belongs to */
  gMasterId: string | null;
  /** Google: original start of that instance (epoch ms) */
  gOrigStart: number | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** yyyy-MM-dd (local) or null */
  due: string | null;
  priority: Priority;
  done: boolean;
  doneAt: number | null;
  parentId: string | null;
  sort: number;
  /** minutes, used as default time-block length */
  estimate: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One concrete instance of an event (recurring events expand into many). */
export interface Occ {
  key: string;
  ev: Ev;
  start: number;
  end: number;
  recurring: boolean;
  /** start of this occurrence before any edits (key for exdates) */
  origStart: number;
}

export interface Settings {
  theme: ThemeSetting;
  weekStart: 0 | 1 | 6;
  hour24: boolean;
  defaultLen: number;
  closeToTray: boolean;
  showWeekends: boolean;
  sidebar: boolean;
  view: ViewMode;
  taskFilter: TaskFilter;
  showDone: boolean;
  hourPx: number;
  defaultCalendar: string | null;
  googleEmail: string | null;
  googleLastSync: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStart: 1,
  hour24: true,
  defaultLen: 60,
  closeToTray: false,
  showWeekends: true,
  sidebar: true,
  view: 'week',
  taskFilter: 'all',
  showDone: false,
  hourPx: 52,
  defaultCalendar: null,
  googleEmail: null,
  googleLastSync: null
};

export const CAL_COLORS = [
  '#4a5be8', '#0ea5a4', '#16a34a', '#d9a400',
  '#f0722a', '#e23b5a', '#a24bd9', '#64748b'
];
