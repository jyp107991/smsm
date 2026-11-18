/**
 * S6b core (docs/slices/S6b.md "Decisions made here → Recap wording", "Data", "Interfaces → Core"; docs/AI.md §1, §3.4;
 * SPEC INS-2): what the recap's AI wording is given, and the guard every reply passes before it is shown. Code computes,
 * the AI only phrases: every number in the reply must be one of the month's own figures. Written before the build
 * (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/wording.ts (pure; no I/O, no clock):
 *
 *   recapStats(recap: Recap, people: readonly [UserId, UserId]): RecapStats
 *     What the `recap` task is sent (AI.md rule 4: that month's aggregate figures only). people[0] is "A", people[1]
 *     is "B" (the data layer passes the household's members in the order they joined, so the stored wording reads
 *     the same on both phones). Money is given as the app shows it (formatPence: "£1,365.50"), so the model only
 *     copies figures and never converts or adds; the comparison as the template words it, whole pounds ("£120").
 *     interface RecapStats {
 *       period: string;                  // 'YYYY-MM'
 *       month: string;                   // 'October'
 *       total: string;                   // formatPence(recap.total)
 *       everyday: string;                // formatPence(recap.everyday)
 *       usual: string | null;            // formatPence(recap.usual), null without one
 *       comparison: { direction: 'less' | 'more' | 'same'; amount: string | null } | null
 *                                        // 'less'/'more': '£120' (whole pounds, grouped: '£1,200'); 'same': amount null
 *       bar: { name: string; total: string }[];   // recap.bar's names and formatPence totals, in order
 *       notes: string[];                 // recap.notes' texts, in order
 *       paid: { A: string; B: string };  // formatPence of recap.paid[people[0]] / [people[1]]
 *     }
 *     Exactly these keys. Nothing else: no user ids, no names, no balance, no moment, no template headline.
 *
 *   wordingGuard(stats: RecapStats, reply: { headline: string; aside: string | null }, names: { A: string; B: string })
 *     → { headline: string; aside: string | null } | null
 *     null (the template is used) when:
 *       - the headline is blank, or the headline or the aside is longer than 140 characters (as the AI wrote it);
 *       - any number in the headline or aside is not one of the stats' own. A number is read after normalising
 *         pounds formatting: "£1,365.50", "£1365.50", "1,365.50" and "1365.50" are all 136550p; "£1,000", "1,000" and
 *         "£1,000.00" are all 100000p. A whole-pounds form only stands for a figure with no pence ("£1,365" is not
 *         £1,365.50). Allowed: every money figure in the stats (total, everyday, usual, comparison, bar, paid, and
 *         the amounts written in the notes); a percentage only if that percentage is written in a note; a bare
 *         number only if it is one of those figures in pounds, a number written in a note, or the period's year;
 *       - the headline or aside uses an advice or judgement word, whole words, any case: "should", "too much",
 *         "overspent", "blame" (AI.md §3.4: no advice, no judgement about either person).
 *     Otherwise the same two sentences (trimmed), with "Person A" and "Person B" (also before an apostrophe:
 *     "Person A’s") replaced by names.A and names.B. A bare "A" stays an article ("A quiet October"); "B&Q" and "M&S"
 *     are untouched. (Corrected by the builder after the fresh review: a bare capital "A" is also the article that
 *     opens many sentences, so the people are "Person A" and "Person B" in the prompt and the reply.)
 *
 * Until src/core/wording.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module); once it exists this can become `import * as wording from './wording'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatPence, pence } from './money';
import type { Recap } from './recap';
import type { UserId } from './split';

interface RecapStats {
  period: string; month: string; total: string; everyday: string; usual: string | null;
  comparison: { direction: 'less' | 'more' | 'same'; amount: string | null } | null;
  bar: { name: string; total: string }[]; notes: string[]; paid: { A: string; B: string };
}
type Wording = { headline: string; aside: string | null };
interface WordingCore {
  recapStats(recap: Recap, people: readonly [UserId, UserId]): RecapStats;
  wordingGuard(stats: RecapStats, reply: Wording, names: { A: string; B: string }): Wording | null;
}

const NAMES = ['recapStats', 'wordingGuard'] as const;
const WORDING = './wording';
const loaded = (await import(/* @vite-ignore */ WORDING).catch(() => null)) as Partial<WordingCore> | null;
function core(): WordingCore {
  const missing = NAMES.filter((n) => typeof loaded?.[n] !== 'function');
  if (!loaded || missing.length > 0) throw new Error(`src/core/wording.ts does not export ${missing.join(', ')} yet (S6b)`);
  return loaded as WordingCore;
}

// ───────── the month: October 2026, worked by hand ─────────
const JAE = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000b1';
const PEOPLE = [JAE, SAM] as const;
const WHO = { A: 'Jae', B: 'Sam' };
const EATING_NOTE = 'Eating out is £85 over its usual (£210 so far, usually £125)';
const ENERGY_NOTE = 'Energy came in 30% above its usual';

/** £1,365.50 together; usual £1,485.00 → about £120 less; Rent & bills £1,000.00, Groceries £240.50, Eating out £125.00. */
const OCTOBER: Recap = {
  month: '2026-10', soFar: false, total: pence(136550), everyday: pence(136550), usual: pence(148500),
  comparison: { direction: 'less', amount: pence(12000) },
  headline: 'October cost £1,365.50 together, about £120 less than usual.',
  bar: [
    { categoryId: 'cat-rent', name: 'Rent & bills', total: pence(100000) },
    { categoryId: 'cat-groceries', name: 'Groceries', total: pence(24050) },
    { categoryId: 'cat-eating', name: 'Eating out', total: pence(12500) },
  ],
  notes: [{ kind: 'category', text: EATING_NOTE, weight: pence(8500) }, { kind: 'price', text: ENERGY_NOTE, weight: pence(2200) }],
  paid: { [JAE]: pence(100000), [SAM]: pence(36550) },
  balance: { debtor: SAM, creditor: JAE, amount: pence(53000) },
  moment: { id: '00000000-0000-4000-8000-00000000e009', description: 'Rent', amount: pence(100000), date: '2026-10-10', comments: 0 },
};
const SAME: Recap = { ...OCTOBER, month: '2026-09', usual: pence(136550), comparison: { direction: 'same', amount: pence(0) }, notes: [] };
const NO_USUAL: Recap = { ...OCTOBER, month: '2026-06', usual: null, comparison: null, notes: [] };
const BIG: Recap = { ...OCTOBER, month: '2026-12', comparison: { direction: 'more', amount: pence(120000) }, notes: [] };

const stats = () => core().recapStats(OCTOBER, PEOPLE);
const guard = (headline: string, aside: string | null = null, s: RecapStats = stats()) => core().wordingGuard(s, { headline, aside }, WHO);
const GOOD = 'October came to £1,365.50 together, about £120 less than usual.';

// ─────────────────────────────── recapStats ───────────────────────────────

describe('recapStats: what the recap wording is sent (INS-2; AI.md §1.4, §3.4)', () => {
  it('INS-2: the month’s figures as the app shows them, people only as A and B', () => {
    expect(stats()).toEqual({
      period: '2026-10', month: 'October', total: '£1,365.50', everyday: '£1,365.50', usual: '£1,485.00',
      comparison: { direction: 'less', amount: '£120' },
      bar: [{ name: 'Rent & bills', total: '£1,000.00' }, { name: 'Groceries', total: '£240.50' }, { name: 'Eating out', total: '£125.00' }],
      notes: [EATING_NOTE, ENERGY_NOTE],
      paid: { A: '£1,000.00', B: '£365.50' },
    });
  });

  it('INS-2: A is the first person given, B the second (the order the caller passes, not who is looking)', () => {
    expect(core().recapStats(OCTOBER, [SAM, JAE]).paid).toEqual({ A: '£365.50', B: '£1,000.00' });
  });

  it('INS-2: least data: no ids, no names, no balance, no moment, no template headline', () => {
    const all = JSON.stringify(stats());
    for (const s of [JAE, SAM, 'Jae', 'Sam', 'debtor', 'creditor', 'balance', '£530', 'moment', 'cat-rent', OCTOBER.headline, 'e009']) {
      expect(all, s).not.toContain(s);
    }
    expect(Object.keys(stats()).sort()).toEqual(['bar', 'comparison', 'everyday', 'month', 'notes', 'paid', 'period', 'total', 'usual']);
  });

  it('INS-2: about the same: no comparison amount; no usual: no comparison at all', () => {
    expect(core().recapStats(SAME, PEOPLE).comparison).toEqual({ direction: 'same', amount: null });
    expect(core().recapStats(NO_USUAL, PEOPLE)).toMatchObject({ usual: null, comparison: null, month: 'June', period: '2026-06' });
  });

  it('INS-2: a comparison of a thousand pounds or more is grouped as the template shows it', () => {
    expect(core().recapStats(BIG, PEOPLE).comparison).toEqual({ direction: 'more', amount: '£1,200' });
  });
});

// ─────────────────────────────── wordingGuard: numbers ───────────────────────────────

describe('wordingGuard: every number is one of the month’s (INS-2; AI.md §3.4)', () => {
  it('INS-2: a reply using only the stats’ figures passes', () => {
    expect(guard(GOOD, 'Rent & bills was £1,000.00 of it.')).toEqual({ headline: GOOD, aside: 'Rent & bills was £1,000.00 of it.' });
    expect(guard(GOOD)).toEqual({ headline: GOOD, aside: null });
  });

  it('INS-2: pounds formatting doesn’t matter: with or without £ and commas', () => {
    for (const total of ['£1,365.50', '£1365.50', '1,365.50', '1365.50']) {
      expect(guard(`October came to ${total} together.`), total).not.toBeNull();
    }
  });

  it('INS-2: a figure with no pence may be written in whole pounds, as the template does', () => {
    for (const rent of ['£1,000', '£1000', '1,000', '£1,000.00']) {
      expect(guard(GOOD, `Rent & bills took ${rent}.`), rent).not.toBeNull();
    }
    expect(guard('October came in about £120.00 under the usual.')).not.toBeNull();
  });

  it('INS-2: a changed amount is refused: rounding away the pence, a penny out, digits swapped', () => {
    for (const wrong of ['£1,365', '£1,366', '£1,365.51', '£1,356.50', '£136,550']) {
      expect(guard(`October came to ${wrong} together.`), wrong).toBeNull();
    }
  });

  it('INS-2: an invented number is refused, in the headline or the aside', () => {
    expect(guard('October came to £1,400 together.')).toBeNull();
    expect(guard(GOOD, 'That’s £50 a week.')).toBeNull();
    expect(guard(GOOD, 'Spread over 31 days.')).toBeNull();
    expect(guard('October came to £1,365.50 together, about £125 less than usual.')).toBeNull();
  });

  it('INS-2: a percentage passes only when a note says it', () => {
    expect(guard(GOOD, 'Energy came in 30% above its usual.')).not.toBeNull();
    expect(guard(GOOD, 'Eating out was up 68%.')).toBeNull();
    expect(guard(GOOD, 'That is 8% less than usual.')).toBeNull();
  });

  it('INS-2: the amounts written in a note may be used', () => {
    expect(guard(GOOD, 'Eating out was £85 over its usual.')).not.toBeNull();
    expect(guard(GOOD, 'Eating out came to £210, against £125 usually.')).not.toBeNull();
    expect(guard(GOOD, 'Eating out was £86 over its usual.')).toBeNull();
  });

  it('INS-2: the year may be named; another year may not', () => {
    expect(guard('October 2026 came to £1,365.50 together.')).not.toBeNull();
    expect(guard('October 2025 came to £1,365.50 together.')).toBeNull();
  });

  it('INS-2: who paid, the bar and the usual are all figures of the month', () => {
    expect(guard('Person A paid £1,000.00 and Person B £365.50.')).not.toBeNull();
    expect(guard(GOOD, 'Groceries were £240.50; the usual is £1,485.00.')).not.toBeNull();
  });

  it('INS-2: with "about the same", no comparison amount exists to quote', () => {
    const same = core().recapStats(SAME, PEOPLE);
    expect(guard('September came to £1,365.50 together, about the same as usual.', null, same)).not.toBeNull();
    expect(guard('September came to £1,365.50 together, about £0 off usual.', null, same)).toBeNull();
    expect(guard('September came to £1,365.50 together, about £120 less than usual.', null, same)).toBeNull();
  });

  it('INS-2: any money figure not in the stats makes the wording null (property)', () => {
    const s = stats();
    const allowed = new Set([136550, 148500, 12000, 100000, 24050, 12500, 36550, 8500, 21000, 202600]);
    const arb = fc.integer({ min: 1, max: 5_000_000 }).filter((v) => !allowed.has(v));
    fc.assert(fc.property(arb, fc.boolean(), (v, inAside) => {
      const money = formatPence(pence(v));
      const r = inAside ? guard(GOOD, `Of that, ${money} was the shop.`, s) : guard(`October came to ${money} together.`, null, s);
      expect(r).toBeNull();
    }), { numRuns: 300 });
  });

  it('INS-2: any bare number or percentage not in the stats makes the wording null (property)', () => {
    const s = stats();
    const allowedBare = new Set([1365, 1485, 120, 1000, 125, 85, 210, 2026, 30]);
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999 }).filter((k) => !allowedBare.has(k)), fc.boolean(), (k, percent) => {
      const n = percent ? `${String(k)}%` : String(k);
      expect(guard(GOOD, `There were ${n} of them.`, s)).toBeNull();
    }), { numRuns: 300 });
  });
});

// ─────────────────────────────── wordingGuard: length, tone, names ───────────────────────────────

describe('wordingGuard: length, tone and names (INS-2; AI.md §3.4)', () => {
  it('INS-2: at most 140 characters each, as written; a blank headline is no wording', () => {
    const exactly = `October came to £1,365.50 together. ${'x'.repeat(140 - 'October came to £1,365.50 together. '.length)}`;
    expect(exactly).toHaveLength(140);
    expect(guard(exactly)).not.toBeNull();
    expect(guard(`${exactly}y`)).toBeNull();
    expect(guard(GOOD, `${exactly}y`)).toBeNull();
    expect(guard('   ')).toBeNull();
    expect(guard('')).toBeNull();
  });

  it('INS-2: advice or judgement words are refused, any case, headline or aside', () => {
    expect(guard('October came to £1,365.50 together. You should cook more.')).toBeNull();
    expect(guard(GOOD, 'Should be easy to beat.')).toBeNull();
    expect(guard(GOOD, 'Eating out was too much.')).toBeNull();
    expect(guard(GOOD, 'Nobody overspent.')).toBeNull();
    expect(guard(GOOD, 'No BLAME here.')).toBeNull();
  });

  it('INS-2: the list is of whole words: "shoulder" is not "should"', () => {
    expect(guard(GOOD, 'Groceries included a shoulder of lamb.')).not.toBeNull();
  });

  it('INS-2: A and B become the names on this phone', () => {
    expect(guard('Person A paid £1,000.00 and Person B £365.50.')).toEqual({ headline: 'Jae paid £1,000.00 and Sam £365.50.', aside: null });
    expect(guard(GOOD, 'Most of it was Person A’s rent.')).toEqual({ headline: GOOD, aside: 'Most of it was Jae’s rent.' });
    expect(core().wordingGuard(stats(), { headline: 'B paid £365.50.', aside: null }, { A: 'Sam', B: 'Jae' })).toEqual({ headline: 'Jae paid £365.50.', aside: null });
  });

  it('INS-2: only A and B standing alone: "B&Q", "M&S" and the article "a" are left as they are', () => {
    expect(guard(GOOD, 'Household was mostly B&Q and M&S, a quiet month.')).toEqual({ headline: GOOD, aside: 'Household was mostly B&Q and M&S, a quiet month.' });
  });

  it('INS-2: the reply is trimmed', () => {
    expect(guard(`  ${GOOD}  `, '  Rent & bills was £1,000.00 of it. ')).toEqual({ headline: GOOD, aside: 'Rent & bills was £1,000.00 of it.' });
  });
});
