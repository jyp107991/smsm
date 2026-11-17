/**
 * smsm's Worker (S6a). Every path is the static app (wrangler.jsonc: the Worker runs first only for /api/*), except
 * POST /api/ai: the smart features, on Cloudflare Workers AI through the `AI` binding. No key anywhere; the account's
 * free daily allowance (10,000 Neurons), and on the Workers Free plan use past it fails instead of being billed
 * (owner, 17 Nov: "use free ones that macropy is using that dont require api key/new secret").
 *
 * The caller must be signed in: the household's daily count goes through the `increment_ai_usage` RPC with the
 * caller's own token, which also proves who they are and that they are in a household. Only the app's own origin may
 * call. Always 200 with `{ok: true, data}` or `{ok: false, reason}` once signed in, so the phone falls back quietly.
 * Nothing about the request or the reply is logged.
 */
import { buildRequest, capFor, isDailyLimit, MODELS, readReply, timeoutFor, type Outcome, type Task, type TaskInput } from './ai-core';

export interface AiBinding { run(model: string, input: Record<string, unknown>): Promise<unknown> }
export interface Env {
  AI: AiBinding;
  ASSETS: { fetch(req: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
}

const TASKS: readonly Task[] = ['scan', 'parse', 'categorise'];
const MAX_IMAGE_CHARS = 2_800_000; // a 1280 px JPEG as base64 is far below this

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function inputFrom(body: Record<string, unknown>): TaskInput | null {
  const strings = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? v.slice(0, 100) : null);
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  const categories = strings(body.categories);
  if (!categories) return null;
  switch (body.task) {
    case 'scan': {
      const image = text(body.image, MAX_IMAGE_CHARS);
      const today = text(body.today, 10);
      if (!image || !today || body.mimeType !== 'image/jpeg') return null;
      return { task: 'scan', image, mimeType: 'image/jpeg', categories, today, homeCountry: text(body.homeCountry, 2) ?? 'GB' };
    }
    case 'parse': {
      const t = text(body.text, 300);
      const today = text(body.today, 10);
      return t && today ? { task: 'parse', text: t, categories, chapters: strings(body.chapters) ?? [], today } : null;
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
async function ask(env: Env, model: string, request: Record<string, unknown>, ms: number): Promise<{ reply: unknown } | { error: string }> {
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

export async function handleAi(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // Only the app itself may use the allowance: browsers always send Origin on a POST.
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'forbidden' }, 403);
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth) || !env.SUPABASE_URL || !env.SUPABASE_KEY) return json({ error: 'sign in' }, 401);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ ok: false, reason: 'invalid' } satisfies Outcome<never>); }
  const task = TASKS.find((t) => t === body.task);
  const input = inputFrom(body);
  if (!task || !input) return json({ ok: false, reason: 'invalid' } satisfies Outcome<never>);

  // The household's count for today, as the caller (a refused call counts too, so a loop can't run on).
  const counted = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/increment_ai_usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_KEY, authorization: auth },
    body: JSON.stringify({ p_kind: task }),
  }).catch(() => null);
  if (!counted) return json({ ok: false, reason: 'error' } satisfies Outcome<never>);
  if (counted.status === 401 || counted.status === 403) return json({ error: 'sign in' }, 401);
  const calls: unknown = counted.ok ? await counted.json().catch(() => null) : null;
  if (typeof calls !== 'number') return json({ ok: false, reason: 'error' } satisfies Outcome<never>);
  if (calls > capFor(task)) return json({ ok: false, reason: 'limit' } satisfies Outcome<never>);

  const deadline = Date.now() + timeoutFor(task);
  let reason: Outcome<never> = { ok: false, reason: 'error' };
  for (const model of MODELS[task]) {
    const left = deadline - Date.now();
    if (left <= 0) return json({ ok: false, reason: 'timeout' } satisfies Outcome<never>);
    const got = await ask(env, model, buildRequest(input, model), left);
    if ('error' in got) {
      if (isDailyLimit(got.error)) return json({ ok: false, reason: 'limit' } satisfies Outcome<never>);
      reason = { ok: false, reason: got.error === 'timeout' ? 'timeout' : 'error' };
      continue;
    }
    const read = readReply(task, got.reply);
    if (read.ok) return json(read);
    reason = read;
  }
  return json(reason);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === '/api/ai') return handleAi(req, env);
    return env.ASSETS.fetch(req);
  },
};
