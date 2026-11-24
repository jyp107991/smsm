/**
 * Recurring dates (SPEC REC-2). Occurrence k falls on start + k·step, always counted from the start date, so
 * monthly dates anchor to it: 31 Jan → 28/29 Feb → 31 Mar, never drifting to the 28th. This is exactly how
 * post_due_recurring() computes dates in the database; a test compares the two for random schedules.
 */
import { addDays, addMonths, addYears, daysBetween, weekday, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import { normaliseKey } from './text';

export interface Schedule { frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate; endDate: IsoDate | null }

export function occurrence(s: Schedule, k: number): IsoDate {
  if (!Number.isInteger(s.every) || s.every < 1) throw new RangeError('every must be a whole number of at least 1');
  switch (s.frequency) {
    case 'weekly':
      return addDays(s.startDate, 7 * s.every * k);
    case 'monthly':
      return addMonths(s.startDate, s.every * k);
    case 'yearly':
      return addYears(s.startDate, s.every * k);
  }
}

/** Every occurrence from number `postedCount` onward that is due by `today` and not after the end date. */
export function dueOccurrences(s: Schedule, postedCount: number, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = postedCount; ; k += 1) {
    const d = occurrence(s, k);
    if (d > today || (s.endDate !== null && d > s.endDate)) break;
    out.push(d);
  }
  return out;
}

// ───────── S9: a start date in the past ─────────

export interface PastOccurrences {
  /** The occurrences before today (and not after the end date): saving posts them all at once. */
  count: number;
  /** What they come to, exactly: count × the amount. */
  totalPence: Pence;
  /** The first occurrence on or after today, not after the end date: the start the sheet offers instead. */
  nextDate: IsoDate | null;
}

/**
 * What a template's start date in the past would post as soon as it is saved (post_due_recurring posts every
 * occurrence due by the UK today; one today posts today, as for any payment starting today, so it is not counted).
 * The dates are `occurrence`'s, which are the database's (tests/unit/recurring-sql.test.ts).
 */
export function pastOccurrences(t: { schedule: Schedule; amount: Pence }, today: IsoDate): PastOccurrences {
  let count = 0;
  let nextDate: IsoDate | null = null;
  const last = t.schedule.endDate ?? '9999-12-31';
  for (let k = 0; ; k += 1) {
    const d = occurrence(t.schedule, k);
    if (d > last) break;
    if (d >= today) {
      nextDate = d;
      break;
    }
    count += 1;
  }
  return { count, totalPence: pence(count * t.amount), nextDate };
}

/**
 * Whether the schedule started afresh on its occurrence `d` gives the same dates from then on (REC-2's anchor). Weekly
 * always does. Monthly and yearly do when `d` is on the start's own day of the month; an occurrence cut short
 * by a shorter month (30 Nov from the 31st) or a common year (28 Feb from 29 Feb) does not: started there, it would
 * repeat on the shorter day.
 */
export function keepsAnchor(s: Schedule, d: IsoDate): boolean {
  // A yearly occurrence is always in the start's month, so for both it is the day of the month that tells.
  return s.frequency === 'weekly' || d.slice(8) === s.startDate.slice(8);
}

// ───────── S10: a new start after one has posted; deleting one that has stopped ─────────

/**
 * Running: not paused, and not ended (one that ends today has had its last day). Only a template that isn't running
 * can be deleted, and a deleted one never runs again (recurring_guard checks the same with the UK today).
 */
export function isRunning(t: { active: boolean; endDate: IsoDate | null }, today: IsoDate): boolean {
  return t.active && (t.endDate === null || t.endDate > today);
}

/** What a schedule repeats on, for the sheet's sentence ("From now on it posts on the 15th."). */
export interface RepeatsOn {
  frequency: Schedule['frequency'];
  every: number;
  /** The start's weekday, Monday = 1 … Sunday = 7 (what weekly repeats on). */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** The start's day of the month and month (what monthly and yearly repeat on). */
  day: number;
  month: number;
  /** Shorter months (from the 29th, 30th or 31st) or common years (from 29 Feb) take their last day instead. */
  shorter: boolean;
}

export interface Restart {
  /** The occurrences of the new schedule on or before today: they count as done and never post (the server's new posted_count). */
  done: number;
  /** The first occurrence after today, not after the end date; null when the end comes first. */
  next: IsoDate | null;
  on: RepeatsOn;
}

/**
 * A new start on a regular payment that has posted, as the database applies it (recurring_guard, migration
 * 20261124000000): the start is the anchor (REC-2), every occurrence on or before today counts as done, so the change
 * posts nothing (a new day that falls today included: that period's bill posted on the old day), and the next
 * occurrence is the first after today. The dates are `occurrence`'s, which are the database's
 * (tests/unit/recurring-sql.test.ts).
 */
export function restart(s: Schedule, today: IsoDate): Restart {
  let done = 0;
  while (occurrence(s, done) <= today) done += 1;
  const first = occurrence(s, done);
  const day = Number(s.startDate.slice(8, 10));
  const month = Number(s.startDate.slice(5, 7));
  return {
    done,
    next: s.endDate !== null && first > s.endDate ? null : first,
    on: {
      frequency: s.frequency, every: s.every, weekday: weekday(s.startDate), day, month,
      shorter: s.frequency === 'monthly' ? day > 28 : s.frequency === 'yearly' && month === 2 && day === 29,
    },
  };
}

// ───────── S3: what regular payments cost, what is coming up, and "looks monthly" ─────────

export type Frequency = Schedule['frequency'];
const PER_YEAR: Record<Frequency, number> = { weekly: 52, monthly: 12, yearly: 1 };

function checkEvery(every: number): void {
  if (!Number.isInteger(every) || every < 1) throw new RangeError('every must be a whole number of at least 1');
}

/** n ÷ d to the nearest penny, halves up (n ≥ 0, d > 0), exactly. */
function roundHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/** REC-8: the cost a month, worked out exactly and rounded once to the nearest penny, halves up. */
export function monthlyCost(s: Pick<Schedule, 'frequency' | 'every'>, amount: Pence): Pence {
  checkEvery(s.every);
  return pence(roundHalfUp(amount * PER_YEAR[s.frequency], 12 * s.every));
}

/** REC-7: the cost a year, rounded the same way. */
export function yearlyCost(s: Pick<Schedule, 'frequency' | 'every'>, amount: Pence): Pence {
  checkEvery(s.every);
  return pence(roundHalfUp(amount * PER_YEAR[s.frequency], s.every));
}

/** Every occurrence from number `fromIndex` within [from, to], never after the end date, in order. */
export function occurrencesBetween(s: Schedule, from: IsoDate, to: IsoDate, fromIndex = 0): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = fromIndex; ; k += 1) {
    const d = occurrence(s, k);
    if (d > to || (s.endDate !== null && d > s.endDate)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface UpcomingTemplate {
  id: string; description: string; amount: Pence; amountVaries: boolean; active: boolean; postedCount: number; schedule: Schedule;
}
export interface UpcomingBill { id: string; description: string; date: IsoDate; amount: Pence; amountVaries: boolean }

/** The occurrences not posted yet of the active templates, up to `to` (from `from` when given), by date then description. */
export function upcoming(templates: readonly UpcomingTemplate[], window: { from?: IsoDate; to: IsoDate }): UpcomingBill[] {
  const out: UpcomingBill[] = [];
  for (const t of templates) {
    if (!t.active) continue;
    for (const date of occurrencesBetween(t.schedule, window.from ?? '0000-01-01', window.to, t.postedCount)) {
      out.push({ id: t.id, description: t.description, date, amount: t.amount, amountVaries: t.amountVaries });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.description < b.description ? -1 : a.description > b.description ? 1 : 0));
}

export interface SuggestEntry { description: string; amount: Pence; date: IsoDate }
export interface RecurringSuggestion {
  key: string; description: string; frequency: Frequency; every: number; amount: Pence; lastDate: IsoDate; nextDate: IsoDate;
}

/** The steady intervals that read as a schedule (days, inclusive), REC-5. */
const WINDOWS: readonly { min: number; max: number; frequency: Frequency; every: number }[] = [
  { min: 6, max: 8, frequency: 'weekly', every: 1 },
  { min: 13, max: 15, frequency: 'weekly', every: 2 },
  { min: 26, max: 35, frequency: 'monthly', every: 1 },
  { min: 86, max: 96, frequency: 'monthly', every: 3 },
  { min: 358, max: 372, frequency: 'yearly', every: 1 },
];

function stepFrom(d: IsoDate, frequency: Frequency, every: number): IsoDate {
  return frequency === 'weekly' ? addDays(d, 7 * every) : frequency === 'monthly' ? addMonths(d, every) : addYears(d, every);
}

/** REC-5: descriptions whose last three entries came at a steady interval with similar amounts, recently. */
export function suggestRecurring(history: readonly SuggestEntry[], today: IsoDate, exclude?: ReadonlySet<string>): RecurringSuggestion[] {
  const skip = new Set([...(exclude ?? [])].map(normaliseKey));
  const groups = new Map<string, SuggestEntry[]>();
  for (const e of history) {
    const key = normaliseKey(e.description);
    if (key === '' || skip.has(key)) continue;
    const g = groups.get(key);
    if (g) g.push(e); else groups.set(key, [e]);
  }
  const out: RecurringSuggestion[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 3) continue;
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const [a, b, c] = sorted.slice(-3) as [SuggestEntry, SuggestEntry, SuggestEntry];
    if (a.date === b.date || b.date === c.date) continue;
    const g1 = daysBetween(a.date, b.date);
    const g2 = daysBetween(b.date, c.date);
    const w = WINDOWS.find((x) => g1 >= x.min && g1 <= x.max && g2 >= x.min && g2 <= x.max);
    if (!w) continue;
    const amounts = [a.amount, b.amount, c.amount];
    if (10 * Math.max(...amounts) > 11 * Math.min(...amounts)) continue;
    if (daysBetween(c.date, today) > w.max) continue;
    out.push({ key, description: c.description, frequency: w.frequency, every: w.every, amount: c.amount, lastDate: c.date, nextDate: stepFrom(c.date, w.frequency, w.every) });
  }
  return out.sort((x, y) => (x.lastDate > y.lastDate ? -1 : x.lastDate < y.lastDate ? 1 : x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
