/**
 * S5b core (docs/slices/S5b.md "Decisions made here", "Interfaces"; SPEC INS-2, INS-7, INS-8; DATA_MODEL §5): the
 * month's recap, the year in review and "on this day", computed on the phone from the household's rows. Every figure
 * comes from src/core/insights.ts (sharedSpend, byCategory, whoPaid, usual, notes, monthlyTotals) and balance.ts;
 * this module adds no new money rule. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/recap.ts (pure; no I/O, no clock; every figure exact pence):
 *
 *   recapOf(entries: InsightEntry[], settlements: InsightSettlement[], people: readonly [UserId, UserId], month: Month,
 *           opts: RecapOptions): Recap
 *     interface RecapOptions {
 *       today: IsoDate;                                    // the phone's date
 *       names: Record<UserId, string>;                     // 'Jae', 'Sam' (unused by figures; for wording)
 *       categories: readonly { id: string; name: string }[];
 *       templates?: readonly NoteTemplate[];               // for the notes (insights.ts)
 *       commentCounts?: Readonly<Record<string, number>>;  // expense id → live comments (for the moment)
 *     }
 *     interface Recap {
 *       month: Month;
 *       soFar: boolean;           // today is on or before the month's last day (a settle-day recap): figures run
 *                                 // from the 1st to today; otherwise the whole month
 *       total: Pence;             // sharedSpend over the month (chapters included)
 *       everyday: Pence;          // the same, everyday only (CHP-5)
 *       usual: Pence | null;      // usual(entries, month) (everyday); null for a so-far recap too
 *       comparison: { direction: 'less' | 'more' | 'same'; amount: Pence } | null
 *                                 // everyday − usual = d; |d| ≤ £10.00 → 'same' (amount 0); else |d| to the nearest
 *                                 // £10 (1000p), halves up. null without a usual or for a so-far recap.
 *       headline: string;         // the template wording (INS-2; the AI wording is S6):
 *                                 //   "October cost £1,596.00 together, about £70 less than usual."
 *                                 //   "October cost £1,009.00 together, about the same as usual."
 *                                 //   "October cost £300.00 together."                    (no usual)
 *                                 //   "November so far cost £300.00 together."            (so far: no comparison)
 *       bar: { categoryId: string | null; name: string; total: Pence }[]
 *                                 // byCategory over the month, largest first: more than four categories → the top
 *                                 // four and { categoryId: null, name: 'Everything else', total: the rest };
 *                                 // otherwise each one. Totals sum to `total`.
 *       notes: Note[];            // notes(…, the month's last day — or today when so far), the first three
 *       paid: Record<UserId, Pence>;   // whoPaid over the month (chapters included), both people present
 *       balance: { debtor: UserId; creditor: UserId; amount: Pence } | null
 *                                 // today's balance (balance.ts over every live row and settle-up); null when square
 *       moment: { id: string; description: string; amount: Pence; date: IsoDate; comments: number } | null
 *                                 // among the month's live shared expenses (to today when so far): the most-commented
 *                                 // (≥ 1 comment; a tie → the bigger, then the earlier); with none commented, the
 *                                 // biggest (a tie → the earlier date); no expenses → null
 *     }
 *
 *   yearOf(entries: InsightEntry[], chapters: readonly { id: string; name: string }[], people, year: number): YearInReview
 *     interface YearInReview {
 *       year: number;
 *       total: Pence;                                          // sharedSpend 1 Jan–31 Dec, chapters included
 *       categories: { categoryId: string | null; total: Pence }[]   // byCategory, the top three
 *       months: { month: Month; total: Pence }[];              // the 12 months, Jan–Dec, £0.00 included
 *       biggest: { id: string; description: string; amount: Pence; date: IsoDate } | null
 *                                                              // the largest live shared expense (tie → earlier)
 *       chapters: { id: string; name: string; total: Pence }[]
 *                                                              // chapters with a live entry dated in the year, each
 *                                                              // with its own total (all its entries), largest first
 *       paid: Record<UserId, Pence>;                           // whoPaid over the year
 *     }
 *
 *   onThisDay(entries: (InsightEntry & { place: string | null })[], commentCounts: Readonly<Record<string, number>>,
 *             today: IsoDate): (InsightEntry & { place: string | null }) | null
 *     A live expense dated exactly a year before today (same month and day, the year before) that has a comment or a
 *     chapter. Several → the biggest (tie → the first given). 29 Feb has no "a year ago" and no "a year later"
 *     (in a non-leap year nothing matches it; on 29 Feb nothing is a year old). No such entry → null.
 *
 * Until src/core/recap.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module); once it exists this can become `import * as recap from './recap'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import type { InsightEntry, InsightSettlement, Month, Note, NoteTemplate } from './insights';
import { pence, type Pence } from './money';
import type { PenceMap, UserId } from './split';

interface RecapOptions {
  today: IsoDate; names: Record<UserId, string>; categories: readonly { id: string; name: string }[];
  templates?: readonly NoteTemplate[]; commentCounts?: Readonly<Record<string, number>>;
}
interface Recap {
  month: Month; soFar: boolean; total: Pence; everyday: Pence; usual: Pence | null;
  comparison: { direction: 'less' | 'more' | 'same'; amount: Pence } | null; headline: string;
  bar: { categoryId: string | null; name: string; total: Pence }[]; notes: Note[]; paid: Record<UserId, Pence>;
  balance: { debtor: UserId; creditor: UserId; amount: Pence } | null;
  moment: { id: string; description: string; amount: Pence; date: IsoDate; comments: number } | null;
}
interface YearInReview {
  year: number; total: Pence; categories: { categoryId: string | null; total: Pence }[]; months: { month: Month; total: Pence }[];
  biggest: { id: string; description: string; amount: Pence; date: IsoDate } | null;
  chapters: { id: string; name: string; total: Pence }[]; paid: Record<UserId, Pence>;
}
type PlacedEntry = InsightEntry & { place: string | null };
interface RecapCore {
  recapOf(entries: readonly InsightEntry[], settlements: readonly InsightSettlement[], people: readonly [UserId, UserId], month: Month, opts: RecapOptions): Recap;
  yearOf(entries: readonly InsightEntry[], chapters: readonly { id: string; name: string }[], people: readonly [UserId, UserId], year: number): YearInReview;
  onThisDay(entries: readonly PlacedEntry[], commentCounts: Readonly<Record<string, number>>, today: IsoDate): PlacedEntry | null;
}

const NAMES = ['recapOf', 'yearOf', 'onThisDay'] as const;
const RECAP = './recap';
const loaded = (await import(/* @vite-ignore */ RECAP).catch(() => null)) as Partial<RecapCore> | null;
function core(): RecapCore {
  const missing = NAMES.filter((n) => typeof loaded?.[n] !== 'function');
  if (!loaded || missing.length > 0) throw new Error(`src/core/recap.ts does not export ${missing.join(', ')} yet (S5b)`);
  return loaded as RecapCore;
}

// ───────── the household ─────────
const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const WHO = { [JAE]: 'Jae', [SAM]: 'Sam' };
const TODAY = '2026-11-14';
const GROCERIES = 'cat-groceries';
const EATING = 'cat-eating';
const HOUSEHOLD = 'cat-household';
const TRAVEL = 'cat-travel';
const RENT = 'cat-rent';
const TRANSPORT = 'cat-transport';
const GOING_OUT = 'cat-going-out';
const CATEGORIES = [
  { id: GROCERIES, name: 'Groceries' }, { id: EATING, name: 'Eating out' }, { id: HOUSEHOLD, name: 'Household' },
  { id: TRAVEL, name: 'Travel' }, { id: RENT, name: 'Rent & bills' }, { id: TRANSPORT, name: 'Transport' }, { id: GOING_OUT, name: 'Going out' },
];
const BATH = 'ch-bath';
const SOFA = 'ch-sofa';
const LISBON = 'ch-lisbon';
const CHAPTERS = [{ id: BATH, name: 'Bath weekend' }, { id: SOFA, name: 'New sofa' }, { id: LISBON, name: 'Lisbon' }];

let seq = 0;
/** An entry: Jae paying, split 50/50 (ratio), everyday, Groceries, in the UK, on 10 Oct, unless told otherwise. */
function e(over: Partial<Omit<PlacedEntry, 'amount' | 'paid' | 'shares'>> & { amount: number; paid?: Record<string, number>; shares?: Record<string, number> }): PlacedEntry {
  const { amount, paid, shares, ...rest } = over;
  const toMap = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)])) as PenceMap;
  const half = Math.floor(amount / 2);
  seq += 1;
  return {
    id: `e${String(seq)}`, kind: 'expense', description: 'Something', splitMode: 'ratio', date: '2026-10-10', categoryId: GROCERIES,
    chapterId: null, country: 'GB', recurringId: null, deleted: false, place: null, ...rest,
    amount: pence(amount), paid: toMap(paid ?? { [JAE]: amount }), shares: toMap(shares ?? { [JAE]: amount - half, [SAM]: half }),
  };
}
const bySam = (amount: number) => ({ amount, paid: { [SAM]: amount } });
const settle = (from: UserId, to: UserId, amount: number, date: IsoDate): InsightSettlement => ({ from, to, amount: pence(amount), date, deleted: false });

/**
 * The household, worked by hand (every entry split 50/50):
 *   10 Jun 2025   Lisbon (chapter) Travel "Flights" £400.00 (Jae)                         ← the first entry
 *   15 Mar 2026   New sofa (chapter) Household "Sofa" £1,200.00 (Jae)
 *   10 May–10 Sep Rent & bills "Rent" £1,000.00 (Jae), Eating out "Dinner" £125.00 (Sam), Groceries "Weekly shop"
 *                 £240.00 (Sam): £1,365.00 a month; 28 May–28 Sep Sam pays Jae £300.00
 *   October 2026 (everyday £1,296.00; with Bath £1,596.00):
 *     10 Oct Rent £1,000.00 (Jae)              Rent & bills     12 Oct Dishoom £86.00 (Sam)          Eating out
 *     10 Oct Weekly shop £40.00 (Sam)          Groceries        18 Oct Birthday dinner £90.00 (Sam)  Eating out
 *     20 Oct Lamp £45.00 (Jae)                 Household        22 Oct Taxi £20.00 (Jae)             Transport
 *     25 Oct Cinema £15.00 (Sam)               Going out        24 Oct Hotel £300.00 (Jae)           Travel, Bath weekend
 *     excluded: 11 Oct "Old chair" £999.00 deleted; 11 Oct "Sam's book" £50.00 for_other
 *   3 Nov 2026    Going out "Big night out" £300.00 (Sam)
 *
 * October's recap (today 14 Nov):
 *   total £1,596.00; everyday £1,296.00; usual (Apr–Sep 2026, everyday: £0, then £1,365.00 × 5) £1,365.00;
 *   d = −£69.00 → "about £70 less than usual".
 *   Where it went: Rent & bills £1,000.00, Travel £300.00, Eating out £176.00, Household £45.00,
 *     Everything else £75.00 (Groceries £40.00 + Transport £20.00 + Going out £15.00) = £1,596.00.
 *   Notes as of 31 Oct: Eating out £176 against its usual £125 (≥ 1.3× and ≥ £20 over) → one note, weight £51.00.
 *   Who paid: Jae £1,365.00 (Rent, Lamp, Taxi, Hotel), Sam £231.00 (Weekly shop, Dishoom, Birthday dinner, Cinema).
 *   Today's balance: Jae is owed: Lisbon +200.00; May–Sep 5 × (+317.50) − 5 × 300.00 = +87.50; Sofa +600.00;
 *     October +1,365.00 − 798.00 + 50.00 (Sam's book, Jae paid for Sam) = +617.00; November −150.00
 *     → Sam owes Jae £1,354.50.
 *   The moment: no comments → Rent £1,000.00, 10 Oct.
 */
const OCT = {
  rent: e({ description: 'Rent', amount: 100000, categoryId: RENT, date: '2026-10-10' }),
  shop: e({ description: 'Weekly shop', ...bySam(4000), categoryId: GROCERIES, date: '2026-10-10' }),
  dishoom: e({ description: 'Dishoom', ...bySam(8600), categoryId: EATING, date: '2026-10-12', place: 'Dishoom Covent Garden' }),
  birthday: e({ description: 'Birthday dinner', ...bySam(9000), categoryId: EATING, date: '2026-10-18' }),
  lamp: e({ description: 'Lamp', amount: 4500, categoryId: HOUSEHOLD, date: '2026-10-20' }),
  taxi: e({ description: 'Taxi', amount: 2000, categoryId: TRANSPORT, date: '2026-10-22' }),
  cinema: e({ description: 'Cinema', ...bySam(1500), categoryId: GOING_OUT, date: '2026-10-25' }),
  hotel: e({ description: 'Hotel', amount: 30000, categoryId: TRAVEL, chapterId: BATH, date: '2026-10-24' }),
  oldChair: e({ description: 'Old chair', amount: 99900, categoryId: HOUSEHOLD, date: '2026-10-11', deleted: true }),
  book: e({ description: "Sam's book", amount: 5000, splitMode: 'for_other', shares: { [SAM]: 5000 }, categoryId: GOING_OUT, date: '2026-10-11' }),
};
const NIGHT_OUT = e({ description: 'Big night out', ...bySam(30000), categoryId: GOING_OUT, date: '2026-11-03' });
const SOFA_ENTRY = e({ description: 'Sofa', amount: 120000, categoryId: HOUSEHOLD, chapterId: SOFA, date: '2026-03-15' });
const FLIGHTS = e({ description: 'Flights', amount: 40000, categoryId: TRAVEL, chapterId: LISBON, country: 'PT', date: '2025-06-10' });

function household(): { entries: PlacedEntry[]; settlements: InsightSettlement[] } {
  const entries: PlacedEntry[] = [FLIGHTS, SOFA_ENTRY];
  const settlements: InsightSettlement[] = [];
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    entries.push(
      e({ description: 'Rent', amount: 100000, categoryId: RENT, date: `${m}-10` }),
      e({ description: 'Dinner', ...bySam(12500), categoryId: EATING, date: `${m}-10` }),
      e({ description: 'Weekly shop', ...bySam(24000), categoryId: GROCERIES, date: `${m}-10` }),
    );
    settlements.push(settle(SAM, JAE, 30000, `${m}-28`));
  }
  entries.push(...Object.values(OCT), NIGHT_OUT);
  return { entries, settlements };
}

const OPTS: RecapOptions = { today: TODAY, names: WHO, categories: CATEGORIES };
function october(opts: Partial<RecapOptions> = {}, h = household()): Recap {
  return core().recapOf(h.entries, h.settlements, PEOPLE, '2026-10', { ...OPTS, ...opts });
}
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** One everyday Rent entry a month (on the 15th), May onwards, with these October totals: a usual of £1,000.00. */
function steady(octoberTotal: number): PlacedEntry[] {
  const out = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => e({ amount: 100000, categoryId: RENT, date: `${m}-15` }));
  if (octoberTotal > 0) out.push(e({ amount: octoberTotal, categoryId: RENT, date: '2026-10-15' }));
  return out;
}
const headlineFor = (entries: PlacedEntry[], month: Month = '2026-10', today: IsoDate = TODAY) =>
  core().recapOf(entries, [], PEOPLE, month, { ...OPTS, today }).headline;

// ─────────────────────────────── INS-2: the headline ───────────────────────────────

describe('recapOf: the headline (INS-2, template wording)', () => {
  it('INS-2: October cost £1,596.00 together, about £70 less than usual (usual = everyday, chapters left out: CHP-5)', () => {
    const r = october();
    expect(r.month).toBe('2026-10');
    expect(r.soFar).toBe(false);
    expect(r.total).toBe(159600);
    expect(r.everyday).toBe(129600);
    expect(r.usual).toBe(136500);
    expect(r.comparison).toEqual({ direction: 'less', amount: 7000 });
    expect(r.headline).toBe('October cost £1,596.00 together, about £70 less than usual.');
  });

  it('INS-2: the difference goes to the nearest £10, halves up ("about £120 less")', () => {
    expect(headlineFor(steady(88500))).toBe('October cost £885.00 together, about £120 less than usual.');
    expect(headlineFor(steady(111400))).toBe('October cost £1,114.00 together, about £110 more than usual.');
    expect(headlineFor(steady(111500))).toBe('October cost £1,115.00 together, about £120 more than usual.');
  });

  it('INS-2: within £10 of the usual (inclusive) it is "about the same as usual"', () => {
    expect(headlineFor(steady(100900))).toBe('October cost £1,009.00 together, about the same as usual.');
    expect(headlineFor(steady(99000))).toBe('October cost £990.00 together, about the same as usual.');
    expect(headlineFor(steady(101000))).toBe('October cost £1,010.00 together, about the same as usual.');
    expect(headlineFor(steady(101100))).toBe('October cost £1,011.00 together, about £10 more than usual.');
    const same = core().recapOf(steady(100900), [], PEOPLE, '2026-10', OPTS);
    expect(same.comparison).toEqual({ direction: 'same', amount: 0 });
  });

  it('INS-2: no usual yet (fewer than 3 full months) → no comparison', () => {
    const young = [e({ amount: 20000, date: '2026-09-05' }), e({ amount: 30000, date: '2026-10-05' })];
    const r = core().recapOf(young, [], PEOPLE, '2026-10', OPTS);
    expect(r.usual).toBeNull();
    expect(r.comparison).toBeNull();
    expect(r.headline).toBe('October cost £300.00 together.');
  });

  it('INS-2 SET-4: a month not yet over (settle day) is "so far": 1st to today, no comparison', () => {
    const h = household();
    h.entries.push(e({ description: 'Later', amount: 5000, date: '2026-11-20' }));
    const r = core().recapOf(h.entries, h.settlements, PEOPLE, '2026-11', OPTS);
    expect(r.soFar).toBe(true);
    expect(r.total).toBe(30000);
    expect(r.comparison).toBeNull();
    expect(r.headline).toBe('November so far cost £300.00 together.');
  });
});

// ─────────────────────────────── INS-2: where it went ───────────────────────────────

describe('recapOf: one bar, where it went (INS-2)', () => {
  it('INS-2: the top four categories and "Everything else", largest first, summing to the total', () => {
    const r = october();
    expect(r.bar).toEqual([
      { categoryId: RENT, name: 'Rent & bills', total: 100000 },
      { categoryId: TRAVEL, name: 'Travel', total: 30000 },
      { categoryId: EATING, name: 'Eating out', total: 17600 },
      { categoryId: HOUSEHOLD, name: 'Household', total: 4500 },
      { categoryId: null, name: 'Everything else', total: 7500 },
    ]);
    expect(sum(r.bar.map((b) => b.total))).toBe(r.total);
  });

  it('INS-2: four categories or fewer → each one, no "Everything else"', () => {
    const r = core().recapOf([...steady(100000), e({ amount: 3000, categoryId: EATING, date: '2026-10-02' })], [], PEOPLE, '2026-10', OPTS);
    expect(r.bar.map((b) => b.name)).toEqual(['Rent & bills', 'Eating out']);
  });

  it('INS-2: property: at most five parts, largest first among the named, always summing to the month total', () => {
    const cats = CATEGORIES.map((c) => c.id);
    fc.assert(fc.property(
      fc.array(fc.record({ cat: fc.constantFrom(...cats), amount: fc.integer({ min: 1, max: 500000 }), day: fc.integer({ min: 1, max: 31 }) }), { minLength: 1, maxLength: 30 }),
      (rows) => {
        const entries = rows.map((x) => e({ amount: x.amount, categoryId: x.cat, date: `2026-10-${String(x.day).padStart(2, '0')}` }));
        const r = core().recapOf(entries, [], PEOPLE, '2026-10', OPTS);
        expect(r.bar.length).toBeLessThanOrEqual(5);
        expect(sum(r.bar.map((b) => b.total))).toBe(r.total);
        const named = r.bar.filter((b) => b.name !== 'Everything else').map((b) => b.total);
        expect([...named].sort((a, b) => b - a)).toEqual(named);
        expect(r.bar.filter((b) => b.name === 'Everything else').length).toBe(new Set(rows.map((x) => x.cat)).size > 4 ? 1 : 0);
      },
    ), { seed: 5021, numRuns: 150 });
  });
});

// ─────────────────────────────── INS-2: notes ───────────────────────────────

describe('recapOf: up to three notes, as of the month\'s last day (INS-2, INS-3)', () => {
  it('INS-2 INS-3: October\'s one note is Eating out over its usual; November\'s entries don\'t count', () => {
    const r = october();
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ kind: 'category', weight: 5100 });
    expect(r.notes[0]?.text).toContain('Eating out');
  });

  it('INS-2 INS-3: a regular payment started after the month ended is not October\'s note', () => {
    const later: NoteTemplate = { id: 't1', description: 'Gym', amount: pence(3000), frequency: 'monthly', every: 1, startDate: '2026-11-05', isSubscription: false, active: true };
    const within: NoteTemplate = { ...later, id: 't2', description: 'Window cleaner', startDate: '2026-10-20' };
    const r = october({ templates: [later, within] });
    expect(r.notes.map((n) => n.kind)).toContain('new-regular');
    expect(r.notes.some((n) => n.text.includes('Gym'))).toBe(false);
    expect(r.notes.some((n) => n.text.includes('Window cleaner'))).toBe(true);
  });

  it('INS-2: never more than three notes, the three largest by weight', () => {
    const cats = [GROCERIES, EATING, HOUSEHOLD, TRANSPORT];
    const entries: PlacedEntry[] = [];
    for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) for (const c of cats) entries.push(e({ amount: 10000, categoryId: c, date: `${m}-15` }));
    cats.forEach((c, i) => entries.push(e({ amount: 20000 + 1000 * i, categoryId: c, date: '2026-10-15' })));
    const r = core().recapOf(entries, [], PEOPLE, '2026-10', OPTS);
    expect(r.notes.map((n) => n.weight)).toEqual([13000, 12000, 11000]);
  });
});

// ─────────────────────────────── INS-2: between you ───────────────────────────────

describe('recapOf: between you (INS-2, MB-1)', () => {
  it('INS-2: what each paid in October (chapters included) and today\'s balance', () => {
    const r = october();
    expect(r.paid).toEqual({ [JAE]: 136500, [SAM]: 23100 });
    expect((r.paid[JAE] ?? 0) + (r.paid[SAM] ?? 0)).toBe(r.total);
    expect(r.balance).toEqual({ debtor: SAM, creditor: JAE, amount: 135450 });
  });

  it('INS-2: square → no balance (nothing to settle)', () => {
    const lunch = e({ amount: 2000, date: '2026-10-05' });
    const r = core().recapOf([lunch], [settle(SAM, JAE, 1000, '2026-10-06')], PEOPLE, '2026-10', OPTS);
    expect(r.balance).toBeNull();
    expect(r.paid).toEqual({ [JAE]: 2000, [SAM]: 0 });
  });
});

// ─────────────────────────────── INS-2: one moment ───────────────────────────────

describe('recapOf: one moment (INS-2)', () => {
  it('INS-2: no comments → the month\'s biggest expense', () => {
    expect(october().moment).toEqual({ id: OCT.rent.id, description: 'Rent', amount: 100000, date: '2026-10-10', comments: 0 });
  });

  it('INS-2 ACT-4: the most-commented entry wins over the biggest', () => {
    const r = october({ commentCounts: { [OCT.dishoom.id]: 2, [OCT.lamp.id]: 1 } });
    expect(r.moment).toEqual({ id: OCT.dishoom.id, description: 'Dishoom', amount: 8600, date: '2026-10-12', comments: 2 });
  });

  it('INS-2: equal comments → the bigger; a deleted entry or another month\'s never counts', () => {
    const r = october({ commentCounts: { [OCT.dishoom.id]: 1, [OCT.birthday.id]: 1, [OCT.oldChair.id]: 5, [NIGHT_OUT.id]: 9 } });
    expect(r.moment?.id).toBe(OCT.birthday.id);
  });

  it('INS-2: a month with no expenses has no moment', () => {
    expect(core().recapOf(steady(0), [], PEOPLE, '2026-10', OPTS).moment).toBeNull();
  });
});

// ─────────────────────────────── INS-7: year in review ───────────────────────────────

describe('yearOf: the year in review (INS-7)', () => {
  /** 2026: Sofa £1,200.00 + May–Sep 5 × £1,365.00 + October £1,596.00 + November £300.00 = £9,921.00. */
  it('INS-7: the year\'s total and its top three categories', () => {
    const y = core().yearOf(household().entries, CHAPTERS, PEOPLE, 2026);
    expect(y.year).toBe(2026);
    expect(y.total).toBe(992100);
    expect(y.categories).toEqual([
      { categoryId: RENT, total: 600000 },
      { categoryId: HOUSEHOLD, total: 124500 },
      { categoryId: GROCERIES, total: 124000 },
    ]);
  });

  it('INS-7: the months as 12 columns, January to December, empty months £0.00', () => {
    const y = core().yearOf(household().entries, CHAPTERS, PEOPLE, 2026);
    expect(y.months.map((m) => m.month)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `2026-${m}`));
    expect(y.months.map((m) => m.total)).toEqual([0, 0, 120000, 0, 136500, 136500, 136500, 136500, 136500, 159600, 30000, 0]);
    expect(sum(y.months.map((m) => m.total))).toBe(y.total);
  });

  it('INS-7: the biggest expense, the chapters of that year with their totals (largest first), who paid', () => {
    const y = core().yearOf(household().entries, CHAPTERS, PEOPLE, 2026);
    expect(y.biggest).toEqual({ id: SOFA_ENTRY.id, description: 'Sofa', amount: 120000, date: '2026-03-15' });
    expect(y.chapters).toEqual([{ id: SOFA, name: 'New sofa', total: 120000 }, { id: BATH, name: 'Bath weekend', total: 30000 }]);
    expect(y.paid).toEqual({ [JAE]: 756500, [SAM]: 235600 });
    expect((y.paid[JAE] ?? 0) + (y.paid[SAM] ?? 0)).toBe(y.total);
  });

  it('INS-7: another year holds only its own (2025: Lisbon)', () => {
    const y = core().yearOf(household().entries, CHAPTERS, PEOPLE, 2025);
    expect(y.total).toBe(40000);
    expect(y.chapters).toEqual([{ id: LISBON, name: 'Lisbon', total: 40000 }]);
    expect(y.biggest?.description).toBe('Flights');
    expect(y.months).toHaveLength(12);
  });

  it('INS-7: a year with nothing: £0.00, no biggest, no chapters', () => {
    const y = core().yearOf(household().entries, CHAPTERS, PEOPLE, 2024);
    expect(y.total).toBe(0);
    expect(y.biggest).toBeNull();
    expect(y.chapters).toEqual([]);
    expect(y.categories).toEqual([]);
  });
});

// ─────────────────────────────── INS-8: on this day ───────────────────────────────

describe('onThisDay (INS-8)', () => {
  const dishoom = e({ description: 'Dishoom', amount: 8600, date: '2025-11-14', categoryId: EATING, place: 'London' });
  const pizza = e({ description: 'Pizza', amount: 3000, date: '2025-11-14', categoryId: EATING, chapterId: BATH });
  const plain = e({ description: 'Milk', amount: 120, date: '2025-11-14' });

  it('INS-8: a live entry dated exactly a year ago with a comment', () => {
    expect(core().onThisDay([plain, dishoom], { [dishoom.id]: 1 }, '2026-11-14')).toBe(dishoom);
  });

  it('INS-8: or with a chapter', () => {
    expect(core().onThisDay([plain, pizza], {}, '2026-11-14')).toBe(pizza);
  });

  it('INS-8: neither a comment nor a chapter → none', () => {
    expect(core().onThisDay([plain], {}, '2026-11-14')).toBeNull();
  });

  it('INS-8: several → the biggest', () => {
    expect(core().onThisDay([pizza, dishoom], { [dishoom.id]: 2 }, '2026-11-14')).toBe(dishoom);
  });

  it('INS-8: only exactly a year ago: not the day before or after, not two years ago, not deleted', () => {
    expect(core().onThisDay([dishoom], { [dishoom.id]: 1 }, '2026-11-13')).toBeNull();
    expect(core().onThisDay([dishoom], { [dishoom.id]: 1 }, '2026-11-15')).toBeNull();
    expect(core().onThisDay([dishoom], { [dishoom.id]: 1 }, '2027-11-14')).toBeNull();
    expect(core().onThisDay([{ ...dishoom, deleted: true }], { [dishoom.id]: 1 }, '2026-11-14')).toBeNull();
  });

  it('INS-8: 29 Feb has no "a year ago": nothing in a non-leap year, nothing on the leap day itself', () => {
    const leap = e({ description: 'Leap dinner', amount: 5000, date: '2024-02-29', chapterId: BATH });
    expect(core().onThisDay([leap], {}, '2025-02-28')).toBeNull();
    expect(core().onThisDay([leap], {}, '2025-03-01')).toBeNull();
    const feb28 = e({ description: 'Pancakes', amount: 800, date: '2027-02-28', chapterId: BATH });
    expect(core().onThisDay([feb28], {}, '2028-02-29')).toBeNull();
    expect(core().onThisDay([feb28], {}, '2028-02-28')).toBe(feb28);
  });
});
