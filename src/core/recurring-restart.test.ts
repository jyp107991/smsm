/**
 * S10 (owner: "make start dates for recurring payments editable after you upload one"): a regular payment that has
 * posted takes a new start. `restart(schedule, today)` is the database's rule (recurring_guard, migration
 * 20261124000000): the new start is the anchor (REC-2) and every occurrence of the new schedule on or before today
 * counts as done (`done`, the server's new posted_count), so the change posts nothing; `next` is the first occurrence
 * after today (null when the end date comes first). `on` is what the sheet's sentence needs: the weekday, the day of
 * the month or the day and month, and whether shorter months (or common years) move it to their last day. The
 * comparison with the database's own expression is tests/unit/recurring-sql.test.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { pence } from './money';
import { dueOccurrences, occurrence, pastOccurrences, restart, type Schedule } from './recurring';

const sched = (frequency: Schedule['frequency'], startDate: string, every = 1, endDate: string | null = null): Schedule => ({ frequency, every, startDate, endDate });

describe('restart', () => {
  it('monthly, moved to the 15th on Tue 24 Nov 2026: 11 days done (15 Jan … 15 Nov), next Tue 15 Dec', () => {
    expect(restart(sched('monthly', '2026-01-15'), '2026-11-24')).toEqual({
      done: 11, next: '2026-12-15', on: { frequency: 'monthly', every: 1, weekday: 4, day: 15, month: 1, shorter: false },
    });
  });

  it('a new day that falls today is done (it doesn’t post today); the next is a period on', () => {
    expect(restart(sched('monthly', '2026-01-24'), '2026-11-24')).toMatchObject({ done: 11, next: '2026-12-24' });
    expect(restart(sched('weekly', '2026-11-10'), '2026-11-24')).toMatchObject({ done: 3, next: '2026-12-01' });
    expect(restart(sched('monthly', '2026-11-24'), '2026-11-24')).toMatchObject({ done: 1, next: '2026-12-24' });
  });

  it('a start after today: nothing done, the start is next', () => {
    expect(restart(sched('monthly', '2027-01-05'), '2026-11-24')).toMatchObject({ done: 0, next: '2027-01-05' });
    expect(restart(sched('monthly', '2026-11-25'), '2026-11-24')).toMatchObject({ done: 0, next: '2026-11-25' });
  });

  it('to the 31st: the next is 30 Nov, then 31 Dec; shorter months take their last day', () => {
    const s = sched('monthly', '2026-01-31');
    const r = restart(s, '2026-11-24');
    expect(r).toMatchObject({ done: 10, next: '2026-11-30', on: { day: 31, shorter: true } });
    expect(occurrence(s, r.done + 1)).toBe('2026-12-31');
    expect(restart(sched('monthly', '2026-01-29'), '2026-11-24').on.shorter).toBe(true);
    expect(restart(sched('monthly', '2026-01-28'), '2026-11-24').on.shorter).toBe(false);
  });

  it('weekly names its weekday (Monday = 1 … Sunday = 7)', () => {
    expect(restart(sched('weekly', '2026-11-02'), '2026-11-24')).toEqual({
      done: 4, next: '2026-11-30', on: { frequency: 'weekly', every: 1, weekday: 1, day: 2, month: 11, shorter: false },
    });
    expect(restart(sched('weekly', '2026-11-22', 2), '2026-11-24')).toMatchObject({ done: 1, next: '2026-12-06', on: { weekday: 7, every: 2 } });
  });

  it('yearly from 29 Feb: 28 Feb in common years, 29 Feb again in a leap year', () => {
    const r = restart(sched('yearly', '2024-02-29'), '2026-11-24');
    expect(r).toEqual({ done: 3, next: '2027-02-28', on: { frequency: 'yearly', every: 1, weekday: 4, day: 29, month: 2, shorter: true } });
    expect(restart(sched('yearly', '2024-02-29'), '2027-03-01').next).toBe('2028-02-29');
    expect(restart(sched('yearly', '2025-12-15'), '2026-11-24')).toMatchObject({ done: 1, next: '2026-12-15', on: { day: 15, month: 12, shorter: false } });
  });

  it('to before the first posting: everything since counts as done', () => {
    expect(restart(sched('monthly', '2024-11-01'), '2026-11-24')).toMatchObject({ done: 25, next: '2026-12-01' });
  });

  it('an end before the next day: nothing more posts (next is null); an end on the next day keeps it', () => {
    expect(restart(sched('monthly', '2026-01-15', 1, '2026-12-14'), '2026-11-24')).toMatchObject({ done: 11, next: null });
    expect(restart(sched('monthly', '2026-01-15', 1, '2026-12-15'), '2026-11-24')).toMatchObject({ done: 11, next: '2026-12-15' });
  });

  it('every must be a whole number of at least 1', () => {
    expect(() => restart(sched('monthly', '2026-01-15', 0), '2026-11-24')).toThrow(RangeError);
  });

  const dateArb = fc.integer({ min: Date.UTC(1990, 0, 1) / 86_400_000, max: Date.UTC(2045, 11, 31) / 86_400_000 })
    .map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
  const scheduleArb = fc.record({
    frequency: fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'),
    every: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 52 })),
    startDate: fc.oneof(dateArb, fc.tuple(fc.integer({ min: 1995, max: 2045 }), fc.constantFrom('01-31', '03-30', '08-31', '01-29')).map(([y, md]) => `${String(y)}-${md}`)),
    endDate: fc.constant(null),
  });

  it('property: done counts exactly the occurrences on or before today; next is the first after it', () => {
    fc.assert(fc.property(scheduleArb, dateArb, (s, today) => {
      const r = restart(s, today);
      expect(r.done).toBe(dueOccurrences(s, 0, today).length);
      expect(r.next).toBe(occurrence(s, r.done));
      expect(r.next !== null && r.next > today).toBe(true);
      if (r.done > 0) expect(occurrence(s, r.done - 1) <= today).toBe(true);
    }), { numRuns: 400, seed: 20261124 });
  });

  it('property: never anything past or today from the change; one more done than the past-start count when today is a day', () => {
    fc.assert(fc.property(scheduleArb, dateArb, (s, today) => {
      const r = restart(s, today);
      const past = pastOccurrences({ schedule: s, amount: pence(100) }, today);
      expect(r.done).toBe(past.count + (past.nextDate === today ? 1 : 0));
      // Posting from `done` on (what post_due_recurring does) by today posts nothing.
      expect(dueOccurrences(s, r.done, today)).toEqual([]);
      expect(dueOccurrences(s, r.done, addDays(today, -1))).toEqual([]);
    }), { numRuns: 400, seed: 20261125 });
  });

  it('property: the words are the start’s own day', () => {
    fc.assert(fc.property(scheduleArb, dateArb, (s, today) => {
      const { on } = restart(s, today);
      expect(on.day).toBe(Number(s.startDate.slice(8)));
      expect(on.month).toBe(Number(s.startDate.slice(5, 7)));
      expect(on.shorter).toBe((s.frequency === 'monthly' && on.day > 28) || (s.frequency === 'yearly' && on.month === 2 && on.day === 29));
    }), { numRuns: 200, seed: 20261126 });
  });
});
