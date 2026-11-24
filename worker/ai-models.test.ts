/**
 * Retired models (24 Nov 2026). The live eval run 45367987613 got HTTP 410 from `@cf/qwen/qwen3-30b-a3b-fp8`:
 * "AiError: Model has been deprecated: @cf/qwen/qwen3-30b-a3b-fp8 was deprecated on 2026-11-20." Cloudflare's model
 * page for it says "Deprecated 11/20/2026". It is gone from every task's order; `@cf/qwen/qwen3.8-27b` (live, no
 * deprecation on its page, already the scan's third model) takes its place. A retired model met anyway is skipped
 * like any failing model, logged in one plain line, and never reaches the person as anything but the usual fallback.
 */
import { describe, expect, it, vi } from 'vitest';
import { isRetired, MODEL_OPTIONS, MODELS, type Task } from './ai-core';
import { handleAi, type AiEnv } from './index';

const RETIRED = ['@cf/qwen/qwen3-30b-a3b-fp8'];
const GONE = 'AiError: Model has been deprecated: @cf/qwen/qwen3-30b-a3b-fp8 was deprecated on 2026-11-20. See the model catalog for alternatives: https://developers.cloudflare.com/workers-ai/models/';
const ORIGIN = 'https://smsm.example.workers.dev';
const counted = (() => Promise.resolve(new Response('1', { status: 200 }))) as unknown as typeof fetch;
const env = (run: NonNullable<AiEnv['AI']>['run']): AiEnv => ({ AI: { run }, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', APP_ORIGIN: ORIGIN });
const CATEGORISE = { task: 'categorise', description: 'Zzyzx Emporium', categories: ['Household', 'Other'] };
const request = (body: unknown) => new Request(`${ORIGIN}/api/ai`, {
  method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('the models each task asks (SCAN-5, CAT-2, ADD-9, INS-2, INS-9; AI.md §2)', () => {
  it('SCAN-5: no task asks a retired model', () => {
    for (const task of Object.keys(MODELS) as Task[]) for (const m of RETIRED) expect(MODELS[task], task).not.toContain(m);
    for (const m of RETIRED) expect(MODEL_OPTIONS[m]).toBeUndefined();
  });

  it('SCAN-5: every task still has a second model to fall back on, from another family than its first', () => {
    for (const task of Object.keys(MODELS) as Task[]) {
      const [first, second] = MODELS[task];
      expect(second, task).toBeDefined();
      expect(first?.split('/')[2], task).not.toBe(second?.split('/')[2]);
    }
  });

  it('SCAN-5: the text tasks: categorise, parse, recap and ask, in order', () => {
    expect(MODELS.parse).toEqual(['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3.8-27b']);
    expect(MODELS.categorise).toEqual(['@cf/openai/gpt-oss-20b', '@cf/qwen/qwen3.8-27b']);
    expect(MODELS.recap).toEqual(['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3.8-27b']);
    expect(MODELS.ask).toEqual(['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3.8-27b']);
  });

  it('SCAN-5: qwen3.8-27b reasons little (its page: reasoning_effort low | medium | xhigh, default xhigh), so it answers in time', () => {
    expect(MODEL_OPTIONS['@cf/qwen/qwen3.8-27b']).toMatchObject({ reasoning_effort: 'low' });
  });
});

describe('a retired model met anyway (SCAN-5; AI.md §4)', () => {
  it('SCAN-5: HTTP 410 or "deprecated" is a retired model, and never the daily limit', () => {
    expect(isRetired(GONE)).toBe(true);
    expect(isRetired('AiError: 410 Gone')).toBe(true);
    expect(isRetired('Model has been retired')).toBe(true);
    expect(isRetired('AiError: 3040: Capacity temporarily exceeded')).toBe(false);
    expect(isRetired('AiError: 4006: daily free allocation of 10,000 neurons')).toBe(false);
  });

  it('SCAN-5: the next model answers; one plain line is logged, with the model and nothing of the request or reply', async () => {
    const run = vi.fn((model: string) => (model === MODELS.categorise[0] ? Promise.reject(new Error(GONE)) : Promise.resolve({ response: '{"category":"Household"}' })));
    const log = vi.fn();
    const res = await handleAi(request(CATEGORISE), env(run), counted, log);
    expect(await res.json()).toEqual({ ok: true, data: { category: 'Household' } });
    expect(run.mock.calls.map((c) => c[0])).toEqual(MODELS.categorise.slice(0, 2));
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain(MODELS.categorise[0]);
    expect(line).toMatch(/retired/);
    for (const s of ['Zzyzx', 'Household', 'Bearer', 'anon']) expect(line).not.toContain(s);
  });

  it('SCAN-5: every model retired is the quiet fallback ("error"), not "limit" and not an HTTP error', async () => {
    const log = vi.fn();
    const res = await handleAi(request(CATEGORISE), env(() => Promise.reject(new Error(GONE))), counted, log);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'error' });
    expect(log).toHaveBeenCalledTimes(MODELS.categorise.length);
  });

  it('SCAN-5: other failures are not logged (nothing about calls is logged but a retired model)', async () => {
    const log = vi.fn();
    await handleAi(request(CATEGORISE), env(() => Promise.reject(new Error('AiError: 3040: Capacity temporarily exceeded'))), counted, log);
    expect(log).not.toHaveBeenCalled();
  });
});
