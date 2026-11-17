/**
 * Who is signed in on this phone (PPL-1, OFF-6). supabase-js saves the session (under its own key) and
 * refreshes it; this keeper makes sure being offline never signs anyone out:
 * - auth-js answers "no session" when the saved access token has expired and can't be refreshed for lack of
 *   a connection, although the session is still saved. That is not a sign-out: the keeper remembers who was
 *   signed in (in the app's own storage) and stays signed in, with the refresh pending.
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

export function createSessionKeeper(deps: { client: SupabaseClient<Database>; storage: KeeperStorage; network: Network }): SessionKeeper {
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

  const { data: sub } = client.auth.onAuthStateChange((event, session) => {
    // Never await inside this callback (supabase-js holds a lock while it runs).
    if (event === 'SIGNED_OUT') signedOut();
    else if (session) signedIn(session.user.id, false);
    // A null session on INITIAL_SESSION is what auth-js reports for an expired token offline: ignored.
  });
  const offNetwork = network.subscribe((online) => {
    if (online) void refreshNow().catch(() => undefined);
  });

  const ready = (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (data.session) {
        signedIn(data.session.user.id, false);
        return;
      }
      const last = await storage.getItem(LAST_USER_KEY);
      if (error && isAuthRetryableFetchError(error) && last) {
        signedIn(last, true);
        return;
      }
      if (error && !isAuthRetryableFetchError(error)) signedOut();
      else set(SIGNED_OUT);
    } catch {
      const last = await Promise.resolve(storage.getItem(LAST_USER_KEY)).catch(() => null);
      if (last) signedIn(last, true);
    }
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
