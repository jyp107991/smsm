/**
 * OFF-6: being offline never signs anyone out. A sign-in that can't be refreshed for lack of connection stays
 * valid on the phone and refreshes when the connection returns. Only a definite "no" from the server, online,
 * signs the person out.
 *
 * The fake's auth behaves as auth-js 2.119 does: with an expired stored session and no network, getSession()
 * answers { session: null, error: AuthRetryableFetchError } although the session is still stored, so the app
 * must not take a null session at face value.
 *
 * Contract (tests-first writer):
 *   createSessionKeeper(deps: {
 *     client: SupabaseClient<Database>;
 *     storage: { getItem; setItem; removeItem };   // async, idb-keyval-shaped; may remember the last person
 *     network: { readonly online: boolean; subscribe(listener: (online: boolean) => void): () => void };
 *   }): {
 *     ready: Promise<void>;
 *     state(): { status: 'signed-in'; userId: string; refreshPending: boolean } | { status: 'signed-out' };
 *     subscribe(listener: () => void): () => void;
 *     dispose(): void;
 *   }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { createSessionKeeper } from './session';
import { FakeNetwork, FakeServer, FakeStorage, type FakePhone, type FakeUser } from '../../tests/fixtures/fake-supabase';

/** The contract above as a type: createSessionKeeper's result must be assignable to it. */
type SessionState = { status: 'signed-in'; userId: string; refreshPending: boolean } | { status: 'signed-out' };
interface Keeper {
  ready: Promise<void>;
  state(): SessionState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
const keepers: Keeper[] = [];
afterEach(() => {
  for (const k of keepers.splice(0)) k.dispose();
});

function keeper(phone: FakePhone, storage: FakeStorage): Keeper {
  const k: Keeper = createSessionKeeper({ client: phone.client as SupabaseClient<Database>, storage, network: phone.network });
  keepers.push(k);
  return k;
}

function people(): { server: FakeServer; jae: FakeUser } {
  const server = new FakeServer();
  const h = server.seedHousehold();
  return { server, jae: h.members[0] };
}

describe('session (OFF-6)', () => {
  it('a valid stored sign-in is signed in', async () => {
    const { server, jae } = people();
    const k = keeper(server.phone('jae', jae), new FakeStorage());
    await k.ready;
    expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: false });
  });

  it('no stored sign-in is signed out', async () => {
    const { server } = people();
    const k = keeper(server.phone('nobody', null), new FakeStorage());
    await k.ready;
    expect(k.state()).toEqual({ status: 'signed-out' });
  });

  it('OFF-6: offline with an expired sign-in, after a restart, stays signed in; it refreshes when the connection returns', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const network = new FakeNetwork(true);
    const phone = server.phone('jae', jae, network);
    const first = keeper(phone, storage);
    await first.ready;
    expect(first.state()).toMatchObject({ status: 'signed-in', userId: jae.id });
    first.dispose();

    // Days in airplane mode: the access token expires and can't be refreshed. The app is opened again.
    network.set(false);
    phone.auth.expire();
    const second = keeper(phone, storage);
    await second.ready;
    expect(second.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: true });
    expect(phone.auth.calls).not.toContain('signOut');
    expect(phone.auth.session).not.toBeNull(); // nothing removed the stored session

    const seen: unknown[] = [];
    const off = second.subscribe(() => seen.push(second.state()));
    network.set(true);
    await vi.waitFor(() => {
      expect(second.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: false });
    });
    off();
    expect(seen.length).toBeGreaterThan(0);
    expect((phone.auth.session?.expires_at ?? 0) * 1000).toBeGreaterThan(Date.now());
    expect(phone.auth.calls).not.toContain('signOut');
  });

  it('OFF-6: going offline while signed in, and the token expiring meanwhile, never signs out', async () => {
    const { server, jae } = people();
    const network = new FakeNetwork(true);
    const phone = server.phone('jae', jae, network);
    const k = keeper(phone, new FakeStorage());
    await k.ready;
    network.set(false);
    phone.auth.expire();
    // auth-js's own refresh attempts fail with a retryable error while offline.
    await phone.auth.refreshSession();
    await phone.auth.getSession();
    await new Promise((r) => setTimeout(r, 50));
    expect(k.state()).toMatchObject({ status: 'signed-in', userId: jae.id });
  });

  it('online, a refresh the server refuses (signed out elsewhere) does sign out', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const phone = server.phone('jae', jae);
    const first = keeper(phone, storage);
    await first.ready;
    first.dispose();
    phone.auth.refreshTokenValid = false;
    phone.auth.expire();
    const second = keeper(phone, storage);
    await second.ready;
    await vi.waitFor(() => {
      expect(second.state()).toEqual({ status: 'signed-out' });
    });
  });
});
