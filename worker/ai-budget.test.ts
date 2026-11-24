/**
 * The smart features' cost against the account's free Workers AI allocation (docs/AI.md "Cost"; SCAN-5's caps). On
 * 24 Nov three live-eval runs used up the day's 10,000 Neurons, which the app shares with MacroPy; the caps must keep
 * one household's worst day within smsm's share (60%), at Cloudflare's published rates.
 */
import { describe, expect, it } from 'vitest';
import { callNeurons, DAILY_FREE_NEURONS, estimate, inputTokens, LARGEST, NEURONS_PER_M, SMSM_SHARE, worstCaseDay } from './ai-budget';
import { buildRequest, MODELS, type Task } from './ai-core';

describe('Neuron costs (SCAN-5; AI.md "Cost")', () => {
  it('SCAN-5: every model the Worker asks has its published rate recorded', () => {
    for (const models of Object.values(MODELS)) for (const m of models) expect(NEURONS_PER_M[m], m).toBeDefined();
  });

  it('SCAN-5: a call costs its input and output tokens at the model’s rate; a photo counts as image tokens, not its bytes', () => {
    const input = LARGEST.categorise;
    const req = buildRequest(input, '@cf/openai/gpt-oss-20b');
    const tokens = inputTokens(req);
    expect(callNeurons(input, '@cf/openai/gpt-oss-20b', 'max')).toBeCloseTo((tokens * 18182 + Number(req.max_tokens) * 27273) / 1e6, 6);
    const photo = (image: string) => ({ task: 'scan' as const, image, categories: ['Groceries'], today: '2026-11-24', country: 'GB' });
    const small = inputTokens(buildRequest(photo('a'.repeat(10)), MODELS.scan[0] ?? ''));
    const big = inputTokens(buildRequest(photo('a'.repeat(400_000)), MODELS.scan[0] ?? ''));
    expect(big).toBe(small);
  });

  it('SCAN-5: a receipt is roughly 100–300 Neurons (AI.md "Cost"); a category guess is a few', () => {
    const scan = callNeurons(LARGEST.scan, MODELS.scan[0] ?? '', 'expected');
    expect(scan).toBeGreaterThan(80);
    expect(scan).toBeLessThan(300);
    expect(callNeurons(LARGEST.categorise, MODELS.categorise[0] ?? '', 'expected')).toBeLessThan(15);
  });

  it('SCAN-5: an estimate adds the calls, each answered by its first model; the ceiling is every reply at max_tokens', () => {
    const one = estimate([LARGEST.parse]);
    const two = estimate([LARGEST.parse, LARGEST.parse]);
    expect(two.calls).toBe(2);
    expect(Math.abs(two.expected - 2 * one.expected)).toBeLessThanOrEqual(1);
    expect(one.ceiling).toBeGreaterThan(one.expected);
  });
});

describe('the daily caps fit the free allocation (SCAN-5; AI.md §2, "Cost")', () => {
  it('SCAN-5: one household’s worst day at the caps is at most 60% of the 10,000 free Neurons it shares with MacroPy', () => {
    const day = worstCaseDay();
    expect(day.total).toBeLessThanOrEqual(DAILY_FREE_NEURONS * SMSM_SHARE);
    for (const t of Object.keys(MODELS) as Task[]) expect(day.byTask[t], t).toBeGreaterThan(0);
  });
});
