/**
 * S9a core (docs/slices/S9a.md fixes 4, 5, 7 and 23; SPEC INS-1 INS-4 INS-6 MB-3; DATA_MODEL §3 "Shared spending", §5
 * "Pace", "Standing-order hint"). Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/insights.ts (pure):
 *
 *   comparisonPeriod(entries: readonly InsightEntry[], period: Period): Period | null
 *     Fix 4: the period Insights compares with: previousPeriod(period), unless it starts before the household's first
 *     live entry (then null: no comparison line); null for a chapter or with no entries.
 *
 *   pace(entries, today): Pace           (unchanged signature)
 *     Fix 5: a regular payment that hasn't posted yet this month is never counted as money saved. Either "usual pace
 *     by today" counts only what usually lands by this day of the month, or regular payments (recurringId set) are left
 *     out of both sides; the builder picks one, records it in DECISIONS and makes Insights use the same definition.
 *     These tests hold for either: with spending exactly as usual, the pace is "on", and Home's pace and Insights'
 *     month comparison point the same way.
 *
 *   standingOrder(entries, settlements, people, today, opts?: { settleDay?: number | null })
 *     Fix 23 (INS-6): no hint when the couple's settle rhythm already covers it: they have a settle day, or they settle
 *     monthly (a live settle-up in each of the three months the hint looks at).
 *
 *   InsightEntry gains   refundOf?: string | null
 *     MB-3 (fix 7): sharedSpend and every figure leave out money back whose original (an entry in `entries`) is deleted.
 */
import { describe, expect, it } from 'vitest';
import { addDays, daysInMonth, type IsoDate } from './dates';
import {
  comparisonPeriod, pace, periodOf, previousPeriod, sharedSpend, standingOrder, type InsightEntry, type InsightSettlement, type Pace,
} from './insights';
import { pence } from './money';
import type { PenceMap } from './split';

const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const map = (m: Record<string, number>): PenceMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)]));

let seq = 0;
type Entry = InsightEntry & { refundOf?: string | null };
/** Jae paying, 50/50, everyday Groceries in the UK, unless told otherwise. */
function e(amount: number, date: IsoDate, over: Partial<Entry> = {}): Entry {
  seq += 1;
  const half = Math.floor(amount / 2);
  return {
    id: `e${String(seq)}`, kind: 'expense', description: 'Shop', amount: pence(amount), paid: map({ [JAE]: amount }),
    shares: map({ [JAE]: amount - half, [SAM]: half }), splitMode: 'ratio', date, categoryId: 'c-groceries', chapterId: null, country: 'GB',
    recurringId: null, deleted: false, ...over,
  };
}
const settle = (from: string, to: string, amount: number, date: IsoDate): InsightSettlement => ({ from, to, amount: pence(amount), date, deleted: false });

// ─────────────────────────────── fix 4: like with like ───────────────────────────────

describe('comparisonPeriod: never against months before the household existed (fix 4, INS-4)', () => {
  // The demo's history starts on 23 May 2025.
  const history = [e(1000, '2025-05-23'), e(2000, '2025-09-14'), e(3000, '2026-11-02')];
  const today = '2026-11-20';

  it('INS-4: the month and 3 months compare with the same days before', () => {
    expect(comparisonPeriod(history, periodOf('month', today))).toEqual(previousPeriod(periodOf('month', today)));
    expect(comparisonPeriod(history, periodOf('month', today))).toMatchObject({ from: '2026-10-01', to: '2026-10-20' });
    expect(comparisonPeriod(history, periodOf('3months', today))).toMatchObject({ from: '2026-06-01', to: '2026-08-20' });
  });

  it('INS-4: 12 months and this year would start before 23 May 2025: no comparison', () => {
    expect(comparisonPeriod(history, periodOf('12months', today))).toBeNull();
    expect(comparisonPeriod(history, periodOf('year', today))).toBeNull();
  });

  it('INS-4: a comparison that starts on the first entry’s day or later is used', () => {
    const older = [e(1000, '2025-01-01'), ...history];
    expect(comparisonPeriod(older, periodOf('year', today))).toMatchObject({ from: '2025-01-01', to: '2025-11-20' });
  });

  it('INS-4: the household’s first month compares with nothing (May 2025 started on the 23rd)', () => {
    expect(comparisonPeriod(history, periodOf('month', '2025-06-10'))).toBeNull();
  });

  it('INS-4: a chapter, or no entries at all: no comparison', () => {
    expect(comparisonPeriod(history, periodOf('chapter', today, { id: 'ch', startDate: '2026-11-01', endDate: '2026-11-09' }))).toBeNull();
    expect(comparisonPeriod([], periodOf('month', today))).toBeNull();
  });
});

// ─────────────────────────────── fix 5: pace ───────────────────────────────

/**
 * July to October 2026: £10.00 of groceries every day, and rent of £1,500.00 (a regular payment) on the 25th. November
 * so far (to the 14th): the same £10.00 a day, and the rent not posted yet.
 */
function steadyMonths(): Entry[] {
  const out: Entry[] = [];
  for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    const days = daysInMonth(2026, Number(m.slice(5)));
    for (let d = 1; d <= days; d += 1) out.push(e(1000, `${m}-${String(d).padStart(2, '0')}`));
    out.push(e(150000, `${m}-25`, { description: 'Rent', categoryId: 'c-rent', recurringId: 'rent' }));
  }
  for (let d = 1; d <= 14; d += 1) out.push(e(1000, addDays('2026-11-01', d - 1)));
  return out;
}
const TODAY = '2026-11-14';

/** What Insights says for "This month": this month's everyday spend so far against the same days of last month. */
function insightsDirection(entries: readonly InsightEntry[], today: IsoDate): 'more' | 'less' | 'same' {
  const now = periodOf('month', today);
  // For "this month" the comparison is the same days of last month (what previousPeriod gives).
  const before = previousPeriod(now);
  if (!before) throw new Error('no comparison');
  const a = sharedSpend(entries, now, { everydayOnly: true });
  const b = sharedSpend(entries, before, { everydayOnly: true });
  return a === b ? 'same' : a > b ? 'more' : 'less';
}
const agrees = (p: Pace, insights: 'more' | 'less' | 'same') =>
  ({ on: 'same', over: 'more', under: 'less' } as const)[p.direction ?? 'on'] === insights;

describe('pace: a bill that hasn’t posted yet is not money saved (fix 5, INS-1)', () => {
  it('INS-1: spending exactly as usual, with the rent still to come on the 25th, is on the usual pace (not "£700 under")', () => {
    const p = pace(steadyMonths(), TODAY);
    expect(p.soFar).toBe(14000);
    expect(p.direction).toBe('on');
  });

  it('INS-1: £200.00 more than usual by the 14th is "about £200 over"', () => {
    const p = pace([...steadyMonths(), e(20000, '2026-11-10', { description: 'Big shop' })], TODAY);
    expect(p.direction).toBe('over');
    expect(p.amount).toBe(20000);
  });

  it('INS-1: £90.00 less than usual by the 14th is "about £90 under"', () => {
    const fewer = steadyMonths().filter((x) => !(x.date >= '2026-11-01' && x.date <= '2026-11-09'));
    const p = pace(fewer, TODAY);
    expect(p.soFar).toBe(5000);
    expect(p.direction).toBe('under');
    expect(p.amount).toBe(9000);
  });

  it('INS-1 INS-4: Home’s pace and Insights’ month comparison agree on the same data', () => {
    const cases = [
      steadyMonths(),
      [...steadyMonths(), e(20000, '2026-11-10')],
      steadyMonths().filter((x) => !(x.date >= '2026-11-01' && x.date <= '2026-11-09')),
    ];
    for (const entries of cases) {
      const p = pace(entries, TODAY);
      expect(agrees(p, insightsDirection(entries, TODAY)), `pace ${String(p.direction)} vs Insights ${insightsDirection(entries, TODAY)}`).toBe(true);
    }
  });

  it('INS-1: once the rent has posted (the 26th), spending as usual is still on pace', () => {
    const entries = [...steadyMonths()];
    for (let d = 15; d <= 26; d += 1) entries.push(e(1000, `2026-11-${String(d)}`));
    entries.push(e(150000, '2026-11-25', { description: 'Rent', categoryId: 'c-rent', recurringId: 'rent' }));
    expect(pace(entries, '2026-11-26').direction).toBe('on');
  });
});

// ─────────────────────────────── fix 23: standing-order hint ───────────────────────────────

/** Jae pays £300.00 of groceries on the 10th, July to October: Sam's half (£150.00) builds up each month. */
const monthly = ['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => e(30000, `${m}-10`));

describe('standingOrder: not when the settle rhythm covers it (fix 23, INS-6)', () => {
  it('INS-6: never settled, owing at each month end: the hint (as before)', () => {
    expect(standingOrder(monthly, [], PEOPLE, TODAY)).toEqual({ debtor: SAM, creditor: JAE, amount: 45000 });
  });

  it('INS-6: Sam settles every month (on the 2nd, for the month before): no hint', () => {
    const settles = ['2026-08-02', '2026-09-02', '2026-10-02'].map((d) => settle(SAM, JAE, 15000, d));
    expect(standingOrder(monthly, settles, PEOPLE, TODAY)).toBeNull();
  });

  it('INS-6 SET-4: the couple has a settle day: no hint', () => {
    expect(standingOrder(monthly, [], PEOPLE, TODAY, { settleDay: 1 })).toBeNull();
  });

  it('INS-6: settling once in three months is not a monthly rhythm: the hint stays', () => {
    const once = [settle(SAM, JAE, 15000, '2026-09-02')];
    expect(standingOrder(monthly, once, PEOPLE, TODAY, { settleDay: null })).not.toBeNull();
  });
});

// ─────────────────────────────── fix 7: orphaned money back ───────────────────────────────

describe('money back whose original is deleted never counts (fix 7, MB-3)', () => {
  it('MB-3: Insights leaves it out of shared spend', () => {
    const lamp = e(4000, '2026-11-03', { id: 'lamp', categoryId: 'c-household', deleted: true });
    const back = e(1500, '2026-11-05', { id: 'back', kind: 'money_back', categoryId: 'c-household', refundOf: 'lamp' });
    const bread = e(1000, '2026-11-06');
    expect(sharedSpend([lamp, back, bread], periodOf('month', TODAY))).toBe(1000);
    // With the original live, the money back comes off it as usual.
    expect(sharedSpend([{ ...lamp, deleted: false }, back, bread], periodOf('month', TODAY))).toBe(3500);
  });
});
