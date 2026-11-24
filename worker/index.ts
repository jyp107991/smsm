/**
 * smsm's Worker (S6a). Every path is the static app (wrangler.jsonc: the Worker runs first only for /api/*), except
 * POST /api/ai: the smart features, on Cloudflare Workers AI through the `AI` binding. No key anywhere; the account's
 * free daily allowance (10,000 Neurons), and on the Workers Free plan use past it fails instead of being billed
 * (owner, 17 Nov: "use free ones that macropy is using that dont require api key/new secret").
 *
 * The caller must be signed in: the household's daily count goes through the `increment_ai_usage` RPC with the
 * caller's own token, which also proves who they are and that they are in a household. Only the app's own origin may
 * call. Always 200 with `{ok: true, data}` or `{ok: false, reason}` once signed in, so the phone falls back quietly.
 * Nothing about the request or the reply is logged; a retired model is logged by name only.
 */
import { buildRequest, capFor, recapStatsSchema, isDailyLimit, isRetired, MODELS, readReply, timeoutFor, type Outcome, type Task, type TaskInput } from './ai-core';

export interface AiBinding { run(model: string, input: Record<string, unknown>): Promise<unknown> }
/** What the AI route needs: the binding, Supabase's URL and public key (deploy vars), the app's own origin. */
export interface AiEnv {
  AI?: AiBinding;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** Defaults to the Worker's own origin. */
  APP_ORIGIN?: string;
}
export interface Env extends AiEnv { ASSETS: { fetch(req: Request): Promise<Response> } }

const TASKS: readonly Task[] = ['scan', 'parse', 'categorise', 'recap', 'ask'];
const MAX_IMAGE_CHARS = 2_800_000; // a 1280 px JPEG as base64 is far below this
const MAX_BODY_BYTES = 3_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function inputFrom(body: Record<string, unknown>): TaskInput | null {
  // Names only, each short: a household's categories or chapters, never a way to send a long prompt.
  const strings = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length <= 80) ? v.slice(0, 100) : null);
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  // S6b: the recap carries only the month's figures (exactly their keys: a stray field, such as names, is refused).
  if (body.task === 'recap') {
    const stats = recapStatsSchema.safeParse(body.stats);
    return stats.success ? { task: 'recap', stats: stats.data } : null;
  }
  const categories = strings(body.categories);
  if (!categories) return null;
  switch (body.task) {
    case 'scan': {
      const image = text(body.image, MAX_IMAGE_CHARS);
      const today = text(body.today, 10);
      if (!image || !today) return null;
      return { task: 'scan', image, categories, today, country: text(body.country, 2) ?? 'GB' };
    }
    case 'parse': {
      const t = text(body.text, 300);
      const today = text(body.today, 10);
      return t && today ? { task: 'parse', text: t, categories, chapters: strings(body.chapters) ?? [], today } : null;
    }
    case 'ask': {
      const question = text(body.question, 300);
      const today = text(body.today, 10);
      const countries = Array.isArray(body.countries) && body.countries.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) ? (body.countries as string[]).slice(0, 250) : null;
      return question && today && countries ? { task: 'ask', question, categories, chapters: strings(body.chapters) ?? [], countries, today } : null;
    }
    case 'categorise': {
      const d = text(body.description, 200);
      return d ? { task: 'categorise', description: d, categories } : null;
    }
    default:
      return null;
  }
}

/** One model's answer, or why not, within `ms`. */
async function ask(env: Required<Pick<AiEnv, 'AI'>>, model: string, request: Record<string, unknown>, ms: number): Promise<{ reply: unknown } | { error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ error: string }>((resolve) => { timer = setTimeout(() => { resolve({ error: 'timeout' }); }, ms); });
  try {
    return await Promise.race([env.AI.run(model, request).then((reply) => ({ reply })), late]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `log` takes one plain line, only for a retired model (its name and that it was skipped): never the request, the
 * reply, the error's own words or anything about the caller.
 */
export async function handleAi(req: Request, env: AiEnv, fetchImpl: typeof fetch = fetch, log: (line: string) => void = (line) => { console.log(line); }): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // Only the app itself may use the allowance: browsers always send Origin on a POST.
  if (req.headers.get('origin') !== (env.APP_ORIGIN ?? new URL(req.url).origin)) return json({ error: 'forbidden' }, 403);
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return json({ error: 'sign in' }, 401);
  // A shrunk receipt is well under a megabyte; nothing bigger is read.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'bad request' }, 400);
  let parsed: unknown;
  try { parsed = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return json({ error: 'bad request' }, 400);
  const body = parsed as Record<string, unknown>;
  const task = TASKS.find((t) => t === body.task);
  const input = inputFrom(body);
  if (!task || !input) return json({ error: 'bad request' }, 400);
  const ai = env.AI;
  if (!ai || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ ok: false, reason: 'off' } satisfies Outcome<never>);

  // The household's count for today, as the caller (a refused call counts too, so a loop can't run on).
  const counted = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/increment_ai_usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_ANON_KEY, authorization: auth },
    body: JSON.stringify({ p_kind: task }),
  }).catch(() => null);
  if (counted?.status === 401) return json({ error: 'sign in' }, 401);
  const calls: unknown = counted?.ok ? await counted.json().catch(() => null) : null;
  if (typeof calls !== 'number') return json({ ok: false, reason: 'error' } satisfies Outcome<never>);
  if (calls > capFor(task)) return json({ ok: false, reason: 'limit' } satisfies Outcome<never>);

  const deadline = Date.now() + timeoutFor(task);
  let threw = 0;
  let invalid = 0;
  const models = MODELS[task];
  for (const [i, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left <= 0) return json({ ok: false, reason: 'timeout' } satisfies Outcome<never>);
    // Each model gets its share of what is left, so a slow one hands over to the next instead of using it all.
    const share = i === models.length - 1 ? left : Math.ceil(left / (models.length - i));
    const got = await ask({ AI: ai }, model, buildRequest(input, model), share);
    if ('error' in got) {
      // A retired model (HTTP 410) is skipped like any failure; the person only ever sees the usual fallback.
      if (isRetired(got.error)) {
        log(`ai: ${model} is retired (HTTP 410); asked the next model for ${task}. Update MODELS in worker/ai-core.ts.`);
        threw += 1;
        continue;
      }
      if (isDailyLimit(got.error)) return json({ ok: false, reason: 'limit' } satisfies Outcome<never>);
      if (got.error === 'timeout') {
        if (i === models.length - 1) return json({ ok: false, reason: 'timeout' } satisfies Outcome<never>);
        continue;
      }
      threw += 1;
      continue;
    }
    const read = readReply(task, got.reply);
    if (read.ok) return json(read);
    invalid += 1;
  }
  return json({ ok: false, reason: invalid > 0 ? 'invalid' : threw > 0 ? 'error' : 'timeout' } satisfies Outcome<never>);
}

// ───────── S9: the second keep-alive (wrangler.jsonc `triggers.crons`, once a day) ─────────

const KEEPALIVE_TIMEOUT_MS = 15_000;

/**
 * A free Supabase project pauses after 7 days without activity. Once a day the Worker calls the same public
 * `health()` RPC as the GitHub keep-alive (.github/workflows/keepalive.yml) and the smoke test, with the publishable
 * key it already has: no new secret, and it keeps the project awake even if GitHub stops running scheduled
 * workflows. It never throws (the next day tries again); it tries twice, each within 15 s. What it logs is one plain
 * line with the outcome and an HTTP status at most: never the key, the project's address or an error's own words.
 */
export async function keepAlive(
  env: Pick<AiEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => { console.log(line); },
): Promise<'ok' | 'failed' | 'off'> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    log('keep-alive: off (SUPABASE_URL or SUPABASE_ANON_KEY is not set on this Worker)');
    return 'off';
  }
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/health`;
  let why = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(KEEPALIVE_TIMEOUT_MS),
      });
      const body: unknown = res.ok ? await res.json().catch(() => null) : null;
      if (res.ok && typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true) {
        log(`keep-alive: ok${attempt > 1 ? ' (second try)' : ''}`);
        return 'ok';
      }
      why = res.ok ? 'health() did not say ok' : `HTTP ${String(res.status)}`;
    } catch (e) {
      why = e instanceof Error && e.name === 'TimeoutError' ? 'no answer within 15 s' : 'the request did not complete';
    }
  }
  log(`keep-alive: failed twice (${why}); tomorrow's run tries again`);
  return 'failed';
}

/** Cloudflare's scheduled() handler (module syntax): what a Cron Trigger passes. */
interface ScheduledController { readonly cron: string; readonly scheduledTime: number }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === '/api/ai') return handleAi(req, env);
    return env.ASSETS.fetch(req);
  },
  /** One cron (wrangler.jsonc): the keep-alive. The runtime waits for the returned promise. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await keepAlive(env);
  },
};
