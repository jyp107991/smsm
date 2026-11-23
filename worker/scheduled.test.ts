/**
 * S9 (OPEN_ITEMS, "Keep-alive stops if the repo goes quiet"): a second keep-alive that does not depend on GitHub.
 * A Cron Trigger on the app's own Worker (wrangler.jsonc `triggers.crons`, once a day) calls the same public
 * `health()` RPC the GitHub keep-alive and the smoke test call, with the publishable key the Worker already has
 * (SUPABASE_ANON_KEY): no new secret. Written before the handler.
 *
 * Interface these tests expect, exported from worker/index.ts:
 *   keepAlive(env: AiEnv, fetchImpl?: typeof fetch, log?: (line: string) => void): Promise<'ok' | 'failed' | 'off'>
 *   default.scheduled(controller, env, ctx): Promise<void>   (Cloudflare's module-syntax scheduled handler)
 * It POSTs `${SUPABASE_URL}/rest/v1/rpc/health` with `apikey` and `{}`; it never throws (a failed or missing
 * database is logged as one plain line and the next day tries again); no line it logs holds the key or the URL.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Outcome = 'ok' | 'failed' | 'off';
interface Env { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string }
type KeepAlive = (env: Env, fetchImpl?: typeof fetch, log?: (line: string) => void) => Promise<Outcome>;
interface Worker {
  scheduled?: (controller: { cron: string; scheduledTime: number; type: 'scheduled' }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => Promise<void>;
}

const INDEX = './index';
const loaded = (await import(/* @vite-ignore */ INDEX).catch(() => null)) as { keepAlive?: KeepAlive; default?: Worker } | null;
function keepAlive(): KeepAlive {
  if (typeof loaded?.keepAlive !== 'function') throw new Error('worker/index.ts does not export keepAlive yet');
  return loaded.keepAlive;
}

const SUPABASE = 'https://test-project.supabase.co';
const ANON = 'sb_publishable_test-key-0123456789';
const ENV: Env = { SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: ANON };
const healthy = () => new Response(JSON.stringify({ ok: true, push: true }), { status: 200, headers: { 'content-type': 'application/json' } });

interface Call { url: string; init: RequestInit | undefined }
function fakeFetch(answer: (n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return Promise.resolve(answer(calls.length));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}
const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('keep-alive Cron Trigger', () => {
  it('POSTs health() at the project with the publishable key and an empty body, and reads ok', async () => {
    const f = fakeFetch(healthy);
    const lines: string[] = [];
    await expect(keepAlive()(ENV, f.impl, (l) => lines.push(l))).resolves.toBe('ok');
    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call?.url).toBe(`${SUPABASE}/rest/v1/rpc/health`);
    expect(call?.init?.method).toBe('POST');
    expect(headerOf(call?.init, 'apikey')).toBe(ANON);
    expect(headerOf(call?.init, 'content-type')).toBe('application/json');
    expect(call?.init?.body).toBe('{}');
    // Never a user's token: the key is public, and nothing here acts as anyone.
    expect(headerOf(call?.init, 'authorization')).toBeNull();
    expect(lines).toHaveLength(1);
  });

  it('a trailing slash on the URL still calls one clean address', async () => {
    const f = fakeFetch(healthy);
    await keepAlive()({ ...ENV, SUPABASE_URL: `${SUPABASE}/` }, f.impl, () => undefined);
    expect(f.calls[0]?.url).toBe(`${SUPABASE}/rest/v1/rpc/health`);
  });

  it('tolerates failure: an error status, a thrown fetch or a reply that is not ok never throw, and try once more', async () => {
    for (const answer of [
      () => new Response('paused', { status: 503 }),
      () => Promise.reject(new Error(`connect ECONNREFUSED ${SUPABASE} apikey=${ANON}`)),
      () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
      () => new Response('not json', { status: 200 }),
    ]) {
      const f = fakeFetch(answer);
      const lines: string[] = [];
      await expect(keepAlive()(ENV, f.impl, (l) => lines.push(l))).resolves.toBe('failed');
      expect(f.calls).toHaveLength(2);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('a second try that answers is ok', async () => {
    const f = fakeFetch((n) => (n === 1 ? new Response('busy', { status: 502 }) : healthy()));
    await expect(keepAlive()(ENV, f.impl, () => undefined)).resolves.toBe('ok');
    expect(f.calls).toHaveLength(2);
  });

  it('without the deploy vars it calls nothing and says so', async () => {
    for (const env of [{}, { SUPABASE_URL: SUPABASE }, { SUPABASE_ANON_KEY: ANON }]) {
      const f = fakeFetch(healthy);
      const lines: string[] = [];
      await expect(keepAlive()(env, f.impl, (l) => lines.push(l))).resolves.toBe('off');
      expect(f.calls).toHaveLength(0);
      expect(lines).toHaveLength(1);
    }
  });

  it('logs nothing secret: no line holds the key, the project address or an error’s own words', async () => {
    const lines: string[] = [];
    for (const answer of [
      healthy,
      () => new Response(`bad key ${ANON}`, { status: 401 }),
      () => Promise.reject(new Error(`failed ${SUPABASE}/rest/v1/rpc/health?apikey=${ANON}`)),
    ]) {
      await keepAlive()(ENV, fakeFetch(answer).impl, (l) => lines.push(l));
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).not.toContain(ANON);
      expect(l).not.toContain('test-project');
      expect(l).not.toContain('supabase.co');
      expect(l).not.toMatch(/apikey|ECONN/i);
    }
  });

  it('the Worker\'s scheduled handler runs it with the global fetch and the console only, and never throws', async () => {
    const worker = loaded?.default;
    if (typeof worker?.scheduled !== 'function') throw new Error('worker/index.ts has no scheduled handler yet');
    const f = fakeFetch(() => new Response('down', { status: 500 }));
    vi.stubGlobal('fetch', f.impl);
    const said: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { said.push(args.map(String).join(' ')); });
    }
    const waits: Promise<unknown>[] = [];
    await expect(worker.scheduled({ cron: '37 5 * * *', scheduledTime: Date.UTC(2026, 10, 23, 5, 37), type: 'scheduled' }, ENV, { waitUntil: (p) => { waits.push(p); } })).resolves.toBeUndefined();
    await Promise.all(waits);
    expect(f.calls.map((c) => c.url)).toEqual([`${SUPABASE}/rest/v1/rpc/health`, `${SUPABASE}/rest/v1/rpc/health`]);
    expect(said.length).toBeGreaterThan(0);
    for (const l of said) { expect(l).not.toContain(ANON); expect(l).not.toContain(SUPABASE); }
  });

  it('wrangler.jsonc schedules it once a day at an odd minute, and the demo Worker has no schedule', () => {
    const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');
    const app = JSON.parse(strip(readFileSync('wrangler.jsonc', 'utf8'))) as { triggers?: { crons?: string[] } };
    const crons = app.triggers?.crons ?? [];
    expect(crons).toHaveLength(1);
    const [min, hour, dom, mon, dow] = (crons[0] ?? '').split(' ');
    expect(Number(min) % 2).toBe(1);
    expect(Number(hour)).toBeGreaterThanOrEqual(0);
    expect(Number(hour)).toBeLessThan(24);
    expect([dom, mon, dow]).toEqual(['*', '*', '*']);
    const demo = JSON.parse(strip(readFileSync('wrangler.demo.jsonc', 'utf8'))) as { triggers?: unknown };
    expect(demo.triggers).toBeUndefined();
  });
});
