/**
 * The data layer's heart (DATA_MODEL §6, SPEC §11.1): one QueryClient whose cache and offline write queue
 * are persisted (IndexedDB in the app), so the app opens instantly, works with no connection for as long as
 * needed, and sends waiting changes, in order, when the phone is back.
 *
 * How the queue survives a restart (OFF-5):
 * - Every money write is a TanStack mutation with the key ['money'] and a scope per person ('money:<id>'),
 *   so one person's writes run one at a time in the order they were made (ADD-6, OFF-2), and writes left by
 *   another account on this phone never hold up the person signed in now.
 * - Mutation functions can't be stored, so they are registered by key with `setMutationDefaults` before the
 *   queue is restored; a restored mutation finds its function by its key.
 * - Every waiting write (not only paused ones) is saved under its own key (`smsm-queue`), apart from the
 *   cache, as soon as it is queued and whenever the queue changes. So a cache that is discarded (a new
 *   buster, a corrupt copy) never takes the queue with it. After a restore the writes are resumed in order.
 * - A replay is an upsert by an id made on the phone, so a write that reached the server before its answer
 *   was lost can't be duplicated (OFF-7).
 * - Only one window owns the queue (windows.ts): two windows of the app on one phone never both send it.
 *
 * Sending: each write waits for the connection (this store's own `network`), the stale-app check and, for an
 * entry made before the partner joined, the partner; a transient failure (no connection, a lost answer, an
 * expired token, a server hiccup) waits and tries again, sooner when the connection returns. A refusal is
 * final: the write leaves the queue (so it leaves what is shown: the rollback) and is kept to fix (OFF-5).
 * A write that was discarded (sign-out) stops at its next try and is never sent.
 */
import { browserGeo, frankfurterRates, type GeoService, type RatesService } from './places';
import { defaultDownscale, memoryPhotoStore, offAi, type AiService, type Downscale, type PhotoStore } from './smart';
import {
  MutationObserver, QueryClient, dehydrate, hashKey, hydrate,
  type DehydratedState, type DehydrateOptions, type QueryKey,
} from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  persistQueryClientRestore, persistQueryClientSubscribe,
  type AsyncStorage, type PersistedClient, type Persister,
} from '@tanstack/react-query-persist-client';
import { netPositions } from '../core/balance';
import type { IsoDate } from '../core/dates';
import type { Pence } from '../core/money';
import type { UserId } from '../core/split';
import { ApiError, isTransient, type Api, type CategoryMemoryRow, type AuthUser, type ExpenseRow, type HouseholdRow, type MemberRow, type SettlementRow } from './api';
import { keys, MEMORY_KEY, MEMORY_SCOPE, MONEY_KEY, MONEY_SCOPE } from './keys';
import type { Network } from './network';
import { createProblemStore, problemFrom, type ProblemStore } from './problems';
import {
  categoriesQuery, changesQuery, chaptersQuery, commentsQuery, expensesQuery, householdQuery, inboxQuery, membersQuery, membershipQuery, memoryQuery, recurringQuery, settlementsQuery,
} from './queries';
import { createRealtime, type Realtime } from './realtime';
import { expenseToLedger, settlementToLedger } from './rows';
import { userIdOf, type SessionKeeper } from './session';
import type { VersionCheck } from './version';
import { claimQueue, OtherWindowError, type QueueLocks, type WindowRole } from './windows';
import {
  categoryWrite, chapterWrite, commentWrite, completedRow, defaultRatioOf, expenseWrite, opRowId, overlay, overlayMemory, partnerCompleter, recurringWrite, settlementWrite,
  type ExpenseUpsert, type MemoryOp, type MoneyOp, type QueuedRow,
} from './writes';

export const CACHE_KEY = 'smsm-cache';
/** The waiting writes, apart from the cache (OFF-5). */
export const QUEUE_KEY = 'smsm-queue';
/** A stored queue that couldn't be read is set aside here, never overwritten. */
export const QUEUE_UNREADABLE_KEY = 'smsm-queue-unreadable';
/** Bump only to discard the cached copy of the household (the queue is kept apart and never discarded). */
export const CACHE_BUSTER = 'smsm-1';
const RECURRING_DAY_KEY = 'smsm-recurring-day';
const RECHECK_VERSION_MS = 6 * 60 * 60 * 1000;

export interface DataLayerOptions {
  api: Api;
  /** Where the cache, the queue and kept-back writes live. IndexedDB in the app; a Map in tests and the demo. */
  storage: AsyncStorage;
  network: Network;
  session: SessionKeeper;
  /**
   * Web Locks shared by every window of the app on this phone (`navigator.locks`), so only one owns the
   * queue (windows.ts). None: this window owns it (no other window can share its storage, or the browser
   * has no Web Locks).
   */
  locks?: QueueLocks | null;
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
  /** How often the cache is written to storage at most (the queue is saved at once). */
  throttleMs?: number;
  /** Wait before trying a write again after a transient failure (default: 1 s doubling to 30 s). */
  retryDelay?: (attempt: number) => number;
  /** S4b: where the phone is (geolocation + place names); the browser's by default. */
  geo?: GeoService;
  /** S4b: the day's exchange rates; Frankfurter by default. */
  rates?: RatesService;
  /** S6a: the smart features (off by default), the phone's photo store (memory by default) and the shrinker. */
  ai?: AiService;
  photos?: PhotoStore;
  downscale?: Downscale;
}

export interface DataLayer {
  client: QueryClient;
  /** S4b: place and rate services (fakes in tests). */
  geo: GeoService;
  rates: RatesService;
  /** S6a: smart features, the phone's photos and the photo shrinker (fakes in tests). */
  ai: AiService;
  photos: PhotoStore;
  downscale: Downscale;
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
  /** The writes still waiting to be sent, oldest first: the signed-in person's (everyone's when signed out). */
  waiting(): MoneyOp[];
  /** Whether this window owns the queue; 'follower' while smsm is open in another window (read-only here). */
  role(): WindowRole;
  subscribeRole(cb: () => void): () => void;
  /** True while this app is too old to write and is waiting for the new version. */
  stale(): boolean;
  subscribeStale(cb: () => void): () => void;
  /** Queue a money write; returns at once (the write is shown immediately and sent when possible). */
  enqueue(op: MoneyOp): void;
  /** Queue what a person's choice taught the app (CAT-3, CAT-4); not counted as a waiting change. Skipped in a read-only window. */
  remember(op: MemoryOp): void;
  /** The household's category memory with waiting choices applied. */
  memory(): CategoryMemoryRow[];
  /** Write the cache and queue to storage now. */
  flush(): Promise<void>;
  /** Sign out and clear everything stored for the person on this phone. Needs a connection. */
  signOut(): Promise<void>;
}

function isMoneyMutation(m: { options: { mutationKey?: readonly unknown[] } } | undefined): boolean {
  return m?.options.mutationKey?.[0] === MONEY_KEY[0];
}

function isMemoryMutation(m: { options: { mutationKey?: readonly unknown[] } } | undefined): boolean {
  return m?.options.mutationKey?.[0] === MEMORY_KEY[0];
}

/** Writes kept in the stored queue: money, and what the app learned from a person's choices (CAT-3). */
function isQueuedMutation(m: { options: { mutationKey?: readonly unknown[] } } | undefined): boolean {
  return isMoneyMutation(m) || isMemoryMutation(m);
}

/** One queue per person: another account's waiting writes never hold up this person's. */
function scopeFor(by: string): { id: string } {
  return { id: `${MONEY_SCOPE.id}:${by}` };
}

function memoryScopeFor(by: string): { id: string } {
  return { id: `${MEMORY_SCOPE.id}:${by}` };
}

/** The cache holds the household's rows only; the queue is saved apart (QUEUE_KEY). */
const dehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] === 'smsm',
  shouldDehydrateMutation: () => false,
};

/** Every waiting write, including one that was mid-request when the app closed: replaying it is safe. */
const queueDehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: () => false,
  shouldDehydrateMutation: (m) => m.state.status === 'pending' && isQueuedMutation(m),
};

type StoredMutation = NonNullable<DehydratedState['mutations']>[number];

function opOf(m: { state?: { variables?: unknown } }): MoneyOp | undefined {
  const v = m.state?.variables as Partial<MoneyOp> | undefined;
  return v && typeof v === 'object' && typeof v.opId === 'string' && typeof v.by === 'string' ? (v as MoneyOp) : undefined;
}

function upsertById<R extends { id: string }>(rows: readonly R[], row: R): R[] {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) return [...rows, row];
  const next = [...rows];
  next[i] = row;
  return next;
}

/** A write that was discarded (the person signed out and chose to drop it) while it waited to be sent. */
class DiscardedError extends Error {
  constructor() {
    super('discarded');
    this.name = 'DiscardedError';
  }
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });
const noop = () => undefined;

export function createDataLayer(opts: DataLayerOptions): DataLayer {
  const photos = opts.photos ?? memoryPhotoStore();
  const { api, storage, network, session } = opts;
  const now = opts.now ?? (() => new Date());
  const report = opts.report ?? (() => undefined);
  const retryDelay = opts.retryDelay ?? ((attempt: number) => Math.min(1000 * 2 ** attempt, 30_000));
  let disposed = false;

  // ───────── which window owns the queue ─────────
  let role: WindowRole = 'opening';
  const roleListeners = new Set<() => void>();
  const setRole = (next: WindowRole) => {
    if (role === next) return;
    role = next;
    for (const l of roleListeners) l();
  };
  const owns = () => role === 'owner' && !disposed;
  /** Storage as this window may use it: only the owner writes (a follower reads). */
  const owned: AsyncStorage = {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => (owns() ? storage.setItem(k, v) : undefined),
    removeItem: (k) => (owns() ? storage.removeItem(k) : undefined),
  };

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

  const problems = createProblemStore(owned);
  const base = createAsyncStoragePersister({ storage: owned, key: CACHE_KEY, throttleTime: opts.throttleMs ?? 250 });
  /** A queue saved inside the cache by the first S2 build; moved to its own key on the first open. */
  let legacyQueue: StoredMutation[] = [];
  const persister: Persister = {
    persistClient: (pc) => base.persistClient(pc),
    async restoreClient() {
      const pc = await base.restoreClient();
      if (!pc) return pc;
      legacyQueue = pc.clientState.mutations;
      return { ...pc, clientState: { ...pc.clientState, mutations: [] } };
    },
    removeClient: () => base.removeClient(),
  };
  const snapshot = (): PersistedClient => ({ buster: CACHE_BUSTER, timestamp: Date.now(), clientState: dehydrate(client, dehydrateOptions) });

  let queueSaving: Promise<void> = Promise.resolve();
  /** Writes the waiting writes to their own key (owner only). */
  function saveQueue(): Promise<void> {
    if (!owns()) return queueSaving;
    const { mutations } = dehydrate(client, queueDehydrateOptions);
    const value = JSON.stringify({ v: 1, mutations });
    queueSaving = queueSaving.then(async () => { await owned.setItem(QUEUE_KEY, value); }).catch(noop);
    return queueSaving;
  }

  let flushing: Promise<void> = Promise.resolve();
  const flush = async (): Promise<void> => {
    if (!owns()) return;
    const value = JSON.stringify(snapshot());
    flushing = flushing.then(async () => { await owned.setItem(CACHE_KEY, value); }).catch(noop);
    await Promise.all([flushing, saveQueue()]);
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
    await Promise.all([
      client.query({ ...householdQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...membersQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...categoriesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...expensesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...settlementsQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...changesQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...memoryQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...recurringQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...inboxQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...chaptersQuery(api, id, hid), staleTime: 0 }).catch(noop),
      client.query({ ...commentsQuery(api, id, hid), staleTime: 0 }).catch(noop),
    ]);
    followHousehold();
    wake();
  }

  async function postRecurringOncePerDay(): Promise<void> {
    if (!network.online || !owns()) return;
    const today = opts.today();
    try {
      if ((await storage.getItem(RECURRING_DAY_KEY)) === today) return;
      const posted = await api.postDueRecurring();
      await owned.setItem(RECURRING_DAY_KEY, today);
      const id = uid();
      if (posted > 0 && id) {
        void client.invalidateQueries({ queryKey: keys.expenses(id) });
        void client.invalidateQueries({ queryKey: keys.inbox(id) });
        void client.invalidateQueries({ queryKey: keys.recurring(id) });
      }
    } catch {
      /* the nightly job posts them anyway (REC-2); try again on the next open */
    }
  }

  // ───────── sending ─────────
  /** An entry made before the partner joined gets its shares now, from the people in the household. */
  async function completeForPartner(op: ExpenseUpsert & { awaitingPartner: true }): Promise<ExpenseRow> {
    const id = uid();
    if (!id) throw new ApiError('auth', 'not signed in');
    const members = await client.query({ ...membersQuery(api, id, op.row.household_id), staleTime: 0 });
    const [a, b] = members;
    if (!a || !b) throw new ApiError('waiting', 'waiting for the partner to join');
    const household = client.getQueryData<HouseholdRow | null>(keys.household(id));
    return completedRow(op, [a.user_id, b.user_id], defaultRatioOf(household), now());
  }

  async function sendOnce(op: MoneyOp): Promise<QueuedRow | null> {
    switch (op.table) {
      case 'expenses': {
        if (op.op === 'patch') return api.patchExpense(op.id, op.patch);
        const row = op.awaitingPartner === true ? await completeForPartner(op) : op.row;
        return api.upsertExpense(expenseWrite(row));
      }
      case 'settlements':
        return op.op === 'upsert' ? api.upsertSettlement(settlementWrite(op.row)) : api.patchSettlement(op.id, op.patch);
      case 'recurring':
        return api.upsertRecurring(recurringWrite(op.row), op.isNew ? undefined : op.columns);
      case 'inbox_items':
        return op.op === 'patch' ? api.patchInboxItem(op.id, op.patch) : api.insertInboxItem({ id: op.row.id, household_id: op.row.household_id, source: op.row.source, status: op.row.status, payload: op.row.payload, receipt_path: op.row.receipt_path });
      case 'receipts': {
        // The photo goes up from the phone's photo store; a photo the phone no longer has can't be sent.
        const photo = await photos.get(op.id);
        if (!photo) throw new ApiError('refused', 'the photo is no longer on this phone', 0, 'photo-missing');
        await api.uploadReceipt(op.id, photo);
        return null;
      }
      case 'categories':
        return api.upsertCategory(categoryWrite(op.row));
      case 'chapters':
        return api.upsertChapter(chapterWrite(op.row), op.isNew ? undefined : op.columns);
      case 'comments':
        return api.upsertComment(commentWrite(op.row), op.isNew ? undefined : op.columns);
    }
  }

  /** Still in the queue (not discarded by a sign-out). */
  function queued(op: { opId: string }): boolean {
    return client.getMutationCache().getAll().some((m) => isQueuedMutation(m) && opOf(m)?.opId === op.opId);
  }

  async function send(op: MoneyOp): Promise<QueuedRow | null> {
    return sendWith(op, () => sendOnce(op));
  }

  /** Sends one queued write, waiting out anything transient; what is thrown is a refusal. */
  async function sendWith<T>(op: { opId: string; by: string }, once: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Checked before every try, after every wait: a discarded write is never sent.
        if (!owns() || !queued(op)) throw new DiscardedError();
        if (!network.online) throw new ApiError('network', 'offline');
        // Made by another account on this phone: wait for that person rather than send it as someone else.
        if (uid() !== op.by) throw new ApiError('auth', 'waiting for the person who made this change to sign in');
        const v = await checkVersion();
        // Nothing is sent until the check passes; offline ('unknown') it simply waits.
        if (v === 'stale') throw new ApiError('stale', 'this version of the app is too old to save; it is updating');
        if (v === 'unknown') throw new ApiError('network', 'could not check the app version');
        if (!queued(op)) throw new DiscardedError();
        return await once();
      } catch (err) {
        if (!isTransient(err)) throw err;
        await wait(op.opId, retryDelay(attempt));
      }
    }
  }

  function keyFor(table: MoneyOp['table'], id: string): QueryKey | null {
    switch (table) {
      case 'expenses': return keys.expenses(id);
      case 'settlements': return keys.settlements(id);
      case 'recurring': return keys.recurring(id);
      case 'inbox_items': return keys.inbox(id);
      case 'categories': return keys.categories(id);
      case 'chapters': return keys.chapters(id);
      case 'comments': return keys.comments(id);
      case 'receipts': return null;
    }
  }

  async function applyServerRow(op: MoneyOp, row: QueuedRow): Promise<void> {
    const id = uid();
    if (!id) return;
    const key = keyFor(op.table, id);
    if (key === null) return; // a photo upload: no list to update
    const wasFetching = client.isFetching({ queryKey: key }) > 0;
    // A refetch that started before this write finished could bring back the old row; cancel it, then
    // fetch again afterwards so nothing the partner changed meanwhile is missed.
    if (wasFetching) await client.cancelQueries({ queryKey: key });
    if (client.getQueryData(key) !== undefined) {
      client.setQueryData<QueuedRow[]>(key, (old) => upsertById(old ?? [], row));
    }
    if (wasFetching || client.getQueryData(key) === undefined) void client.invalidateQueries({ queryKey: key, refetchType: 'all' });
    void client.invalidateQueries({ queryKey: keys.activity(id, row.id) });
    // REC-2: a regular payment that has reached the server posts what is due at once (not at the next open).
    // Not awaited: a slow post never holds the rest of the queue (it refreshes the lists when it lands).
    if (op.table === 'recurring') void postDueNow();
  }

  /** Post what is due now, then read back what it made (entries, Inbox bills, the templates' counts). */
  async function postDueNow(): Promise<void> {
    const id = uid();
    if (!id || !network.online) return;
    try {
      const posted = await api.postDueRecurring();
      if (posted > 0) {
        await Promise.all([
          client.invalidateQueries({ queryKey: keys.expenses(id), refetchType: 'all' }),
          client.invalidateQueries({ queryKey: keys.inbox(id), refetchType: 'all' }),
          client.invalidateQueries({ queryKey: keys.recurring(id), refetchType: 'all' }),
        ]);
      }
    } catch {
      /* the next open, or the nightly job, posts it (REC-2) */
    }
  }

  client.setMutationDefaults(MONEY_KEY, {
    scope: MONEY_SCOPE,
    networkMode: 'always',
    retry: 0, // transient failures are retried inside `send`; what reaches TanStack as an error is a refusal
    mutationFn: (op: MoneyOp) => send(op),
    onSuccess: async (row: QueuedRow | null, op: MoneyOp) => {
      problems.resolveRow(opRowId(op));
      if (row) await applyServerRow(op, row);
    },
    onError: (err: Error, op: MoneyOp) => {
      if (err instanceof DiscardedError) return; // dropped on purpose: nothing to tell or keep
      const code = err instanceof ApiError ? err.code : '';
      problems.add(problemFrom(op, err.message, code, now()));
      report(err, { what: 'write refused', table: op.table, op: op.op, id: opRowId(op) });
    },
  });

  client.setMutationDefaults(MEMORY_KEY, {
    scope: MEMORY_SCOPE,
    networkMode: 'always',
    retry: 0,
    mutationFn: (op: MemoryOp) => sendWith(op, () => api.upsertCategoryMemory(op.row)),
    onSuccess: (row: CategoryMemoryRow) => {
      const id = uid();
      if (!id || client.getQueryData(keys.memory(id)) === undefined) return;
      client.setQueryData<CategoryMemoryRow[]>(keys.memory(id), (old) => [...(old ?? []).filter((r) => r.key !== row.key), row]);
    },
    // The app's memory, not the person's entry: a refusal (the category was removed meanwhile) is dropped
    // quietly and reported; the next choice for that description teaches it again.
    onError: (err: Error, op: MemoryOp) => {
      if (err instanceof DiscardedError) return;
      report(err, { what: 'category memory refused', key: op.row.key });
    },
  });

  function memoryWaiting(): MemoryOp[] {
    const me = uid();
    return client
      .getMutationCache()
      .findAll({ mutationKey: MEMORY_KEY, status: 'pending' })
      .map((m) => m.state.variables as MemoryOp | undefined)
      .filter((v): v is MemoryOp => v !== undefined && v.by === me);
  }

  function remember(op: MemoryOp): void {
    // Learning is a nicety: a read-only window (smsm open elsewhere) simply doesn't learn this time.
    if (disposed || role !== 'owner') return;
    const observer = new MutationObserver<CategoryMemoryRow, Error, MemoryOp>(client, { mutationKey: MEMORY_KEY, scope: memoryScopeFor(op.by) });
    observer
      .mutate(op)
      .catch(() => undefined)
      .finally(() => { observer.reset(); });
  }

  function memory(): CategoryMemoryRow[] {
    const id = uid();
    return id ? overlayMemory(rows<CategoryMemoryRow>(keys.memory(id)), memoryWaiting()) : [];
  }

  function waitingAll(): MoneyOp[] {
    return client
      .getMutationCache()
      .findAll({ mutationKey: MONEY_KEY, status: 'pending' })
      .map(opOf)
      .filter((v): v is MoneyOp => v !== undefined);
  }

  function waiting(): MoneyOp[] {
    const me = uid();
    return waitingAll().filter((op) => me === null || op.by === me);
  }

  function enqueue(op: MoneyOp): void {
    if (disposed) throw new Error('This store has been closed.');
    if (role !== 'owner') throw new OtherWindowError();
    const observer = new MutationObserver<QueuedRow, Error, MoneyOp>(client, { mutationKey: MONEY_KEY, scope: scopeFor(op.by) });
    observer
      .mutate(op)
      .catch(noop) // handled by the defaults' onError
      .finally(() => { observer.reset(); });
  }

  function resume(): void {
    // Straight to the mutation cache: TanStack's own resume also consults the browser-wide online flag.
    if (owns()) void client.getMutationCache().resumePausedMutations();
    wake();
  }

  /** Puts the stored queue back (owner only). An older app's queue in the cache is taken only if there is no queue of its own yet. */
  async function restoreQueue(): Promise<void> {
    let raw: string | null | undefined = null;
    let stored: StoredMutation[] = [];
    try {
      raw = await storage.getItem(QUEUE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { mutations?: unknown } | null;
        if (!parsed || !Array.isArray(parsed.mutations)) throw new Error('the stored queue has no list of writes');
        stored = parsed.mutations as StoredMutation[];
      }
    } catch (err) {
      // Never overwrite what can't be read: it is set aside (and reported) before the queue is saved again.
      if (raw) await Promise.resolve(owned.setItem(QUEUE_UNREADABLE_KEY, raw)).catch(noop);
      report(err, { what: 'stored queue unreadable' });
    }
    const candidates = raw == null ? legacyQueue : stored;
    const present = new Set(waitingAll().map((op) => op.opId));
    const mutations: StoredMutation[] = [];
    for (const item of candidates as unknown[]) {
      // Read from storage: anything could be there.
      const m = item as StoredMutation;
      const op = item && typeof item === 'object' ? opOf(m) : undefined;
      if (!op || present.has(op.opId)) continue;
      present.add(op.opId);
      // Marked paused so resuming picks up every one; in this person's own queue.
      const learned = m.mutationKey?.[0] === MEMORY_KEY[0];
      mutations.push({
        ...m,
        mutationKey: learned ? [...MEMORY_KEY] : [...MONEY_KEY],
        scope: learned ? memoryScopeFor(op.by) : scopeFor(op.by),
        state: { ...m.state, isPaused: true },
      });
    }
    legacyQueue = [];
    hydrate(client, { mutations, queries: [] });
  }

  // ───────── reads of the phone's copy ─────────
  function rows<R>(key: QueryKey): R[] {
    return client.getQueryData<R[]>(key) ?? [];
  }
  function members(): MemberRow[] {
    const id = uid();
    return id ? rows<MemberRow>(keys.members(id)) : [];
  }
  function household(): HouseholdRow | null {
    const id = uid();
    return id ? (client.getQueryData<HouseholdRow | null>(keys.household(id)) ?? null) : null;
  }
  function entries(): ExpenseRow[] {
    const id = uid();
    // BAL-6: an entry made before the partner joined shows its shares as soon as both people are known.
    return id ? overlay(rows<ExpenseRow>(keys.expenses(id)), waiting(), 'expenses', partnerCompleter(members(), household())) : [];
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
          const op = opOf(m);
          return !m.state.isPaused && !(op && waitingOps.has(op.opId));
        });
      quiet = busy ? 0 : quiet + 1;
    }
    await flush();
    await queueSaving;
    await problems.saved();
  }

  // ───────── start ─────────
  const cleanups: (() => void)[] = [];
  let lastUser: string | null = null;

  const signedIn = () => {
    const st = session.state();
    if (st.status === 'signed-in') opts.onSignedIn?.({ userId: st.userId, email: null });
  };

  /** This window now owns the queue: put it back, keep it saved, send it. */
  async function startOwning(): Promise<void> {
    await restoreQueue();
    cleanups.push(persistQueryClientSubscribe({ queryClient: client, persister, buster: CACHE_BUSTER, dehydrateOptions }));
    // The queue goes to storage the moment it changes, not on the throttle.
    cleanups.push(
      client.getMutationCache().subscribe((event) => {
        if (!isQueuedMutation(event.mutation)) return;
        const changed = event.type === 'removed' || (event.type === 'updated' && ['pending', 'success', 'error'].includes(event.action.type));
        if (changed) void saveQueue();
      }),
    );
    await saveQueue();
  }

  /** The window that owned the queue closed and handed this one the lock. */
  async function takeOver(): Promise<void> {
    await ready.catch(noop);
    if (disposed) return;
    setRole('owner');
    await problems.load();
    await startOwning();
    resume();
    if (network.online && uid()) {
      void refresh();
      void postRecurringOncePerDay();
    }
  }

  const claim = claimQueue(opts.locks, () => { void takeOver(); });

  let restored = false;
  const ready = (async () => {
    client.mount();
    setRole(await claim.role);
    await problems.load();
    try {
      await persistQueryClientRestore({ queryClient: client, persister, maxAge: Infinity, buster: CACHE_BUSTER });
    } catch {
      /* a corrupt cache is discarded by the restore itself; the queue is kept apart */
    }
    if (owns()) await startOwning();
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

  /** Clears what this phone keeps for `me` (everyone's, when nobody is known). Their waiting writes stop. */
  async function forget(me: string | null): Promise<void> {
    const cache = client.getMutationCache();
    for (const m of cache.getAll()) {
      if (isQueuedMutation(m) && (me === null || opOf(m)?.by === me)) cache.remove(m);
    }
    if (me) client.removeQueries({ queryKey: keys.all(me) });
    else client.getQueryCache().clear();
    for (const p of problems.list()) if (me === null || p.by === undefined || p.by === me) problems.dismiss(p.id);
    wake(); // the discarded writes stop waiting now, and end without sending
    await persister.removeClient();
    await saveQueue();
    await owned.removeItem(RECURRING_DAY_KEY);
  }

  return {
    client,
    geo: opts.geo ?? browserGeo(),
    rates: opts.rates ?? frankfurterRates(),
    ai: opts.ai ?? offAi,
    photos,
    downscale: opts.downscale ?? defaultDownscale,
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
      await ready.catch(noop);
      await flush();
      await problems.saved();
      disposed = true;
      claim.release();
      for (const c of cleanups.splice(0)) c();
      realtime.stop();
      client.unmount();
      wake(); // clears the timers; a closed app's waits never resolve
    },
    me: uid,
    householdId,
    members,
    household,
    entries,
    settlements,
    balance,
    waiting,
    role: () => role,
    subscribeRole(cb) {
      roleListeners.add(cb);
      return () => { roleListeners.delete(cb); };
    },
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
      // Signing out clears storage the window that owns the queue relies on.
      if (role !== 'owner') throw new OtherWindowError();
      const me = uid();
      await api.auth.signOut();
      await forget(me);
    },
  };
}
