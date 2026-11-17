/**
 * The stale-app check (DATA_MODEL §6): on open and before the first write the app compares its version with
 * app_config.min_client_version (a jsonb string, also returned by the health() RPC); an older app refreshes
 * itself first. Offline the answer is "unknown", which never blocks saving on the phone.
 *
 * Contract (tests-first writer), src/data/version.ts:
 *   compareVersions(a: string, b: string): number                 // < 0, 0, > 0; numeric x.y.z
 *   isStale(appVersion: string, minVersion: string): boolean
 *   checkClientVersion(client: SupabaseClient<Database>, appVersion: string): Promise<'current' | 'stale' | 'unknown'>
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { checkClientVersion, compareVersions, isStale } from './version';
import { FakeNetwork, FakeServer } from '../../tests/fixtures/fake-supabase';

describe('compareVersions and isStale', () => {
  it.each([
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.1.0', 1],
    ['1.2.3', '1.2.3', 0],
    ['0.10.0', '0.9.0', 1], // numeric, not alphabetical
    ['1.2.9', '1.2.10', -1],
    ['2.0.0', '1.99.99', 1],
  ] as const)('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it('an app is stale only when it is older than the minimum', () => {
    expect(isStale('0.1.0', '0.2.0')).toBe(true);
    expect(isStale('0.2.0', '0.2.0')).toBe(false);
    expect(isStale('0.3.0', '0.2.0')).toBe(false);
    expect(isStale('0.9.0', '0.10.0')).toBe(true);
    // The baseline's "0.0.0" never makes an app stale.
    expect(isStale('0.1.0', '0.0.0')).toBe(false);
  });
});

describe('checkClientVersion', () => {
  function client(min: string, online = true) {
    const server = new FakeServer();
    const h = server.seedHousehold({ minClientVersion: min });
    const phone = server.phone('jae', h.members[0], new FakeNetwork(online));
    return phone.client as SupabaseClient<Database>;
  }

  it('stale when the server asks for a newer app', async () => {
    await expect(checkClientVersion(client('0.2.0'), '0.1.0')).resolves.toBe('stale');
  });

  it('current at or above the minimum', async () => {
    await expect(checkClientVersion(client('0.1.0'), '0.1.0')).resolves.toBe('current');
    await expect(checkClientVersion(client('0.1.0'), '0.10.0')).resolves.toBe('current');
  });

  it('unknown when it cannot be checked (offline): never treated as stale', async () => {
    await expect(checkClientVersion(client('9.9.9', false), '0.1.0')).resolves.toBe('unknown');
  });
});
