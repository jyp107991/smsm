/** S6a fresh review: the route's limits and its fallbacks when a model is slow (review 4, 11). */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAi, type AiEnv } from './index';

const ORIGIN = 'https://smsm.example.workers.dev';
const reply = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/ai/replies/${name}.json`, import.meta.url), 'utf8'));
const env = (run: AiEnv['AI']): AiEnv => ({ AI: run, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', APP_ORIGIN: ORIGIN });
const counted = (() => Promise.resolve(new Response('1', { status: 200 }))) as unknown as typeof fetch;
const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/ai`, {
  method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer t', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const SCAN = { task: 'scan', image: 'aGVsbG8=', categories: ['Groceries'], today: '2026-11-17', country: 'GB' };

afterEach(() => { vi.useRealTimers(); });

describe('limits (review 11)', () => {
  it('SCAN-5: a category name longer than 80 characters is a bad request; nothing is counted or read', async () => {
    const run = vi.fn();
    const fetchImpl = vi.fn(counted);
    const res = await handleAi(request({ ...SCAN, categories: ['x'.repeat(81)] }), env({ run }), fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('SCAN-5: a body said to be over 3 MB is refused before it is read', async () => {
    const run = vi.fn();
    const res = await handleAi(request(SCAN, { 'content-length': '4000000' }), env({ run }), counted);
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('SCAN-1 SCAN-5: a model that never answers hands over to the next in time', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const run = vi.fn((model: string) => {
      seen.push(model);
      return seen.length === 1 ? new Promise(() => { /* never */ }) : Promise.resolve(reply('scan-good'));
    });
    const pending = handleAi(request(SCAN), env({ run }), counted);
    await vi.advanceTimersByTimeAsync(9_000);
    const out = (await (await pending).json()) as { ok: boolean };
    expect(seen).toHaveLength(2);
    expect(out.ok).toBe(true);
  });
});

describe('the scan prompt (review 4)', () => {
  it('TXT-5: amounts are hundredths of every currency, yen included', () => {
    const prompt = readFileSync(new URL('./prompts/scan.md', import.meta.url), 'utf8');
    expect(prompt).toMatch(/hundredths/);
    expect(prompt).toMatch(/¥648 is 64800/);
  });
});
