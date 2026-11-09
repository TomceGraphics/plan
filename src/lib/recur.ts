import { RRule } from 'rrule';
import type { Ev, Occ } from './types';
import { DAY } from './time';

/** "Floating UTC": a Date whose UTC fields equal the local wall-clock fields. rrule works on this so DST never shifts times. */
const toFloat = (ms: number): Date => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
};
const fromFloat = (d: Date): number =>
  new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();

const cache = new Map<string, RRule | null>();
function ruleFor(ev: Ev): RRule | null {
  const key = `${ev.rrule}|${ev.start}`;
  let r = cache.get(key);
  if (r === undefined) {
    try {
      r = new RRule({ ...RRule.parseString(ev.rrule!), dtstart: toFloat(ev.start) });
    } catch {
      r = null;
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, r);
  }
  return r;
}

const single = (ev: Ev): Occ => ({
  key: ev.id, ev, start: ev.start, end: ev.end, recurring: false, origStart: ev.start
});

/** All occurrences overlapping [from, to). */
export function expand(events: Ev[], from: number, to: number): Occ[] {
  const out: Occ[] = [];
  for (const ev of events) {
    if (!ev.rrule) {
      if (ev.start < to && ev.end > from) out.push(single(ev));
      continue;
    }
    if (ev.start >= to) continue;
    const rule = ruleFor(ev);
    if (!rule) {
      if (ev.start < to && ev.end > from) out.push(single(ev));
      continue;
    }
    const dur = ev.end - ev.start;
    const dates = rule.between(toFloat(from - dur), toFloat(to), true);
    const skip = new Set(ev.exdates);
    for (const d of dates) {
      const s = fromFloat(d);
      if (skip.has(s)) continue;
      const e = ev.allDay ? s + Math.round(dur / DAY) * DAY : s + dur;
      const end = ev.allDay ? fromFloat(new Date(d.getTime() + Math.round(dur / DAY) * DAY)) : e;
      if (s < to && end > from) {
        out.push({ key: `${ev.id}@${s}`, ev, start: s, end, recurring: true, origStart: s });
      }
    }
  }
  return out;
}

/** First occurrence starting at/after `from` (for palette hints). */
export function nextOccurrence(ev: Ev, from: number): number | null {
  if (!ev.rrule) return ev.end > from ? ev.start : null;
  const rule = ruleFor(ev);
  if (!rule) return null;
  const skip = new Set(ev.exdates);
  let cursor = toFloat(from);
  for (let i = 0; i < 20; i++) {
    const d = rule.after(cursor, true);
    if (!d) return null;
    const s = fromFloat(d);
    if (!skip.has(s)) return s;
    cursor = new Date(d.getTime() + 1000);
  }
  return null;
}

export type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';

export const PRESETS: { id: Exclude<Preset, 'custom'>; label: string; rule: string | null }[] = [
  { id: 'none', label: 'Does not repeat', rule: null },
  { id: 'daily', label: 'Every day', rule: 'FREQ=DAILY' },
  { id: 'weekdays', label: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { id: 'weekly', label: 'Every week', rule: 'FREQ=WEEKLY' },
  { id: 'biweekly', label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { id: 'monthly', label: 'Every month', rule: 'FREQ=MONTHLY' },
  { id: 'yearly', label: 'Every year', rule: 'FREQ=YEARLY' }
];

export function presetOf(rule: string | null): Preset {
  if (!rule) return 'none';
  const hit = PRESETS.find((p) => p.rule === rule);
  return hit ? hit.id : 'custom';
}

export function describeRule(rule: string | null): string {
  if (!rule) return 'Does not repeat';
  const p = PRESETS.find((x) => x.rule === rule);
  if (p) return p.label;
  try {
    const t = RRule.fromString(rule).toText();
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return 'Custom';
  }
}
