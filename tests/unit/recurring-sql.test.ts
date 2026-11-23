/// <reference types="node" />
/**
 * REC-2: the phone's recurring dates must be the database's. post_due_recurring
 * (supabase/migrations/20261116000100_hardening.sql) posts occurrence k on
 *   (r.start_date + step * r.posted_count)::date
 * with step = make_interval(weeks|months|years => r.every). This compares occurrence(s, k) with exactly that
 * expression for 500 seeded random schedules. Runs only when a PostgreSQL is reachable (PGHOST set; always in CI).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import { occurrence, pastOccurrences, type Schedule } from '../../src/core/recurring';
import { pence } from '../../src/core/money';

const DAY_MS = 86_400_000;
const dayNumber = (d: string): number => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
};
const fromDayNumber = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

function psql(sql: string, database = process.env.PGDATABASE ?? 'postgres'): string {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

interface Case {
  s: Schedule;
  k: number;
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    frequency: fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'),
    every: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 52 })), // the table allows 1..52
    startDate: fc.oneof(
      fc.integer({ min: dayNumber('1990-01-01'), max: dayNumber('2060-12-31') }).map(fromDayNumber),
      // month ends, leap days and the clock-change Sundays, with a random year
      fc
        .tuple(fc.integer({ min: 1995, max: 2055 }), fc.constantFrom('01-31', '01-30', '01-29', '03-31', '05-31', '08-31', '10-31', '12-31', '03-29', '10-25'))
        .map(([y, md]) => `${y}-${md}`),
      fc.integer({ min: 499, max: 513 }).map((q) => `${4 * q}-02-29`), // leap years 1996..2052
    ),
    endDate: fc.constant(null),
  })
  .chain((s) => {
    const monthsPerStep = s.frequency === 'weekly' ? s.every / 4 : s.frequency === 'monthly' ? s.every : 12 * s.every;
    return fc.record({ s: fc.constant(s), k: fc.integer({ min: 0, max: Math.max(1, Math.floor(1200 / monthsPerStep)) }) });
  });

const FIXED: Case[] = [
  { s: { frequency: 'monthly', every: 1, startDate: '2026-01-31', endDate: null }, k: 1 },
  { s: { frequency: 'monthly', every: 1, startDate: '2026-01-31', endDate: null }, k: 2 },
  { s: { frequency: 'monthly', every: 1, startDate: '2028-01-31', endDate: null }, k: 1 },
  { s: { frequency: 'yearly', every: 1, startDate: '2028-02-29', endDate: null }, k: 1 },
  { s: { frequency: 'yearly', every: 1, startDate: '2028-02-29', endDate: null }, k: 4 },
  { s: { frequency: 'yearly', every: 4, startDate: '2096-02-29', endDate: null }, k: 1 },
  { s: { frequency: 'weekly', every: 1, startDate: '2026-03-22', endDate: null }, k: 1 },
  { s: { frequency: 'weekly', every: 1, startDate: '2026-10-18', endDate: null }, k: 1 },
  { s: { frequency: 'weekly', every: 52, startDate: '2026-11-17', endDate: null }, k: 3 },
  { s: { frequency: 'monthly', every: 3, startDate: '2026-11-30', endDate: null }, k: 1 },
];

describe.skipIf(!process.env.PGHOST)('recurring dates against PostgreSQL', () => {
  it('REC-2 DAT-3 occurrence(s, k) equals post_due_recurring\'s (start_date + step * k)::date for 500 random schedules', () => {
    const cases = [...FIXED, ...fc.sample(caseArb, { numRuns: 500, seed: 20261117 })];
    const values = cases
      .map(({ s, k }, i) => `(${i}, date '${s.startDate}', '${s.frequency}', ${s.every}, ${k})`)
      .join(',\n');
    const sql = `
select i, (start_date + (case frequency when 'weekly' then make_interval(weeks => every)
                                        when 'monthly' then make_interval(months => every)
                                        else make_interval(years => every) end) * k)::date
from (values ${values}) as v(i, start_date, frequency, every, k)
order by i;`;
    const rows = psql(sql)
      .trim()
      .split('\n')
      .map((line) => line.split('|'));
    expect(rows).toHaveLength(cases.length);
    const mismatches: string[] = [];
    rows.forEach(([i, sqlDate], idx) => {
      expect(Number(i)).toBe(idx);
      const c = cases[idx];
      if (!c || sqlDate === undefined) throw new Error('row out of range');
      const ts = occurrence(c.s, c.k);
      if (ts !== sqlDate) mismatches.push(`${c.s.frequency} every ${c.s.every} from ${c.s.startDate}, k=${c.k}: core ${ts}, SQL ${sqlDate}`);
    });
    expect(mismatches).toEqual([]);
  }, 60_000);

  // S9: what a start in the past posts at once. The database posts every occurrence k with
  // (start_date + step * k)::date <= the UK today and not after end_date; the past ones are those before today, and
  // resuming a paused template skips exactly those (recurring_guard: advance while the date is < uk_today). So
  // pastOccurrences' count and next date must be the database's for the same schedule, end and today.
  it('S9 REC-2 pastOccurrences(template, today) counts and finds the next day exactly as the database\'s dates do, for 500 random schedules', () => {
    const dateArb = fc.integer({ min: dayNumber('2000-01-01'), max: dayNumber('2045-12-31') }).map(fromDayNumber);
    const pastArb = fc.record({
      frequency: fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'),
      every: fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 52 })),
      startDate: fc.oneof(dateArb, fc.tuple(fc.integer({ min: 2000, max: 2045 }), fc.constantFrom('01-31', '03-31', '08-31', '10-31', '01-29', '01-30')).map(([y, md]) => `${String(y)}-${md}`), fc.integer({ min: 500, max: 511 }).map((q) => `${String(4 * q)}-02-29`)),
      endDate: fc.option(dateArb, { nil: null, freq: 3 }),
      today: dateArb,
      amount: fc.integer({ min: 1, max: 100_000_000 }),
    });
    const cases = [
      { frequency: 'monthly' as const, every: 1, startDate: '2025-01-24', endDate: null, today: '2026-11-23', amount: 145_000 },
      { frequency: 'monthly' as const, every: 1, startDate: '2026-01-31', endDate: null, today: '2026-11-23', amount: 100 },
      { frequency: 'monthly' as const, every: 1, startDate: '2026-10-23', endDate: '2026-11-23', today: '2026-11-23', amount: 100 },
      { frequency: 'yearly' as const, every: 1, startDate: '2024-02-29', endDate: null, today: '2027-02-28', amount: 100 },
      { frequency: 'weekly' as const, every: 1, startDate: '2026-11-23', endDate: null, today: '2026-11-23', amount: 100 },
      ...fc.sample(pastArb, { numRuns: 500, seed: 20261123 }),
    ];
    // Every case's occurrences run past its today or its end within this many steps (weekly every 1 over 46 years).
    const values = cases
      .map((c, i) => `(${String(i)}, date '${c.startDate}', ${c.endDate === null ? 'null::date' : `date '${c.endDate}'`}, date '${c.today}', '${c.frequency}', ${String(c.every)})`)
      .join(',\n');
    const sql = `
with v(i, start_date, end_date, today, frequency, every) as (values ${values}),
d as (
  select i, today, (start_date + (case frequency when 'weekly' then make_interval(weeks => every)
                                                 when 'monthly' then make_interval(months => every)
                                                 else make_interval(years => every) end) * k)::date as day
  from v, generate_series(0, 2500) as k
  where end_date is null or (start_date + (case frequency when 'weekly' then make_interval(weeks => every)
                                                          when 'monthly' then make_interval(months => every)
                                                          else make_interval(years => every) end) * k)::date <= end_date
)
select v.i, (select count(*) from d where d.i = v.i and d.day < d.today), coalesce((select min(day)::text from d where d.i = v.i and d.day >= d.today), '')
from v order by v.i;`;
    const rows = psql(sql).trim().split('\n').map((line) => line.split('|'));
    expect(rows).toHaveLength(cases.length);
    const mismatches: string[] = [];
    rows.forEach(([i, count, next], idx) => {
      expect(Number(i)).toBe(idx);
      const c = cases[idx];
      if (!c) throw new Error('row out of range');
      const r = pastOccurrences({ schedule: { frequency: c.frequency, every: c.every, startDate: c.startDate, endDate: c.endDate }, amount: pence(c.amount) }, c.today);
      const sqlNext = next === '' ? null : next;
      if (r.count !== Number(count) || r.nextDate !== sqlNext || r.totalPence !== Number(count) * c.amount) {
        mismatches.push(`${c.frequency} every ${String(c.every)} from ${c.startDate} to ${String(c.endDate)}, today ${c.today}: core ${String(r.count)} / ${String(r.nextDate)}, SQL ${String(count)} / ${String(sqlNext)}`);
      }
    });
    expect(mismatches).toEqual([]);
  }, 60_000);
});
