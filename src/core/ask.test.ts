/**
 * S6b core (docs/slices/S6b.md "Decisions made here → Ask smsm", "Data", "Interfaces → Core"; docs/AI.md §3.5; SPEC
 * INS-9): turning the AI's closed-schema reading of a question into the app's own filter, and computing the answer
 * with the same filter code as Activity (src/core/filters.ts) and the same money rules as Insights (sharedSpend):
 * the AI never gives the figure. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/ask.ts (pure; no I/O, no clock; money in integer pence):
 *
 *   type Measure = 'total' | 'count' | 'average' | 'largest'
 *   type GroupBy = 'category' | 'month' | 'country' | 'payer' | 'chapter'
 *   type AskReply (src/core/aiReplies.ts askSchema, strict) =
 *     | { measure: Measure; filters: { categories?: string[]; chapters?: string[]; countries?: string[] /* ISO2 *\/;
 *         payer?: 'A' | 'B'; from?: 'YYYY-MM-DD'; to?: 'YYYY-MM-DD'; text?: string; tags?: string[]; mode?: SplitMode[] };
 *         group_by?: GroupBy }
 *     | { unsupported: true }
 *
 *   interface AskLookups {
 *     categories: readonly { id: string; name: string }[];
 *     chapters: readonly { id: string; name: string }[];
 *     countries: readonly { code: string; name: string }[];       // the countries present in the data, named
 *     people: readonly [{ id: UserId; name: string }, { id: UserId; name: string }];   // [A (the one asking), B]
 *     today: IsoDate;
 *   }
 *   interface AskFilter extends Filter { modes?: SplitMode[] }      // Filter from src/core/filters.ts
 *   interface Chip { key: 'category' | 'chapter' | 'country' | 'payer' | 'dates' | 'text' | 'tag' | 'mode'; value: string; label: string }
 *
 *   askFilter(reply: AskReply, lookups: AskLookups)
 *     → { filter: AskFilter; measure: Measure; groupBy: GroupBy | null; chips: Chip[] } | null
 *     null for { unsupported: true }. Category and chapter names → ids (matched ignoring case and surrounding
 *     spaces); names that aren't the household's are dropped; countries kept only if present in lookups.countries;
 *     payer 'A' → people[0].id, 'B' → people[1].id; from/to kept only when each is a real date; text trimmed (blank
 *     dropped); tags as given; mode → filter.modes. If EVERY value a list filter gave (categories, chapters or
 *     countries) is unknown, the question can't be answered as asked: null (dropping them all would answer a wider
 *     question than the one asked; the screen then says what it can answer). Filter keys that end up empty are left
 *     out. Chips, in this order, one per value: categories (label: the name), chapters (the name), countries (the
 *     country's name), payer ("Paid by ⟨name⟩"), dates (one chip, key 'dates', when from or to is set), text,
 *     tags, modes.
 *
 *   answer(entries: AskEntry[], filter: AskFilter, measure: Measure, groupBy: GroupBy | null, today: IsoDate,
 *          lookups: AskLookups) → { figure: number; sentence: string; groups?: { key: string | null; label: string; figure: number }[] }
 *     AskEntry = the Insights entry with the Activity filter's fields (kind may be 'settlement').
 *     The rows are applyFilter(entries, filter) (then filter.modes, when given, on splitMode), counted as Insights
 *     counts them: live (not deleted) expenses split ratio/exact/treat, minus live money back that isn't for the
 *     other; for_other entries and settle-ups never count.
 *       total    figure = sharedSpend of those rows (pence) — exactly insights.sharedSpend for the same entries
 *       count    figure = the number of counted expenses (money back is not an entry here)
 *       average  figure = total ÷ count, to the nearest penny (halves up); 0 with nothing counted
 *       largest  figure = the biggest counted expense's amount (pence); 0 with nothing counted
 *     sentence: the figure as the app shows it (formatPence for money, the number for a count), then
 *     " on ⟨category names, joined with " and "⟩" when categories are filtered, " in ⟨chapter or country names⟩"
 *     when they are, then ", all time" when neither from nor to is set (otherwise the dates, in words).
 *       e.g. total, Eating out, Japan, no dates → "£612.40 on Eating out in Japan, all time"
 *     groups (only with groupBy): the same measure per group, over the same rows; key = category id / 'YYYY-MM' /
 *     ISO2 / user id (whoPaid: what each paid, both people) / chapter id, null for none; label = the category's
 *     name / "October 2026" / the country's name / the person's name / the chapter's name ("Everyday" for none);
 *     largest figure first, except months: oldest first. Groups whose figure is 0 are left out.
 *
 * Until src/core/ask.ts exists it is loaded by a computed path (so this file type-checks and each test fails on the
 * missing module); once it exists this can become `import * as ask from './ask'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import { applyFilter, type Filter, type FilterEntry } from './filters';
import { sharedSpend, type InsightEntry, type Period } from './insights';
import { pence } from './money';
import type { SplitMode, UserId } from './split';

type Measure = 'total' | 'count' | 'average' | 'largest';
type GroupBy = 'category' | 'month' | 'country' | 'payer' | 'chapter';
type AskReply =
  | { measure: Measure; filters: { categories?: string[]; chapters?: string[]; countries?: string[]; payer?: 'A' | 'B'; from?: string; to?: string; text?: string; tags?: string[]; mode?: SplitMode[] }; group_by?: GroupBy }
  | { unsupported: true };
interface AskLookups {
  categories: readonly { id: string; name: string }[]; chapters: readonly { id: string; name: string }[];
  countries: readonly { code: string; name: string }[]; people: readonly [{ id: UserId; name: string }, { id: UserId; name: string }]; today: IsoDate;
}
interface AskFilter extends Filter { modes?: SplitMode[] }
interface Chip { key: 'category' | 'chapter' | 'country' | 'payer' | 'dates' | 'text' | 'tag' | 'mode'; value: string; label: string }
type AskEntry = Omit<InsightEntry, 'kind' | 'splitMode' | 'country'> & FilterEntry;
interface Answer { figure: number; sentence: string; groups?: { key: string | null; label: string; figure: number }[] }
interface AskCore {
  askFilter(reply: AskReply, lookups: AskLookups): { filter: AskFilter; measure: Measure; groupBy: GroupBy | null; chips: Chip[] } | null;
  answer(entries: readonly AskEntry[], filter: AskFilter, measure: Measure, groupBy: GroupBy | null, today: IsoDate, lookups: AskLookups): Answer;
}

const NAMES = ['askFilter', 'answer'] as const;
const ASK = './ask';
const loaded = (await import(/* @vite-ignore */ ASK).catch(() => null)) as Partial<AskCore> | null;
function core(): AskCore {
  const missing = NAMES.filter((n) => typeof loaded?.[n] !== 'function');
  if (!loaded || missing.length > 0) throw new Error(`src/core/ask.ts does not export ${missing.join(', ')} yet (S6b)`);
  return loaded as AskCore;
}

// ───────── the household (Jae asking: A = Jae, B = Sam) ─────────
const JAE = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000b1';
const TODAY = '2026-11-14';
const EATING = 'cat-eating';
const TRAVEL = 'cat-travel';
const GROCERIES = 'cat-groceries';
const JAPAN = 'ch-japan';
const SOFA = 'ch-sofa';
const LOOKUPS: AskLookups = {
  categories: [{ id: GROCERIES, name: 'Groceries' }, { id: EATING, name: 'Eating out' }, { id: TRAVEL, name: 'Travel' }, { id: 'cat-gifts', name: 'Gifts' }],
  chapters: [{ id: JAPAN, name: 'Japan trip' }, { id: SOFA, name: 'New sofa' }],
  countries: [{ code: 'GB', name: 'United Kingdom' }, { code: 'JP', name: 'Japan' }],
  people: [{ id: JAE, name: 'Jae' }, { id: SAM, name: 'Sam' }],
  today: TODAY,
};

let seq = 0;
/** An entry: Jae paying, split 50/50, everyday, in the UK, unless told otherwise. */
function e(description: string, amount: number, over: Partial<Omit<AskEntry, 'amount' | 'paid' | 'shares'>> & { by?: UserId } = {}): AskEntry {
  const { by = JAE, ...rest } = over;
  seq += 1;
  const half = Math.floor(amount / 2);
  return {
    id: `e${String(seq)}`, kind: 'expense', description, notes: null, tags: [], place: null, payer: by, categoryId: EATING, chapterId: null,
    country: 'GB', date: '2026-10-10', splitMode: 'ratio', recurringId: null, deleted: false, ...rest,
    amount: pence(amount), paid: { [by]: pence(amount) }, shares: { [JAE]: pence(amount - half), [SAM]: pence(half) },
  };
}

/**
 * Worked by hand:
 *   Eating out in Japan: Ramen £24.40 + Sushi £88.00 − refund £10.00 = £102.40 (2 entries); Rail pass £720.00 is Travel.
 *   Eating out anywhere: £102.40 + Dinner £210.00 + Dishoom £86.00 + Birthday dinner (a treat) £60.00 = £458.40,
 *     5 entries (the refund isn't one), average £91.68, largest £210.00. Not counted: Sam’s lunch (paid for Sam),
 *     Pizza (deleted), the settle-up.
 *   Everything: £1,418.40 = Japan £822.40 + UK £596.00; Travel £720.00, Eating out £458.40, Groceries £240.00.
 *   Who paid: Jae £88.00 + £720.00 + £86.00 + £240.00 − £10.00 = £1,124.00; Sam £24.40 + £210.00 + £60.00 = £294.40.
 *   Counted by month: Sep 1, Oct 2 (Dishoom, Weekly shop), Nov 4.
 */
const ENTRIES: AskEntry[] = [
  e('Ramen', 2440, { by: SAM, chapterId: JAPAN, country: 'JP', date: '2026-11-04' }),
  e('Sushi', 8800, { chapterId: JAPAN, country: 'JP', date: '2026-11-06', tags: ['dinner'] }),
  e('Izakaya refund', 1000, { kind: 'money_back', chapterId: JAPAN, country: 'JP', date: '2026-11-07' }),
  e('Rail pass', 72000, { categoryId: TRAVEL, chapterId: JAPAN, country: 'JP', date: '2026-11-02' }),
  e('Dinner', 21000, { by: SAM, date: '2026-11-08', tags: ['dinner'] }),
  e('Dishoom', 8600, { date: '2026-10-12' }),
  e('Sam’s lunch', 1500, { splitMode: 'for_other', date: '2026-10-20' }),
  e('Weekly shop', 24000, { categoryId: GROCERIES, date: '2026-10-03' }),
  e('Settle up', 5000, { kind: 'settlement', by: SAM, categoryId: null, splitMode: null, date: '2026-10-28' }),
  e('Pizza', 3000, { deleted: true, date: '2026-10-15' }),
  e('Birthday dinner', 6000, { by: SAM, splitMode: 'treat', date: '2026-09-20' }),
];
const ALL_TIME: Period = { kind: '12months', from: null, to: null, chapterId: null };
/** Insights' own figure for the rows a filter picks (Insights never sees settle-ups). */
const insightsTotal = (f: Filter) =>
  sharedSpend(applyFilter(ENTRIES, f).filter((r) => r.kind !== 'settlement') as unknown as InsightEntry[], ALL_TIME);

const query = (filters: Extract<AskReply, { measure: Measure }>['filters'], measure: Measure = 'total', group_by?: GroupBy) =>
  core().askFilter(group_by ? { measure, filters, group_by } : { measure, filters }, LOOKUPS);
function run(filters: Extract<AskReply, { measure: Measure }>['filters'], measure: Measure = 'total', group_by?: GroupBy): Answer {
  const q = query(filters, measure, group_by);
  if (!q) throw new Error('askFilter gave null');
  return core().answer(ENTRIES, q.filter, q.measure, q.groupBy, TODAY, LOOKUPS);
}

// ─────────────────────────────── askFilter ───────────────────────────────

describe('askFilter: the AI’s reading becomes the app’s own filter (INS-9; AI.md §3.5)', () => {
  it('INS-9: names become ids; the chips say what was understood', () => {
    expect(query({ categories: ['Eating out'], countries: ['JP'] })).toEqual({
      filter: { categories: [EATING], countries: ['JP'] }, measure: 'total', groupBy: null,
      chips: [{ key: 'category', value: EATING, label: 'Eating out' }, { key: 'country', value: 'JP', label: 'Japan' }],
    });
  });

  it('INS-9: { unsupported: true } is no filter', () => {
    expect(core().askFilter({ unsupported: true }, LOOKUPS)).toBeNull();
  });

  it('INS-9: names match ignoring case and spaces round them', () => {
    expect(query({ categories: ['  eating OUT '] })?.filter.categories).toEqual([EATING]);
    expect(query({ chapters: ['japan TRIP'] })?.filter.chapters).toEqual([JAPAN]);
  });

  it('INS-9: a name that isn’t the household’s is dropped; the rest stand', () => {
    const q = query({ categories: ['Eating out', 'Gambling'], chapters: ['New sofa', 'Wedding'] });
    expect(q?.filter.categories).toEqual([EATING]);
    expect(q?.filter.chapters).toEqual([SOFA]);
    expect(q?.chips.map((c) => c.label)).toEqual(['Eating out', 'New sofa']);
  });

  it('INS-9: when every name of a filter is unknown the question can’t be answered as asked: null, never a wider answer', () => {
    expect(query({ categories: ['Gambling'] })).toBeNull();
    expect(query({ chapters: ['Wedding'] })).toBeNull();
    expect(query({ countries: ['PE'] })).toBeNull();
    expect(query({ categories: ['Gambling'], countries: ['JP'] })).toBeNull();
  });

  it('INS-9: countries are kept only when present in the data', () => {
    expect(query({ countries: ['JP', 'FR'] })?.filter.countries).toEqual(['JP']);
  });

  it('INS-9: who paid: A is the one asking, B the partner; the chip names them', () => {
    const a = query({ payer: 'A' });
    const b = query({ payer: 'B' });
    expect(a?.filter.payer).toBe(JAE);
    expect(b?.filter.payer).toBe(SAM);
    expect(b?.chips).toEqual([{ key: 'payer', value: SAM, label: 'Paid by Sam' }]);
  });

  it('INS-9: dates are kept when real; one chip for them', () => {
    const q = query({ from: '2026-10-01', to: '2026-10-31' });
    expect(q?.filter).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(q?.chips.filter((c) => c.key === 'dates')).toHaveLength(1);
    expect(query({ from: '2026-02-30', to: '2026-10-31' })?.filter).toEqual({ to: '2026-10-31' });
    expect(query({})?.chips).toEqual([]);
  });

  it('INS-9: text, tags and split modes pass through; blank text is dropped', () => {
    expect(query({ text: ' dishoom ', tags: ['dinner'], mode: ['treat'] })?.filter).toEqual({ text: 'dishoom', tags: ['dinner'], modes: ['treat'] });
    expect(query({ text: '   ' })?.filter).toEqual({});
  });

  it('INS-9: the measure and the grouping come through; no grouping is null', () => {
    expect(query({}, 'count', 'month')).toMatchObject({ measure: 'count', groupBy: 'month' });
    expect(query({}, 'largest')).toMatchObject({ measure: 'largest', groupBy: null });
  });

  it('INS-9: the chips run in a fixed order: categories, chapters, countries, payer, dates, text, tags, modes', () => {
    const q = query({ mode: ['ratio'], tags: ['dinner'], text: 'sushi', from: '2026-11-01', payer: 'A', countries: ['JP'], chapters: ['Japan trip'], categories: ['Eating out'] });
    expect(q?.chips.map((c) => c.key)).toEqual(['category', 'chapter', 'country', 'payer', 'dates', 'text', 'tag', 'mode']);
  });
});

// ─────────────────────────────── answer ───────────────────────────────

describe('answer: code computes the figure (INS-9; AI.md §1.2, §3.5)', () => {
  it('INS-9: total: "£102.40 on Eating out in Japan, all time" (money back subtracts)', () => {
    expect(run({ categories: ['Eating out'], countries: ['JP'] })).toMatchObject({ figure: 10240, sentence: '£102.40 on Eating out in Japan, all time' });
  });

  it('INS-9: one category, all time', () => {
    expect(run({ categories: ['Eating out'] })).toMatchObject({ figure: 45840, sentence: '£458.40 on Eating out, all time' });
  });

  it('INS-9: a chapter is named like a place', () => {
    expect(run({ chapters: ['Japan trip'] })).toMatchObject({ figure: 82240, sentence: '£822.40 in Japan trip, all time' });
  });

  it('INS-9: paid for the other, deleted entries and settle-ups never count', () => {
    const r = run({});
    expect(r.figure).toBe(141840);
    expect(r.sentence.startsWith('£1,418.40')).toBe(true);
    expect(r.sentence.endsWith('all time')).toBe(true);
  });

  it('INS-9: count is the number of shared expenses (a refund is not one)', () => {
    const r = run({ categories: ['Eating out'] }, 'count');
    expect(r.figure).toBe(5);
    expect(r.sentence).toMatch(/^5 /);
    expect(r.sentence).toContain('Eating out');
    expect(run({ categories: ['Eating out'], countries: ['JP'] }, 'count').figure).toBe(2);
  });

  it('INS-9: average is the total over the count, to the nearest penny', () => {
    expect(run({ categories: ['Eating out'] }, 'average')).toMatchObject({ figure: 9168 });
    expect(run({ categories: ['Eating out'] }, 'average').sentence).toContain('£91.68');
    // Sam’s: £24.40 + £210.00 + £60.00 = £294.40 over 3 = £98.1333… → £98.13.
    expect(run({ categories: ['Eating out'], payer: 'B' }, 'average').figure).toBe(9813);
  });

  it('INS-9: largest is the biggest shared expense', () => {
    expect(run({ categories: ['Eating out'] }, 'largest').figure).toBe(21000);
    expect(run({ categories: ['Eating out'] }, 'largest').sentence).toContain('£210.00');
    expect(run({ countries: ['JP'], categories: ['Eating out'] }, 'largest').figure).toBe(8800);
  });

  it('INS-9: nothing matching is £0.00, 0 entries, no average, no largest', () => {
    const q = query({ categories: ['Gifts'] });
    if (!q) throw new Error('askFilter gave null');
    for (const m of ['total', 'count', 'average', 'largest'] as const) expect(core().answer(ENTRIES, q.filter, m, null, TODAY, LOOKUPS).figure).toBe(0);
    expect(core().answer(ENTRIES, q.filter, 'total', null, TODAY, LOOKUPS).sentence).toBe('£0.00 on Gifts, all time');
  });

  it('INS-9: dates narrow it, and the sentence no longer says "all time"', () => {
    const r = run({ categories: ['Eating out'], from: '2026-10-01', to: '2026-10-31' });
    expect(r.figure).toBe(8600);
    expect(r.sentence.startsWith('£86.00 on Eating out')).toBe(true);
    expect(r.sentence).not.toContain('all time');
  });

  it('INS-9: text, tags and a split mode narrow it with Activity’s rules', () => {
    expect(run({ text: 'SUSHI' }).figure).toBe(8800);
    expect(run({ tags: ['dinner'] }).figure).toBe(29800);
    expect(run({ mode: ['treat'] }).figure).toBe(6000);
    expect(run({ mode: ['for_other'] }).figure).toBe(0);
  });

  it('INS-9: the total equals Insights’ sharedSpend for the same entries, whatever the filter (property)', () => {
    const arb = fc.record({
      categories: fc.option(fc.subarray(['Groceries', 'Eating out', 'Travel'], { minLength: 1 }), { nil: undefined }),
      countries: fc.option(fc.subarray(['GB', 'JP'], { minLength: 1 }), { nil: undefined }),
      payer: fc.option(fc.constantFrom('A' as const, 'B' as const), { nil: undefined }),
      from: fc.option(fc.constantFrom('2026-09-01', '2026-10-05', '2026-11-03'), { nil: undefined }),
      to: fc.option(fc.constantFrom('2026-10-12', '2026-11-06', '2026-12-31'), { nil: undefined }),
    });
    fc.assert(fc.property(arb, (raw) => {
      const filters = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
      const q = core().askFilter({ measure: 'total', filters }, LOOKUPS);
      expect(q).not.toBeNull();
      if (!q) return;
      expect(core().answer(ENTRIES, q.filter, 'total', null, TODAY, LOOKUPS).figure).toBe(insightsTotal(q.filter));
    }), { numRuns: 200 });
  });
});

describe('answer: grouped (INS-9; AI.md §3.5 group_by)', () => {
  it('INS-9: by category, largest first, adding up to the figure', () => {
    const r = run({}, 'total', 'category');
    expect(r.groups).toEqual([
      { key: TRAVEL, label: 'Travel', figure: 72000 }, { key: EATING, label: 'Eating out', figure: 45840 }, { key: GROCERIES, label: 'Groceries', figure: 24000 },
    ]);
    expect((r.groups ?? []).reduce((t, g) => t + g.figure, 0)).toBe(r.figure);
  });

  it('INS-9: by country, named', () => {
    expect(run({}, 'total', 'country').groups).toEqual([{ key: 'JP', label: 'Japan', figure: 82240 }, { key: 'GB', label: 'United Kingdom', figure: 59600 }]);
  });

  it('INS-9: by who paid: what each paid (as Insights’ whoPaid)', () => {
    expect(run({}, 'total', 'payer').groups).toEqual([{ key: JAE, label: 'Jae', figure: 112400 }, { key: SAM, label: 'Sam', figure: 29440 }]);
  });

  it('INS-9: by chapter; entries in none are "Everyday"', () => {
    expect(run({}, 'total', 'chapter').groups).toEqual([{ key: JAPAN, label: 'Japan trip', figure: 82240 }, { key: null, label: 'Everyday', figure: 59600 }]);
  });

  it('INS-9: by month, oldest first, with the measure asked (a count here)', () => {
    expect(run({}, 'count', 'month').groups).toEqual([
      { key: '2026-09', label: 'September 2026', figure: 1 }, { key: '2026-10', label: 'October 2026', figure: 2 }, { key: '2026-11', label: 'November 2026', figure: 4 },
    ]);
  });

  it('INS-9: no grouping asked, no groups', () => {
    expect(run({ categories: ['Eating out'] }).groups).toBeUndefined();
  });
});
