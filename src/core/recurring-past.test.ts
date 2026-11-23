/**
 * S9 (OPEN_ITEMS, "A regular payment started long ago back-posts every occurrence at once"): what a start date in the
 * past would post the moment the template is saved. `pastOccurrences(template, today)` counts the occurrences before
 * today (on or before the end date), what they come to in pence, and the first occurrence on or after today: the
 * day the sheet offers as "Start from … instead". The dates are REC-2's (`occurrence`, start + k·step, anchored to
 * the start); the comparison with the database's own expression is tests/unit/recurring-sql.test.ts. An occurrence
 * today is not "past": it posts today as any new payment starting today does.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pence } from './money';
import { dueOccurrences, keepsAnchor, occurrence, pastOccurrences, type Schedule } from './recurring';

const monthly = (startDate: string, endDate: string | null = null, every = 1): Schedule => ({ frequency: 'monthly', every, startDate, endDate });

describe('pastOccurrences', () => {
  it('rent from 1 Jan 2025 on 23 Nov 2026: 23 past payments, £33,350.00, next Tue 1 Dec', () => {
    expect(pastOccurrences({ schedule: monthly('2025-01-01'), amount: pence(145_000) }, '2026-11-23'))
      .toEqual({ count: 23, totalPence: 3_335_000, nextDate: '2026-12-01' });
  });

  it('the example in the brief: 22 past payments of £1,450.00 are £31,900.00', () => {
    expect(pastOccurrences({ schedule: monthly('2025-01-24'), amount: pence(145_000) }, '2026-11-23'))
      .toEqual({ count: 22, totalPence: 3_190_000, nextDate: '2026-11-24' });
  });

  it('an occurrence today is not past: it is the next date', () => {
    expect(pastOccurrences({ schedule: monthly('2026-10-23'), amount: pence(1000) }, '2026-11-23'))
      .toEqual({ count: 1, totalPence: 1000, nextDate: '2026-11-23' });
    expect(pastOccurrences({ schedule: monthly('2026-11-23'), amount: pence(1000) }, '2026-11-23'))
      .toEqual({ count: 0, totalPence: 0, nextDate: '2026-11-23' });
  });

  it('a start today or later has nothing past', () => {
    expect(pastOccurrences({ schedule: monthly('2027-01-05'), amount: pence(500) }, '2026-11-23'))
      .toEqual({ count: 0, totalPence: 0, nextDate: '2027-01-05' });
  });

  it('a start yesterday has one past payment', () => {
    expect(pastOccurrences({ schedule: { frequency: 'weekly', every: 1, startDate: '2026-11-22', endDate: null }, amount: pence(1200) }, '2026-11-23'))
      .toEqual({ count: 1, totalPence: 1200, nextDate: '2026-11-29' });
  });

  it('monthly dates keep the start as their anchor (REC-2): from 31 Jan the next is 30 Nov, never the 28th', () => {
    expect(pastOccurrences({ schedule: monthly('2026-01-31'), amount: pence(100) }, '2026-11-23'))
      .toEqual({ count: 10, totalPence: 1000, nextDate: '2026-11-30' });
    expect(pastOccurrences({ schedule: monthly('2026-01-31'), amount: pence(100) }, '2026-12-01').nextDate).toBe('2026-12-31');
  });

  it('weekly every 2 and yearly on 29 Feb', () => {
    expect(pastOccurrences({ schedule: { frequency: 'weekly', every: 2, startDate: '2026-10-01', endDate: null }, amount: pence(1200) }, '2026-11-23'))
      .toEqual({ count: 4, totalPence: 4800, nextDate: '2026-11-26' });
    expect(pastOccurrences({ schedule: { frequency: 'yearly', every: 1, startDate: '2024-02-29', endDate: null }, amount: pence(9500) }, '2026-11-23'))
      .toEqual({ count: 3, totalPence: 28_500, nextDate: '2027-02-28' });
  });

  it('the end date: occurrences after it are neither past nor next', () => {
    // ended before today: everything is past, nothing comes next
    expect(pastOccurrences({ schedule: monthly('2026-01-10', '2026-03-10'), amount: pence(3000) }, '2026-11-23'))
      .toEqual({ count: 3, totalPence: 9000, nextDate: null });
    // the end date itself counts, and one day before excludes it
    expect(pastOccurrences({ schedule: monthly('2026-01-10', '2026-03-09'), amount: pence(3000) }, '2026-11-23').count).toBe(2);
    // ending today with an occurrence today: today's is next
    expect(pastOccurrences({ schedule: monthly('2026-10-23', '2026-11-23'), amount: pence(3000) }, '2026-11-23'))
      .toEqual({ count: 1, totalPence: 3000, nextDate: '2026-11-23' });
    // ending before the next one: no next
    expect(pastOccurrences({ schedule: monthly('2026-10-20', '2026-11-22'), amount: pence(3000) }, '2026-11-23'))
      .toEqual({ count: 2, totalPence: 6000, nextDate: null });
    // ending before it starts: nothing at all
    expect(pastOccurrences({ schedule: monthly('2026-10-20', '2026-10-19'), amount: pence(3000) }, '2026-11-23'))
      .toEqual({ count: 0, totalPence: 0, nextDate: null });
  });

  it('the total is exact pence at the largest amount and a long weekly history', () => {
    const r = pastOccurrences({ schedule: { frequency: 'weekly', every: 1, startDate: '1990-01-01', endDate: null }, amount: pence(100_000_000) }, '2026-11-23');
    expect(r.count).toBe(1925);
    expect(r.totalPence).toBe(192_500_000_000);
    expect(Number.isSafeInteger(r.totalPence)).toBe(true);
  });

  it('every must be a whole number of at least 1, as occurrence()', () => {
    expect(() => pastOccurrences({ schedule: monthly('2026-01-01', null, 0), amount: pence(1) }, '2026-11-23')).toThrow(RangeError);
  });

  it('property: count is what dueOccurrences would post up to yesterday, nextDate the first occurrence on or after today, and moving the start there leaves nothing past', () => {
    const day = fc.integer({ min: Date.UTC(2015, 0, 1) / 86_400_000, max: Date.UTC(2035, 11, 31) / 86_400_000 }).map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(fc.property(
      fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'), fc.integer({ min: 1, max: 6 }), day, day, fc.option(day, { nil: null }), fc.integer({ min: 1, max: 500_000 }),
      (frequency, every, startDate, today, endDate, amount) => {
        const schedule: Schedule = { frequency, every, startDate, endDate };
        const r = pastOccurrences({ schedule, amount: pence(amount) }, today);
        const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        const due = dueOccurrences(schedule, 0, yesterday);
        expect(r.count).toBe(due.length);
        expect(r.totalPence).toBe(due.length * amount);
        const next = occurrence(schedule, r.count);
        expect(r.nextDate).toBe(endDate !== null && next > endDate ? null : next);
        if (r.nextDate !== null) {
          expect(r.nextDate >= today).toBe(true);
          const moved = pastOccurrences({ schedule: { ...schedule, startDate: r.nextDate }, amount: pence(amount) }, today);
          expect(moved.count).toBe(0);
          expect(moved.nextDate).toBe(r.nextDate);
        }
      },
    ), { numRuns: 400, seed: 20261123 });
  });
});

describe('keepsAnchor: whether starting afresh on an occurrence keeps every later date (REC-2)', () => {
  it('monthly from the 31st: a 31st keeps it, a shorter month-end does not', () => {
    expect(keepsAnchor(monthly('2026-01-31'), '2026-12-31')).toBe(true);
    expect(keepsAnchor(monthly('2026-01-31'), '2026-11-30')).toBe(false);
    expect(keepsAnchor(monthly('2026-01-31'), '2026-02-28')).toBe(false);
    expect(keepsAnchor(monthly('2026-01-24'), '2026-11-24')).toBe(true);
    expect(keepsAnchor(monthly('2026-01-30', null, 3), '2026-04-30')).toBe(true);
  });

  it('yearly from 29 Feb: 28 Feb in a common year does not; weekly always does', () => {
    expect(keepsAnchor({ frequency: 'yearly', every: 1, startDate: '2024-02-29', endDate: null }, '2027-02-28')).toBe(false);
    expect(keepsAnchor({ frequency: 'yearly', every: 1, startDate: '2024-02-29', endDate: null }, '2028-02-29')).toBe(true);
    expect(keepsAnchor({ frequency: 'yearly', every: 1, startDate: '2024-03-31', endDate: null }, '2026-03-31')).toBe(true);
    expect(keepsAnchor({ frequency: 'weekly', every: 2, startDate: '2026-01-31', endDate: null }, '2026-11-28')).toBe(true);
  });

  it('property: it is true exactly when the schedule restarted there gives the same next 24 dates', () => {
    const day = fc.integer({ min: Date.UTC(2015, 0, 1) / 86_400_000, max: Date.UTC(2035, 11, 31) / 86_400_000 }).map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(fc.property(
      fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'), fc.integer({ min: 1, max: 4 }),
      fc.oneof(day, fc.tuple(fc.integer({ min: 2015, max: 2035 }), fc.constantFrom('01-29', '01-30', '01-31', '03-31')).map(([y, md]) => `${String(y)}-${md}`), fc.integer({ min: 504, max: 508 }).map((q) => `${String(4 * q)}-02-29`)),
      fc.integer({ min: 0, max: 40 }),
      (frequency, every, startDate, k) => {
        const s: Schedule = { frequency, every, startDate, endDate: null };
        const d = occurrence(s, k);
        const restarted: Schedule = { ...s, startDate: d };
        let same = true;
        for (let j = 0; j < 24; j += 1) if (occurrence(restarted, j) !== occurrence(s, k + j)) same = false;
        expect(keepsAnchor(s, d)).toBe(same);
      },
    ), { numRuns: 400, seed: 20261124 });
  });
});
