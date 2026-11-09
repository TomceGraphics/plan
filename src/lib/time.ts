import {
  addDays, addMonths, endOfMonth, format, getISODay, isSameDay, startOfDay, startOfMonth, startOfWeek
} from 'date-fns';
import type { ViewMode } from './types';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const dayStart = (ms: number | Date): number => startOfDay(ms).getTime();
export const minutesOfDay = (ms: number): number => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};
/** local ms for `minutes` after local midnight of `day` (DST-safe via Date fields) */
export const msAt = (day: Date | number, minutes: number): number => {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.round(minutes)).getTime();
};
export const snap = (minutes: number, step = 15): number => Math.round(minutes / step) * step;
export const snapMs = (ms: number, step = 15): number => {
  const d = new Date(ms);
  return msAt(d, snap(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, step));
};
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const dayKey = (d: Date | number): string => format(d, 'yyyy-MM-dd');
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const fmtTime = (ms: number, hour24: boolean): string =>
  hour24 ? format(ms, 'HH:mm') : format(ms, 'h:mm a').replace(':00 ', ' ').toLowerCase();
export const fmtHourLabel = (h: number, hour24: boolean): string => {
  if (hour24) return `${String(h).padStart(2, '0')}:00`;
  if (h === 0) return '12 am';
  if (h < 12) return `${h} am`;
  if (h === 12) return '12 pm';
  return `${h - 12} pm`;
};

export interface Range {
  start: Date;
  /** exclusive */
  end: Date;
  days: Date[];
}

export function rangeFor(view: ViewMode, cursor: Date, weekStart: 0 | 1 | 6, weekends: boolean): Range {
  const c = startOfDay(cursor);
  let days: Date[];
  if (view === 'day') {
    days = [c];
  } else if (view === 'week') {
    const s = startOfWeek(c, { weekStartsOn: weekStart });
    days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    if (!weekends) days = days.filter((d) => getISODay(d) < 6);
  } else {
    const s = startOfWeek(startOfMonth(c), { weekStartsOn: weekStart });
    days = Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }
  return { start: days[0], end: addDays(days[days.length - 1], 1), days };
}

export function shiftCursor(view: ViewMode, cursor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(cursor, dir);
  if (view === 'week') return addDays(cursor, 7 * dir);
  return addMonths(cursor, dir);
}

export function titleFor(view: ViewMode, r: Range, cursor: Date): string {
  if (view === 'day') return format(cursor, 'EEEE, d MMMM yyyy');
  if (view === 'month') return format(cursor, 'MMMM yyyy');
  const a = r.days[0];
  const b = r.days[r.days.length - 1];
  if (a.getMonth() === b.getMonth()) return `${format(a, 'd')} – ${format(b, 'd MMMM yyyy')}`;
  if (a.getFullYear() === b.getFullYear()) return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`;
  return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`;
}

export const sameDay = isSameDay;
export { addDays, addMonths, endOfMonth, startOfMonth };

export function relDayLabel(d: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return format(d, 'EEEE');
  return format(d, d.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'd MMM yyyy');
}

/** Parse "9", "930", "9:30", "9.30", "9pm", "9:30 pm", "21:15" → minutes after midnight, or null. */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\./g, ':');
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}
