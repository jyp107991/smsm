/**
 * The data layer's heart (DATA_MODEL §6, SPEC §11.1): one QueryClient whose cache and offline write queue
 * are persisted (IndexedDB in the app), so the app opens instantly, works with no connection for as long as
 * needed, and sends waiting changes, in order, when the phone is back.
 *
 * How the queue survives a restart (OFF-5):
 * - Every money write is a TanStack mutation with the key ['money'] and the shared scope 'money', so they
 *   run one at a time in the order they were made (ADD-6, OFF-2).
 * - Mutation functions can't be stored, so they are registered by key with `setMutationDefaults` before the
 *   persisted cache is restored; a restored mutation finds its function by its key.
 * - Every waiting write (not only paused ones) is persisted, marked paused, and written to storage as soon as
 *   it is queued (not on the usual throttle). After a restore the paused writes are resumed in order.
 * - A replay is an upsert by an id made on the phone, so a write that reached the server before its answer
 *   was lost can't be duplicated (OFF-7).
 *
 * Sending: each write waits for the connection (this store's own `network`), the stale-app check and, for an
 * entry made before the partner joined, the partner; a transient failure (no connection, a lost answer, an
 * expired token, a server hiccup) waits and tries again, sooner when the connection returns. A refusal is
 * final: the write leaves the queue (so it leaves what is shown: the rollback) and is kept to fix (OFF-5).
 */
import { MutationObserver, QueryClient, dehydrate, hashKey, type DehydrateOptions, type QueryKey } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  persistQueryClientRestore, persistQueryClientSubscribe,
  type AsyncStorage, type PersistedClient, type Persister,
} from '@tanstack/react-query-persist-client';
import { netPositions } from '../core/balance';
import type { IsoDate } from '../core/dates';
import type { Pence } from '../core/money';
import type { UserId } from '../core/split';
import {
  ApiError, isTransient, type Api, type AuthUser, type CategoryMemoryRow, type ExpenseRow, type HouseholdRow, type MemberRow, type SettlementRow,
} from './api';
import { keys, MEMORY_KEY, MEMORY_SCOPE, MONEY_KEY, MONEY_SCOPE } from './keys';
import type { Network } from './network';
import { createProblemStore, problemFrom, type ProblemStore } from './problems';
import {
  categoriesQuery, changesQuery, expensesQuery, householdQuery, membersQuery, membershipQuery, memoryQuery, settlementsQuery,
} from './queries';
import { createRealtime, type Realtime } from './realtime';
import { expenseToLedger, settlementToLedger } from './rows';
import { userIdOf, type SessionKeeper } from './session';
import type { VersionCheck } from './version';
import {
  buildExpense, completeSplit, expenseWrite, opRowId, overlay, overlayMemory, settlementWrite, type MemoryOp, type MoneyOp,
} from './writes';

export const CACHE_KEY = 'smsm-cache';
/** Bump only with a migration of the stored queue: a different buster discards the persisted cache. */
export const CACHE_BUSTER = 'smsm-1';
const RECURRING_DAY_KEY = 'smsm-recurring-day';
const RECHECK_VERSION_MS = 6 * 60 * 60 * 1000;

export interface DataLayerOptions {
  api: Api;
  /** Where the cache, the queue and kept-back writes live. IndexedDB in the app; a Map in tests and the demo. */
  storage: AsyncStorage;
  network: Network;
  session: SessionKeeper;
  /** The stale-app check (version.ts); none in the demo. */
  versionCheck?: () => Promise<VersionCheck>;
  /** This app is older than the minimum: ask the service worker for the new version (staleApp.ts). */
  onStale?: () => void;
  /** The phone's own today (DAT-2). */
  today: () => IsoDate;
  /** Report a refused write to client_errors (src/data/errors.ts). */
  report?: (err: unknown, context: Record<string, unknown>) => void;
  onSignedIn?: (user: AuthUser) => void;
  now?: () => Date;
  /** How often the cache is written to storage at most (writes to the queue are saved at once). */
  throttleMs?: number;
  /** Wait before trying a write again after a transient failure (default: 1 s doubling to 30 s). */
  retryDelay?: (attempt: number) => number;
}

export interface DataLayer {
  client: QueryClient;
  api: Api;
  session: SessionKeeper;
  network: Network;
  problems: ProblemStore;
  realtime: Realtime;
  now: () => Date;
  today: () => IsoDate;
  /** Restored from storage, then (if online) fetched from the server. */
  ready: Promise<void>;
  /** The phone's copy has been restored (writes can be queued in order). */
  isReady(): boolean;
  /** Nothing in flight: the queue is sent or waiting (for the network, the partner, an update); storage written. */
  idle(): Promise<void>;
  /** Refetch everything (also runs on open, reconnect and Realtime). */
  refresh(): Promise<void>;
  /** The app closes: stop listening and sending, write storage. A disposed layer is not started again. */
  dispose(): Promise<void>;
  me(): string | null;
  householdId(): string | null;
  members(): MemberRow[];
  household(): HouseholdRow | null;
  /** The phone's copy with waiting writes applied, deleted ones included. */
  entries(): ExpenseRow[];
  settlements(): SettlementRow[];
  /** core netPositions over the phone's copy; empty before the partner joins. */
  balance(): Record<UserId, Pence>;
  /** The writes still waiting to be sent, oldest first. */
  waiting(): MoneyOp[];
  /** True while this app is too old to write and is waiting for the new version. */
  stale(): boolean;
  subscribeStale(cb: () => void): () => void;
  /** Queue a money write; returns at once (the write is shown immediately and sent when possible). */
  enqueue(op: MoneyOp): void;
  /** Queue what a person's choice taught the app (CAT-3, CAT-4); not counted as a waiting change. */
  remember(op: MemoryOp): void;
  /** The household's category memory with waiting choices applied. */
  memory(): CategoryMemoryRow[];
  /** Write the cache and queue to storage now. */
  flush(): Promise<void>;
  /** Sign out and clear everything stored for the person on this phone. Needs a connection. */
  signOut(): Promise<void>;
}

function isMoneyMutation(m: { options: { mutationKey?: readonly unknown[] } }): boolean {
  return m.options.mutationKey?.[0] === MONEY_KEY[0];
}

function isMemoryMutation(m: { options: { mutationKey?: readonly unknown[] } }): boolean {
  return m.options.mutationKey?.[0] === MEMORY_KEY[0];
}

/** Writes that are persisted with the queue: money, and what the app learned (CAT-3). */
function isQueuedMutation(m: { options: { mutationKey?: readonly unknown[] } }): boolean {
  return isMoneyMutation(m) || isMemoryMutation(m);
}

const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] === 'smsm',
  // Every waiting write, including one that was mid-request when the app closed: replaying it is safe.
  shouldDehydrateMutation: (m) => m.state.status === 'pending' && isQueuedMutation(m),
};

/** Restored writes are marked paused, so resuming picks up every one of them. */
function markPaused(pc: PersistedClient): PersistedClient {
  return {
    ...pc,
    clientState: {
      ...pc.clientState,
      mutations: pc.clientState.mutations.map((m) => ({ ...m, state: { ...m.state, isPaused: true } })),
    },
  };
}

function upsertById<R extends { id: string }>(rows: readonly R[], row: R): R[] {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) return [...rows, row];
  const next = [...rows];
  next[i] = row;
  return next;
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

export function createDataLayer(opts: DataLayerOptions): DataLayer {
  const { api, storage, network, session } = opts;
  const now = opts.now ?? (() => new Date());
  const report = opts.report ?? (() => undefined);
  const retryDelay = opts.retryDelay ?? ((attempt: number) => Math.min(1000 * 2 ** attempt, 30_000));
  let disposed = false;

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // This store's own network decides (not the browser-wide flag), so a request is simply tried; the
        // phone's copy stays when it fails (OFF-1, OFF-3).
        networkMode: 'always',
        // Never garbage-collect: the household is small, and timers longer than ~24.8 days overflow.
        gcTime: Infinity,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false, // done below, on this store's network
        retry: (count, err) => network.online && isTransient(err) && count < 2,
      },
      mutations: { networkMode: 'always' },
    },
  });

  const problems = createProblemStore(storage);
  const base = createAsyncStoragePersister({ storage, key: CACHE_KEY, throttleTime: opts.throttleMs ?? 250 });
  const persister: Persister = {
    persistClient: (pc) => (disposed ? undefined : base.persistClient(markPaused(pc))),
    restoreClient: () => base.restoreClient(),
    removeClient: () => base.removeClient(),
  };
  const snapshot = (): PersistedClient => ({ buster: CACHE_BUSTER, timestamp: Date.now(), clientState: dehydrate(client, dehydrateOptions) });
  let flushing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (disposed) return flushing;
    const value = JSON.stringify(markPaused(snapshot()));
    flushing = flushing.then(async () => { await storage.setItem(CACHE_KEY, value); }).catch(() => undefined);
    return flushing;
  };

  const uid = () => userIdOf(session.state());
  const membership = (): MemberRow | null => {
    const id = uid();
    return id ? (client.getQueryData(membershipQuery(api, id).queryKey) ?? null) : null;
  };
  const householdId = () => membership()?.household_id ?? null;

  // ───────── waking writes that wait ─────────
  const waiters = new Set<() => void>();
  const waitingOps = new Set<string>();
  /** Wakes every waiting write: the connection is back, the partner joined, the app was refreshed… */
  function wake(): void {
    for (const w of [...waiters]) w();
  }
  function wait(opId: string, ms: number): Promise<void> {
    waitingOps.add(opId);
    return new Promise<void>((resolve) => {
      if (disposed) return; // a closed app sends nothing more; the queue is in storage
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        if (disposed) return;
        waitingOps.delete(opId);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiters.add(done);
    });
  }

  // Only a change to who is in the household wakes waiting writes (an entry made before the partner joined);
  // waking on every change would turn our own writes' echoes into a resend loop.
  const realtime = createRealtime({ api, client, userId: uid, onChange: (table) => { if (table === 'members') wake(); } });

  // ───────── the stale-app check ─────────
  let version: { state: VersionCheck; at: number } = { state: 'unknown', at: -Infinity };
  const staleListeners = new Set<() => void>();
  async function checkVersion(): Promise<VersionCheck> {
    if (!opts.versionCheck) return 'current';
    if (version.state === 'current' && Date.now() - version.at < RECHECK_VERSION_MS) return 'current';
    const state = await opts.versionCheck();
    const was = version.state;
    version = { state, at: Date.now() };
    if (state !== was) for (const l of staleListeners) l();
    if (state === 'stale') opts.onStale?.();
    return state;
  }

  // ───────── reading the household ─────────
  function followHousehold(): void {
    if (!disposed) realtime.follow(householdId());
  }

  async function refresh(): Promise<void> {
    const id = uid();
    if (!id || disposed) return;
    const mq = membershipQuery(api, id);
    let me: MemberRow | null = client.getQueryData(mq.queryKey) ?? null;
    try {
      me = await client.query({ ...mq, staleTime: 0 });
    } catch {
      /* offline: keep the phone's copy */
    }
    const hid = me?.household_id;
    if (!hid) return;
    const noop = () => undefined;
    await Promise.all([
      client.query({ ...householdQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...membersQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...categoriesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...expensesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...settlementsQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...changesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...memoryQuery(api, id, hid), staleTime: 0 }).catch(noop),
    ]);
    followHousehold();
    wake();
  }

  async function postRecurringOncePerDay(): Promise<void> {
    if (!network.online || disposed) return;
    const today = opts.today();
    try {
      if ((await storage.getItem(RECURRING_DAY_KEY)) === today) return;
      const posted = await api.postDueRecurring();
      await storage.setItem(RECURRING_DAY_KEY, today);
      const id = uid();
      if (posted > 0 && id) void client.invalidateQueries({ queryKey: keys.expenses(id) });
    } catch {
      /* the nightly job posts them anyway (REC-2); try again on the next open */
    }
  }

  // ───────── sending ─────────
  /** An entry made before the partner joined gets its shares now, from the people in the household. */
  async function completeForPartner(op: MoneyOp & { table: 'expenses'; op: 'upsert' }): Promise<ExpenseRow> {
    const id = uid();
    const hid = op.row.household_id;
    if (!id) throw new ApiError('auth', 'not signed in');
    const members = await client.query({ ...membersQuery(api, id, hid), staleTime: 0 });
    const [a, b] = members;
    if (!a || !b) throw new ApiError('waiting', 'waiting for the partner to join');
    const pair = [a.user_id, b.user_id] as const;
    const household = client.getQueryData<HouseholdRow | null>(keys.household(id));
    const dr = household?.default_ratio;
    const ratio = dr && typeof dr === 'object' && !Array.isArray(dr) ? (dr as Record<string, number>) : null;
    const input = { ...op.input, split: completeSplit(op.input.split, pair, ratio) };
    return buildExpense({ householdId: hid, userId: op.by, members: pair, now: now() }, input, op.row);
  }

  async function sendOnce(op: MoneyOp): Promise<ExpenseRow | SettlementRow> {
    if (op.table === 'expenses') {
      if (op.op === 'patch') return api.patchExpense(op.id, op.patch);
      const row = op.awaitingPartner ? await completeForPartner(op) : op.row;
      return api.upsertExpense(expenseWrite(row, op.isNew));
    }
    return op.op === 'upsert' ? api.upsertSettlement(settlementWrite(op.row, op.isNew)) : api.patchSettlement(op.id, op.patch);
  }

  /** Sends one queued write, waiting out anything transient; what is thrown is a refusal. */
  async function send<T>(op: { opId: string; by: string }, once: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        if (!network.online) throw new ApiError('network', 'offline');
        // Made by another account on this phone: wait for that person rather than send it as someone else.
        if (uid() !== op.by) throw new ApiError('auth', 'waiting for the person who made this change to sign in');
        const v = await checkVersion();
        // Nothing is sent until the check passes; offline ('unknown') it simply waits.
        if (v === 'stale') throw new ApiError('stale', 'this version of the app is too old to save; it is updating');
        if (v === 'unknown') throw new ApiError('network', 'could not check the app version');
        return await once();
      } catch (err) {
        if (!isTransient(err)) throw err;
        await wait(op.opId, retryDelay(attempt));
      }
    }
  }

  async function applyServerRow(op: MoneyOp, row: ExpenseRow | SettlementRow): Promise<void> {
    const id = uid();
    if (!id) return;
    const key: QueryKey = op.table === 'expenses' ? keys.expenses(id) : keys.settlements(id);
    const wasFetching = client.isFetching({ queryKey: key }) > 0;
    // A refetch that started before this write finished could bring back the old row; cancel it, then
    // fetch again afterwards so nothing the partner changed meanwhile is missed.
    if (wasFetching) await client.cancelQueries({ queryKey: key });
    if (client.getQueryData(key) !== undefined) {
      client.setQueryData<(ExpenseRow | SettlementRow)[]>(key, (old) => upsertById(old ?? [], row));
    }
    if (wasFetching || client.getQueryData(key) === undefined) void client.invalidateQueries({ queryKey: key, refetchType: 'all' });
    void client.invalidateQueries({ queryKey: keys.activity(id, row.id) });
  }

  client.setMutationDefaults(MONEY_KEY, {
    scope: MONEY_SCOPE,
    networkMode: 'always',
    retry: 0, // transient failures are retried inside `send`; what reaches TanStack as an error is a refusal
    mutationFn: (op: MoneyOp) => send(op, () => sendOnce(op)),
    onSuccess: async (row: ExpenseRow | SettlementRow, op: MoneyOp) => {
      problems.resolveRow(opRowId(op));
      await applyServerRow(op, row);
    },
    onError: (err: Error, op: MoneyOp) => {
      const code = err instanceof ApiError ? err.code : '';
      problems.add(problemFrom(op, err.message, code, now()));
      report(err, { what: 'write refused', table: op.table, op: op.op, id: opRowId(op) });
    },
  });

  client.setMutationDefaults(MEMORY_KEY, {
    scope: MEMORY_SCOPE,
    networkMode: 'always',
    retry: 0,
    mutationFn: (op: MemoryOp) => send(op, () => api.upsertCategoryMemory(op.row)),
    onSuccess: (row: CategoryMemoryRow) => {
      const id = uid();
      if (!id || client.getQueryData(keys.memory(id)) === undefined) return;
      client.setQueryData<CategoryMemoryRow[]>(keys.memory(id), (old) => [...(old ?? []).filter((r) => r.key !== row.key), row]);
    },
    // The app's memory, not the person's entry: a refusal (the category was removed meanwhile) is dropped
    // quietly and reported, and the next choice for that description teaches it again.
    onError: (err: Error, op: MemoryOp) => {
      report(err, { what: 'category memory refused', key: op.row.key });
    },
  });

  function memoryWaiting(): MemoryOp[] {
    return client
      .getMutationCache()
      .findAll({ mutationKey: MEMORY_KEY, status: 'pending' })
      .map((m) => m.state.variables as MemoryOp | undefined)
      .filter((v): v is MemoryOp => v !== undefined);
  }

  function remember(op: MemoryOp): void {
    if (disposed) throw new Error('This store has been closed.');
    const observer = new MutationObserver<CategoryMemoryRow, Error, MemoryOp>(client, { mutationKey: MEMORY_KEY });
    observer
      .mutate(op)
      .catch(() => undefined)
      .finally(() => { observer.reset(); });
  }

  function memory(): CategoryMemoryRow[] {
    const id = uid();
    return id ? overlayMemory(rows<CategoryMemoryRow>(keys.memory(id)), memoryWaiting()) : [];
  }

  function waiting(): MoneyOp[] {
    return client
      .getMutationCache()
      .findAll({ mutationKey: MONEY_KEY, status: 'pending' })
      .map((m) => m.state.variables as MoneyOp | undefined)
      .filter((v): v is MoneyOp => v !== undefined);
  }

  function enqueue(op: MoneyOp): void {
    if (disposed) throw new Error('This store has been closed.');
    const observer = new MutationObserver<ExpenseRow | SettlementRow, Error, MoneyOp>(client, { mutationKey: MONEY_KEY });
    observer
      .mutate(op)
      .catch(() => undefined) // handled by the defaults' onError
      .finally(() => { observer.reset(); });
  }

  function resume(): void {
    // Straight to the mutation cache: TanStack's own resume also consults the browser-wide online flag.
    if (!disposed) void client.getMutationCache().resumePausedMutations();
    wake();
  }

  // ───────── reads of the phone's copy ─────────
  function rows<R>(key: QueryKey): R[] {
    return client.getQueryData<R[]>(key) ?? [];
  }
  function members(): MemberRow[] {
    const id = uid();
    return id ? rows<MemberRow>(keys.members(id)) : [];
  }
  function entries(): ExpenseRow[] {
    const id = uid();
    return id ? overlay(rows<ExpenseRow>(keys.expenses(id)), waiting(), 'expenses') : [];
  }
  function settlements(): SettlementRow[] {
    const id = uid();
    return id ? overlay(rows<SettlementRow>(keys.settlements(id)), waiting(), 'settlements') : [];
  }
  function balance(): Record<UserId, Pence> {
    const [a, b] = members();
    if (!a || !b) return {};
    return netPositions([a.user_id, b.user_id], entries().map(expenseToLedger), settlements().map(settlementToLedger));
  }

  // ───────── idle ─────────
  async function idle(): Promise<void> {
    for (let quiet = 0; quiet < 2;) {
      await tick();
      const busy =
        client.isFetching() > 0 ||
        client.getMutationCache().findAll({ status: 'pending', predicate: isQueuedMutation }).some((m) => {
          const op = m.state.variables as { opId: string } | undefined;
          return !m.state.isPaused && !(op && waitingOps.has(op.opId));
        });
      quiet = busy ? 0 : quiet + 1;
    }
    await flush();
    await problems.saved();
  }

  // ───────── start ─────────
  const cleanups: (() => void)[] = [];
  let lastUser: string | null = null;

  const signedIn = () => {
    const st = session.state();
    if (st.status === 'signed-in') opts.onSignedIn?.({ userId: st.userId, email: null });
  };

  let restored = false;
  const ready = (async () => {
    client.mount();
    await problems.load();
    try {
      await persistQueryClientRestore({ queryClient: client, persister, maxAge: Infinity, buster: CACHE_BUSTER });
    } catch {
      /* a corrupt store is discarded by the restore itself; start empty */
    }
    cleanups.push(persistQueryClientSubscribe({ queryClient: client, persister, buster: CACHE_BUSTER, dehydrateOptions }));
    // A newly queued write goes to storage at once, not on the throttle.
    cleanups.push(
      client.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'pending' && isQueuedMutation(event.mutation)) void flush();
      }),
    );
    cleanups.push(
      client.getQueryCache().subscribe((event) => {
        const id = uid();
        if (event.type !== 'updated' || !id) return;
        if (event.query.queryHash === hashKey(keys.membership(id)) || event.query.queryHash === hashKey(keys.members(id))) {
          followHousehold();
          wake(); // the partner may have joined
        }
      }),
    );
    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') void flush();
        else wake();
      };
      const onPageHide = () => { void flush(); };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
      });
    }
    cleanups.push(
      network.subscribe((online) => {
        if (!online) return;
        resume();
        void refresh();
        void postRecurringOncePerDay();
      }),
    );
    await session.ready;
    cleanups.push(
      session.subscribe(() => {
        const id = uid();
        if (id && id !== lastUser) {
          lastUser = id;
          signedIn();
          void postRecurringOncePerDay();
          void refresh();
        }
        if (!id) lastUser = null;
        followHousehold();
        wake();
      }),
    );
    lastUser = uid();
    restored = true;
    if (lastUser) signedIn();
    followHousehold();
    resume();
    if (network.online && lastUser) {
      await refresh();
      void postRecurringOncePerDay();
      if (opts.versionCheck) await checkVersion();
    }
  })();

  async function forget(): Promise<void> {
    client.getMutationCache().clear();
    client.getQueryCache().clear();
    problems.clear();
    await persister.removeClient();
    await storage.removeItem(RECURRING_DAY_KEY);
  }

  return {
    client,
    api,
    session,
    network,
    problems,
    realtime,
    now,
    today: opts.today,
    ready,
    isReady: () => restored && !disposed,
    idle,
    refresh,
    async dispose() {
      if (disposed) return;
      await ready.catch(() => undefined);
      await flush();
      await problems.saved();
      disposed = true;
      for (const c of cleanups.splice(0)) c();
      realtime.stop();
      client.unmount();
      wake(); // clears the timers; a closed app's waits never resolve
    },
    me: uid,
    householdId,
    members,
    household: () => {
      const id = uid();
      return id ? (client.getQueryData<HouseholdRow | null>(keys.household(id)) ?? null) : null;
    },
    entries,
    settlements,
    balance,
    waiting,
    stale: () => version.state === 'stale',
    subscribeStale(cb) {
      staleListeners.add(cb);
      return () => { staleListeners.delete(cb); };
    },
    enqueue,
    remember,
    memory,
    flush,
    async signOut() {
      await api.auth.signOut();
      await forget();
    },
  };
}
