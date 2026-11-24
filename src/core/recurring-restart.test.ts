/**
 * S10 (owner: "make start dates for recurring payments editable after you upload one"; the rule decided after the fresh
 * review, DECISIONS 24 Nov). `restart(old, postedCount, newStart)` is the database's rule (recurring_restart_index,
 * migration 20261124000000): D (`instead`) is the old schedule's first day not yet posted; the next payment (`next`) is
 * the new schedule's occurrence nearest to D, a tie to the later one; `done` (the server's new posted_count) counts the
 * new occurrences before it. One on or before today posts as normal, on its own date. `on` is what the sheet's sentence
 * needs. The comparison with the database's own function is tests/unit/recurring-sql.test.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { daysBetween } from './dates';
import { pence } from './money';
import { monthlyCost, occurrence, restart, upcoming, yearlyCost, type Schedule } from './recurring';

const sched = (frequency: Schedule['frequency'], startDate: string, every = 1, endDate: string | null = null): Schedule => ({ frequency, every, startDate, endDate });

describe('restart', () => {
  it('the review’s first example: 15th → 5th on 10 Nov (D = 15 Nov): next is 5 Nov, before today, posting at once', () => {
    // Monthly from 15 Jan, posted through 15 Oct (10): D = 15 Nov.
    expect(restart(sched('monthly', '2026-01-15'), 10, '2026-01-05')).toEqual({
      done: 10, next: '2026-11-05', instead: '2026-11-15', on: { frequency: 'monthly', every: 1, weekday: 1, day: 5, month: 1, shorter: false },
    });
  });

  it('the review’s second example: 1st → 25th on 24 Nov (D = 1 Dec): next is 25 Nov', () => {
    expect(restart(sched('monthly', '2026-01-01'), 11, '2026-01-25')).toMatchObject({ done: 10, next: '2026-11-25', instead: '2026-12-01' });
  });

  it('nearest after D: 1st → 15th with D = 1 Dec gives 15 Dec (14 days) over 15 Nov (16)', () => {
    expect(restart(sched('monthly', '2026-01-01'), 11, '2026-01-15')).toMatchObject({ done: 11, next: '2026-12-15', instead: '2026-12-01' });
  });

  it('a tie takes the later: every 2 weeks, D = 16 Nov, new days 9 Nov and 23 Nov', () => {
    expect(restart(sched('weekly', '2026-11-02', 2), 1, '2026-10-26')).toMatchObject({ done: 2, next: '2026-11-23', instead: '2026-11-16' });
  });

  it('weekly, moving the weekday: Mondays → Fridays (D = Mon 30 Nov): Fri 27 Nov is nearer than Fri 4 Dec; Thursdays: Thu 3 Dec', () => {
    expect(restart(sched('weekly', '2026-11-02'), 4, '2026-11-06')).toEqual({
      done: 3, next: '2026-11-27', instead: '2026-11-30', on: { frequency: 'weekly', every: 1, weekday: 5, day: 6, month: 11, shorter: false },
    });
    expect(restart(sched('weekly', '2026-11-02'), 4, '2026-11-05')).toMatchObject({ done: 4, next: '2026-12-03' });
  });

  it('to the 31st: D = 1 Dec, nearest is 30 Nov; shorter months take their last day; the 31st comes back', () => {
    const r = restart(sched('monthly', '2026-01-01'), 11, '2026-01-31');
    expect(r).toMatchObject({ done: 10, next: '2026-11-30', instead: '2026-12-01', on: { day: 31, shorter: true } });
    expect(occurrence(sched('monthly', '2026-01-31'), r.done + 1)).toBe('2026-12-31');
    expect(restart(sched('monthly', '2026-01-01'), 11, '2026-01-29').on.shorter).toBe(true);
    expect(restart(sched('monthly', '2026-01-01'), 11, '2026-01-28').on.shorter).toBe(false);
  });

  it('yearly from 29 Feb: D = 2 Mar 2027 gives 28 Feb 2027; 29 Feb comes back in 2028', () => {
    const r = restart(sched('yearly', '2025-03-02'), 2, '2024-02-29');
    expect(r).toEqual({ done: 3, next: '2027-02-28', instead: '2027-03-02', on: { frequency: 'yearly', every: 1, weekday: 4, day: 29, month: 2, shorter: true } });
    expect(occurrence(sched('yearly', '2024-02-29'), r.done + 1)).toBe('2028-02-29');
  });

  it('every 3 months: D = 1 Jan 2027; from 20 Mar the days are 20 Dec and 20 Mar: 20 Dec is nearer; from 15 Feb, 15 Feb 2027', () => {
    expect(restart(sched('monthly', '2026-01-01', 3), 4, '2026-03-20')).toMatchObject({ done: 3, next: '2026-12-20', instead: '2027-01-01' });
    expect(restart(sched('monthly', '2026-01-01', 3), 4, '2026-02-15')).toMatchObject({ done: 4, next: '2027-02-15' });
  });

  it('a start after D: the start itself is next, nothing done', () => {
    expect(restart(sched('monthly', '2026-01-01'), 11, '2027-03-10')).toMatchObject({ done: 0, next: '2027-03-10', instead: '2026-12-01' });
  });

  it('the same day as before: nothing changes', () => {
    expect(restart(sched('monthly', '2026-01-01'), 11, '2025-06-01')).toMatchObject({ done: 18, next: '2026-12-01', instead: '2026-12-01' });
  });

  it('an end before the next day: nothing more posts (next is null); D after the end is null too', () => {
    expect(restart(sched('monthly', '2026-01-01', 1, '2026-12-10'), 11, '2026-01-15')).toMatchObject({ done: 11, next: null, instead: '2026-12-01' });
    expect(restart(sched('monthly', '2026-01-01', 1, '2026-11-20'), 11, '2026-01-15')).toMatchObject({ next: null, instead: null });
  });

  it('an end on the next payment keeps it; an end on D keeps D', () => {
    expect(restart(sched('monthly', '2026-01-01', 1, '2026-12-15'), 11, '2026-01-15')).toMatchObject({ next: '2026-12-15', instead: '2026-12-01' });
    expect(restart(sched('monthly', '2026-01-01', 1, '2026-12-01'), 11, '2026-01-15')).toMatchObject({ next: null, instead: '2026-12-01' });
    expect(restart(sched('monthly', '2026-01-01', 1, '2026-12-01'), 11, '2026-01-22')).toMatchObject({ next: '2026-11-22', instead: '2026-12-01' });
  });

  it('every must be a whole number of at least 1', () => {
    expect(() => restart(sched('monthly', '2026-01-15', 0), 3, '2026-01-01')).toThrow('every must be a whole number of at least 1');
    expect(() => monthlyCost({ frequency: 'monthly', every: 0 }, pence(100))).toThrow('every must be a whole number of at least 1');
    expect(() => yearlyCost({ frequency: 'monthly', every: 0 }, pence(100))).toThrow('every must be a whole number of at least 1');
  });

  it('upcoming: bills on the same day are in description order, whichever template comes first', () => {
    const t = (id: string, description: string) => ({ id, description, amount: pence(100), amountVaries: false, active: true, postedCount: 0, schedule: sched('monthly', '2026-12-01') });
    const names = (ts: ReturnType<typeof t>[]) => upcoming(ts, { from: '2026-12-01', to: '2026-12-01' }).map((b) => b.description);
    expect(names([t('a', 'Water'), t('b', 'Energy')])).toEqual(['Energy', 'Water']);
    expect(names([t('b', 'Energy'), t('a', 'Water')])).toEqual(['Energy', 'Water']);
    expect(names([t('a', 'Water'), t('b', 'Energy'), t('c', 'Rent')])).toEqual(['Energy', 'Rent', 'Water']);
  });

  const dateArb = fc.integer({ min: Date.UTC(1990, 0, 1) / 86_400_000, max: Date.UTC(2045, 11, 31) / 86_400_000 })
    .map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
  const startArb = fc.oneof(dateArb, fc.tuple(fc.integer({ min: 1995, max: 2045 }), fc.constantFrom('01-31', '03-30', '08-31', '01-29', '02-28')).map(([y, md]) => `${String(y)}-${md}`),
    fc.integer({ min: 499, max: 511 }).map((q) => `${String(4 * q)}-02-29`));
  const caseArb = fc.record({
    frequency: fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'),
    every: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 52 })),
    oldStart: startArb,
    posted: fc.integer({ min: 0, max: 40 }),
    newStart: startArb,
  });

  it('property: next is the new occurrence nearest to D, a tie to the later; done counts the ones before it', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const old: Schedule = { frequency: c.frequency, every: c.every, startDate: c.oldStart, endDate: null };
      const fresh: Schedule = { ...old, startDate: c.newStart };
      const r = restart(old, c.posted, c.newStart);
      const d = occurrence(old, c.posted);
      expect(r.instead).toBe(d);
      expect(r.next).toBe(occurrence(fresh, r.done));
      const dist = (k: number) => Math.abs(daysBetween(occurrence(fresh, k), d));
      if (r.done > 0) expect(dist(r.done - 1)).toBeGreaterThanOrEqual(dist(r.done));
      if (r.done > 0) expect(occurrence(fresh, r.done - 1) < d).toBe(true);
      expect(dist(r.done + 1)).toBeGreaterThan(dist(r.done));
    }), { numRuns: 500, seed: 20261124 });
  });

  it('property: the words are the new start’s own day', () => {
    fc.assert(fc.property(caseArb, (c) => {
      const { on } = restart({ frequency: c.frequency, every: c.every, startDate: c.oldStart, endDate: null }, c.posted, c.newStart);
      expect(on.day).toBe(Number(c.newStart.slice(8)));
      expect(on.month).toBe(Number(c.newStart.slice(5, 7)));
      expect(on.shorter).toBe((c.frequency === 'monthly' && on.day > 28) || (c.frequency === 'yearly' && on.month === 2 && on.day === 29));
    }), { numRuns: 200, seed: 20261126 });
  });
});
