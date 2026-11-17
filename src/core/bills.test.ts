/**
 * S3 core (docs/slices/S3.md "Interfaces → Core"): what regular payments cost (REC-7, REC-8), what is coming up
 * for the Bills calendar and list (REC-7, reusing core/recurring's occurrences), and the "looks monthly"
 * suggestion (REC-5). Written before the build (ENGINEERING §5, tests first by someone else): golden vectors in
 * tests/vectors/bills.json plus properties against independent references written here.
 *
 * Interface these tests expect, all in src/core/recurring.ts (pure; no I/O, no clock):
 *
 *   type Frequency = Schedule['frequency']
 *
 *   monthlyCost(s: { frequency; every }, amount: Pence): Pence
 *     REC-8: weekly amount×52÷12÷every; monthly amount÷every; yearly amount÷12÷every.
 *   yearlyCost(s: { frequency; every }, amount: Pence): Pence
 *     REC-7: weekly amount×52÷every; monthly amount×12÷every; yearly amount÷every.
 *     Both are worked out exactly and rounded once to the nearest penny, halves up (DECISIONS, S3). "What home
 *     costs" is the sum of the rounded monthly costs of the active templates, so the figures shown add up.
 *
 *   occurrencesBetween(s: Schedule, from: IsoDate, to: IsoDate, fromIndex = 0): IsoDate[]
 *     every occurrence(s, k) with k ≥ fromIndex and from ≤ date ≤ to, never after s.endDate, in order.
 *
 *   interface UpcomingTemplate { id; description; amount: Pence; amountVaries: boolean; active: boolean;
 *                                postedCount: number; schedule: Schedule }
 *   interface UpcomingBill { id; description; date: IsoDate; amount: Pence; amountVaries: boolean }
 *   upcoming(templates: readonly UpcomingTemplate[], window: { from?: IsoDate; to: IsoDate }): UpcomingBill[]
 *     the occurrences not posted yet (k ≥ postedCount) of the active templates, on or before `to` (and on or
 *     after `from` when given; without it an overdue one that couldn't post yet, offline, is included), sorted
 *     by date, then description.
 *
 *   interface SuggestEntry { description: string; amount: Pence; date: IsoDate }
 *   interface RecurringSuggestion { key: string; description: string; frequency: Frequency; every: number;
 *                                   amount: Pence; lastDate: IsoDate; nextDate: IsoDate }
 *   suggestRecurring(history: readonly SuggestEntry[], today: IsoDate, exclude?: ReadonlySet<string>): RecurringSuggestion[]
 *     REC-5. The caller passes live expenses only (no money back, nothing deleted, nothing posted by a template).
 *     Entries are grouped by normaliseKey(description); keys in `exclude` (normalised) are skipped. A group is
 *     suggested when its LAST THREE entries by date:
 *       - fall on three different days;
 *       - have both gaps in the same one of these windows (days), which is what "a steady interval" means:
 *         6–8 → weekly every 1; 13–15 → weekly every 2; 26–35 → monthly every 1; 86–96 → monthly every 3;
 *         358–372 → yearly every 1 (a direct debit moved off a weekend, or February, still reads as monthly);
 *       - have similar amounts: the largest at most 10 % above the smallest (10·max ≤ 11·min);
 *       - and the last is recent: today − last ≤ the window's upper bound.
 *     It offers the latest entry's description (as typed) and amount, lastDate = the latest date, nextDate = one
 *     step after it (addDays 7·every, addMonths every, addYears 1). Most recent lastDate first, then by key.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, addMonths, addYears, daysBetween, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import * as recurring from './recurring';
import { normaliseKey } from './text';
import vectorsJson from '../../tests/vectors/bills.json';

type Schedule = recurring.Schedule;
type Frequency = Schedule['frequency'];
interface UpcomingTemplate { id: string; description: string; amount: Pence; amountVaries: boolean; active: boolean; postedCount: number; schedule: Schedule }
interface UpcomingBill { id: string; description: string; date: IsoDate; amount: Pence; amountVaries: boolean }
interface SuggestEntry { description: string; amount: Pence; date: IsoDate }
interface RecurringSuggestion { key: string; description: string; frequency: Frequency; every: number; amount: Pence; lastDate: IsoDate; nextDate: IsoDate }
interface S3Core {
  monthlyCost(s: Pick<Schedule, 'frequency' | 'every'>, amount: Pence): Pence;
  yearlyCost(s: Pick<Schedule, 'frequency' | 'every'>, amount: Pence): Pence;
  occurrencesBetween(s: Schedule, from: IsoDate, to: IsoDate, fromIndex?: number): IsoDate[];
  upcoming(templates: readonly UpcomingTemplate[], window: { from?: IsoDate; to: IsoDate }): UpcomingBill[];
  suggestRecurring(history: readonly SuggestEntry[], today: IsoDate, exclude?: ReadonlySet<string>): RecurringSuggestion[];
}
// The new functions live beside occurrence() and dueOccurrences(); typed here so the file compiles before they exist.
const core = recurring as unknown as typeof recurring & S3Core;

interface CostVector { name: string; frequency: Frequency; every: number; amount: number; expected: number }
interface Vectors {
  monthlyCost: CostVector[];
  yearlyCost: CostVector[];
  upcoming: {
    templates: (Omit<UpcomingTemplate, 'amount'> & { amount: number })[];
    cases: { name: string; from?: string; to: string; expected: { id: string; date: string }[] }[];
  };
  suggest: { name: string; today: string; exclude?: string[]; history: [string, number, string][]; expected: RecurringSuggestion[] }[];
}
const V = vectorsJson as unknown as Vectors;

// ───────── independent references ─────────
/** n ÷ d to the nearest whole number, halves up (n ≥ 0, d > 0). */
const roundHalfUp = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
const PER_YEAR: Record<Frequency, number> = { weekly: 52, monthly: 12, yearly: 1 };
const refMonthly = (f: Frequency, every: number, amount: number) => roundHalfUp(amount * PER_YEAR[f], 12 * every);
const refYearly = (f: Frequency, every: number, amount: number) => roundHalfUp(amount * PER_YEAR[f], every);

const freqArb = fc.constantFrom<Frequency>('weekly', 'monthly', 'yearly');
const everyArb = fc.oneof(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 52 }));
const amountArb = fc.oneof(fc.integer({ min: 1, max: 5_000 }), fc.integer({ min: 1, max: 100_000_000 }));

describe('monthlyCost and yearlyCost (REC-7, REC-8)', () => {
  it.each(V.monthlyCost.map((v) => [v.name, v] as const))('REC-8 monthly: %s', (_n, v) => {
    expect(core.monthlyCost({ frequency: v.frequency, every: v.every }, pence(v.amount))).toBe(v.expected);
  });

  it.each(V.yearlyCost.map((v) => [v.name, v] as const))('REC-7 yearly: %s', (_n, v) => {
    expect(core.yearlyCost({ frequency: v.frequency, every: v.every }, pence(v.amount))).toBe(v.expected);
  });

  it('REC-8 equals the exact cost rounded once, halves up, for any schedule and amount', () => {
    fc.assert(
      fc.property(freqArb, everyArb, amountArb, (frequency, every, amount) => {
        const m = core.monthlyCost({ frequency, every }, pence(amount));
        expect(Number.isSafeInteger(m)).toBe(true);
        expect(m).toBe(refMonthly(frequency, every, amount));
      }),
      { numRuns: 500 },
    );
  });

  it('REC-7 the yearly cost equals the exact cost rounded once, halves up', () => {
    fc.assert(
      fc.property(freqArb, everyArb, amountArb, (frequency, every, amount) => {
        expect(core.yearlyCost({ frequency, every }, pence(amount))).toBe(refYearly(frequency, every, amount));
      }),
      { numRuns: 500 },
    );
  });

  it('REC-8 a monthly bill costs itself a month and twelve times itself a year', () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        expect(core.monthlyCost({ frequency: 'monthly', every: 1 }, pence(amount))).toBe(amount);
        expect(core.yearlyCost({ frequency: 'monthly', every: 1 }, pence(amount))).toBe(12 * amount);
        expect(core.yearlyCost({ frequency: 'yearly', every: 1 }, pence(amount))).toBe(amount);
      }),
    );
  });

  it('REC-8 never decreases when the amount goes up, and is never more than half a penny off a month', () => {
    fc.assert(
      fc.property(freqArb, everyArb, amountArb, fc.integer({ min: 0, max: 10_000 }), (frequency, every, amount, more) => {
        const a = core.monthlyCost({ frequency, every }, pence(amount));
        expect(core.monthlyCost({ frequency, every }, pence(amount + more))).toBeGreaterThanOrEqual(a);
        // |a − exact| ≤ ½p, i.e. |24·every·a − 2·amount·perYear| ≤ 12·every
        expect(Math.abs(24 * every * a - 2 * amount * PER_YEAR[frequency])).toBeLessThanOrEqual(12 * every);
      }),
    );
  });

  it('REC-8 refuses what is not a schedule (every < 1 or not whole), as occurrence() does', () => {
    expect(() => core.monthlyCost({ frequency: 'monthly', every: 0 }, pence(1000))).toThrow(RangeError);
    expect(() => core.yearlyCost({ frequency: 'weekly', every: 1.5 }, pence(1000))).toThrow(RangeError);
  });
});

// ───────── upcoming occurrences (REC-7: the calendar and "Next 30 days") ─────────
const DAY_MS = 86_400_000;
const dayNumber = (d: IsoDate): number => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
};
const fromDayNumber = (n: number): IsoDate => new Date(n * DAY_MS).toISOString().slice(0, 10);
const dateArb = fc.integer({ min: dayNumber('2000-01-01'), max: dayNumber('2060-12-31') }).map(fromDayNumber);
const scheduleArb: fc.Arbitrary<Schedule> = fc.record({
  frequency: freqArb,
  every: fc.integer({ min: 1, max: 6 }),
  startDate: fc.oneof(dateArb, fc.constantFrom('2026-01-31', '2028-02-29', '2026-08-31', '2026-03-29', '2026-10-25')),
  endDate: fc.constant(null),
});

describe('occurrencesBetween and upcoming (REC-7)', () => {
  const templates = (): UpcomingTemplate[] => V.upcoming.templates.map((t) => ({ ...t, amount: pence(t.amount) }));

  it.each(V.upcoming.cases.map((c) => [c.name, c] as const))('REC-7 %s', (_n, c) => {
    const got = core.upcoming(templates(), c.from === undefined ? { to: c.to } : { from: c.from, to: c.to });
    expect(got.map((u) => ({ id: u.id, date: u.date }))).toEqual(c.expected);
  });

  it('REC-7 REC-3 each upcoming bill carries its description, amount and whether it varies', () => {
    const got = core.upcoming(templates(), { to: '2026-12-14' });
    expect(got.find((u) => u.id === 'energy')).toEqual({ id: 'energy', description: 'Energy', date: '2026-12-03', amount: 9000, amountVaries: true });
    expect(got.find((u) => u.id === 'rent')).toEqual({ id: 'rent', description: 'Rent', date: '2026-12-01', amount: 145000, amountVaries: false });
  });

  it('REC-2 REC-7 occurrencesBetween is exactly the occurrences k ≥ fromIndex inside the window and before the end', () => {
    fc.assert(
      fc.property(
        scheduleArb,
        fc.integer({ min: -30, max: 900 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 12 }),
        fc.option(fc.integer({ min: 0, max: 1200 }), { nil: null }),
        (s0, fromOffset, length, fromIndex, endOffset) => {
          const s: Schedule = { ...s0, endDate: endOffset === null ? null : addDays(s0.startDate, endOffset) };
          const from = addDays(s.startDate, fromOffset);
          const to = addDays(from, length);
          const expected: IsoDate[] = [];
          for (let k = fromIndex; ; k += 1) {
            const d = recurring.occurrence(s, k);
            if (d > to || (s.endDate !== null && d > s.endDate)) break;
            if (d >= from) expected.push(d);
          }
          expect(core.occurrencesBetween(s, from, to, fromIndex)).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('REC-7 upcoming never shows a posted occurrence, a paused template or anything past its end, and is in date order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            schedule: scheduleArb,
            postedCount: fc.integer({ min: 0, max: 30 }),
            active: fc.boolean(),
            amountVaries: fc.boolean(),
            amount: fc.integer({ min: 1, max: 500_000 }),
            description: fc.constantFrom('Rent', 'Netflix', 'Energy', 'Gym', 'Water'),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 120 }),
        (raw, length) => {
          const ts: UpcomingTemplate[] = raw.map((r, i) => ({ ...r, id: `t${String(i)}`, amount: pence(r.amount) }));
          const to = addDays('2030-01-01', length);
          const got = core.upcoming(ts, { from: '2030-01-01', to });
          for (let i = 1; i < got.length; i += 1) {
            const [a, b] = [got[i - 1], got[i]];
            if (a && b) expect(a.date < b.date || (a.date === b.date && a.description <= b.description)).toBe(true);
          }
          for (const t of ts) {
            const mine = got.filter((u) => u.id === t.id).map((u) => u.date);
            const want = t.active ? core.occurrencesBetween(t.schedule, '2030-01-01', to, t.postedCount) : [];
            expect(mine).toEqual(want);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ───────── suggest recurring (REC-5) ─────────
const entries = (h: [string, number, string][]): SuggestEntry[] => h.map(([description, amount, date]) => ({ description, amount: pence(amount), date }));

interface Pattern { frequency: Frequency; every: number; step: (d: IsoDate) => IsoDate; jitter: number }
const PATTERNS: Pattern[] = [
  { frequency: 'weekly', every: 1, step: (d) => addDays(d, 7), jitter: 1 },
  { frequency: 'weekly', every: 2, step: (d) => addDays(d, 14), jitter: 1 },
  { frequency: 'monthly', every: 1, step: (d) => addMonths(d, 1), jitter: 2 },
  { frequency: 'monthly', every: 3, step: (d) => addMonths(d, 3), jitter: 2 },
  { frequency: 'yearly', every: 1, step: (d) => addYears(d, 1), jitter: 2 },
];

/** A clean series: n entries exactly one step apart, the same amount, ending on `last`. */
const seriesArb = fc
  .record({
    pattern: fc.constantFrom(...PATTERNS),
    first: fc.integer({ min: dayNumber('2020-01-01'), max: dayNumber('2040-12-31') }).map(fromDayNumber),
    n: fc.integer({ min: 3, max: 6 }),
    amount: fc.integer({ min: 100, max: 500_000 }),
    description: fc.constantFrom('Netflix', 'Rent', 'Window cleaner', 'Spotify Duo', '넷플릭스', 'Council tax'),
    wait: fc.integer({ min: 0, max: 5 }),
  })
  .map((r) => {
    const dates: IsoDate[] = [r.first];
    for (let i = 1; i < r.n; i += 1) dates.push(r.pattern.step(dates[i - 1] ?? r.first));
    const last = dates[dates.length - 1] ?? r.first;
    const history: SuggestEntry[] = dates.map((date) => ({ description: r.description, amount: pence(r.amount), date }));
    return { ...r, dates, last, today: addDays(last, r.wait), history };
  });

describe('suggestRecurring (REC-5)', () => {
  it.each(V.suggest.map((v) => [v.name, v] as const))('REC-5 %s', (_n, v) => {
    const exclude = v.exclude ? new Set(v.exclude) : undefined;
    expect(core.suggestRecurring(entries(v.history), v.today, exclude)).toEqual(v.expected);
  });

  it('REC-5 a steady series of three or more is suggested with its own schedule, amount and next date', () => {
    fc.assert(
      fc.property(seriesArb, (s) => {
        const got = core.suggestRecurring(s.history, s.today);
        expect(got).toEqual([
          {
            key: normaliseKey(s.description), description: s.description, frequency: s.pattern.frequency, every: s.pattern.every,
            amount: s.amount, lastDate: s.last, nextDate: s.pattern.step(s.last),
          },
        ]);
      }),
      { numRuns: 300 },
    );
  });

  it('REC-5 the order the history comes in makes no difference', () => {
    fc.assert(
      fc.property(seriesArb, seriesArb, fc.integer(), (a, b, seed) => {
        const all = [...a.history, ...b.history.map((e) => ({ ...e, description: `${e.description} B` }))];
        const shuffled = fc.sample(fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }), { numRuns: 1, seed })[0] ?? all;
        const today = a.today > b.today ? a.today : b.today;
        expect(core.suggestRecurring(shuffled, today)).toEqual(core.suggestRecurring(all, today));
      }),
      { numRuns: 100 },
    );
  });

  it('REC-5 fewer than three is never enough', () => {
    fc.assert(
      fc.property(seriesArb, (s) => {
        expect(core.suggestRecurring(s.history.slice(-2), s.today)).toEqual([]);
      }),
    );
  });

  it('REC-5 an excluded description (already regular, or "No" was tapped) is never suggested, whatever its case', () => {
    fc.assert(
      fc.property(seriesArb, (s) => {
        expect(core.suggestRecurring(s.history, s.today, new Set([normaliseKey(s.description)]))).toEqual([]);
      }),
    );
  });

  it('REC-5 amounts more than 10 % apart are not "similar"', () => {
    fc.assert(
      fc.property(seriesArb, fc.integer({ min: 0, max: 2 }), (s, which) => {
        const lastThree = s.history.length - 3 + which;
        const bumped = s.history.map((e, i) => (i === lastThree ? { ...e, amount: pence(Math.ceil((e.amount * 11) / 10) + 1) } : e));
        expect(core.suggestRecurring(bumped, s.today)).toEqual([]);
      }),
    );
  });

  it('REC-5 a series that stopped is not suggested', () => {
    fc.assert(
      fc.property(seriesArb, (s) => {
        expect(core.suggestRecurring(s.history, addDays(s.last, 400))).toEqual([]);
      }),
    );
  });

  it('REC-5 small slips of a day or two still read as steady', () => {
    fc.assert(
      fc.property(seriesArb, fc.integer({ min: -1, max: 1 }), (s, slip) => {
        // The middle one of the last three is a day or two early or late.
        const middle = s.history.length - 2;
        const slipped = s.history.map((e, i) => (i === middle ? { ...e, date: addDays(e.date, slip * s.pattern.jitter) } : e));
        const got = core.suggestRecurring(slipped, s.today);
        expect(got.map((g) => [g.frequency, g.every])).toEqual([[s.pattern.frequency, s.pattern.every]]);
      }),
    );
  });

  it('REC-5 entries for other descriptions never change the suggestion for this one', () => {
    fc.assert(
      fc.property(
        seriesArb,
        fc.array(fc.record({ description: fc.constantFrom('Tesco', 'Pret', 'Coffee'), amount: fc.integer({ min: 100, max: 9000 }), offset: fc.integer({ min: -400, max: 0 }) }), { maxLength: 20 }),
        (s, noise) => {
          const extra = noise.map((n) => ({ description: n.description, amount: pence(n.amount), date: addDays(s.today, n.offset) }));
          const mine = core.suggestRecurring([...s.history, ...extra], s.today).filter((g) => g.key === normaliseKey(s.description));
          expect(mine).toEqual(core.suggestRecurring(s.history, s.today));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('REC-5 every suggestion is a real schedule: stepping back from the next date lands within days of the last entry', () => {
    fc.assert(
      fc.property(seriesArb, (s) => {
        for (const g of core.suggestRecurring(s.history, s.today)) {
          expect(daysBetween(g.lastDate, g.nextDate)).toBeGreaterThan(0);
          const back = recurring.occurrence({ frequency: g.frequency, every: g.every, startDate: g.lastDate, endDate: null }, 1);
          expect(back).toBe(g.nextDate);
        }
      }),
    );
  });
});
