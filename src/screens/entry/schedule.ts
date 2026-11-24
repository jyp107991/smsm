/**
 * S3 (REC-1, REC-6): the regular payment half of the form. A template is entered exactly like an entry (amount,
 * description, category, who paid, the split) plus its schedule, kept as typed until Save. The schedule anchors
 * to the day the person picks in "Starts" (monthly on that day of the month, weekly on that weekday, yearly on
 * that date), which can be any day, past or future, not just the day it was entered.
 */
import { addDays, addYears, formatDate, formatShortDate, type IsoDate } from '../../core/dates';
import { occurrencesBetween, restart, type Frequency, type Schedule } from '../../core/recurring';
import type { ExpenseRow, RecurringRow } from '../../data';
import { strings } from '../../ui/strings';
import type { Person } from '../shared/words';
import { formFromRow, type FormState } from './form';

export interface ScheduleState {
  frequency: Frequency;
  everyText: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  amountVaries: boolean;
  isSubscription: boolean;
}

export function blankSchedule(startDate: IsoDate): ScheduleState {
  return { frequency: 'monthly', everyText: '1', startDate, endDate: null, amountVaries: false, isSubscription: false };
}

export function scheduleOf(t: RecurringRow): ScheduleState {
  return {
    frequency: t.frequency as Frequency, everyText: String(t.every), startDate: t.start_date, endDate: t.end_date,
    amountVaries: t.amount_varies, isSubscription: t.is_subscription,
  };
}

/** The form for a template, as the person would have entered it (its money read back like an entry's). */
export function formFromTemplate(t: RecurringRow, people: readonly Person[], date: IsoDate): FormState {
  const row = { ...t, kind: 'expense', date, tags: [], refund_of: null } as unknown as ExpenseRow;
  return formFromRow(row, people);
}

/** "Every": a whole number from 1 to 52, or null. */
export function everyOf(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 52 ? n : null;
}

/**
 * REC-6: the month a price change takes effect: the first occurrence after the day it was made (an occurrence
 * on that day had already posted). "December", or "January 2028" in another year.
 */
export function fromMonth(t: RecurringRow, changedOn: IsoDate, today: IsoDate): string | null {
  const next = occurrencesBetween(
    { frequency: t.frequency as Frequency, every: t.every, startDate: t.start_date, endDate: null },
    addDays(changedOn, 1), addYears(changedOn, 3),
  )[0];
  if (next === undefined) return null;
  const name = strings.datePicker.months[Number(next.slice(5, 7)) - 1] ?? '';
  return next.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${next.slice(0, 4)}`;
}

/**
 * S10: under Starts, when a regular payment that has posted takes a new start: what it repeats on from now on, its
 * next day and that past payments stay ("From now on it posts on the 15th. Next: Tue 15 Dec. Past payments stay as
 * they are."). The dates are the core's (`restart`, the database's rule).
 */
export function restartLine(s: Schedule, today: IsoDate): string {
  const { next, on } = restart(s, today);
  const weekday = strings.datePicker.weekdays[on.weekday - 1]?.[1] ?? '';
  // A date in the start's own year reads "15 Dec" whichever year that is (the year is the next date's business).
  const date = formatShortDate(s.startDate, s.startDate);
  const words = on.frequency === 'weekly' ? strings.recurring.onWeekday(on.every, weekday)
    : on.frequency === 'monthly' ? strings.recurring.onDayOfMonth(on.every, on.day, on.shorter)
      : strings.recurring.onDate(on.every, date, on.shorter);
  return strings.recurring.restartLine(words, next === null ? null : formatDate(next, today));
}
