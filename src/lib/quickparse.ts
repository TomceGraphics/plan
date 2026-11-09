import { addDays, format, startOfDay } from 'date-fns';
import { dayKey, msAt, MIN } from './time';
import type { Priority } from './types';

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

type Box = { v: string };
function take(s: Box, re: RegExp): RegExpExecArray | null {
  const m = re.exec(s.v);
  if (!m) return null;
  s.v = `${s.v.slice(0, m.index)} ${s.v.slice(m.index + m[0].length)}`;
  return m;
}
const to24 = (h: number, ap?: string): number => {
  if (!ap) return h;
  const p = ap.toLowerCase() === 'pm';
  if (p && h < 12) return h + 12;
  if (!p && h === 12) return 0;
  return h;
};
const tidy = (s: string): string =>
  s.replace(/\s+/g, ' ').replace(/^(?:at|on|from|for|by)\s+/i, '').replace(/\s+(?:at|on|from|for|by)$/i, '').trim();

/** Extracts a date from the text; returns local Date at midnight or null. */
function takeDate(s: Box, now: Date): { date: Date; chip: string } | null {
  let m = take(s, /\b(today|tonight|tomorrow|tmrw|tmr)\b/i);
  if (m) {
    const w = m[1].toLowerCase();
    const d = startOfDay(now);
    return w.startsWith('tom') || w === 'tmrw' || w === 'tmr'
      ? { date: addDays(d, 1), chip: 'Tomorrow' }
      : { date: d, chip: 'Today' };
  }
  m = take(s, /\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return { date: d, chip: format(d, 'EEE d MMM') };
  }
  m = take(s, /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const m2 = m ?? take(s, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (m2) {
    const day = Number(m ? m2[1] : m2[2]);
    const mon = MONTHS.indexOf((m ? m2[2] : m2[1]).toLowerCase().slice(0, 3));
    let d = new Date(now.getFullYear(), mon, day);
    if (d.getTime() < startOfDay(now).getTime()) d = new Date(now.getFullYear() + 1, mon, day);
    return { date: d, chip: format(d, 'EEE d MMM') };
  }
  m = take(s, /\b(?:next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/i);
  if (m) {
    const target = WEEKDAYS[m[1].toLowerCase()];
    const base = startOfDay(now);
    let delta = (target - base.getDay() + 7) % 7;
    if (/^next/i.test(m[0].trim()) && delta === 0) delta = 7;
    const d = addDays(base, delta);
    return { date: d, chip: format(d, 'EEE d MMM') };
  }
  return null;
}

export interface ParsedEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  chips: string[];
}

export function parseEventText(text: string, now: Date, defaultLen: number): ParsedEvent {
  const s: Box = { v: text };
  const chips: string[] = [];

  let durMin: number | null = null;
  const dm = take(s, /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i);
  if (dm) {
    const n = Number(dm[1]);
    durMin = /^h/i.test(dm[2]) ? Math.round(n * 60) : Math.round(n);
  }

  const dt = takeDate(s, now);

  let startMin: number | null = null;
  let endMin: number | null = null;
  const range = take(
    s,
    /\b(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (range) {
    const hasMarker = range[2] || range[3] || range[5] || range[6];
    if (hasMarker) {
      const ap1 = range[3] ?? range[6];
      const ap2 = range[6] ?? range[3];
      startMin = to24(Number(range[1]), ap1) * 60 + Number(range[2] ?? 0);
      endMin = to24(Number(range[4]), ap2) * 60 + Number(range[5] ?? 0);
      if (endMin <= startMin && !ap1 && !range[6]) endMin += 12 * 60; // "9-1" → 9:00–13:00
      if (endMin <= startMin) endMin = startMin + 60;
    } else {
      s.v += ` ${range[0]}`; // not a time range (e.g. "2-3 items"); put it back
    }
  }
  if (startMin === null) {
    const single =
      take(s, /\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i) ??
      take(s, /\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i);
    if (single) {
      const hasColon = single[0].includes(':');
      const h = Number(single[1]);
      const min = hasColon ? Number(single[2]) : 0;
      const ap = hasColon ? single[3] : single[2];
      if (h <= 23 && min <= 59) startMin = to24(h, ap) * 60 + min;
    } else {
      const at = take(s, /\bat\s+(\d{1,2})\b/i);
      if (at && Number(at[1]) <= 23) startMin = Number(at[1]) * 60;
    }
  }

  const title = tidy(s.v);
  const baseDay = dt?.date ?? startOfDay(now);
  if (dt) chips.push(dt.chip);

  let allDay = false;
  let start: number;
  let end: number;
  if (startMin !== null) {
    start = msAt(baseDay, startMin);
    end = endMinOrLen(baseDay, startMin, endMin, durMin, defaultLen);
    chips.push(
      `${fmtHM(startMin)}–${fmtHM(Math.round((end - msAt(baseDay, 0)) / MIN))}`
    );
  } else if (dt) {
    allDay = true;
    start = baseDay.getTime();
    end = addDays(baseDay, 1).getTime();
    chips.push('All day');
  } else {
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    start = nextHour.getTime();
    end = start + (durMin ?? defaultLen) * MIN;
    chips.push(`${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`);
  }
  return { title, start, end, allDay, chips };
}

function endMinOrLen(day: Date, startMin: number, endMin: number | null, durMin: number | null, defLen: number): number {
  if (endMin !== null) return msAt(day, endMin);
  return msAt(day, startMin + (durMin ?? defLen));
}
const fmtHM = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export interface ParsedTask {
  title: string;
  due: string | null;
  priority: Priority;
  estimate: number | null;
  chips: string[];
}

export function parseTaskText(text: string, now: Date): ParsedTask {
  const s: Box = { v: text };
  const chips: string[] = [];
  let priority: Priority = 0;
  const p = take(s, /(?:^|\s)!(1|2|3|high|hi|med|medium|low|lo)\b/i);
  if (p) {
    const v = p[1].toLowerCase();
    priority = (v === '3' || v.startsWith('h') ? 3 : v === '2' || v.startsWith('m') ? 2 : 1) as Priority;
    chips.push(['', 'Low', 'Medium', 'High'][priority] + ' priority');
  }
  let estimate: number | null = null;
  const e = take(s, /(?:^|\s)~(\d+(?:\.\d+)?)\s*(h|m)?\b/i);
  if (e) {
    const n = Number(e[1]);
    estimate = Math.max(5, Math.round(/^h/i.test(e[2] ?? '') ? n * 60 : n));
    chips.push(`${estimate} min`);
  }
  const dt = takeDate(s, now);
  let due: string | null = null;
  if (dt) {
    due = dayKey(dt.date);
    chips.unshift(dt.chip);
  }
  return { title: tidy(s.v), due, priority, estimate, chips };
}
