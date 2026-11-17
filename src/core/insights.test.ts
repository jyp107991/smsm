/**
 * S5a core (docs/slices/S5.md "Definitions", "Data / core"; DATA_MODEL §3 "Shared spending", "Everyday vs chapters",
 * §5 "Definitions shown in the app"): shared spend for a period and its breakdowns, the usual month, the pace line,
 * the rule-based notes, fairness and the standing-order hint. Written before the build (ENGINEERING §5, tests first
 * by someone else): vectors worked by hand plus fast-check properties.
 *
 * Interface these tests expect, in src/core/insights.ts (pure; no I/O, no clock; every figure exact pence):
 *
 *   type Month = string                       // 'YYYY-MM'
 *   interface InsightEntry {
 *     id: string; kind: 'expense' | 'money_back'; description: string; amount: Pence; paid: PenceMap; shares: PenceMap;
 *     splitMode: SplitMode; date: IsoDate; categoryId: string | null; chapterId: string | null; country: string | null;
 *     recurringId: string | null; deleted: boolean }
 *     (rows may carry more fields; for money back `paid` is who received it, as everywhere.)
 *   interface InsightSettlement { from: UserId; to: UserId; amount: Pence; date: IsoDate; deleted: boolean }
 *   type PeriodChoice = 'month' | '3months' | '12months' | 'year' | 'chapter'
 *   interface Period { kind: PeriodChoice; from: IsoDate | null; to: IsoDate | null; chapterId: string | null }
 *   interface PeriodChapter { id: string; startDate: IsoDate | null; endDate: IsoDate | null }
 *   interface SpendOptions { everydayOnly?: boolean }     // default false: chapters included
 *
 *   periodOf(choice, today, chapter?): Period
 *     month    = 1st of today's month .. today          3months  = 1st of the month two months back .. today
 *     12months = 1st of the month eleven months back .. today (the 12 Trend columns)
 *     year     = 1 Jan .. today                          chapter  = { from: startDate, to: endDate, chapterId }
 *   previousPeriod(period): Period | null
 *     The same-length period just before: from and to each moved back by the period's length in months (1, 3, 12,
 *     12), clamped to the month's end (31 Mar → 28 Feb). A chapter has none (null).
 *   A chapter period holds that chapter's entries whatever their dates; other periods hold entries dated from..to.
 *
 *   sharedSpend(entries, period, opts?): Pence
 *     Live expenses with splitMode ratio/exact/treat at full amount, minus live money back whose splitMode isn't
 *     for_other, dated in the period. for_other excluded; settle-ups are never entries. everydayOnly: chapterId null.
 *   byCategory(entries, period, opts?): { categoryId: string | null; total: Pence }[]  non-zero only, largest first
 *   byCountry(entries, period, opts?):  { country: string | null; total: Pence }[]     non-zero only, largest first
 *   whoPaid(entries, period, people, opts?): Record<UserId, Pence>
 *     Both people always present: Σ paid[P] over those expenses − Σ paid[P] over that money back (what P received).
 *   monthlyTotals(entries, months: readonly Month[], opts?): { month: Month; total: Pence }[]  in the order given
 *   usual(entries, month: Month, opts?: { categoryId?: string | null }): Pence | null
 *     Everyday only (CHP-5). "Full months": calendar months after the month of the first live entry (any kind, any
 *     chapter) and before `month`. Take the most recent up to 6 of them (a month with nothing counts as £0.00);
 *     fewer than 3 → null. Median; an even count → the mean of the middle two, rounded down to the penny.
 *     With categoryId: the same months, that category's shared spend.
 *   pace(entries, today): Pace
 *     interface Pace { soFar: Pence; usual: Pence | null; direction: 'under' | 'over' | 'on' | null;
 *                      amount: Pence | null; ratio: number | null }
 *     soFar = everyday shared spend from the 1st to today (entries dated after today are not "so far").
 *     usual = usual(entries, this month). With no usual, direction, amount and ratio are null.
 *     d = soFar − usual × daysElapsed ÷ daysInMonth (daysElapsed counts today), exact.
 *     |d| ≤ £10.00 → 'on'; else 'under' (d < 0) or 'over'; amount = |d| to the nearest £10 (1000p), halves up.
 *     ratio = soFar ÷ (usual × daysElapsed ÷ daysInMonth) − 1 (a float, for the definition sheet).
 *   notes(input: { entries; templates: NoteTemplate[]; categories: { id: string; name: string }[] }, today): Note[]
 *     interface NoteTemplate { id: string; description: string; amount: Pence; frequency: 'weekly' | 'monthly' | 'yearly';
 *                              every: number; startDate: IsoDate; isSubscription: boolean; active: boolean }
 *     interface Note { kind: 'category' | 'entry' | 'price' | 'new-regular'; text: string; weight: Pence }
 *     Everyday entries only, this month = 1st .. today. Sorted by weight, largest first (Home shows the first).
 *     category:    this month ≥ 1.3 × usual(category) and ≥ £20.00 above it (both inclusive, exact integers):
 *                  "Eating out is £85 over its usual (£210 so far, usually £125)"; weight = the excess.
 *     entry:       an expense this month ≥ 3 × the median of its category's expenses in the 6 full calendar months
 *                  before this month, with ≥ 5 of those: "Big shop £180 is about 3× a usual Groceries entry"
 *                  (the multiple to the nearest whole); weight = the entry's amount.
 *     price:       a subscription template whose entry posted this month (recurringId) differs from its previous
 *                  posted entry: "Netflix went from £10.99 to £12.99"; weight = the difference.
 *     new-regular: an active template whose startDate is from the 1st to today: "New regular payment: Gym £30.00 a
 *                  month"; weight = its amount.
 *     (Amounts in the category and entry texts are whole pounds; these vectors use whole-pound figures only.)
 *   fairness(entries, people, period, split: Record<UserId, number>):
 *     { percents: Record<UserId, number>; split: Record<UserId, number>; total: Pence } | null
 *     whoPaid ÷ total as whole percentages by largest remainder, a tie to the first person; null when total ≤ 0.
 *   standingOrder(entries, settlements, people, today): { debtor: UserId; creditor: UserId; amount: Pence } | null
 *     The net balance (balance.ts rules, every live row and settle-up dated ≤ the month's last day) at the end of each
 *     of the 3 full months before today's month; the same person owing at all three and the mean ≥ £50.00 → the mean
 *     rounded down to £10.
 *
 * Until src/core/insights.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module); once it exists this can become `import * as insights from './insights'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { PenceMap, SplitMode, UserId } from './split';

type Month = string;
interface InsightEntry {
  id: string; kind: 'expense' | 'money_back'; description: string; amount: Pence; paid: PenceMap; shares: PenceMap;
  splitMode: SplitMode; date: IsoDate; categoryId: string | null; chapterId: string | null; country: string | null;
  recurringId: string | null; deleted: boolean;
}
interface InsightSettlement { from: UserId; to: UserId; amount: Pence; date: IsoDate; deleted: boolean }
type PeriodChoice = 'month' | '3months' | '12months' | 'year' | 'chapter';
interface Period { kind: PeriodChoice; from: IsoDate | null; to: IsoDate | null; chapterId: string | null }
interface PeriodChapter { id: string; startDate: IsoDate | null; endDate: IsoDate | null }
interface SpendOptions { everydayOnly?: boolean }
interface Pace { soFar: Pence; usual: Pence | null; direction: 'under' | 'over' | 'on' | null; amount: Pence | null; ratio: number | null }
interface NoteTemplate {
  id: string; description: string; amount: Pence; frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate;
  isSubscription: boolean; active: boolean;
}
interface Note { kind: 'category' | 'entry' | 'price' | 'new-regular'; text: string; weight: Pence }
interface Fairness { percents: Record<UserId, number>; split: Record<UserId, number>; total: Pence }

interface InsightsCore {
  periodOf(choice: PeriodChoice, today: IsoDate, chapter?: PeriodChapter): Period;
  previousPeriod(period: Period): Period | null;
  sharedSpend(entries: readonly InsightEntry[], period: Period, opts?: SpendOptions): Pence;
  byCategory(entries: readonly InsightEntry[], period: Period, opts?: SpendOptions): { categoryId: string | null; total: Pence }[];
  byCountry(entries: readonly InsightEntry[], period: Period, opts?: SpendOptions): { country: string | null; total: Pence }[];
  whoPaid(entries: readonly InsightEntry[], period: Period, people: readonly [UserId, UserId], opts?: SpendOptions): Record<UserId, Pence>;
  monthlyTotals(entries: readonly InsightEntry[], months: readonly Month[], opts?: SpendOptions): { month: Month; total: Pence }[];
  usual(entries: readonly InsightEntry[], month: Month, opts?: { categoryId?: string | null }): Pence | null;
  pace(entries: readonly InsightEntry[], today: IsoDate): Pace;
  notes(input: { entries: readonly InsightEntry[]; templates: readonly NoteTemplate[]; categories: readonly { id: string; name: string }[] }, today: IsoDate): Note[];
  fairness(entries: readonly InsightEntry[], people: readonly [UserId, UserId], period: Period, split: Record<UserId, number>): Fairness | null;
  standingOrder(entries: readonly InsightEntry[], settlements: readonly InsightSettlement[], people: readonly [UserId, UserId], today: IsoDate): { debtor: UserId; creditor: UserId; amount: Pence } | null;
}

const NAMES = [
  'periodOf', 'previousPeriod', 'sharedSpend', 'byCategory', 'byCountry', 'whoPaid', 'monthlyTotals', 'usual', 'pace', 'notes',
  'fairness', 'standingOrder',
] as const;
const INSIGHTS = './insights';
const loaded = (await import(/* @vite-ignore */ INSIGHTS).catch(() => null)) as Partial<InsightsCore> | null;
function core(): InsightsCore {
  const missing = NAMES.filter((n) => typeof loaded?.[n] !== 'function');
  if (!loaded || missing.length > 0) throw new Error(`src/core/insights.ts does not export ${missing.join(', ')} yet (S5a)`);
  return loaded as InsightsCore;
}

// ───────── the household ─────────
const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const TODAY = '2026-11-14'; // a Saturday; November has 30 days
const GROCERIES = 'cat-groceries';
const EATING = 'cat-eating';
const HOUSEHOLD = 'cat-household';
const TRAVEL = 'cat-travel';
const RENT = 'cat-rent';
const SUBS = 'cat-subs';
const CATEGORIES = [
  { id: GROCERIES, name: 'Groceries' }, { id: EATING, name: 'Eating out' }, { id: HOUSEHOLD, name: 'Household' },
  { id: TRAVEL, name: 'Travel' }, { id: RENT, name: 'Rent & bills' }, { id: SUBS, name: 'Subscriptions' },
];
const JAPAN = 'ch-japan';
const WEDDING = 'ch-wedding';

let seq = 0;
/** An entry: Jae paying, split 50/50 (ratio), everyday, Groceries, in the UK, on 3 Nov, unless told otherwise. */
function e(over: Partial<Omit<InsightEntry, 'amount' | 'paid' | 'shares'>> & { amount: number; paid?: Record<string, number>; shares?: Record<string, number> }): InsightEntry {
  const { amount, paid, shares, ...rest } = over;
  const toMap = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)])) as PenceMap;
  const half = Math.floor(amount / 2);
  seq += 1;
  return {
    id: `e${String(seq)}`, kind: 'expense', description: 'Something', splitMode: 'ratio', date: '2026-11-03', categoryId: GROCERIES,
    chapterId: null, country: 'GB', recurringId: null, deleted: false, ...rest,
    amount: pence(amount), paid: toMap(paid ?? { [JAE]: amount }), shares: toMap(shares ?? { [JAE]: amount - half, [SAM]: half }),
  };
}
const settle = (from: UserId, to: UserId, amount: number, date: IsoDate): InsightSettlement => ({ from, to, amount: pence(amount), date, deleted: false });

/** One everyday entry per month on the 15th with these totals (pence), in a category. */
function monthly(totals: Record<Month, number>, categoryId: string = RENT): InsightEntry[] {
  return Object.entries(totals).filter(([, v]) => v !== 0).map(([m, v]) => e({ amount: v, date: `${m}-15`, categoryId }));
}

const P = (choice: PeriodChoice, today: IsoDate = TODAY, chapter?: PeriodChapter) => core().periodOf(choice, today, chapter);
const MONTH = () => P('month');
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// ─────────────────────────────── periods ───────────────────────────────

describe('periodOf and previousPeriod (INS-4)', () => {
  it('INS-4: This month, Last 3 months, Last 12 months and This year run from the 1st of a month to today', () => {
    expect(P('month')).toMatchObject({ kind: 'month', from: '2026-11-01', to: TODAY });
    expect(P('3months')).toMatchObject({ kind: '3months', from: '2026-09-01', to: TODAY });
    expect(P('12months')).toMatchObject({ kind: '12months', from: '2025-12-01', to: TODAY });
    expect(P('year')).toMatchObject({ kind: 'year', from: '2026-01-01', to: TODAY });
  });

  it('INS-4 CHP-3: a chapter period is that chapter, with its dates', () => {
    const p = P('chapter', TODAY, { id: JAPAN, startDate: '2026-11-01', endDate: '2026-11-09' });
    expect(p).toMatchObject({ kind: 'chapter', chapterId: JAPAN, from: '2026-11-01', to: '2026-11-09' });
  });

  it('INS-4: the comparison is the same-length period just before ("£120.00 less than the 3 months before")', () => {
    expect(core().previousPeriod(P('month'))).toMatchObject({ from: '2026-10-01', to: '2026-10-14' });
    expect(core().previousPeriod(P('3months'))).toMatchObject({ from: '2026-06-01', to: '2026-08-14' });
    expect(core().previousPeriod(P('12months'))).toMatchObject({ from: '2024-12-01', to: '2025-11-14' });
    expect(core().previousPeriod(P('year'))).toMatchObject({ from: '2025-01-01', to: '2025-11-14' });
  });

  it('INS-4: across a year end and a short month the dates clamp to the month (31 Mar → 1–28 Feb)', () => {
    expect(core().previousPeriod(P('month', '2026-03-31'))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(P('3months', '2026-01-15')).toMatchObject({ from: '2025-11-01', to: '2026-01-15' });
    expect(core().previousPeriod(P('3months', '2026-01-15'))).toMatchObject({ from: '2025-08-01', to: '2025-10-15' });
  });

  it('INS-4: a chapter has no comparison', () => {
    expect(core().previousPeriod(P('chapter', TODAY, { id: JAPAN, startDate: '2026-11-01', endDate: '2026-11-09' }))).toBeNull();
  });
});

// ─────────────────────────────── shared spend ───────────────────────────────

/** November to date (today 14 Nov), worked by hand:
 *   ratio £40.00 Groceries (Jae)                  +4000
 *   exact £35.00 Household (Sam)                  +3500
 *   treat £60.00 Eating out (Sam)                 +6000
 *   for_other £30.00 (Jae for Sam)                  excluded
 *   money back £10.00 Groceries (ratio, Jae got)  −1000
 *   money back £5.00 for_other                      excluded
 *   deleted £99.99                                  excluded
 *   31 Oct £70.00; 15 Nov £80.00 (after today)      outside the period
 *   Japan (chapter) £500.00 Travel, JP (Jae)     +50000
 *   total 62500; everyday only 12500. */
function november(): InsightEntry[] {
  return [
    e({ amount: 4000, categoryId: GROCERIES, date: '2026-11-03' }),
    e({ amount: 3500, categoryId: HOUSEHOLD, splitMode: 'exact', paid: { [SAM]: 3500 }, shares: { [JAE]: 1500, [SAM]: 2000 }, date: '2026-11-04' }),
    e({ amount: 6000, categoryId: EATING, splitMode: 'treat', paid: { [SAM]: 6000 }, shares: { [SAM]: 6000 }, date: '2026-11-05' }),
    e({ amount: 3000, categoryId: HOUSEHOLD, splitMode: 'for_other', shares: { [JAE]: 0, [SAM]: 3000 }, date: '2026-11-06' }),
    e({ kind: 'money_back', amount: 1000, categoryId: GROCERIES, date: '2026-11-07' }),
    e({ kind: 'money_back', amount: 500, categoryId: HOUSEHOLD, splitMode: 'for_other', shares: { [JAE]: 0, [SAM]: 500 }, date: '2026-11-08' }),
    e({ amount: 9999, categoryId: GROCERIES, deleted: true, date: '2026-11-09' }),
    e({ amount: 7000, categoryId: GROCERIES, date: '2026-10-31' }),
    e({ amount: 8000, categoryId: GROCERIES, date: '2026-11-15' }),
    e({ amount: 50000, categoryId: TRAVEL, chapterId: JAPAN, country: 'JP', date: '2026-11-02' }),
  ];
}

describe('sharedSpend, byCategory, byCountry, whoPaid: vectors (INS-4, CHP-5, PLC-7, MB-1)', () => {
  it('INS-4 MB-1: ratio, exact and treat count in full; for_other excluded; money back subtracts; deleted and out-of-period ignored', () => {
    expect(core().sharedSpend(november(), MONTH())).toBe(62500);
  });

  it('CHP-5: "Include chapters" off → everyday only', () => {
    expect(core().sharedSpend(november(), MONTH(), { everydayOnly: true })).toBe(12500);
    expect(core().sharedSpend(november(), MONTH(), { everydayOnly: false })).toBe(62500);
  });

  it('INS-4 MB-1: by category, largest first, money back counted against its own category', () => {
    expect(core().byCategory(november(), MONTH())).toEqual([
      { categoryId: TRAVEL, total: 50000 },
      { categoryId: EATING, total: 6000 },
      { categoryId: HOUSEHOLD, total: 3500 },
      { categoryId: GROCERIES, total: 3000 },
    ]);
    expect(core().byCategory(november(), MONTH(), { everydayOnly: true }).map((c) => c.categoryId)).toEqual([EATING, HOUSEHOLD, GROCERIES]);
  });

  it('PLC-7: by country, largest first', () => {
    expect(core().byCountry(november(), MONTH())).toEqual([{ country: 'JP', total: 50000 }, { country: 'GB', total: 12500 }]);
    expect(core().byCountry(november(), MONTH(), { everydayOnly: true })).toEqual([{ country: 'GB', total: 12500 }]);
  });

  it('INS-4 MB-1: who paid: Σ paid over shared spending, minus what each received back', () => {
    // Jae: 4000 + 50000 − 1000 (received) = 53000; Sam: 3500 + 6000 = 9500. 53000 + 9500 = 62500.
    expect(core().whoPaid(november(), MONTH(), PEOPLE)).toEqual({ [JAE]: 53000, [SAM]: 9500 });
    expect(core().whoPaid(november(), MONTH(), PEOPLE, { everydayOnly: true })).toEqual({ [JAE]: 3000, [SAM]: 9500 });
  });

  it('INS-4: who paid lists both people even when one paid nothing', () => {
    expect(core().whoPaid([e({ amount: 1234 })], MONTH(), PEOPLE)).toEqual({ [JAE]: 1234, [SAM]: 0 });
  });

  it('INS-4 CHP-3: a chapter period holds that chapter’s entries whatever their dates', () => {
    const entries = [...november(), e({ amount: 2000, chapterId: JAPAN, date: '2026-10-28' }), e({ amount: 900, chapterId: WEDDING })];
    const p = P('chapter', TODAY, { id: JAPAN, startDate: '2026-11-01', endDate: '2026-11-09' });
    expect(core().sharedSpend(entries, p)).toBe(52000);
  });

  it('INS-4: monthly totals for the months asked, in order (a month with nothing is £0.00)', () => {
    const entries = november().filter((x) => x.date !== '2026-11-15');
    expect(core().monthlyTotals(entries, ['2026-09', '2026-10', '2026-11'])).toEqual([
      { month: '2026-09', total: 0 }, { month: '2026-10', total: 7000 }, { month: '2026-11', total: 62500 },
    ]);
    expect(core().monthlyTotals(entries, ['2026-10', '2026-11'], { everydayOnly: true })).toEqual([
      { month: '2026-10', total: 7000 }, { month: '2026-11', total: 12500 },
    ]);
  });
});

// ─────────────────────────────── usual ───────────────────────────────

describe('usual: the median of the previous 3–6 full everyday months (INS-3, CHP-5)', () => {
  it('INS-3: six full months → the median of six (even: the mean of the middle two)', () => {
    // First entry in April, so May–Oct are full: £100…£600 → (300 + 400) ÷ 2 = £350.00.
    const entries = monthly({ '2026-04': 5000, '2026-05': 10000, '2026-06': 20000, '2026-07': 30000, '2026-08': 40000, '2026-09': 50000, '2026-10': 60000 });
    expect(core().usual(entries, '2026-11')).toBe(35000);
  });

  it('INS-3: only the previous six months count, however long the history', () => {
    const entries = monthly({
      '2026-01': 1, '2026-02': 900000, '2026-03': 900000, '2026-04': 900000, // older than six months: ignored
      '2026-05': 10000, '2026-06': 20000, '2026-07': 30000, '2026-08': 40000, '2026-09': 50000, '2026-10': 60000,
    });
    expect(core().usual(entries, '2026-11')).toBe(35000);
  });

  it('INS-3: exactly three full months → the middle one', () => {
    const entries = monthly({ '2026-07': 99999, '2026-08': 40000, '2026-09': 60000, '2026-10': 50000 });
    expect(core().usual(entries, '2026-11')).toBe(50000);
  });

  it('INS-3: fewer than three full months of history → none (not shown)', () => {
    expect(core().usual(monthly({ '2026-08': 40000, '2026-09': 60000, '2026-10': 50000 }), '2026-11')).toBeNull();
    expect(core().usual([], '2026-11')).toBeNull();
  });

  it('INS-3: the first month with any entry is not a full month; a quiet month after it counts as £0.00', () => {
    // July is the first; August had nothing; September £300, October £500 → median of (0, 300, 500) = £300.
    const entries = monthly({ '2026-07': 10000, '2026-09': 30000, '2026-10': 50000 });
    expect(core().usual(entries, '2026-11')).toBe(30000);
  });

  it('INS-3: an even count halves rounded down to the penny', () => {
    // First entry June; July–October: 1001, 1002, 1000, 2000 → middle two 1001, 1002 → 1001.5 → 1001.
    const entries = monthly({ '2026-06': 1, '2026-07': 1001, '2026-08': 1002, '2026-09': 1000, '2026-10': 2000 });
    expect(core().usual(entries, '2026-11')).toBe(1001);
  });

  it('CHP-5: chapter spending never moves the usual month', () => {
    const base = monthly({ '2026-07': 10000, '2026-08': 40000, '2026-09': 60000, '2026-10': 50000 });
    const wedding = e({ amount: 2_000_000, chapterId: WEDDING, date: '2026-09-20' });
    expect(core().usual([...base, wedding], '2026-11')).toBe(50000);
  });

  it('INS-3 MB-1: the usual uses shared spend: for_other excluded, money back subtracted', () => {
    const base = monthly({ '2026-07': 10000, '2026-08': 40000, '2026-09': 60000, '2026-10': 50000 });
    const extra = [
      e({ amount: 90000, splitMode: 'for_other', shares: { [JAE]: 0, [SAM]: 90000 }, date: '2026-10-02', categoryId: RENT }),
      e({ kind: 'money_back', amount: 4000, date: '2026-10-03', categoryId: RENT }),
    ];
    // October 50000 − 4000 = 46000; median of (40000, 60000, 46000) = 46000.
    expect(core().usual([...base, ...extra], '2026-11')).toBe(46000);
  });

  it('INS-3: a category’s usual: the same months, that category only', () => {
    const entries = [
      ...monthly({ '2026-04': 100, '2026-05': 12500, '2026-06': 12500, '2026-07': 12500, '2026-08': 12500, '2026-09': 12500, '2026-10': 12500 }, EATING),
      ...monthly({ '2026-05': 50000, '2026-06': 50000, '2026-07': 50000 }, RENT),
    ];
    expect(core().usual(entries, '2026-11', { categoryId: EATING })).toBe(12500);
    // Rent: May–Jul 50000, Aug–Oct 0 → median of (0, 0, 0, 50000, 50000, 50000) = 25000.
    expect(core().usual(entries, '2026-11', { categoryId: RENT })).toBe(25000);
  });
});

// ─────────────────────────────── pace ───────────────────────────────

/** A usual of £3,000.00 (May–Oct, first entry in April); on 14 Nov the usual pace is 3000 × 14 ÷ 30 = £1,400.00. */
const USUAL_3000 = monthly({ '2026-04': 100, '2026-05': 300000, '2026-06': 300000, '2026-07': 300000, '2026-08': 300000, '2026-09': 300000, '2026-10': 300000 });
const soFar = (amount: number, extra: InsightEntry[] = []) => core().pace([...USUAL_3000, e({ amount, date: '2026-11-10', categoryId: GROCERIES }), ...extra], TODAY);

describe('pace: the month so far against the usual pace (INS-1, CHP-5)', () => {
  it('INS-1: "£1,320.00 so far · about £80 under your usual pace"', () => {
    const p = soFar(132000);
    expect(p).toMatchObject({ soFar: 132000, usual: 300000, direction: 'under', amount: 8000 });
    expect(p.ratio).toBeCloseTo(132000 / 140000 - 1, 9);
  });

  it('INS-1: over the usual pace', () => {
    expect(soFar(148000)).toMatchObject({ direction: 'over', amount: 8000 });
  });

  it('INS-1: within £10 (inclusive) → "on your usual pace"', () => {
    expect(soFar(140000).direction).toBe('on');
    expect(soFar(141000).direction).toBe('on');
    expect(soFar(139000).direction).toBe('on');
    expect(soFar(141001)).toMatchObject({ direction: 'over', amount: 1000 });
    expect(soFar(138999)).toMatchObject({ direction: 'under', amount: 1000 });
  });

  it('INS-1: the amount is to the nearest £10, halves up', () => {
    expect(soFar(141499).amount).toBe(1000); // £14.99 → £10
    expect(soFar(141500).amount).toBe(2000); // £15.00 → £20
    expect(soFar(137500)).toMatchObject({ direction: 'under', amount: 3000 }); // £25.00 under → £30
    expect(soFar(137501)).toMatchObject({ direction: 'under', amount: 2000 }); // £24.99 under → £20
  });

  it('INS-1: the usual pace is worked exactly: £1,000.00 usual on 14 Nov is £466.666…; £400.00 so far is about £70 under', () => {
    const entries = [
      ...monthly({ '2026-04': 100, '2026-05': 100000, '2026-06': 100000, '2026-07': 100000, '2026-08': 100000, '2026-09': 100000, '2026-10': 100000 }),
      e({ amount: 40000, date: '2026-11-01' }),
    ];
    const p = core().pace(entries, TODAY);
    expect(p).toMatchObject({ soFar: 40000, usual: 100000, direction: 'under', amount: 7000 });
    expect(p.ratio).toBeCloseTo(40000 / (100000 * 14 / 30) - 1, 9);
  });

  it('INS-1 CHP-5: so far is everyday only and only to today', () => {
    const p = soFar(132000, [
      e({ amount: 90000, chapterId: WEDDING, date: '2026-11-05' }),
      e({ amount: 70000, date: '2026-11-20' }),
      e({ amount: 5000, date: '2026-10-31' }),
    ]);
    expect(p).toMatchObject({ soFar: 132000, direction: 'under', amount: 8000 });
  });

  it('INS-1: with no usual yet, just the amount so far', () => {
    const p = core().pace([e({ amount: 124000, date: '2026-11-02' })], TODAY);
    expect(p).toEqual({ soFar: 124000, usual: null, direction: null, amount: null, ratio: null });
  });
});

// ─────────────────────────────── notes ───────────────────────────────

const NO_TEMPLATES: NoteTemplate[] = [];
const notesOf = (entries: InsightEntry[], templates: NoteTemplate[] = NO_TEMPLATES, today: IsoDate = TODAY) =>
  core().notes({ entries, templates, categories: CATEGORIES }, today);
const ofKind = (ns: Note[], kind: Note['kind']) => ns.filter((n) => n.kind === kind);

/** Eating out with a usual of `usualAmount` (May–Oct; first entry, a Rent payment, in April), and `now` so far in November. */
function eatingOut(usualAmount: number, now: number): InsightEntry[] {
  return [
    e({ amount: 100, categoryId: RENT, date: '2026-04-15' }),
    ...monthly({ '2026-05': usualAmount, '2026-06': usualAmount, '2026-07': usualAmount, '2026-08': usualAmount, '2026-09': usualAmount, '2026-10': usualAmount }, EATING),
    e({ amount: now, categoryId: EATING, date: '2026-11-08' }),
  ];
}

describe('notes: unusual category (INS-3, CHP-5)', () => {
  it('INS-3: "Eating out is £85 over its usual (£210 so far, usually £125)"', () => {
    const ns = ofKind(notesOf(eatingOut(12500, 21000)), 'category');
    expect(ns).toEqual([{ kind: 'category', text: 'Eating out is £85 over its usual (£210 so far, usually £125)', weight: 8500 }]);
  });

  it('INS-3: exactly 1.3 × the usual is enough; a penny under is not', () => {
    expect(ofKind(notesOf(eatingOut(10000, 13000)), 'category').map((n) => n.text)).toEqual(['Eating out is £30 over its usual (£130 so far, usually £100)']);
    expect(ofKind(notesOf(eatingOut(10000, 12999)), 'category')).toEqual([]);
  });

  it('INS-3: exactly £20 above is enough; £19.99 is not (even at 1.33×)', () => {
    expect(ofKind(notesOf(eatingOut(6000, 8000)), 'category').map((n) => n.text)).toEqual(['Eating out is £20 over its usual (£80 so far, usually £60)']);
    expect(ofKind(notesOf(eatingOut(6000, 7999)), 'category')).toEqual([]);
  });

  it('INS-3: the 1.3× test is exact (no float drift): usual £66.67 → £86.67 needs 8667.1, so 8667 is not enough, 8668 is', () => {
    expect(ofKind(notesOf(eatingOut(6667, 8667)), 'category')).toEqual([]);
    expect(ofKind(notesOf(eatingOut(6667, 8668)), 'category')).toHaveLength(1);
  });

  it('CHP-5: a trip’s spending never makes a category look unusual', () => {
    const entries = [...eatingOut(12500, 12500), e({ amount: 90000, categoryId: EATING, chapterId: JAPAN, date: '2026-11-04' })];
    expect(ofKind(notesOf(entries), 'category')).toEqual([]);
  });

  it('INS-3: with fewer than three full months there is no usual, so no category note', () => {
    const entries = [e({ amount: 100, date: '2026-08-15' }), ...monthly({ '2026-09': 12500, '2026-10': 12500 }, EATING), e({ amount: 50000, categoryId: EATING, date: '2026-11-08' })];
    expect(ofKind(notesOf(entries), 'category')).toEqual([]);
  });
});

/** `count` earlier Groceries entries of £60.00 in the 6 months before November (one a month from October back), then `big` on 9 Nov. */
function groceries(count: number, big: number, extra: InsightEntry[] = []): InsightEntry[] {
  const months = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05'];
  const earlier = Array.from({ length: count }, (_, i) => e({ amount: 6000, categoryId: GROCERIES, date: `${months[i % 6] ?? '2026-10'}-0${String(1 + Math.floor(i / 6))}` }));
  return [e({ amount: 100, categoryId: RENT, date: '2026-03-15' }), ...earlier, e({ amount: big, categoryId: GROCERIES, description: 'Big shop', date: '2026-11-09' }), ...extra];
}

describe('notes: unusual entry (INS-3, CHP-5)', () => {
  it('INS-3: exactly 3 × the category’s median with 5 earlier entries → "Big shop £180 is about 3× a usual Groceries entry"', () => {
    expect(ofKind(notesOf(groceries(5, 18000)), 'entry')).toEqual([{ kind: 'entry', text: 'Big shop £180 is about 3× a usual Groceries entry', weight: 18000 }]);
  });

  it('INS-3: a penny under 3× is not unusual', () => {
    expect(ofKind(notesOf(groceries(5, 17999)), 'entry')).toEqual([]);
  });

  it('INS-3: with only 4 earlier entries there is no note', () => {
    expect(ofKind(notesOf(groceries(4, 30000)), 'entry')).toEqual([]);
  });

  it('INS-3: entries older than the previous 6 months don’t count toward the 5', () => {
    expect(ofKind(notesOf(groceries(4, 30000, [e({ amount: 6000, categoryId: GROCERIES, date: '2026-04-20' })])), 'entry')).toEqual([]);
  });

  it('INS-3: the multiple is stated: £240 against a £60 median is "about 4×"', () => {
    expect(ofKind(notesOf(groceries(6, 24000)), 'entry').map((n) => n.text)).toEqual(['Big shop £240 is about 4× a usual Groceries entry']);
  });

  it('INS-3: the median, not the mean: one huge earlier entry doesn’t hide a big one', () => {
    const entries = groceries(5, 18000, [e({ amount: 500000, categoryId: GROCERIES, date: '2026-10-20' })]);
    // Earlier: 6000 ×5, 500000 → median of six = (6000 + 6000) ÷ 2 = 6000.
    expect(ofKind(notesOf(entries), 'entry').map((n) => n.text)).toEqual(['Big shop £180 is about 3× a usual Groceries entry']);
  });

  it('CHP-5: a chapter entry is never an unusual entry', () => {
    const entries = groceries(5, 6000, [e({ amount: 40000, categoryId: GROCERIES, chapterId: JAPAN, description: 'Trip shop', date: '2026-11-03' })]);
    expect(ofKind(notesOf(entries), 'entry')).toEqual([]);
  });
});

const NETFLIX: NoteTemplate = { id: 't-netflix', description: 'Netflix', amount: pence(1299), frequency: 'monthly', every: 1, startDate: '2025-06-05', isSubscription: true, active: true };
const RENT_T: NoteTemplate = { id: 't-rent', description: 'Rent', amount: pence(150000), frequency: 'monthly', every: 1, startDate: '2025-01-01', isSubscription: false, active: true };
const GYM: NoteTemplate = { id: 't-gym', description: 'Gym', amount: pence(3000), frequency: 'monthly', every: 1, startDate: '2026-11-03', isSubscription: false, active: true };
const posted = (t: NoteTemplate, amount: number, date: IsoDate) => e({ amount, date, recurringId: t.id, description: t.description, categoryId: SUBS });

describe('notes: subscriptions and regular payments (INS-3)', () => {
  it('INS-3: a subscription whose price changed this month → "Netflix went from £10.99 to £12.99"', () => {
    const ns = ofKind(notesOf([posted(NETFLIX, 1099, '2026-09-05'), posted(NETFLIX, 1099, '2026-10-05'), posted(NETFLIX, 1299, '2026-11-05')], [NETFLIX]), 'price');
    expect(ns).toEqual([{ kind: 'price', text: 'Netflix went from £10.99 to £12.99', weight: 200 }]);
  });

  it('INS-3: the same price, or a change last month, is not a note', () => {
    expect(ofKind(notesOf([posted(NETFLIX, 1299, '2026-10-05'), posted(NETFLIX, 1299, '2026-11-05')], [NETFLIX]), 'price')).toEqual([]);
    expect(ofKind(notesOf([posted(NETFLIX, 1099, '2026-09-05'), posted(NETFLIX, 1299, '2026-10-05'), posted(NETFLIX, 1299, '2026-11-05')], [NETFLIX]), 'price')).toEqual([]);
  });

  it('INS-3: a regular payment that isn’t a subscription changing amount is not a price note', () => {
    expect(ofKind(notesOf([posted(RENT_T, 145000, '2026-10-01'), posted(RENT_T, 150000, '2026-11-01')], [RENT_T]), 'price')).toEqual([]);
  });

  it('INS-3: a new regular payment started this month → "New regular payment: Gym £30.00 a month"', () => {
    expect(ofKind(notesOf([], [GYM]), 'new-regular')).toEqual([{ kind: 'new-regular', text: 'New regular payment: Gym £30.00 a month', weight: 3000 }]);
  });

  it('INS-3: one that started last month, hasn’t started yet, or is paused is not new this month', () => {
    const templates = [
      { ...GYM, startDate: '2026-10-31' },
      { ...GYM, id: 't-later', startDate: '2026-11-20' },
      { ...GYM, id: 't-paused', startDate: '2026-11-02', active: false },
    ];
    expect(ofKind(notesOf([], templates), 'new-regular')).toEqual([]);
    expect(ofKind(notesOf([], [{ ...GYM, startDate: '2026-11-01' }]), 'new-regular')).toHaveLength(1);
  });
});

describe('notes: order (INS-1, INS-3)', () => {
  it('INS-1 INS-3: largest by money first, so Home shows the one that matters most', () => {
    const entries = [...eatingOut(12500, 21000), posted(NETFLIX, 1099, '2026-10-05'), posted(NETFLIX, 1299, '2026-11-05')];
    const ns = notesOf(entries, [NETFLIX, GYM]);
    expect(ns.map((n) => [n.kind, n.weight])).toEqual([['category', 8500], ['new-regular', 3000], ['price', 200]]);
  });

  it('INS-3: a quiet month has no notes', () => {
    expect(notesOf(eatingOut(12500, 12500))).toEqual([]);
  });
});

// ─────────────────────────────── fairness ───────────────────────────────

const FIFTY = { [JAE]: 50, [SAM]: 50 };
const paidBy = (jae: number, sam: number, date: IsoDate = '2026-10-10') => [
  ...(jae ? [e({ amount: jae, paid: { [JAE]: jae }, date })] : []),
  ...(sam ? [e({ amount: sam, paid: { [SAM]: sam }, date })] : []),
];

describe('fairness: each person’s share of what was paid, beside the split (INS-5)', () => {
  it('INS-5: "Jae paid 58%, Sam 42% · your split is 50/50"', () => {
    expect(core().fairness(paidBy(58000, 42000), PEOPLE, P('3months'), FIFTY)).toEqual({ percents: { [JAE]: 58, [SAM]: 42 }, split: FIFTY, total: 100000 });
  });

  it('INS-5: whole percentages by largest remainder: a third and two thirds → 33 and 67', () => {
    expect(core().fairness(paidBy(10000, 20000), PEOPLE, P('3months'), FIFTY)?.percents).toEqual({ [JAE]: 33, [SAM]: 67 });
  });

  it('INS-5: an exact tie in remainders goes to the first person named (49.5 / 50.5 → 50 / 50; 50.5 / 49.5 → 51 / 49)', () => {
    expect(core().fairness(paidBy(99, 101), PEOPLE, P('3months'), FIFTY)?.percents).toEqual({ [JAE]: 50, [SAM]: 50 });
    expect(core().fairness(paidBy(101, 99), PEOPLE, P('3months'), FIFTY)?.percents).toEqual({ [JAE]: 51, [SAM]: 49 });
    expect(core().fairness(paidBy(101, 99), [SAM, JAE], P('3months'), FIFTY)?.percents).toEqual({ [JAE]: 50, [SAM]: 50 });
    expect(core().fairness(paidBy(99, 101), [SAM, JAE], P('3months'), FIFTY)?.percents).toEqual({ [JAE]: 49, [SAM]: 51 });
  });

  it('INS-5: over the period only (3 vs 12 months), shared spending only, money back off the person who got it', () => {
    const entries = [
      ...paidBy(30000, 30000, '2026-10-10'),
      ...paidBy(40000, 0, '2026-03-10'), // in the 12 months, not the 3
      e({ amount: 50000, splitMode: 'for_other', shares: { [JAE]: 0, [SAM]: 50000 }, date: '2026-10-11' }), // not shared spending
      e({ kind: 'money_back', amount: 10000, paid: { [SAM]: 10000 }, date: '2026-10-12' }), // Sam got £100 back
    ];
    // 3 months: Jae 30000, Sam 30000 − 10000 = 20000 → 60 / 40. 12 months: Jae 70000, Sam 20000 → 77.78 / 22.22 → 78 / 22.
    expect(core().fairness(entries, PEOPLE, P('3months'), FIFTY)).toEqual({ percents: { [JAE]: 60, [SAM]: 40 }, split: FIFTY, total: 50000 });
    expect(core().fairness(entries, PEOPLE, P('12months'), { [JAE]: 60, [SAM]: 40 })).toEqual({ percents: { [JAE]: 78, [SAM]: 22 }, split: { [JAE]: 60, [SAM]: 40 }, total: 90000 });
  });

  it('INS-5: nothing paid in the period → no fairness figure', () => {
    expect(core().fairness([], PEOPLE, P('3months'), FIFTY)).toBeNull();
    expect(core().fairness(paidBy(5000, 5000, '2025-01-10'), PEOPLE, P('3months'), FIFTY)).toBeNull();
  });
});

// ─────────────────────────────── standing order ───────────────────────────────

/** Jae pays `amount` that is all Sam's (exact split): Sam's debt to Jae grows by `amount`. Negative: the other way. */
function owe(amount: number, date: IsoDate): InsightEntry {
  return amount >= 0
    ? e({ amount, splitMode: 'exact', paid: { [JAE]: amount }, shares: { [JAE]: 0, [SAM]: amount }, date, categoryId: RENT })
    : e({ amount: -amount, splitMode: 'exact', paid: { [SAM]: -amount }, shares: { [JAE]: -amount, [SAM]: 0 }, date, categoryId: RENT });
}
const so = (entries: InsightEntry[], settlements: InsightSettlement[] = [], today: IsoDate = TODAY) => core().standingOrder(entries, settlements, PEOPLE, today);

describe('standingOrder: the standing-order hint (INS-6)', () => {
  it('INS-6: Sam owed Jae at the end of Aug, Sep and Oct (£100, £120, £140) → a standing order of £120 a month', () => {
    const entries = [owe(10000, '2026-08-10'), e({ amount: 24000, date: '2026-09-10' }), e({ amount: 28000, date: '2026-10-10' })];
    // Aug end: 10000. Sep: Sam pays back 10000 (2 Sep), then a £240 shop at 50/50 → 12000. Oct: pays back 12000, £280 shop → 14000.
    const settlements = [settle(SAM, JAE, 10000, '2026-09-02'), settle(SAM, JAE, 12000, '2026-10-02')];
    expect(so(entries, settlements)).toEqual({ debtor: SAM, creditor: JAE, amount: 12000 });
  });

  it('INS-6: the mean is rounded down to £10 (£120.17 → £120; £59.99 → £50)', () => {
    expect(so([owe(10000, '2026-08-10'), owe(2000, '2026-09-10'), owe(2050, '2026-10-10')])?.amount).toBe(12000);
    expect(so([owe(5999, '2026-08-10')])?.amount).toBe(5000);
  });

  it('INS-6: a mean of exactly £50.00 is enough; £49.99… is not', () => {
    expect(so([owe(4000, '2026-08-10'), owe(1000, '2026-09-10'), owe(1000, '2026-10-10')])).toEqual({ debtor: SAM, creditor: JAE, amount: 5000 });
    expect(so([owe(4000, '2026-08-10'), owe(1000, '2026-09-10'), owe(999, '2026-10-10')])).toBeNull();
  });

  it('INS-6: the other way round names Jae as the one who owes', () => {
    expect(so([owe(-30000, '2026-08-10')])).toEqual({ debtor: JAE, creditor: SAM, amount: 30000 });
  });

  it('INS-6: a change of direction, or square at one month end, is no hint', () => {
    expect(so([owe(-10000, '2026-08-10'), owe(30000, '2026-09-10')])).toBeNull();
    expect(so([owe(30000, '2026-08-10'), owe(-30000, '2026-09-10'), owe(30000, '2026-10-10')])).toBeNull();
  });

  it('INS-6: only the three full months before this one; this month’s settle-up and older history don’t change it', () => {
    const entries = [owe(-90000, '2026-06-10'), owe(160000, '2026-07-10')]; // Jae owed in June; Sam owes £700 from July on
    const settlements = [settle(SAM, JAE, 70000, '2026-11-02')];
    expect(so(entries, settlements)).toEqual({ debtor: SAM, creditor: JAE, amount: 70000 });
  });

  it('INS-6: the balance counts every row: for_other and money back included, deleted rows and settle-ups ignored', () => {
    const entries = [
      e({ amount: 9000, splitMode: 'for_other', shares: { [JAE]: 0, [SAM]: 9000 }, date: '2026-08-05' }), // Sam owes 9000
      e({ kind: 'money_back', amount: 2000, paid: { [JAE]: 2000 }, shares: { [JAE]: 1000, [SAM]: 1000 }, date: '2026-08-06' }), // −(2000 − 1000) → 8000
      e({ amount: 50000, deleted: true, date: '2026-08-07' }),
    ];
    const settlements = [{ ...settle(SAM, JAE, 8000, '2026-08-08'), deleted: true }];
    expect(so(entries, settlements)).toEqual({ debtor: SAM, creditor: JAE, amount: 8000 });
  });

  it('INS-6: a household too new for three month ends gets no hint', () => {
    expect(so([owe(30000, '2026-09-10')])).toBeNull();
  });
});

// ─────────────────────────────── properties ───────────────────────────────

const CATS = [GROCERIES, EATING, HOUSEHOLD, null] as const;
const dateArb = fc.integer({ min: 0, max: 40 }).map((n) => addDays('2026-10-20', n));
const entryArb: fc.Arbitrary<InsightEntry> = fc
  .record({
    kind: fc.constantFrom<'expense' | 'money_back'>('expense', 'expense', 'expense', 'money_back'),
    jae: fc.integer({ min: 0, max: 300_000 }),
    sam: fc.integer({ min: 0, max: 300_000 }),
    splitMode: fc.constantFrom<SplitMode>('ratio', 'exact', 'treat', 'for_other'),
    categoryId: fc.constantFrom(...CATS),
    chapterId: fc.constantFrom(null, null, JAPAN),
    country: fc.constantFrom('GB', 'GB', 'JP', null),
    date: dateArb,
    deleted: fc.boolean(),
  })
  .filter((r) => r.jae + r.sam > 0)
  .map((r) => {
    const amount = r.jae + r.sam;
    const half = Math.floor(amount / 2);
    return e({
      kind: r.kind, amount, paid: { [JAE]: r.jae, [SAM]: r.sam }, shares: { [JAE]: amount - half, [SAM]: half }, splitMode: r.splitMode,
      categoryId: r.categoryId, chapterId: r.chapterId, country: r.country, date: r.date, deleted: r.deleted,
    });
  });
const choiceArb = fc.constantFrom<PeriodChoice>('month', '3months', '12months', 'year');

describe('properties (INS-4, INS-5, PLC-7)', () => {
  it('INS-4: Σ by category = the total, with and without chapters', () => {
    fc.assert(fc.property(fc.array(entryArb, { maxLength: 40 }), choiceArb, fc.boolean(), (entries, choice, everydayOnly) => {
      const p = P(choice);
      expect(sum(core().byCategory(entries, p, { everydayOnly }).map((c) => c.total))).toBe(core().sharedSpend(entries, p, { everydayOnly }));
    }));
  });

  it('PLC-7: Σ by country = the total', () => {
    fc.assert(fc.property(fc.array(entryArb, { maxLength: 40 }), choiceArb, fc.boolean(), (entries, choice, everydayOnly) => {
      const p = P(choice);
      expect(sum(core().byCountry(entries, p, { everydayOnly }).map((c) => c.total))).toBe(core().sharedSpend(entries, p, { everydayOnly }));
    }));
  });

  it('INS-4: Σ who paid = the total', () => {
    fc.assert(fc.property(fc.array(entryArb, { maxLength: 40 }), choiceArb, fc.boolean(), (entries, choice, everydayOnly) => {
      const p = P(choice);
      const paid = core().whoPaid(entries, p, PEOPLE, { everydayOnly });
      expect(Object.keys(paid).sort()).toEqual([JAE, SAM]);
      expect((paid[JAE] ?? 0) + (paid[SAM] ?? 0)).toBe(core().sharedSpend(entries, p, { everydayOnly }));
    }));
  });

  it('INS-4: the 12 months of the trend add up to "Last 12 months" when nothing is dated after today', () => {
    const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
    fc.assert(fc.property(fc.array(entryArb, { maxLength: 40 }), (all) => {
      const entries = all.filter((x) => x.date <= TODAY);
      expect(sum(core().monthlyTotals(entries, months).map((m) => m.total))).toBe(core().sharedSpend(entries, P('12months')));
    }));
  });

  it('INS-5: fairness percentages are whole and sum to 100', () => {
    const paidArb = fc.array(fc.record({ jae: fc.integer({ min: 0, max: 500_000 }), sam: fc.integer({ min: 0, max: 500_000 }) }), { minLength: 1, maxLength: 20 });
    fc.assert(fc.property(paidArb, (rows) => {
      const entries = rows.filter((r) => r.jae + r.sam > 0).map((r) => e({ amount: r.jae + r.sam, paid: { [JAE]: r.jae, [SAM]: r.sam }, date: '2026-10-10' }));
      const f = core().fairness(entries, PEOPLE, P('3months'), FIFTY);
      if (sum(entries.map((x) => x.amount)) === 0) {
        expect(f).toBeNull();
        return;
      }
      expect(f).not.toBeNull();
      const a = f?.percents[JAE] ?? NaN;
      const b = f?.percents[SAM] ?? NaN;
      expect(Number.isInteger(a) && Number.isInteger(b)).toBe(true);
      expect(a + b).toBe(100);
      // Never more than one point from the exact share.
      expect(Math.abs(a - (100 * sum(entries.map((x) => x.paid[JAE] ?? 0))) / (f?.total ?? 1))).toBeLessThan(1);
    }));
  });

  it('INS-6: any hint is a whole £10 and at least £50', () => {
    const rowArb = fc.record({ amount: fc.integer({ min: -60_000, max: 60_000 }), date: fc.integer({ min: 0, max: 150 }).map((n) => addDays('2026-06-15', n)) });
    fc.assert(fc.property(fc.array(rowArb, { maxLength: 12 }), (rows) => {
      const hint = so(rows.filter((r) => r.amount !== 0).map((r) => owe(r.amount, r.date)));
      if (hint) {
        expect(hint.amount % 1000).toBe(0);
        expect(hint.amount).toBeGreaterThanOrEqual(5000);
        expect(hint.debtor).not.toBe(hint.creditor);
      }
    }));
  });
});
