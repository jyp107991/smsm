/**
 * Who is signed in on this phone (PPL-1, OFF-6). supabase-js saves the session (under its own key) and
 * refreshes it; this keeper makes sure being offline never signs anyone out:
 * - auth-js answers "no session" when the saved access token has expired and can't be refreshed for lack of
 *   a connection, although the session is still saved. That is not a sign-out: the keeper remembers who was
 *   signed in (in the app's own storage) and stays signed in, with the refresh pending.
 * - auth-js gives that answer only after retrying the refresh for up to 30 s. When this phone knows who was
 *   signed in, the keeper doesn't wait for it: the app opens at once offline (after a short wait online),
 *   signed in with the refresh pending (CI run 44051517647: a blank screen for 25 s after a restart offline).
 * - When the connection returns, it refreshes. Only a definite "no" from the server (the refresh token was
 *   revoked: signed out elsewhere, account removed) or the person signing out ends the session.
 */
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { Network } from './network';

export type SessionState = { status: 'signed-in'; userId: string; refreshPending: boolean } | { status: 'signed-out' };

export interface KeeperStorage {
  getItem(key: string): Promise<string | null | undefined> | string | null | undefined;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

export interface SessionKeeper {
  /** Resolves once the saved session has been read (no network needed). */
  ready: Promise<void>;
  state(): SessionState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** The app's own note of who was last signed in on this phone (the user id only). */
export const LAST_USER_KEY = 'smsm-last-user';

const SIGNED_OUT: SessionState = { status: 'signed-out' };

/**
 * How long, online, the app waits for auth-js to confirm a saved sign-in before it opens on the phone's copy
 * with the refresh pending. A valid token answers in milliseconds; an expired one is refreshed over the
 * network, normally well within this.
 */
export const SESSION_PATIENCE_MS = 2000;

export function createSessionKeeper(deps: {
  client: SupabaseClient<Database>;
  storage: KeeperStorage;
  network: Network;
  /** Online wait before opening with the refresh pending (default SESSION_PATIENCE_MS); tests shorten it. */
  patienceMs?: number;
}): SessionKeeper {
  const { client, storage, network } = deps;
  let state: SessionState = SIGNED_OUT;
  let disposed = false;
  const listeners = new Set<() => void>();

  const set = (next: SessionState) => {
    if (disposed) return;
    const same =
      next.status === state.status &&
      (next.status === 'signed-out' || (state.status === 'signed-in' && state.userId === next.userId && state.refreshPending === next.refreshPending));
    if (same) return;
    state = next;
    for (const l of listeners) l();
  };

  const signedIn = (userId: string, refreshPending: boolean) => {
    set({ status: 'signed-in', userId, refreshPending });
    if (!refreshPending) void Promise.resolve(storage.setItem(LAST_USER_KEY, userId)).catch(() => undefined);
  };

  const signedOut = () => {
    set(SIGNED_OUT);
    void Promise.resolve(storage.removeItem(LAST_USER_KEY)).catch(() => undefined);
  };

  async function refreshNow(): Promise<void> {
    if (state.status !== 'signed-in' || !state.refreshPending || !network.online) return;
    const { data, error } = await client.auth.refreshSession();
    if (data.session) signedIn(data.session.user.id, false);
    else if (error && !isAuthRetryableFetchError(error)) signedOut();
    // A retryable failure (the connection dropped again): stay signed in; try on the next reconnect.
  }

  /** True once auth-js has given a definite answer; the short wait in `ready` then has nothing to add. */
  let decided = false;
  const isDecided = () => decided;   // read through a function: it is set in callbacks the type checker can't follow

  const { data: sub } = client.auth.onAuthStateChange((event, session) => {
    // Never await inside this callback (supabase-js holds a lock while it runs).
    if (event === 'SIGNED_OUT') {
      decided = true;
      signedOut();
    } else if (session) {
      decided = true;
      signedIn(session.user.id, false);
    }
    // A null session on INITIAL_SESSION is what auth-js reports for an expired token offline: ignored.
  });
  const offNetwork = network.subscribe((online) => {
    if (online) void refreshNow().catch(() => undefined);
  });

  /** auth-js's own answer about the saved session, applied whenever it comes. */
  async function settle(last: string | null): Promise<void> {
    try {
      const { data, error } = await client.auth.getSession();
      if (data.session) {
        decided = true;
        signedIn(data.session.user.id, false);
        return;
      }
      if (error && isAuthRetryableFetchError(error) && last) {
        signedIn(last, true);
        return;
      }
      // A definite "no", or no saved sign-in at all: signed out, and a stale "last person" note is cleared so
      // the next offline open doesn't briefly open as them.
      decided = true;
      signedOut();
    } catch {
      if (last) signedIn(last, true);
    }
  }

  const ready = (async () => {
    const last = (await Promise.resolve(storage.getItem(LAST_USER_KEY)).catch(() => null)) ?? null;
    const answered = settle(last);
    if (!last) {
      await answered;
      return;
    }
    // Someone is signed in on this phone. auth-js answers only after its refresh has worked or given up:
    // with an expired token and no connection it retries for up to 30 s first. Nothing waits for that
    // (OFF-6, "nothing blocks"): offline at once, online after a short wait, the app opens as that person
    // with the refresh pending; auth-js's answer, when it comes, still applies (a definite "no" signs out).
    const patience = network.online ? (deps.patienceMs ?? SESSION_PATIENCE_MS) : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<'waited'>((resolve) => {
      timer = setTimeout(() => { resolve('waited'); }, patience);
    });
    const first = await Promise.race([answered.then(() => 'answered' as const), waited]);
    clearTimeout(timer);
    if (first === 'waited' && !isDecided() && state.status === 'signed-out') signedIn(last, true);
  })();

  return {
    ready,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      disposed = true;
      sub.subscription.unsubscribe();
      offNetwork();
      listeners.clear();
    },
  };
}

/** Always signed in as one person (demo mode). */
export function fixedSession(userId: string): SessionKeeper {
  const state: SessionState = { status: 'signed-in', userId, refreshPending: false };
  return { ready: Promise.resolve(), state: () => state, subscribe: () => () => undefined, dispose: () => undefined };
}

export function userIdOf(state: SessionState): string | null {
  return state.status === 'signed-in' ? state.userId : null;
}
