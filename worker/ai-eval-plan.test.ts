/**
 * The live eval's sample and its Neuron estimate (docs/AI.md §5): by default a run sends a few of each kind, the same
 * ones every time, so it can't use up the account's free daily allocation; the full set only when asked for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimate, DAILY_FREE_NEURONS } from './ai-budget';
import { sampleCategorise, sampleReceipts, sampleRecap, sampleSpread, SAMPLE, spread } from '../tests/ai/eval/plan';
import { recapMonths } from '../tests/ai/eval/recap-months';

const receipts = readdirSync('tests/ai/eval/receipts').filter((f) => f.endsWith('.json')).sort();
const parse = JSON.parse(readFileSync('tests/ai/eval/parse.json', 'utf8')) as unknown[];
const ask = JSON.parse(readFileSync('tests/ai/eval/ask.json', 'utf8')) as unknown[];
const categorise = JSON.parse(readFileSync('tests/ai/eval/categorise.json', 'utf8')) as { description: string; category: string | null }[];
const months = recapMonths();

describe('the live eval’s sample (SCAN-5; AI.md §5)', () => {
  it('SCAN-5: spread picks evenly, first included, in order, never twice; all when asked for more', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 3, 6, 8]);
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(spread([1, 2, 3], 0)).toEqual([]);
  });

  it('SCAN-5: 4 UK receipts and 4 CORD photos; the full set is every receipt', () => {
    const s = sampleReceipts(receipts, false);
    expect(s.filter((n) => n.startsWith('uk-'))).toHaveLength(SAMPLE.uk);
    expect(s.filter((n) => n.startsWith('cord-'))).toHaveLength(SAMPLE.cord);
    expect(sampleReceipts(receipts, true)).toEqual(receipts);
  });

  it('SCAN-5: 10 loose wordings and 10 questions; the full set is all of them', () => {
    expect(sampleSpread(parse, SAMPLE.parse, false)).toHaveLength(10);
    expect(sampleSpread(ask, SAMPLE.ask, false)).toHaveLength(10);
    expect(sampleSpread(parse, SAMPLE.parse, true)).toHaveLength(parse.length);
  });

  it('CAT-2: 10 category guesses: 6 English, 2 Korean, 2 with no right guess', () => {
    const s = sampleCategorise(categorise, false);
    expect(s).toHaveLength(SAMPLE.categorise);
    expect(s.filter((c) => /\p{Script=Hangul}/u.test(c.description))).toHaveLength(2);
    expect(s.filter((c) => c.category === null)).toHaveLength(2);
    expect(sampleCategorise(categorise, true)).toHaveLength(categorise.length);
  });

  it('INS-2: 4 recap months, one of each kind, among them a chapter month and money back', () => {
    const s = sampleRecap(months, false);
    expect(s).toHaveLength(SAMPLE.recap);
    expect(new Set(s.map((m) => m.scenario))).toEqual(new Set(['no comparison', 'less', 'more', 'same']));
    expect(s.some((m) => m.chapter)).toBe(true);
    expect(s.some((m) => m.moneyBack)).toBe(true);
    expect(sampleRecap(months, true)).toHaveLength(12);
  });

  it('SCAN-5: the same cases every run', () => {
    expect(sampleCategorise(categorise, false)).toEqual(sampleCategorise(categorise, false));
    expect(sampleRecap(months, false).map((m) => m.month)).toEqual(sampleRecap(recapMonths(), false).map((m) => m.month));
  });
});

describe('what a run costs (SCAN-5; AI.md §5, "Cost")', () => {
  const CATS = ['Groceries', 'Eating out', 'Going out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Travel', 'Gifts', 'Health', 'Other'];
  const run = (n: { scan: number; parse: number; ask: number; categorise: number; recap: number }) => estimate([
    ...Array.from({ length: n.scan }, () => ({ task: 'scan' as const, image: '', categories: CATS, today: '2026-11-18', country: 'GB' })),
    ...Array.from({ length: n.parse }, () => ({ task: 'parse' as const, text: 'B got the big tesco shop, 86.40', categories: CATS, chapters: ['Japan trip'], today: '2026-11-18' })),
    ...Array.from({ length: n.ask }, () => ({ task: 'ask' as const, question: 'how much on eating out in japan?', categories: CATS, chapters: ['Japan trip'], countries: ['GB', 'JP'], today: '2026-11-18' })),
    ...Array.from({ length: n.categorise }, () => ({ task: 'categorise' as const, description: 'Tesco Express', categories: CATS })),
    ...months.slice(0, n.recap).map((m) => ({ task: 'recap' as const, stats: m.stats })),
  ]);

  it('SCAN-5: the sample is estimated at under a quarter of the day’s free allocation (under 40% with every reply at its longest)', () => {
    const s = run({ scan: 8, parse: 10, ask: 10, categorise: 10, recap: 4 });
    expect(s.calls).toBe(42);
    expect(s.expected).toBeLessThan(DAILY_FREE_NEURONS / 4);
    expect(s.ceiling).toBeLessThan(DAILY_FREE_NEURONS * 0.4);
  });

  it('SCAN-5: the full set is estimated at over a third of it, so it is kept for a quiet day', () => {
    const f = run({ scan: receipts.length, parse: parse.length, ask: ask.length, categorise: categorise.length, recap: 12 });
    expect(f.expected).toBeGreaterThan(DAILY_FREE_NEURONS / 3);
  });
});

describe('the eval-ai workflow (AI.md §5)', () => {
  it('SCAN-5: a "full" choice, off unless ticked, reaches the run as EVAL_FULL', () => {
    const yml = readFileSync('.github/workflows/eval-ai.yml', 'utf8');
    expect(yml).toMatch(/inputs:\s+full:\s+description: [^\n]+\s+type: boolean\s+default: false/);
    expect(yml).toContain('EVAL_FULL: ${{ inputs.full }}');
  });
});
