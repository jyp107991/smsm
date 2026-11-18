/**
 * The push Edge Function (S8): served by Deno on Supabase, with its database reached as service_role through the
 * function's own secret key (Supabase gives every function SUPABASE_URL and SUPABASE_SECRET_KEYS, or the legacy
 * SUPABASE_SERVICE_ROLE_KEY). Deployed with verify_jwt off (supabase/config.toml [functions.push]): the database
 * calls it with its own token, which handler.ts checks. The work itself is handler.ts; this file only wires it up,
 * and imports without Deno so Vitest can load it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handle, type Outgoing, type PushConfig, type PushDb, type SubscriptionRow } from './handler.ts';

export { handle };
export type { Outgoing, PushConfig, PushDb, PushDeps, SubscriptionRow } from './handler.ts';

interface DenoLike {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}

function failed(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** push_config, the outbox and the subscriptions, over PostgREST as service_role. */
export function supabasePushDb(db: SupabaseClient): PushDb {
  return {
    async config() {
      const { data, error } = await db.from('push_config').select('vapid_public, vapid_private, token, function_url').eq('id', true).maybeSingle();
      failed('push_config', error);
      return (data as PushConfig | null) ?? null;
    },
    async saveConfig(patch) {
      const { error } = await db.from('push_config').upsert({ id: true, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      failed('push_config', error);
    },
    async next(limit) {
      const { data, error } = await db.rpc('next_notifications', { p_limit: limit });
      failed('next_notifications', error);
      return (data as Outgoing[] | null) ?? [];
    },
    async subscriptions(userIds) {
      if (userIds.length === 0) return [];
      const { data, error } = await db.from('push_subscriptions').select('user_id, endpoint, p256dh, auth').in('user_id', [...userIds]);
      failed('push_subscriptions', error);
      return (data as SubscriptionRow[] | null) ?? [];
    },
    async markSent(ids) {
      const { error } = await db.rpc('mark_notifications_sent', { p_ids: [...ids] });
      failed('mark_notifications_sent', error);
    },
    async removeSubscription(endpoint) {
      const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
      failed('push_subscriptions', error);
    },
  };
}

/** The new secret key ("default" in SUPABASE_SECRET_KEYS), or the legacy service_role key. */
export function secretKey(get: (name: string) => string | undefined): string {
  const keys = get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown>;
      const key = parsed['default'] ?? Object.values(parsed)[0];
      if (typeof key === 'string' && key !== '') return key;
    } catch {
      /* not JSON: fall back */
    }
  }
  return get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const deno = (globalThis as { Deno?: DenoLike }).Deno;
if (deno) {
  const url = deno.env.get('SUPABASE_URL') ?? '';
  const db = createClient(url, secretKey((name) => deno.env.get(name)), { auth: { persistSession: false, autoRefreshToken: false } });
  const deps = { db: supabasePushDb(db), fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), env: { SUPABASE_URL: url } };
  deno.serve((req) => handle(req, deps));
}
