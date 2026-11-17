/**
 * S6a, POST /api/ai on smsm's own Worker (docs/slices/S6.md as changed by the owner on 17 Nov: Cloudflare Workers AI,
 * no key; docs/AI.md §2, §4 — every row of the failure table, server side; SPEC SCAN-1, SCAN-5, ADD-9, CAT-2).
 * The handler runs in Vitest with a fake `env.AI` and a fake fetch for the increment_ai_usage RPC: no network.
 * Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, exported from worker/index.ts:
 *   handleAi(req: Request, env: AiEnv, fetchImpl?: typeof fetch): Promise<Response>
 *   interface AiEnv {
 *     AI?: { run(model: string, input: unknown): Promise<unknown> };   // the Workers AI binding; missing → 'off'
 *     SUPABASE_URL: string;          // e.g. https://xyz.supabase.co
 *     SUPABASE_ANON_KEY: string;     // the public (anon / publishable) key, sent as `apikey` to PostgREST
 *     APP_ORIGIN: string;            // the app's own origin; any other Origin → 403
 *   }
 * Steps: an Origin other than APP_ORIGIN → 403. No `Authorization: Bearer <supabase access token>` → 401. A body
 * that isn't {task: 'scan'|'parse'|'categorise', …input} (worker/ai-core.ts AiInput) → 400. No AI binding → 200
 * {ok:false, reason:'off'}. Then POST `${SUPABASE_URL}/rest/v1/rpc/increment_ai_usage` with the caller's token (as
 * `Authorization`) and the anon key (as `apikey`), body {p_kind: task}; PostgREST answers the new count as JSON. The
 * RPC answering 401 → HTTP 401 (not signed in); any other failure → {ok:false, reason:'error'} with no AI call. A
 * count above capFor(task) → {ok:false, reason:'limit'} with no AI call. Then env.AI.run(model,
 * buildRequest(input, model)) through MODELS[task] in order: a thrown error tries the next model; an error for which
 * isDailyLimit(message) → 'limit'; nothing within timeoutFor(task) in total → 'timeout'; a reply that extractText /
 * validate reject on every model → 'invalid'; every model throwing → 'error'. Success: 200 {ok:true, data}. Every
 * answer the app reads is JSON; nothing (prompt, photo, reply) is logged.
 *
 * Until worker/index.ts exists it is loaded by a computed path (so this file type-checks and each test fails).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface AiEnv {
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  SUPABASE_URL: string; SUPABASE_ANON_KEY: string; APP_ORIGIN: string;
}
type HandleAi = (req: Request, env: AiEnv, fetchImpl?: typeof fetch) => Promise<Response>;
type Answer = { ok: true; data: Record<string, unknown> } | { ok: false; reason: 'off' | 'limit' | 'timeout' | 'invalid' | 'error' };

const INDEX = './index';
const loaded = (await import(/* @vite-ignore */ INDEX).catch(() => null)) as { handleAi?: HandleAi } | null;
function handleAi(): HandleAi {
  if (typeof loaded?.handleAi !== 'function') throw new Error('worker/index.ts does not export handleAi yet (S6a)');
  return loaded.handleAi;
}

const replyFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/ai/replies/${name}.json`, import.meta.url), 'utf8'));
const ORIGIN = 'https://smsm.example.workers.dev';
const SUPABASE = 'https://test-project.supabase.co';
const ANON = 'test-anon-key';
const TOKEN = 'test-access-token';
const CATEGORIES = ['Groceries', 'Eating out', 'Household', 'Other'];
const IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const SCAN = { task: 'scan', image: IMAGE, categories: CATEGORIES, today: '2026-11-17', country: 'GB' };
const PARSE = { task: 'parse', text: 'B got dinner at dishoom, forty two quid', categories: CATEGORIES, chapters: [], today: '2026-11-17' };
const CATEGORISE = { task: 'categorise', description: 'Zzyzx Emporium', categories: CATEGORIES };
const SCAN_MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/qwen/qwen3.8-27b'];

function request(body: unknown, opts: { origin?: string | null; token?: string | null } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.set('origin', origin);
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new Request(`${ORIGIN}/api/ai`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

/** The RPC on the "database": answers the count it is told to (or a status), and records each call. */
function rpc(answer: { count?: number; status?: number } = {}) {
  const calls: { url: string; auth: string | null; apikey: string | null; body: unknown }[] = [];
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    const raw = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, auth: headers.get('authorization'), apikey: headers.get('apikey'), body: raw ? JSON.parse(raw) as unknown : null });
    const status = answer.status ?? 200;
    const body = status === 200 ? JSON.stringify(answer.count ?? 1) : JSON.stringify({ message: 'refused' });
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

/** Workers AI: each model answers a recorded reply, throws, or never answers. */
type Behaviour = { reply: unknown } | { throws: string } | 'never';
function aiBy(byModel: (model: string) => Behaviour) {
  const run = vi.fn((...args: [model: string, input: unknown]): Promise<unknown> => {
    const [model] = args;
    const b = byModel(model);
    if (b === 'never') return new Promise(() => { /* never answers */ });
    if ('throws' in b) return Promise.reject(new Error(b.throws));
    return Promise.resolve(b.reply);
  });
  return { run };
}
/** Every model answers this recorded reply ('never': no model answers). */
const ai = (reply: unknown) => aiBy(() => (reply === 'never' ? 'never' : { reply }));
const aiThrows = (message: string) => aiBy(() => ({ throws: message }));
const env = (AI?: AiEnv['AI']): AiEnv => ({ ...(AI ? { AI } : {}), SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: ANON, APP_ORIGIN: ORIGIN });

async function answer(res: Response): Promise<Answer> {
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

afterEach(() => { vi.useRealTimers(); });

// ─────────────────────────────── who may ask ───────────────────────────────

describe('POST /api/ai: who may ask (SCAN-5; AI.md §2)', () => {
  it('SCAN-5: another origin is refused (403) and nothing is counted or read', async () => {
    const db = rpc();
    const AI = ai(replyFile('scan-good'));
    const res = await handleAi()(request(SCAN, { origin: 'https://evil.example' }), env(AI), db.impl);
    expect(res.status).toBe(403);
    expect(db.calls).toHaveLength(0);
    expect(AI.run).not.toHaveBeenCalled();
  });

  it('SCAN-5: no sign-in token is 401, with nothing counted or read', async () => {
    const db = rpc();
    const AI = ai(replyFile('scan-good'));
    const res = await handleAi()(request(SCAN, { token: null }), env(AI), db.impl);
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
    expect(AI.run).not.toHaveBeenCalled();
  });

  it('SCAN-5: a token the database doesn’t accept (the RPC answers 401) is 401, and nothing is read', async () => {
    const db = rpc({ status: 401 });
    const AI = ai(replyFile('scan-good'));
    const res = await handleAi()(request(SCAN), env(AI), db.impl);
    expect(res.status).toBe(401);
    expect(AI.run).not.toHaveBeenCalled();
  });

  it('SCAN-5: an unknown task or a body that isn’t JSON is 400', async () => {
    const AI = ai(replyFile('scan-good'));
    expect((await handleAi()(request({ task: 'ask', question: 'how much?' }), env(AI), rpc().impl)).status).toBe(400);
    expect((await handleAi()(request('{"task": "scan", '), env(AI), rpc().impl)).status).toBe(400);
    expect(AI.run).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── counting ───────────────────────────────

describe('POST /api/ai: one count per call, daily caps (SCAN-5; AI.md §2, §4 "Daily limit reached")', () => {
  it('SCAN-1: each call is counted once through increment_ai_usage, as the caller', async () => {
    const db = rpc({ count: 1 });
    const res = await handleAi()(request(SCAN), env(ai(replyFile('scan-good'))), db.impl);
    await answer(res);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.url).toBe(`${SUPABASE}/rest/v1/rpc/increment_ai_usage`);
    expect(db.calls[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(db.calls[0]?.apikey).toBe(ANON);
    expect(db.calls[0]?.body).toEqual({ p_kind: 'scan' });
  });

  it('SCAN-5: the 30th scan of the day is read; the 31st is "limit" and Workers AI isn’t asked', async () => {
    const AI = ai(replyFile('scan-good'));
    expect((await answer(await handleAi()(request(SCAN), env(AI), rpc({ count: 30 }).impl))).ok).toBe(true);
    AI.run.mockClear();
    expect(await answer(await handleAi()(request(SCAN), env(AI), rpc({ count: 31 }).impl))).toEqual({ ok: false, reason: 'limit' });
    expect(AI.run).not.toHaveBeenCalled();
  });

  it('ADD-9 CAT-2: parse and categorise stop after 100 a day', async () => {
    const AI = ai({ response: '{"category":"Household"}' });
    expect(await answer(await handleAi()(request(PARSE), env(AI), rpc({ count: 101 }).impl))).toEqual({ ok: false, reason: 'limit' });
    expect(await answer(await handleAi()(request(CATEGORISE), env(AI), rpc({ count: 101 }).impl))).toEqual({ ok: false, reason: 'limit' });
    expect((await answer(await handleAi()(request(CATEGORISE), env(AI), rpc({ count: 100 }).impl))).ok).toBe(true);
  });

  it('SCAN-5: the count failing for any other reason is "error", and nothing is read', async () => {
    const AI = ai(replyFile('scan-good'));
    expect(await answer(await handleAi()(request(SCAN), env(AI), rpc({ status: 500 }).impl))).toEqual({ ok: false, reason: 'error' });
    expect(AI.run).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── AI.md §4, every row ───────────────────────────────

describe('POST /api/ai: what comes back (AI.md §4; SCAN-1, SCAN-5, TXT-5, ADD-9, CAT-2)', () => {
  it('SCAN-5: smart features off on the server (no AI binding) answers "off"', async () => {
    expect(await answer(await handleAi()(request(SCAN), env(undefined), rpc().impl))).toEqual({ ok: false, reason: 'off' });
  });

  it('SCAN-1: a good scan answers {ok: true, data} with the validated reply, from the first scan model, given the photo as a data URL', async () => {
    const AI = ai(replyFile('scan-good'));
    const a = await answer(await handleAi()(request(SCAN), env(AI), rpc().impl));
    expect(a).toEqual({
      ok: true,
      data: {
        merchant: 'Tesco Express', date: '2026-11-12', currency: 'GBP', total_pence: 1399,
        items: [{ label: 'Milk', pence: 120 }, { label: 'Sourdough', pence: 250 }, { label: 'Bananas', pence: 95 }, { label: 'Washing-up liquid', pence: 135 }, { label: 'Red wine', pence: 899 }],
        discount_pence: 100, service_pence: 0, category: 'Groceries', confidence: 'high',
      },
    });
    expect(AI.run.mock.calls[0]?.[0]).toBe(SCAN_MODELS[0]);
    const sent = JSON.stringify(AI.run.mock.calls[0]?.[1]);
    expect(sent).toContain(`data:image/jpeg;base64,${IMAGE}`);
    // Least data: the sign-in token and the anon key never reach the model.
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain(ANON);
  });

  it('TXT-5: a Japanese receipt in the OpenAI shape with fences comes back as printed', async () => {
    const a = await answer(await handleAi()(request(SCAN), env(ai(replyFile('scan-japanese'))), rpc().impl));
    expect(a.ok && a.data.merchant).toBe('ローソン 京都四条店');
  });

  it('SCAN-1: a model that fails is skipped: the next scan model answers', async () => {
    const AI = aiBy((model) => (model === SCAN_MODELS[0] ? { throws: 'AiError: 3040: Capacity temporarily exceeded' } : { reply: replyFile('scan-good') }));
    const a = await answer(await handleAi()(request(SCAN), env(AI), rpc().impl));
    expect(a.ok).toBe(true);
    expect(AI.run.mock.calls.map((c) => c[0]).slice(0, 2)).toEqual(SCAN_MODELS.slice(0, 2));
  });

  it('SCAN-5: Workers AI’s daily free allocation used up (4006) is "limit"', async () => {
    const AI = aiThrows('AiError: 4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare\'s Workers Paid plan if you would like to continue usage.');
    expect(await answer(await handleAi()(request(SCAN), env(AI), rpc().impl))).toEqual({ ok: false, reason: 'limit' });
  });

  it('SCAN-5: every model failing is "error"', async () => {
    const AI = aiThrows('AiError: 3040: Capacity temporarily exceeded');
    expect(await answer(await handleAi()(request(SCAN), env(AI), rpc().impl))).toEqual({ ok: false, reason: 'error' });
  });

  it('SCAN-5: no answer within 25 s in all is "timeout"', async () => {
    vi.useFakeTimers();
    const pending = handleAi()(request(SCAN), env(ai('never')), rpc().impl);
    await vi.advanceTimersByTimeAsync(25_001);
    expect(await answer(await pending)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('CAT-2: a categorise with no answer within 8 s is "timeout"', async () => {
    vi.useFakeTimers();
    const pending = handleAi()(request(CATEGORISE), env(ai('never')), rpc().impl);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await answer(await pending)).toEqual({ ok: false, reason: 'timeout' });
  });

  for (const name of ['scan-wrong-types', 'scan-extra-fields', 'scan-truncated']) {
    it(`SCAN-5: an invalid reply from every model (${name}) is "invalid"`, async () => {
      expect(await answer(await handleAi()(request(SCAN), env(ai(replyFile(name))), rpc().impl))).toEqual({ ok: false, reason: 'invalid' });
    });
  }

  it('SCAN-5: a reply in no shape Workers AI uses is "invalid" (or "error"), never ok', async () => {
    const a = await answer(await handleAi()(request(SCAN), env(ai(replyFile('not-a-reply'))), rpc().impl));
    expect(a.ok).toBe(false);
    expect(['invalid', 'error']).toContain(!a.ok ? a.reason : '');
  });

  it('ADD-9: a parse answers the validated reading, people as A and B', async () => {
    const a = await answer(await handleAi()(request(PARSE), env(ai(replyFile('parse-good'))), rpc().impl));
    expect(a).toEqual({ ok: true, data: { amount_pence: 4200, description: 'Dishoom', category: 'Eating out', payer: 'B', split: null, date: '2026-11-13', tags: [], chapter: null } });
  });

  it('CAT-2: a categorise answers {category}', async () => {
    const a = await answer(await handleAi()(request(CATEGORISE), env(ai(replyFile('categorise-good'))), rpc().impl));
    expect(a).toEqual({ ok: true, data: { category: 'Household' } });
  });
});
