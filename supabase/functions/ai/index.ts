/**
 * The `ai` Edge Function (S6a; docs/AI.md §2). One task per call: the caller must be signed in and in a household;
 * the household's daily cap is counted first (increment_ai_usage); Gemini is asked with a JSON schema and a timeout;
 * the reply is validated. Always answers 200 with `{ok: true, data}` or `{ok: false, reason}`, so the phone falls
 * back quietly. No prompts, images or replies are logged; only the count per task per day.
 */
import { withSupabase } from 'npm:@supabase/server@1';
import { buildRequest, capFor, ENDPOINT, readReply, timeoutFor, type Outcome, type Task, type TaskInput } from './core.ts';

const TASKS: readonly Task[] = ['scan', 'parse', 'categorise'];
const MAX_IMAGE_CHARS = 2_800_000; // a 1280 px JPEG as base64 is far below this

function answer(body: Outcome<unknown>): Response {
  return Response.json(body);
}

function inputFrom(body: Record<string, unknown>): TaskInput | null {
  const strings = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]).slice(0, 100) : null);
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
      const chapters = strings(body.chapters) ?? [];
      return t && today ? { task: 'parse', text: t, categories, chapters, today } : null;
    }
    case 'categorise': {
      const d = text(body.description, 200);
      return d ? { task: 'categorise', description: d, categories } : null;
    }
    default:
      return null;
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return answer({ ok: false, reason: 'off' });
    let body: Record<string, unknown>;
    try { body = await req.json() as Record<string, unknown>; } catch { return answer({ ok: false, reason: 'invalid' }); }
    const task = TASKS.find((t) => t === body.task);
    const input = inputFrom(body);
    if (!task || !input) return answer({ ok: false, reason: 'invalid' });

    // The cap is the household's, counted before asking (a refused call counts too, so a loop can't run on).
    const counted = await ctx.supabase.rpc('increment_ai_usage', { p_kind: task });
    if (counted.error || typeof counted.data !== 'number') return answer({ ok: false, reason: 'error' });
    if (counted.data > capFor(task)) return answer({ ok: false, reason: 'limit' });

    const model = (task === 'scan' ? Deno.env.get('GEMINI_MODEL_SCAN') : undefined) ?? Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite';
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildRequest(input, model)),
        signal: AbortSignal.timeout(timeoutFor(task)),
      });
      if (res.status === 429) return answer({ ok: false, reason: 'limit' });
      if (!res.ok) return answer({ ok: false, reason: 'error' });
      return answer(readReply(task, await res.json()));
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      return answer({ ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error' });
    }
  }),
};
