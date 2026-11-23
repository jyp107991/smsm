/**
 * Recurring dates (SPEC REC-2). Occurrence k falls on start + k·step, always counted from the start date, so
 * monthly dates anchor to it: 31 Jan → 28/29 Feb → 31 Mar, never drifting to the 28th. This is exactly how
 * post_due_recurring() computes dates in the database; a test compares the two for random schedules.
 */
import { addDays, addMonths, addYears, daysBetween, type IsoDate } from './dates';
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
