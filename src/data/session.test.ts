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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { createSessionKeeper, LAST_USER_KEY } from './session';
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

  /**
   * CI run 44051517647: auth-js does not answer getSession() at once when the stored token has expired and
   * the refresh can't reach the server: it retries with back-off (200 ms, 400 ms, … for up to 30 s) before
   * it answers, and the app showed a blank screen meanwhile. The keeper must not wait for that answer when
   * this phone knows who was signed in.
   */
  function slowGetSession(phone: FakePhone): () => void {
    const real = phone.auth.getSession.bind(phone.auth);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    phone.auth.getSession = async () => {
      await gate;
      return real();
    };
    return release;
  }

  async function signedInOnce(phone: FakePhone, storage: FakeStorage): Promise<void> {
    const first = keeper(phone, storage);
    await first.ready;
    expect(first.state()).toMatchObject({ status: 'signed-in' });
    first.dispose();
  }

  const settlesWithin = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => { r(false); }, ms))]);

  it('OFF-6: offline with an expired sign-in, the app opens at once while auth-js is still retrying the refresh', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const network = new FakeNetwork(true);
    const phone = server.phone('jae', jae, network);
    await signedInOnce(phone, storage);

    network.set(false);
    phone.auth.expire();
    const release = slowGetSession(phone);
    const k = keeper(phone, storage);
    expect(await settlesWithin(k.ready, 500)).toBe(true);
    expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: true });

    // auth-js gives up (still offline): nothing changes.
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: true });
    expect(phone.auth.calls).not.toContain('signOut');

    network.set(true);
    await vi.waitFor(() => {
      expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: false });
    });
  });

  it('OFF-6: online but the server does not answer, the app opens after a short wait; the late answer then counts', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const phone = server.phone('jae', jae);
    await signedInOnce(phone, storage);

    phone.auth.expire();
    const release = slowGetSession(phone);
    const k = createSessionKeeper({ client: phone.client as SupabaseClient<Database>, storage, network: phone.network, patienceMs: 50 });
    keepers.push(k);
    expect(await settlesWithin(k.ready, 1000)).toBe(true);
    expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: true });

    release(); // the server answers in the end: the refresh worked
    await vi.waitFor(() => {
      expect(k.state()).toEqual({ status: 'signed-in', userId: jae.id, refreshPending: false });
    });
  });

  it('a late, definite "no" from the server still signs out', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const phone = server.phone('jae', jae);
    await signedInOnce(phone, storage);

    phone.auth.refreshTokenValid = false;
    phone.auth.expire();
    const release = slowGetSession(phone);
    const k = createSessionKeeper({ client: phone.client as SupabaseClient<Database>, storage, network: phone.network, patienceMs: 50 });
    keepers.push(k);
    await k.ready;
    expect(k.state()).toMatchObject({ status: 'signed-in', userId: jae.id });

    release();
    await vi.waitFor(() => {
      expect(k.state()).toEqual({ status: 'signed-out' });
    });
  });

  it('review: a definite sign-out that arrives while auth-js is still answering is not undone by the short wait', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const phone = server.phone('jae', jae);
    await signedInOnce(phone, storage);

    phone.auth.expire();
    const release = slowGetSession(phone);
    const k = createSessionKeeper({ client: phone.client as SupabaseClient<Database>, storage, network: phone.network, patienceMs: 50 });
    keepers.push(k);
    const seen: string[] = [];
    k.subscribe(() => { seen.push(k.state().status); });
    await Promise.resolve();
    await phone.auth.signOut(); // signed out (e.g. from Settings in another window) before the wait ends
    await k.ready;
    await new Promise((r) => setTimeout(r, 80));
    expect(k.state()).toEqual({ status: 'signed-out' });
    expect(seen).not.toContain('signed-in');
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(k.state()).toEqual({ status: 'signed-out' });
    expect(await storage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('review: a remembered person with no saved sign-in at all (one store cleared) ends signed out, and the note is cleared', async () => {
    const { server, jae } = people();
    const storage = new FakeStorage();
    const network = new FakeNetwork(true);
    const phone = server.phone('jae', jae, network);
    await signedInOnce(phone, storage);
    expect(await storage.getItem(LAST_USER_KEY)).toBe(jae.id);

    phone.auth.session = null; // auth-js's own store was cleared; ours still names Jae
    network.set(false);
    const k = keeper(phone, storage);
    await k.ready;
    await vi.waitFor(() => {
      expect(k.state()).toEqual({ status: 'signed-out' });
    });
    expect(await storage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('OFF-6 with the real auth-js: an expired saved sign-in, offline, after a restart opens at once', async () => {
    // auth-js 2.119 itself, its saved session expired a day ago, every request failing as with no connection.
    const saved = new Map<string, string>();
    const storageKey = 'sb-test-auth-token';
    const expiredAt = Math.floor(Date.now() / 1000) - 86_400;
    saved.set(storageKey, JSON.stringify({
      access_token: 'expired-access', refresh_token: 'still-good-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: expiredAt,
      user: { id: 'u-jae', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() },
    }));
    let requests = 0;
    const client = createClient<Database>('http://127.0.0.1:9', 'publishable-key', {
      auth: {
        storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storage: { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => { saved.set(k, v); }, removeItem: (k) => { saved.delete(k); } },
      },
      global: { fetch: () => { requests += 1; return Promise.reject(new TypeError('Failed to fetch')); } },
    });
    const storage = new FakeStorage();
    await storage.setItem(LAST_USER_KEY, 'u-jae');
    const network = new FakeNetwork(false);

    const answered = client.auth.getSession().then(() => true);
    const k = createSessionKeeper({ client, storage, network });
    keepers.push(k);
    expect(await settlesWithin(k.ready, 500)).toBe(true);
    expect(k.state()).toEqual({ status: 'signed-in', userId: 'u-jae', refreshPending: true });
    // The cause: auth-js is still retrying the refresh with back-off and hasn't answered.
    expect(await settlesWithin(answered, 1)).toBe(false);
    expect(requests).toBeGreaterThan(0);
    expect(saved.has(storageKey)).toBe(true);
  });

  it('nobody signed in on this phone before: it waits for auth-js, and is signed out', async () => {
    const { server } = people();
    const network = new FakeNetwork(false);
    const phone = server.phone('nobody', null, network);
    const release = slowGetSession(phone);
    const k = keeper(phone, new FakeStorage());
    expect(await settlesWithin(k.ready, 100)).toBe(false);
    expect(k.state()).toEqual({ status: 'signed-out' });
    release();
    await k.ready;
    expect(k.state()).toEqual({ status: 'signed-out' });
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
