/**
 * The account's free Workers AI allocation used up (AI.md §4 "Daily limit reached"; SCAN-5), with the answer Cloudflare
 * actually gave on 24 Nov (tests/ai/replies/daily-limit-429.json, eval-ai run 45423764195): every task answers
 * "limit" at once, without asking the task's other models (they draw on the same allocation), and the phone shows its
 * quiet line. The live eval stops at the first such answer (tests/ai/eval/plan.ts isAllocationError).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isAllocationError } from '../tests/ai/eval/plan';
import { isDailyLimit, isRetired, type Task } from './ai-core';
import { handleAi } from './index';

const recorded = JSON.parse(readFileSync(new URL('../tests/ai/replies/daily-limit-429.json', import.meta.url), 'utf8')) as {
  status: number; body: { errors: { message: string; code: number }[] };
};
const MESSAGE = recorded.body.errors[0]?.message ?? '';
const ORIGIN = 'https://smsm.example.workers.dev';
const env = (run: (model: string) => Promise<unknown>) => ({
  AI: { run: vi.fn(run) }, SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_ANON_KEY: 'anon', APP_ORIGIN: ORIGIN,
});
const counted = (() => Promise.resolve(new Response('1', { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch;
const CATS = ['Groceries', 'Other'];
const BODIES: Record<Task, Record<string, unknown>> = {
  scan: { task: 'scan', image: 'aGVsbG8=', categories: CATS, today: '2026-11-24', country: 'GB' },
  parse: { task: 'parse', text: 'dinner 42', categories: CATS, chapters: [], today: '2026-11-24' },
  categorise: { task: 'categorise', description: 'Zzyzx Emporium', categories: CATS },
  recap: {
    task: 'recap',
    stats: {
      period: '2026-10', month: 'October', total: '£10.00', everyday: '£10.00', usual: null, comparison: null,
      bar: [], notes: [], paid: { A: '£10.00', B: '£0.00' },
    },
  },
  ask: { task: 'ask', question: 'how much on groceries?', categories: CATS, chapters: [], countries: ['GB'], today: '2026-11-24' },
};
const request = (body: unknown) => new Request(`${ORIGIN}/api/ai`, {
  method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('the free allocation used up (SCAN-5; AI.md §4)', () => {
  it('SCAN-5: Cloudflare’s recorded message is the daily limit, not a retired model', () => {
    expect(recorded.status).toBe(429);
    expect(isDailyLimit(MESSAGE)).toBe(true);
    expect(isDailyLimit(JSON.stringify(recorded.body))).toBe(true);
    expect(isRetired(MESSAGE)).toBe(false);
  });

  for (const task of Object.keys(BODIES) as Task[]) {
    it(`SCAN-5: a ${task} answers "limit" at once; no other model is asked`, async () => {
      const e = env(() => Promise.reject(new Error(MESSAGE)));
      const res = await handleAi(request(BODIES[task]), e, counted);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, reason: 'limit' });
      expect(e.AI.run).toHaveBeenCalledTimes(1);
    });
  }

  it('SCAN-5: the first model busy and the second out of allocation is still "limit", and the third is not asked', async () => {
    const e = env((model) => Promise.reject(new Error(model.includes('llama') ? 'AiError: 3040: Capacity temporarily exceeded' : MESSAGE)));
    expect(await (await handleAi(request(BODIES.scan), e, counted)).json()).toEqual({ ok: false, reason: 'limit' });
    expect(e.AI.run).toHaveBeenCalledTimes(2);
  });
});

describe('the live eval stops at the first allocation answer (AI.md §5)', () => {
  it('SCAN-5: the recorded HTTP 429 body is an allocation error; other failures are not', () => {
    expect(isAllocationError(JSON.stringify(recorded.body))).toBe(true);
    expect(isAllocationError(MESSAGE)).toBe(true);
    expect(isAllocationError('{"errors":[{"message":"AiError: 3040: Capacity temporarily exceeded"}]}')).toBe(false);
    expect(isAllocationError('Model has been deprecated: @cf/qwen/qwen3-30b-a3b-fp8 was deprecated on 2026-11-20')).toBe(false);
    expect(isAllocationError('internal error')).toBe(false);
  });
});
