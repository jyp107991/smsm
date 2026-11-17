/**
 * Recurring dates (SPEC REC-2). Occurrence k falls on start + k·step, always counted from the start date, so
 * monthly dates anchor to it: 31 Jan → 28/29 Feb → 31 Mar, never drifting to the 28th. This is exactly how
 * post_due_recurring() computes dates in the database; a test compares the two for random schedules.
 */
import { addDays, addMonths, addYears, type IsoDate } from './dates';

export interface Schedule { frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate; endDate: IsoDate | null }

export function occurrence(s: Schedule, k: number): IsoDate {
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
