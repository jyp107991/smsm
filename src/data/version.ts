/**
 * The stale-app check (DATA_MODEL §6): the app compares its own version with `app_config.min_client_version`
 * on open and before the first write. Offline the answer is 'unknown', which never blocks saving on the
 * phone (the write waits in the queue until the check can be made).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** < 0 when a is older, 0 when equal, > 0 when newer. Numeric parts ("0.10.0" > "0.9.3"); text after "-" or "+" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.split(/[-+]/)[0] ?? '').split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function isStale(appVersion: string, minVersion: string): boolean {
  return compareVersions(appVersion, minVersion) < 0;
}

export type VersionCheck = 'current' | 'stale' | 'unknown';

export async function checkClientVersion(client: SupabaseClient<Database>, appVersion: string): Promise<VersionCheck> {
  try {
    const { data, error } = await client.from('app_config').select('*').eq('key', 'min_client_version').maybeSingle();
    if (error) return 'unknown';
    const min = data?.value;
    if (typeof min !== 'string') return 'current';
    return isStale(appVersion, min) ? 'stale' : 'current';
  } catch {
    return 'unknown';
  }
}
