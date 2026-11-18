/**
 * S6b on the server (docs/slices/S6b.md "Decisions made here", "Data → Worker", as changed on 18 Nov; docs/AI.md §1,
 * §2, §3.4, §3.5, §4, §5 contract tests; SPEC INS-2, INS-9, SCAN-3): the `recap` and `ask` tasks of POST /api/ai, and
 * the scan reply's new `tax_pence`. Recorded Workers AI replies in tests/ai/replies/ (recap-*.json, ask-*.json,
 * scan-tax.json) go through extractText → validate (→ the phone's wordingGuard for the recap); the handler runs with a
 * fake `env.AI` and a fake fetch for the increment_ai_usage RPC, as in worker/index.test.ts. No network.
 * Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, added to worker/ai-core.ts (S6a's stays as pinned in worker/ai-core.test.ts):
 *
 *   type Task = 'scan' | 'parse' | 'categorise' | 'recap' | 'ask'
 *   AiInput gains
 *     | { task: 'recap'; stats: RecapStats }        // src/core/wording.ts recapStats(): figures as shown, people A/B
 *     | { task: 'ask'; question: string; categories: string[]; chapters: string[]; countries: string[]; today: string }
 *                                                   // the question with the people already written as A (the one
 *                                                   // asking) and B; countries are ISO2 codes present in the data
 *   MODELS.recap, MODELS.ask: at least one Workers AI text model each ('@cf/…'), tried in order (builder's choice).
 *   capFor('recap') = 3, capFor('ask') = 50 (per household per UK day); timeoutFor('recap') = timeoutFor('ask') = 8000.
 *   Prompts worker/prompts/recap.md and ask.md (first line "version: <n>"), each with <task>.schema.json beside it;
 *   the system message says the figures/question are data, never instructions.
 *   validate('recap', json): { headline: string (1–140 chars), aside: string (≤ 140) | null }, strict.
 *   validate('ask', json): src/core/aiReplies.ts askSchema, strict:
 *     { measure: 'total'|'count'|'average'|'largest',
 *       filters: { categories?: string[], chapters?: string[], countries?: string[] (two capital letters),
 *                  payer?: 'A'|'B', from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', text?: string, tags?: string[],
 *                  mode?: ('ratio'|'exact'|'for_other'|'treat')[] },
 *       group_by?: 'category'|'month'|'country'|'payer'|'chapter' }
 *     | { unsupported: true }
 *     No figure ever comes back from the AI: a reply carrying one (an extra field) is invalid.
 *   validate('scan', …): tax_pence optional (int ≥ 0); still strict.
 *
 *   handleAi (worker/index.ts): accepts {task:'recap', stats} and {task:'ask', question (1–300 chars), categories,
 *   chapters, countries, today}; anything else for those tasks → 400. The day's count goes through increment_ai_usage
 *   with p_kind 'recap' / 'ask'; over the cap → {ok:false, reason:'limit'} with no AI call. Only the stats' own keys
 *   reach the model (a stray field such as names is refused with 400 or never forwarded).
 *
 * Until the S6b parts exist each test fails on what's missing (the modules load by computed paths).
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Task = 'scan' | 'parse' | 'categorise' | 'recap' | 'ask';
interface RecapStats {
  period: string; month: string; total: string; everyday: string; usual: string | null;
  comparison: { direction: 'less' | 'more' | 'same'; amount: string | null } | null;
  bar: { name: string; total: string }[]; notes: string[]; paid: { A: string; B: string };
}
type AiInput =
  | { task: 'recap'; stats: RecapStats }
  | { task: 'ask'; question: string; categories: string[]; chapters: string[]; countries: string[]; today: string };
interface AiRequest { messages: { role: string; content: unknown }[]; max_tokens: number }
type Validated = { ok: true; data: Record<string, unknown> } | { ok: false; reason: 'invalid' };
interface AiCore {
  MODELS: Record<Task, string[]>;
  capFor(task: Task): number;
  timeoutFor(task: Task): number;
  buildRequest(input: AiInput, model: string): AiRequest;
  extractText(reply: unknown): string | null;
  validate(task: Task, json: unknown): Validated;
}
interface WordingCore {
  wordingGuard(stats: RecapStats, reply: { headline: string; aside: string | null }, names: { A: string; B: string }): { headline: string; aside: string | null } | null;
}
interface AiEnv { AI?: { run(model: string, input: unknown): Promise<unknown> }; SUPABASE_URL: string; SUPABASE_ANON_KEY: string; APP_ORIGIN: string }
type HandleAi = (req: Request, env: AiEnv, fetchImpl?: typeof fetch) => Promise<Response>;
type Answer = { ok: true; data: Record<string, unknown> } | { ok: false; reason: 'off' | 'limit' | 'timeout' | 'invalid' | 'error' };

const CORE = './ai-core';
const INDEX = './index';
const WORDING = '../src/core/wording';
const loaded = (await import(/* @vite-ignore */ CORE).catch(() => null)) as Partial<AiCore> | null;
const loadedIndex = (await import(/* @vite-ignore */ INDEX).catch(() => null)) as { handleAi?: HandleAi } | null;
const loadedWording = (await import(/* @vite-ignore */ WORDING).catch(() => null)) as Partial<WordingCore> | null;
function core(): AiCore {
  const names = ['capFor', 'timeoutFor', 'buildRequest', 'extractText', 'validate'] as const;
  const missing: string[] = names.filter((n) => typeof loaded?.[n] !== 'function');
  if (!Array.isArray(loaded?.MODELS?.recap) || !Array.isArray(loaded.MODELS.ask)) missing.push('MODELS.recap/ask');
  if (!loaded || missing.length > 0) throw new Error(`worker/ai-core.ts does not have ${missing.join(', ')} yet (S6b)`);
  return loaded as AiCore;
}
function handleAi(): HandleAi {
  if (typeof loadedIndex?.handleAi !== 'function') throw new Error('worker/index.ts does not export handleAi');
  return loadedIndex.handleAi;
}
function guard(): WordingCore['wordingGuard'] {
  if (typeof loadedWording?.wordingGuard !== 'function') throw new Error('src/core/wording.ts does not export wordingGuard yet (S6b)');
  return loadedWording.wordingGuard;
}

const replyFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/ai/replies/${name}.json`, import.meta.url), 'utf8'));
const promptPath = (task: Task, ext: 'md' | 'schema.json') => new URL(`./prompts/${task}.${ext}`, import.meta.url);
const TODAY = '2026-11-17';
const CATEGORIES = ['Groceries', 'Eating out', 'Rent & bills', 'Travel', 'Other'];
const CHAPTERS = ['Japan', 'New sofa'];
/** src/core/wording.test.ts's October: £1,365.50 together, about £120 less than usual. */
const STATS: RecapStats = {
  period: '2026-10', month: 'October', total: '£1,365.50', everyday: '£1,365.50', usual: '£1,485.00',
  comparison: { direction: 'less', amount: '£120' },
  bar: [{ name: 'Rent & bills', total: '£1,000.00' }, { name: 'Groceries', total: '£240.50' }, { name: 'Eating out', total: '£125.00' }],
  notes: ['Eating out is £85 over its usual (£210 so far, usually £125)'],
  paid: { A: '£1,000.00', B: '£365.50' },
};
const RECAP: AiInput = { task: 'recap', stats: STATS };
const ASK: AiInput = { task: 'ask', question: 'how much did we spend on eating out in japan?', categories: CATEGORIES, chapters: CHAPTERS, countries: ['GB', 'JP'], today: TODAY };
const WHO = { A: 'Jae', B: 'Sam' };

const read = (task: Task, name: string) => core().validate(task, core().extractText(replyFile(name)));
const userText = (req: AiRequest): string => {
  const c = req.messages[1]?.content;
  return typeof c === 'string' ? c : JSON.stringify(c ?? '');
};

// ─────────────────────────────── models, caps, time ───────────────────────────────

describe('recap and ask: models, caps and time (INS-2, INS-9; AI.md §2)', () => {
  it('INS-2 INS-9: each has at least one Workers AI model, tried in order', () => {
    for (const task of ['recap', 'ask'] as const) {
      const models = core().MODELS[task];
      expect(models.length, task).toBeGreaterThanOrEqual(1);
      for (const m of models) expect(m).toMatch(/^@cf\//);
    }
  });

  it('INS-2 INS-9: daily caps per household: recap 3, ask 50; S6a’s are unchanged', () => {
    expect([core().capFor('recap'), core().capFor('ask')]).toEqual([3, 50]);
    expect([core().capFor('scan'), core().capFor('parse'), core().capFor('categorise')]).toEqual([30, 100, 100]);
  });

  it('INS-2 INS-9: 8 s each', () => {
    expect([core().timeoutFor('recap'), core().timeoutFor('ask')]).toEqual([8000, 8000]);
  });
});

// ─────────────────────────────── prompts and requests ───────────────────────────────

describe('recap and ask: prompts and requests, least data (INS-2, INS-9; AI.md §1)', () => {
  for (const task of ['recap', 'ask'] as const) {
    it(`INS-2 INS-9: the ${task} prompt is a versioned file with its JSON Schema beside it`, () => {
      expect(existsSync(promptPath(task, 'md')), `worker/prompts/${task}.md`).toBe(true);
      expect(existsSync(promptPath(task, 'schema.json')), `worker/prompts/${task}.schema.json`).toBe(true);
      expect(readFileSync(promptPath(task, 'md'), 'utf8').split('\n')[0]).toMatch(/^version: \d+$/);
      const schema = readFileSync(promptPath(task, 'schema.json'), 'utf8');
      const want = task === 'recap' ? ['headline', 'aside'] : ['measure', 'filters', 'group_by', 'unsupported', 'categories', 'countries', 'payer'];
      for (const key of want) expect(schema, key).toContain(`"${key}"`);
    });
  }

  for (const input of [RECAP, ASK]) {
    it(`INS-2 INS-9: a ${input.task} request is the system prompt (data, never instructions), then the input`, () => {
      const req = core().buildRequest(input, core().MODELS[input.task][0] ?? '');
      expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
      const system = String(req.messages[0]?.content);
      const body = readFileSync(promptPath(input.task, 'md'), 'utf8').split('\n').slice(1).join('\n').trim();
      expect(system).toContain(body);
      expect(system).toMatch(/never\b[^.]*instructions|not\b[^.]*instructions/i);
      expect(Number.isSafeInteger(req.max_tokens) && req.max_tokens > 0).toBe(true);
    });
  }

  it('INS-2: a recap sends the month’s figures as shown, people only as A and B, and asks for no advice', () => {
    const req = core().buildRequest(RECAP, core().MODELS.recap[0] ?? '');
    const text = userText(req);
    for (const s of ['£1,365.50', '£1,485.00', '£120', 'Rent & bills', '£1,000.00', '£365.50', 'October', '2026-10']) expect(text, s).toContain(s);
    expect(String(req.messages[0]?.content)).toMatch(/advice/i);
    expect(String(req.messages[0]?.content)).toContain('140');
  });

  it('INS-9: an ask sends the question, the category and chapter names, the countries present and today', () => {
    const text = userText(core().buildRequest(ASK, core().MODELS.ask[0] ?? ''));
    expect(text).toContain('how much did we spend on eating out in japan?');
    for (const s of [...CATEGORIES, ...CHAPTERS, 'GB', 'JP', TODAY]) expect(text, s).toContain(s);
  });

  it('INS-2 INS-9: least data: nothing beyond the input (no names, ids, balances or tokens)', () => {
    for (const input of [RECAP, ASK]) {
      const req = core().buildRequest(input, 'm');
      const all = JSON.stringify(req);
      expect(all).not.toMatch(/household_id|user_id|Bearer|access_token|image_url|base64/i);
      // The system prompt may speak of balances (to say none are given); the person's data never carries one.
      expect(userText(req)).not.toMatch(/\bowes\b|balance|Jae|Sam|debtor|creditor/i);
    }
  });
});

// ─────────────────────────────── recorded replies ───────────────────────────────

describe('recap replies (INS-2; AI.md §3.4, §4, §5)', () => {
  it('INS-2: a good reply is valid, passes the guard, and the names go in on the phone', () => {
    const v = read('recap', 'recap-good');
    expect(v).toEqual({ ok: true, data: { headline: 'October came to £1,365.50 together, about £120 less than usual.', aside: 'Person A paid £1,000.00 of it, mostly Rent & bills.' } });
    if (!v.ok) return;
    expect(guard()(STATS, v.data as { headline: string; aside: string | null }, WHO)).toEqual({
      headline: 'October came to £1,365.50 together, about £120 less than usual.', aside: 'Jae paid £1,000.00 of it, mostly Rent & bills.',
    });
  });

  it('INS-2: an invented number is valid JSON but the guard refuses it: the template is used', () => {
    const v = read('recap', 'recap-invented-number');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(guard()(STATS, v.data as { headline: string; aside: string | null }, WHO)).toBeNull();
  });

  it('INS-2: advice is refused by the guard', () => {
    const v = read('recap', 'recap-advice');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(guard()(STATS, v.data as { headline: string; aside: string | null }, WHO)).toBeNull();
  });

  it('INS-2: more than 140 characters is invalid', () => {
    expect(read('recap', 'recap-too-long')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-2: wrong types are invalid', () => {
    expect(read('recap', 'recap-wrong-types')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-2: the shape is closed: a blank headline, a missing aside or an extra field is invalid; aside may be null', () => {
    expect(core().validate('recap', { headline: 'October came to £1,365.50 together.', aside: null }).ok).toBe(true);
    expect(core().validate('recap', { headline: '', aside: null }).ok).toBe(false);
    expect(core().validate('recap', { headline: 'October came to £1,365.50 together.' }).ok).toBe(false);
    expect(core().validate('recap', { headline: 'October came to £1,365.50 together.', aside: null, mood: 'warm' }).ok).toBe(false);
    expect(core().validate('recap', { unsupported: true }).ok).toBe(false);
  });
});

describe('ask replies (INS-9; AI.md §3.5, §4, §5)', () => {
  it('INS-9: a good reply (OpenAI shape, fenced) is a filter, never a figure', () => {
    expect(read('ask', 'ask-good')).toEqual({ ok: true, data: { measure: 'total', filters: { categories: ['Eating out'], countries: ['JP'] } } });
  });

  it('INS-9: a grouped reply with dates and a payer (the object shape)', () => {
    expect(read('ask', 'ask-grouped')).toEqual({ ok: true, data: { measure: 'count', filters: { from: '2026-01-01', to: '2026-10-31', payer: 'B' }, group_by: 'month' } });
  });

  it('INS-9: { unsupported: true } is a valid answer', () => {
    expect(read('ask', 'ask-unsupported')).toEqual({ ok: true, data: { unsupported: true } });
  });

  it('INS-9: wrong types (measure "sum", a category as a string, "last month" as a date) are invalid', () => {
    expect(read('ask', 'ask-wrong-types')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-9: a reply carrying its own figure is invalid: code computes, never the AI', () => {
    expect(read('ask', 'ask-invented-number')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-9: a person named instead of A or B is invalid', () => {
    expect(read('ask', 'ask-named-payer')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-9: the schema is closed', () => {
    const ok = (json: unknown) => core().validate('ask', json).ok;
    expect(ok({ measure: 'largest', filters: {} })).toBe(true);
    expect(ok({ measure: 'average', filters: { chapters: ['Japan'], text: 'ramen', tags: ['dinner'], mode: ['treat'] }, group_by: 'chapter' })).toBe(true);
    expect(ok({ measure: 'total' })).toBe(false);
    expect(ok({ measure: 'total', filters: {}, group_by: 'week' })).toBe(false);
    expect(ok({ measure: 'total', filters: { countries: ['Japan'] } })).toBe(false);
    expect(ok({ measure: 'total', filters: { mode: ['halves'] } })).toBe(false);
    expect(ok({ measure: 'total', filters: { from: '1 Oct' } })).toBe(false);
    expect(ok({ measure: 'total', filters: { where: 'Japan' } })).toBe(false);
    expect(ok({ unsupported: false })).toBe(false);
    expect(ok({ unsupported: true, measure: 'total', filters: {} })).toBe(false);
    expect(ok('not json')).toBe(false);
  });
});

describe('scan replies with tax (SCAN-3; S6b "Found while choosing them")', () => {
  it('SCAN-3: a CORD-style reply with tax_pence is valid, every field kept', () => {
    const v = read('scan', 'scan-tax');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.data).toMatchObject({ total_pence: 281435, service_pence: 17850, tax_pence: 25585, currency: 'IDR' });
  });

  it('SCAN-3: tax must be whole hundredths; an unknown field is still invalid', () => {
    const good = JSON.parse(core().extractText(replyFile('scan-tax')) ?? 'null') as Record<string, unknown>;
    expect(core().validate('scan', { ...good, tax_pence: 255.85 }).ok).toBe(false);
    expect(core().validate('scan', { ...good, vat_pence: 25585 }).ok).toBe(false);
  });
});

// ─────────────────────────────── the route ───────────────────────────────

const ORIGIN = 'https://smsm.example.workers.dev';
const SUPABASE = 'https://test-project.supabase.co';
const ANON = 'test-anon-key';
const TOKEN = 'test-access-token';

function request(body: unknown): Request {
  const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${TOKEN}` });
  return new Request(`${ORIGIN}/api/ai`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function rpc(count = 1) {
  const calls: unknown[] = [];
  const impl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null);
    return Promise.resolve(new Response(JSON.stringify(count), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
function ai(reply: unknown) {
  return {
    run: vi.fn<(model: string, input: unknown) => Promise<unknown>>(() => (reply === 'never' ? new Promise(() => { /* never answers */ }) : Promise.resolve(reply))),
  };
}
const env = (AI?: AiEnv['AI']): AiEnv => ({ ...(AI ? { AI } : {}), SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: ANON, APP_ORIGIN: ORIGIN });
async function answer(res: Response): Promise<Answer> {
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

afterEach(() => { vi.useRealTimers(); });

describe('POST /api/ai: recap and ask (INS-2, INS-9; AI.md §2, §4)', () => {
  it('INS-2: a recap is counted as "recap" and answers the validated wording', async () => {
    const db = rpc(1);
    const AI = ai(replyFile('recap-good'));
    const a = await answer(await handleAi()(request(RECAP), env(AI), db.impl));
    expect(a).toEqual({ ok: true, data: { headline: 'October came to £1,365.50 together, about £120 less than usual.', aside: 'Person A paid £1,000.00 of it, mostly Rent & bills.' } });
    expect(db.calls).toEqual([{ p_kind: 'recap' }]);
    expect(AI.run.mock.calls[0]?.[0]).toBe(core().MODELS.recap[0]);
    const sent = JSON.stringify(AI.run.mock.calls[0]?.[1]);
    expect(sent).toContain('£1,365.50');
    expect(sent).not.toContain(TOKEN);
  });

  it('INS-2: the third recap of the day is read; the fourth is "limit", with no AI call', async () => {
    const third = ai(replyFile('recap-good'));
    expect((await answer(await handleAi()(request(RECAP), env(third), rpc(3).impl))).ok).toBe(true);
    const fourth = ai(replyFile('recap-good'));
    expect(await answer(await handleAi()(request(RECAP), env(fourth), rpc(4).impl))).toEqual({ ok: false, reason: 'limit' });
    expect(fourth.run).not.toHaveBeenCalled();
  });

  it('INS-9: an ask is counted as "ask"; the 50th of the day is read, the 51st is "limit"', async () => {
    const db = rpc(50);
    const AI = ai(replyFile('ask-good'));
    expect(await answer(await handleAi()(request(ASK), env(AI), db.impl))).toEqual({ ok: true, data: { measure: 'total', filters: { categories: ['Eating out'], countries: ['JP'] } } });
    expect(db.calls).toEqual([{ p_kind: 'ask' }]);
    const over = ai(replyFile('ask-good'));
    expect(await answer(await handleAi()(request(ASK), env(over), rpc(51).impl))).toEqual({ ok: false, reason: 'limit' });
    expect(over.run).not.toHaveBeenCalled();
  });

  it('INS-9: { unsupported: true } comes back as an answer', async () => {
    expect(await answer(await handleAi()(request(ASK), env(ai(replyFile('ask-unsupported'))), rpc().impl))).toEqual({ ok: true, data: { unsupported: true } });
  });

  it('INS-2 INS-9: invalid replies are "invalid"', async () => {
    expect(await answer(await handleAi()(request(RECAP), env(ai(replyFile('recap-wrong-types'))), rpc().impl))).toEqual({ ok: false, reason: 'invalid' });
    expect(await answer(await handleAi()(request(ASK), env(ai(replyFile('ask-invented-number'))), rpc().impl))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('INS-2: no answer within 8 s is "timeout"', async () => {
    vi.useFakeTimers();
    const pending = handleAi()(request(RECAP), env(ai('never')), rpc().impl);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await answer(await pending)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('INS-9: an ask with no answer within 8 s is "timeout"', async () => {
    vi.useFakeTimers();
    const pending = handleAi()(request(ASK), env(ai('never')), rpc().impl);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await answer(await pending)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('INS-2 INS-9: a malformed request is 400, with nothing counted', async () => {
    for (const body of [
      { task: 'recap' }, { task: 'recap', stats: 'October' },
      { task: 'ask', categories: CATEGORIES, chapters: [], countries: [], today: TODAY },
      { ...ASK, question: '' }, { ...ASK, question: 'x'.repeat(301) },
    ]) {
      const db = rpc();
      const res = await handleAi()(request(body), env(ai(replyFile('ask-good'))), db.impl);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(db.calls).toEqual([]);
    }
  });

  it('INS-2: only the stats’ own figures reach the model: a stray field (names) is refused or dropped', async () => {
    const AI = ai(replyFile('recap-good'));
    const res = await handleAi()(request({ task: 'recap', stats: { ...STATS, names: { A: 'Jae', B: 'Sam' }, balance: 'Sam owes Jae £530.00' } }), env(AI), rpc().impl);
    if (res.status === 400) return;
    expect(res.status).toBe(200);
    const sent = JSON.stringify(AI.run.mock.calls.map((c) => c[1]));
    expect(sent).not.toMatch(/Jae|Sam|owes|£530/);
  });
});
