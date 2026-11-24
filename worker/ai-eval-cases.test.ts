/**
 * The live eval's categorise and recap cases (docs/AI.md §5), checked without the network: they use the app's real
 * default category names, and the recap months the app's own code works out really cover what the eval says they do
 * (less, more and about the same as usual; no comparison; chapter months; money back), each sent as the Worker accepts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wordingGuard } from '../src/core/wording';
import { recapStatsSchema } from './ai-core';
import { CATEGORIES, NAMES, numbersIn, ownNumbers, recapMonths } from '../tests/ai/eval/recap-months';

const DEFAULTS = [...readFileSync('supabase/schema.sql', 'utf8').matchAll(/\(hid, '([^']+)',\s+'/g)].map((m) => m[1]);

describe('live eval cases: category guess (CAT-2 step 4; AI.md §3.3)', () => {
  const cases = JSON.parse(readFileSync('tests/ai/eval/categorise.json', 'utf8')) as { description: string; category: string | null }[];

  it('CAT-2: about 40 descriptions, each expecting one of the default categories (not Other) or no guess', () => {
    expect(DEFAULTS).toHaveLength(12);
    expect(cases.length).toBeGreaterThanOrEqual(40);
    for (const c of cases) {
      expect(c.description.trim()).not.toBe('');
      if (c.category !== null) {
        expect(DEFAULTS).toContain(c.category);
        expect(c.category).not.toBe('Other');
      }
    }
    expect(new Set(cases.map((c) => c.description.toLowerCase())).size).toBe(cases.length);
  });

  it('CAT-2: some are Korean, and some have no right guess', () => {
    expect(cases.filter((c) => /\p{Script=Hangul}/u.test(c.description)).length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.category === null).length).toBeGreaterThanOrEqual(4);
  });
});

describe('live eval cases: recap months (INS-2; AI.md §3.4)', () => {
  const months = recapMonths();

  it('INS-2: twelve finished months with the default categories, the same figures every run', () => {
    expect(months).toHaveLength(12);
    expect(CATEGORIES.map((c) => c.name)).toEqual(expect.arrayContaining(DEFAULTS));
    expect(JSON.stringify(recapMonths().map((m) => m.stats))).toBe(JSON.stringify(months.map((m) => m.stats)));
  });

  it('INS-2: each month is what the eval calls it: less, more, about the same, or no comparison', () => {
    for (const m of months) {
      if (m.scenario === 'no comparison') expect(m.stats.comparison, m.month).toBeNull();
      else expect(m.stats.comparison?.direction, m.month).toBe(m.scenario);
    }
    for (const s of ['no comparison', 'less', 'more', 'same']) expect(months.filter((m) => m.scenario === s).length).toBeGreaterThanOrEqual(2);
  });

  it('INS-2: chapter months have a total apart from everyday spending; money-back months have money back', () => {
    expect(months.filter((m) => m.chapter).length).toBeGreaterThanOrEqual(1);
    for (const m of months) {
      if (m.chapter) expect(m.recap.total, m.month).toBeGreaterThan(m.recap.everyday);
      else expect(m.recap.total, m.month).toBe(m.recap.everyday);
    }
    expect(months.filter((m) => m.moneyBack).length).toBeGreaterThanOrEqual(1);
  });

  it('INS-2: each is sent as the Worker accepts it, has spending to word, and has notes in some months', () => {
    for (const m of months) {
      expect(recapStatsSchema.safeParse(m.stats).success, m.month).toBe(true);
      expect(m.recap.total, m.month).toBeGreaterThan(0);
    }
    expect(months.some((m) => m.stats.notes.length > 0)).toBe(true);
  });

  it('INS-2: the template headline itself passes the guard, and every number in it is one of the month’s own', () => {
    for (const m of months) {
      expect(wordingGuard(m.stats, { headline: m.recap.headline, aside: null }, NAMES), m.month).not.toBeNull();
      const own = ownNumbers(m.stats);
      expect(numbersIn(m.recap.headline).filter((x) => !own.has(x)), m.month).toEqual([]);
    }
  });

  it('INS-2: the figure check catches a number that isn’t the month’s', () => {
    const m = months[0];
    if (!m) throw new Error('no months');
    const own = ownNumbers(m.stats);
    expect(numbersIn('November cost £9,999.99 together.').filter((x) => !own.has(x))).toEqual([9999.99]);
    expect(numbersIn(`November cost ${m.stats.total} together, in ${m.stats.period.slice(0, 4)}.`).filter((x) => !own.has(x))).toEqual([]);
  });
});
