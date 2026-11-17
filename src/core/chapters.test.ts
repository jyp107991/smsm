/**
 * S4a core (docs/slices/S4.md "Interfaces → Core", "Decisions made here"): what a chapter cost, over how many
 * days, per day for a trip, by category and by who paid (CHP-3), without a second ledger (CHP-4); and the
 * everyday entries only, for S5's usual-month figures (CHP-5). Written before the build (ENGINEERING §5, tests
 * first by someone else): vectors worked by hand plus properties against references written here.
 *
 * Interface these tests expect, in src/core/chapters.ts (pure; no I/O, no clock):
 *
 *   interface SummaryChapter { id: string; kind: 'trip' | 'project'; startDate: IsoDate | null;
 *                              endDate: IsoDate | null; closed: boolean }
 *   interface SummaryEntry { kind: 'expense' | 'money_back'; amount: Pence; paid: PenceMap; date: IsoDate;
 *                            categoryId: string | null; chapterId: string | null; deleted: boolean }
 *     (rows may carry more fields; for money back `paid` is who received it, as everywhere.)
 *   interface ChapterSummary { total: Pence; days: number; perDay: Pence | null;
 *                              byCategory: { categoryId: string | null; total: Pence }[];
 *                              byPerson: Record<UserId, Pence> }
 *
 *   chapterSummary(chapter, entries, people: readonly [UserId, UserId], today: IsoDate): ChapterSummary
 *     Only live (not deleted) entries whose chapterId is the chapter's id count; the caller may pass every entry.
 *     total      = Σ expense amounts − Σ money back amounts.
 *     days       = start..end inclusive when both are set. Otherwise from = startDate ?? the first entry's date,
 *                  to = endDate ?? (an open trip with a start: today; else the last entry's date); inclusive.
 *                  No dates and no entries: 0.
 *     perDay     = trips only (null for a project, and null when days is 0): total ÷ days, rounded once to the
 *                  penny, halves up.
 *     byCategory = per category (null = uncategorised) the same sum, largest first.
 *     byPerson   = for each of the two people (both always present): Σ their `paid` over the expenses − Σ their
 *                  `paid` over the money back (what they received).
 *     So total = Σ byCategory = Σ byPerson, always.
 *
 *   everydayOnly<T extends { chapterId: string | null }>(entries: readonly T[]): T[]
 *     CHP-5: the entries in no chapter, in the order given (the same objects).
 *
 * Until src/core/chapters.ts exists the module is loaded by a computed path (so this file type-checks and each
 * test fails on the missing module); once it exists this can become `import * as core from './chapters'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, daysBetween, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { PenceMap, UserId } from './split';

interface SummaryChapter { id: string; kind: 'trip' | 'project'; startDate: IsoDate | null; endDate: IsoDate | null; closed: boolean }
interface SummaryEntry {
  kind: 'expense' | 'money_back'; amount: Pence; paid: PenceMap; date: IsoDate; categoryId: string | null; chapterId: string | null; deleted: boolean;
}
interface ChapterSummary {
  total: Pence; days: number; perDay: Pence | null; byCategory: { categoryId: string | null; total: Pence }[]; byPerson: Record<UserId, Pence>;
}
interface ChaptersCore {
  chapterSummary(chapter: SummaryChapter, entries: readonly SummaryEntry[], people: readonly [UserId, UserId], today: IsoDate): ChapterSummary;
  everydayOnly<T extends { chapterId: string | null }>(entries: readonly T[]): T[];
}

const MODULE = './chapters';
const loaded = (await import(/* @vite-ignore */ MODULE).catch(() => null)) as ChaptersCore | null;
function core(): ChaptersCore {
  if (!loaded) throw new Error('src/core/chapters.ts does not exist yet (S4a)');
  return loaded;
}

// ───────── the household ─────────
const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const TODAY = '2026-11-14';
const GROCERIES = 'cat-groceries';
const EATING = 'cat-eating';
const TRAVEL = 'cat-travel';
const HOUSEHOLD = 'cat-household';

const JAPAN: SummaryChapter = { id: 'ch-japan', kind: 'trip', startDate: '2026-11-01', endDate: '2026-11-09', closed: false };
const SOFA: SummaryChapter = { id: 'ch-sofa', kind: 'project', startDate: null, endDate: null, closed: false };

function entry(over: Partial<Omit<SummaryEntry, 'amount' | 'paid'>> & { amount: number; paid?: Record<string, number> }): SummaryEntry {
  const { amount, paid, ...rest } = over;
  const paidMap: Record<string, Pence> = {};
  for (const [k, v] of Object.entries(paid ?? { [JAE]: amount })) paidMap[k] = pence(v);
  return { kind: 'expense', date: '2026-11-03', categoryId: GROCERIES, chapterId: JAPAN.id, deleted: false, ...rest, amount: pence(amount), paid: paidMap };
}

/** The summary with plain numbers, so expected values can be written as numbers. */
interface PlainSummary { total: number; days: number; perDay: number | null; byCategory: { categoryId: string | null; total: number }[]; byPerson: Record<string, number> }
const summary = (chapter: SummaryChapter, entries: readonly SummaryEntry[], today: IsoDate = TODAY): PlainSummary =>
  core().chapterSummary(chapter, entries, PEOPLE, today);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// ─────────────────────────────── vectors ───────────────────────────────

describe('chapterSummary: vectors (CHP-3, CHP-4)', () => {
  it('CHP-3: a trip with dates: "£1,840.00 over 9 days, £204.44 a day", by category largest first, who paid', () => {
    const s = summary(JAPAN, [
      entry({ amount: 12000, categoryId: GROCERIES, date: '2026-11-02' }),
      entry({ amount: 100000, categoryId: EATING, paid: { [SAM]: 100000 }, date: '2026-11-04' }),
      entry({ amount: 72000, categoryId: TRAVEL, date: '2026-11-01' }),
    ]);
    expect(s.total).toBe(184000);
    expect(s.days).toBe(9);
    expect(s.perDay).toBe(20444);
    expect(s.byCategory).toEqual([
      { categoryId: EATING, total: 100000 },
      { categoryId: TRAVEL, total: 72000 },
      { categoryId: GROCERIES, total: 12000 },
    ]);
    expect(s.byPerson).toEqual({ [JAE]: 84000, [SAM]: 100000 });
  });

  it('CHP-3: a project without dates: "£3,200.00 so far"; days run first to last entry; no per-day figure', () => {
    const s = summary(SOFA, [
      entry({ chapterId: SOFA.id, amount: 20000, categoryId: HOUSEHOLD, date: '2026-10-01' }),
      entry({ chapterId: SOFA.id, amount: 300000, categoryId: HOUSEHOLD, paid: { [JAE]: 150000, [SAM]: 150000 }, date: '2026-10-20' }),
    ]);
    expect(s.total).toBe(320000);
    expect(s.days).toBe(20);
    expect(s.perDay).toBeNull();
    expect(s.byCategory).toEqual([{ categoryId: HOUSEHOLD, total: 320000 }]);
    expect(s.byPerson).toEqual({ [JAE]: 170000, [SAM]: 150000 });
  });

  it('CHP-3 MB-1: money back comes off the total, its category, and the person who received it', () => {
    const s = summary(SOFA, [
      entry({ chapterId: SOFA.id, amount: 10000, categoryId: HOUSEHOLD, date: '2026-10-01' }),
      entry({ chapterId: SOFA.id, kind: 'money_back', amount: 4000, categoryId: HOUSEHOLD, paid: { [SAM]: 4000 }, date: '2026-10-05' }),
      entry({ chapterId: SOFA.id, amount: 3000, categoryId: GROCERIES, paid: { [SAM]: 3000 }, date: '2026-10-03' }),
    ]);
    expect(s.total).toBe(9000);
    expect(s.byCategory).toEqual([
      { categoryId: HOUSEHOLD, total: 6000 },
      { categoryId: GROCERIES, total: 3000 },
    ]);
    // Jae paid £100; Sam paid £30 and received the £40 back.
    expect(s.byPerson).toEqual({ [JAE]: 10000, [SAM]: -1000 });
  });

  it('CHP-3: deleted entries are ignored: not in the total, not in who paid, and they don’t stretch the days', () => {
    const live = [
      entry({ chapterId: SOFA.id, amount: 5000, date: '2026-10-10' }),
      entry({ chapterId: SOFA.id, amount: 2500, paid: { [SAM]: 2500 }, date: '2026-10-12' }),
    ];
    const s = summary(SOFA, [
      ...live,
      entry({ chapterId: SOFA.id, amount: 99900, categoryId: TRAVEL, deleted: true, date: '2026-09-01' }),
      entry({ chapterId: SOFA.id, kind: 'money_back', amount: 2500, deleted: true, date: '2026-10-30' }),
    ]);
    expect(s).toEqual(summary(SOFA, live));
    expect(s.total).toBe(7500);
    expect(s.days).toBe(3);
    expect(s.byCategory).toEqual([{ categoryId: GROCERIES, total: 7500 }]);
  });

  it('CHP-2: entries of other chapters and everyday entries are not this chapter’s', () => {
    const s = summary(JAPAN, [
      entry({ amount: 1000 }),
      entry({ amount: 50000, chapterId: SOFA.id }),
      entry({ amount: 7000, chapterId: null }),
    ]);
    expect(s.total).toBe(1000);
    expect(s.byPerson).toEqual({ [JAE]: 1000, [SAM]: 0 });
  });

  it('CHP-3: a trip with dates but nothing spent yet: £0.00 over its days; a project with nothing: 0 days', () => {
    const trip = summary(JAPAN, []);
    expect(trip).toEqual({ total: 0, days: 9, perDay: 0, byCategory: [], byPerson: { [JAE]: 0, [SAM]: 0 } });
    const project = summary(SOFA, []);
    expect(project.total).toBe(0);
    expect(project.days).toBe(0);
    expect(project.perDay).toBeNull();
    expect(project.byCategory).toEqual([]);
    expect(project.byPerson).toEqual({ [JAE]: 0, [SAM]: 0 });
  });

  it('CHP-3: uncategorised spending is its own line (category null)', () => {
    const s = summary(JAPAN, [entry({ amount: 1500, categoryId: null }), entry({ amount: 500 })]);
    expect(s.byCategory).toEqual([
      { categoryId: null, total: 1500 },
      { categoryId: GROCERIES, total: 500 },
    ]);
  });
});

describe('chapterSummary: days (CHP-3)', () => {
  const trip = (startDate: IsoDate | null, endDate: IsoDate | null, closed = false): SummaryChapter => ({ id: 'ch-t', kind: 'trip', startDate, endDate, closed });
  const project = (startDate: IsoDate | null, endDate: IsoDate | null, closed = false): SummaryChapter => ({ id: 'ch-p', kind: 'project', startDate, endDate, closed });
  const on = (chapterId: string, ...dates: IsoDate[]) => dates.map((date) => entry({ chapterId, amount: 1000, date }));

  it('CHP-3: start and end set: start to end inclusive, whatever the entries’ dates', () => {
    expect(summary(trip('2026-11-01', '2026-11-09'), on('ch-t', '2026-11-03')).days).toBe(9);
    expect(summary(trip('2026-11-01', '2026-11-01'), on('ch-t', '2026-11-01')).days).toBe(1);
    expect(summary(project('2026-01-01', '2026-12-31'), on('ch-p', '2026-03-01')).days).toBe(365);
  });

  it('CHP-3: an open trip with a start and no end runs to today', () => {
    expect(summary(trip('2026-11-10', null), on('ch-t', '2026-11-10', '2026-11-11')).days).toBe(5);
    expect(summary(trip('2026-11-10', null), []).days).toBe(5);
  });

  it('CHP-3: a closed trip with a start and no end runs to its last entry', () => {
    expect(summary(trip('2026-11-01', null, true), on('ch-t', '2026-11-02', '2026-11-06')).days).toBe(6);
  });

  it('CHP-3: a project with a start and no end runs from the start to its last entry', () => {
    expect(summary(project('2026-10-01', null), on('ch-p', '2026-10-05', '2026-10-20')).days).toBe(20);
  });

  it('CHP-3: an end and no start: from the first entry to the end', () => {
    expect(summary(trip(null, '2026-11-09', true), on('ch-t', '2026-11-05', '2026-11-07')).days).toBe(5);
  });

  it('CHP-3: no dates: first to last entry, inclusive (one day when everything is on one day)', () => {
    expect(summary(trip(null, null, true), on('ch-t', '2026-11-07', '2026-11-03', '2026-11-05')).days).toBe(5);
    expect(summary(project(null, null), on('ch-p', '2026-11-03', '2026-11-03')).days).toBe(1);
  });
});

describe('chapterSummary: per day (CHP-3)', () => {
  const twoDays: SummaryChapter = { id: 'ch-2', kind: 'trip', startDate: '2026-11-01', endDate: '2026-11-02', closed: true };
  const threeDays: SummaryChapter = { ...twoDays, id: 'ch-3', endDate: '2026-11-03' };
  const spent = (chapter: SummaryChapter, amount: number) => summary(chapter, [entry({ chapterId: chapter.id, amount, date: '2026-11-01' })]);

  it('CHP-3: total ÷ days, rounded once to the penny, halves up', () => {
    expect(spent(twoDays, 1001).perDay).toBe(501);   // 500.5 → 501
    expect(spent(twoDays, 1003).perDay).toBe(502);   // 501.5 → 502
    expect(spent(twoDays, 1000).perDay).toBe(500);
    expect(spent(threeDays, 1000).perDay).toBe(333); // 333.33 → 333
    expect(spent(threeDays, 2000).perDay).toBe(667); // 666.67 → 667
    expect(spent(threeDays, 1).perDay).toBe(0);      // 0.33 → 0
    expect(spent(twoDays, 1).perDay).toBe(1);        // 0.5 → 1
  });

  it('CHP-3: trips only: a project has no per-day figure, dates or not', () => {
    const p: SummaryChapter = { ...threeDays, id: 'ch-p3', kind: 'project' };
    expect(spent(p, 3000).days).toBe(3);
    expect(spent(p, 3000).perDay).toBeNull();
  });
});

// ─────────────────────────────── properties ───────────────────────────────

const ROUND_HALF_UP = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
const CATS = [GROCERIES, EATING, TRAVEL, HOUSEHOLD, null] as const;
const CHAPTER_IDS = ['ch-a', 'ch-b', null] as const;
const dateArb = fc.integer({ min: 0, max: 60 }).map((n) => addDays('2026-09-01', n));

const entryArb: fc.Arbitrary<SummaryEntry> = fc
  .record({
    kind: fc.constantFrom<'expense' | 'money_back'>('expense', 'expense', 'expense', 'money_back'),
    jae: fc.integer({ min: 0, max: 500_000 }),
    sam: fc.integer({ min: 0, max: 500_000 }),
    date: dateArb,
    categoryId: fc.constantFrom(...CATS),
    chapterId: fc.constantFrom(...CHAPTER_IDS),
    deleted: fc.boolean(),
  })
  .filter((r) => r.jae + r.sam > 0)
  .map((r) => {
    const paid: Record<string, Pence> = {};
    if (r.jae > 0) paid[JAE] = pence(r.jae);
    if (r.sam > 0) paid[SAM] = pence(r.sam);
    return { kind: r.kind, amount: pence(r.jae + r.sam), paid, date: r.date, categoryId: r.categoryId, chapterId: r.chapterId, deleted: r.deleted };
  });

const chapterArb: fc.Arbitrary<SummaryChapter> = fc
  .record({
    kind: fc.constantFrom<'trip' | 'project'>('trip', 'project'),
    start: fc.option(dateArb, { nil: null }),
    length: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
    closed: fc.boolean(),
  })
  .map((r) => ({
    id: 'ch-a', kind: r.kind, startDate: r.start, closed: r.closed,
    endDate: r.length === null ? null : addDays(r.start ?? '2026-09-01', r.length),
  }));

/** The reference: the brief's rules, written plainly. */
function reference(chapter: SummaryChapter, entries: readonly SummaryEntry[], today: IsoDate) {
  const mine = entries.filter((e) => !e.deleted && e.chapterId === chapter.id);
  const sign = (e: SummaryEntry) => (e.kind === 'money_back' ? -1 : 1);
  const total = sum(mine.map((e) => sign(e) * e.amount));
  const byPerson = { [JAE]: sum(mine.map((e) => sign(e) * (e.paid[JAE] ?? 0))), [SAM]: sum(mine.map((e) => sign(e) * (e.paid[SAM] ?? 0))) };
  const cats = new Map<string | null, number>();
  for (const e of mine) cats.set(e.categoryId, (cats.get(e.categoryId) ?? 0) + sign(e) * e.amount);
  const dates = mine.map((e) => e.date).sort();
  const from = chapter.startDate ?? dates[0] ?? null;
  const to = chapter.endDate ?? (chapter.kind === 'trip' && !chapter.closed && chapter.startDate !== null ? today : dates[dates.length - 1] ?? null);
  const days = from === null || to === null ? 0 : daysBetween(from, to) + 1;
  // Entries dated outside a chapter's own start or end are a case the brief doesn't settle: not checked here.
  const outside = from !== null && to !== null && from > to;
  return { total, byPerson, cats, days, outside };
}

describe('chapterSummary: properties (CHP-3, CHP-4)', () => {
  const entriesArb = fc.array(entryArb, { maxLength: 30 });

  it('CHP-3 CHP-4: total = expenses − money back over the live entries of the chapter = Σ by category = Σ by person', () => {
    fc.assert(
      fc.property(chapterArb, entriesArb, (chapter, entries) => {
        const s = core().chapterSummary(chapter, entries, PEOPLE, TODAY);
        const ref = reference(chapter, entries, TODAY);
        expect(s.total).toBe(ref.total);
        expect(sum(s.byCategory.map((c) => c.total))).toBe(s.total);
        expect(sum(Object.values(s.byPerson))).toBe(s.total);
        expect(Object.keys(s.byPerson).sort()).toEqual([JAE, SAM].sort());
        expect(s.byPerson).toEqual(ref.byPerson);
      }),
      { numRuns: 400 },
    );
  });

  it('CHP-3: by category: one line per category with spending, each the right sum, largest first', () => {
    fc.assert(
      fc.property(chapterArb, entriesArb, (chapter, entries) => {
        const s = core().chapterSummary(chapter, entries, PEOPLE, TODAY);
        const ref = reference(chapter, entries, TODAY);
        const ids = s.byCategory.map((c) => c.categoryId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of s.byCategory) expect(c.total).toBe(ref.cats.get(c.categoryId));
        for (const [id, t] of ref.cats) if (t !== 0) expect(ids).toContain(id);
        for (let i = 1; i < s.byCategory.length; i += 1) {
          expect((s.byCategory[i - 1]?.total ?? 0) >= (s.byCategory[i]?.total ?? 0)).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('CHP-3: days follow the rules; per day is trips only, total ÷ days rounded once, halves up', () => {
    fc.assert(
      fc.property(chapterArb, entriesArb, (chapter, entries) => {
        const s = core().chapterSummary(chapter, entries, PEOPLE, TODAY);
        const ref = reference(chapter, entries, TODAY);
        fc.pre(!ref.outside);
        expect(s.days).toBe(ref.days);
        if (chapter.kind === 'project' || s.days === 0) expect(s.perDay).toBeNull();
        else if (s.total >= 0) expect(s.perDay).toBe(ROUND_HALF_UP(s.total, s.days));
        if (s.perDay !== null) expect(Number.isSafeInteger(s.perDay)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('CHP-3: the order entries come in, deleted entries and other chapters’ entries change nothing', () => {
    fc.assert(
      fc.property(chapterArb, entriesArb, entriesArb, (chapter, entries, noise) => {
        const base = core().chapterSummary(chapter, entries, PEOPLE, TODAY);
        const others = noise.map((e) => (e.chapterId === chapter.id ? { ...e, deleted: true } : e));
        const mixed = [...others, ...entries].reverse();
        const again = core().chapterSummary(chapter, mixed, PEOPLE, TODAY);
        expect(again.total).toBe(base.total);
        expect(again.days).toBe(base.days);
        expect(again.perDay).toBe(base.perDay);
        expect(again.byPerson).toEqual(base.byPerson);
        expect(new Map(again.byCategory.map((c) => [c.categoryId, c.total]))).toEqual(new Map(base.byCategory.map((c) => [c.categoryId, c.total])));
      }),
      { numRuns: 300 },
    );
  });

  it('CHP-4: a chapter’s money is the same money as in the balance: who paid is paid, never shares', () => {
    // Moving an entry's shares (who owes what) changes the balance but not the chapter's figures.
    fc.assert(
      fc.property(chapterArb, entriesArb, (chapter, entries) => {
        const withShares = entries.map((e) => ({ ...e, shares: { [JAE]: e.amount, [SAM]: 0 } }));
        const flipped = entries.map((e) => ({ ...e, shares: { [JAE]: 0, [SAM]: e.amount } }));
        expect(core().chapterSummary(chapter, withShares, PEOPLE, TODAY)).toEqual(core().chapterSummary(chapter, flipped, PEOPLE, TODAY));
      }),
      { numRuns: 200 },
    );
  });
});

// ─────────────────────────────── CHP-5: everyday only ───────────────────────────────

describe('everydayOnly (CHP-5)', () => {
  it('CHP-5: keeps the entries in no chapter, in order, as the same objects', () => {
    const a = entry({ amount: 100, chapterId: null });
    const b = entry({ amount: 200, chapterId: JAPAN.id });
    const c = entry({ amount: 300, chapterId: null, kind: 'money_back' });
    const d = entry({ amount: 400, chapterId: SOFA.id });
    const out = core().everydayOnly([a, b, c, d]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(c);
    expect(core().everydayOnly([])).toEqual([]);
  });

  it('CHP-5: for any entries: everyday + chapter entries = all, and every one kept has no chapter', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 40 }), (entries) => {
        const everyday = core().everydayOnly(entries);
        expect(everyday.every((e) => e.chapterId === null)).toBe(true);
        expect(everyday).toEqual(entries.filter((e) => e.chapterId === null));
      }),
      { numRuns: 200 },
    );
  });
});
