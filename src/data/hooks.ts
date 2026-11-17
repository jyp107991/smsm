/**
 * What screens read (S2 brief, "Interfaces → Data layer"). Everything comes from the phone's copy first,
 * with the waiting writes already applied, so it works offline and shows a save at once. The balance is
 * computed here by the core's one balance function over those rows; screens never do money maths.
 */
import { useIsRestoring, useMutationState, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { balanceState, nextOneOn, netPositions, type BalanceState } from '../core/balance';
import type { Pence } from '../core/money';
import type { UserId } from '../core/split';
import type { ActivityRow, CategoryRow, ChangeRequestRow, ChapterRow, ExpenseRow, HouseholdRow, InboxItemRow, MemberRow, RecurringRow, SettlementRow } from './api';
import { activeDataLayer, DataContext } from './context';
import type { Memory } from '../core/categorise';
import { MEMORY_KEY, MONEY_KEY } from './keys';
import type { WriteProblem } from './problems';
import {
  activityQuery, categoriesQuery, changesQuery, chaptersQuery, expensesQuery, householdQuery, inboxQuery, membersQuery, membershipQuery, memoryQuery, recurringQuery,
  settlementsQuery,
} from './queries';
import { currentChapterId, setCurrentChapter, subscribeCurrentChapter } from './mutations';
import { storedCountry, storedUseLocation, subscribePlaces } from './places';
import type { DataLayer } from './queryClient';
import { expenseToLedger, memoryMap, settlementToLedger } from './rows';
import { userIdOf, type SessionState } from './session';
import type { WindowRole } from './windows';
import { overlay, overlayMemory, partnerCompleter, type MemoryOp, type MoneyOp } from './writes';

export interface DataResult<T> {
  /** Undefined until the first copy is on the phone. */
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  /** A request to the server is in flight (the data shown may be about to change). */
  isFetching: boolean;
  error: Error | null;
}

function result<T>(q: UseQueryResult, data: T | undefined): DataResult<T> {
  return { data, status: q.status, isFetching: q.isFetching, error: q.error };
}

export function useDataLayer(): DataLayer {
  return useContext(DataContext) ?? activeDataLayer();
}

export type SessionView = { status: 'loading' } | SessionState;

/** Who is signed in; 'loading' only while the phone's copy is being read from storage (milliseconds). */
export function useSession(): SessionView {
  const { session } = useDataLayer();
  const subscribe = useCallback((cb: () => void) => session.subscribe(cb), [session]);
  const get = useCallback(() => session.state(), [session]);
  const state = useSyncExternalStore(subscribe, get, get);
  return useIsRestoring() ? { status: 'loading' } : state;
}

function useUid(): string | null {
  const { session } = useDataLayer();
  const subscribe = useCallback((cb: () => void) => session.subscribe(cb), [session]);
  const get = useCallback(() => userIdOf(session.state()), [session]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The signed-in person's household id: undefined until known, null when not in one. */
function useHid(): { uid: string | null; hid: string | null | undefined; q: UseQueryResult } {
  const { api } = useDataLayer();
  const uid = useUid();
  const q = useQuery(membershipQuery(api, uid));
  return { uid, hid: q.data === undefined ? undefined : (q.data?.household_id ?? null), q };
}

/** The signed-in person's writes still waiting to be sent, oldest first (everyone's when signed out). */
function useWaitingOps(): MoneyOp[] {
  const uid = useUid();
  const ops = useMutationState({
    filters: { mutationKey: MONEY_KEY, status: 'pending' },
    select: (m) => m.state.variables as MoneyOp | undefined,
  });
  return useMemo(() => ops.filter((o): o is MoneyOp => o !== undefined && (uid === null || o.by === uid)), [ops, uid]);
}

/** The household, or null when this person isn't in one yet (setup: start or join). */
export function useHousehold(): DataResult<HouseholdRow | null> {
  const { api } = useDataLayer();
  const { uid, hid, q: mq } = useHid();
  const q = useQuery(householdQuery(api, uid, hid));
  // Not in a household (setup): known as soon as this person's membership is known.
  if (hid === null) return result(mq, null);
  return result(q, q.data);
}

/** The people in the household, in the order they joined. */
export function useMembers(): DataResult<MemberRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(membersQuery(api, uid, hid));
  return result(q, q.data);
}

/** All categories in their order, archived ones included (they keep their history; CAT-1). */
export function useCategories(): DataResult<CategoryRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(categoriesQuery(api, uid, hid));
  const ops = useWaitingOps();
  // CAT-1: a category added, edited, archived or moved on this phone shows at once, offline too.
  const data = useMemo(() => q.data && overlay(q.data, ops, 'categories').sort((a, b) => a.sort - b.sort), [q.data, ops]);
  return result(q, data);
}

/** S4a: every chapter (closed ones too), oldest first, with the waiting changes applied (CHP-1). */
export function useChapters(): DataResult<ChapterRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(chaptersQuery(api, uid, hid));
  const ops = useWaitingOps();
  const data = useMemo(() => q.data && overlay(q.data, ops, 'chapters'), [q.data, ops]);
  return result(q, data);
}

/** CHP-2: this phone's current chapter's id, when it is still there and open (a closed one is never current). */
export function useCurrentChapter(): string | null {
  const id = useSyncExternalStore(subscribeCurrentChapter, currentChapterId, () => null);
  const chapters = useChapters().data;
  // Closed (here or on the other phone): forgotten, so reopening it later never sends entries back into it unseen.
  const closed = id !== null && chapters?.some((c) => c.id === id && c.closed) === true;
  useEffect(() => { if (closed) setCurrentChapter(null); }, [closed]);
  return useMemo(() => (chapters?.some((c) => c.id === id && !c.closed) ? id : null), [chapters, id]);
}

/** PLC-3: this phone's current country (the household's home country unless set). */
export function useCurrentCountry(): string {
  const stored = useSyncExternalStore(subscribePlaces, storedCountry, () => null);
  const home = useHousehold().data?.home_country ?? 'GB';
  return stored ?? home;
}

/** PLC-2: whether this phone uses its location. */
export function useLocationSetting(): boolean {
  return useSyncExternalStore(subscribePlaces, storedUseLocation, () => false);
}

/** S3: every regular payment (paused and ended ones too), with the waiting changes applied (REC-1). */
export function useRecurring(): DataResult<RecurringRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(recurringQuery(api, uid, hid));
  const ops = useWaitingOps();
  const data = useMemo(() => q.data && overlay(q.data, ops, 'recurring'), [q.data, ops]);
  return result(q, data);
}

/** S3: the Inbox's open items, oldest first; a decision made on this phone takes its item out at once (INB-1). */
export function useInbox(): DataResult<InboxItemRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(inboxQuery(api, uid, hid));
  const ops = useWaitingOps();
  const data = useMemo(
    () => q.data && overlay(q.data, ops, 'inbox_items').filter((i) => i.status === 'open').sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
    [q.data, ops],
  );
  return result(q, data);
}

function newestFirst<R extends { date: string; created_at: string; id: string }>(a: R, b: R): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/**
 * Every expense and money-back entry, newest first, deleted ones included (`deleted_at` set; ACT-3). An
 * entry made before the partner joined shows its shares as soon as both people are known (BAL-6).
 */
export function useEntries(): DataResult<ExpenseRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(expensesQuery(api, uid, hid));
  const members = useQuery(membersQuery(api, uid, hid)).data;
  const household = useQuery(householdQuery(api, uid, hid)).data;
  const ops = useWaitingOps();
  const data = useMemo(
    () => q.data && overlay(q.data, ops, 'expenses', partnerCompleter(members ?? [], household)).sort(newestFirst),
    [q.data, ops, members, household],
  );
  return result(q, data);
}

/** Every settle-up, newest first, deleted ones included. */
export function useSettlements(): DataResult<SettlementRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(settlementsQuery(api, uid, hid));
  const ops = useWaitingOps();
  const data = useMemo(() => q.data && overlay(q.data, ops, 'settlements').sort(newestFirst), [q.data, ops]);
  return result(q, data);
}

/**
 * What the household has taught the app (CAT-2 step 1, CAT-3, CAT-4): normalised description → category and
 * usual split, with choices still waiting to be sent already applied. Empty until known.
 */
export function useCategoryMemory(): ReadonlyMap<string, Memory> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(memoryQuery(api, uid, hid));
  const ops = useMutationState({
    filters: { mutationKey: MEMORY_KEY, status: 'pending' },
    select: (m) => m.state.variables as MemoryOp | undefined,
  });
  return useMemo(() => memoryMap(overlayMemory(q.data ?? [], ops.filter((o): o is MemoryOp => o !== undefined))), [q.data, ops]);
}

/** Identity and default-split requests (PPL-4, PPL-5), oldest first. */
export function useChangeRequests(): DataResult<ChangeRequestRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(changesQuery(api, uid, hid));
  return result(q, q.data);
}

/** An entry's history from the database's log (ACT-2), newest first. Needs a connection the first time. */
export function useHistory(entityId: string): DataResult<ActivityRow[]> {
  const { api } = useDataLayer();
  const { uid, hid } = useHid();
  const q = useQuery(activityQuery(api, uid, hid, entityId));
  return result(q, q.data);
}

/** Whether the phone has a connection (as the browser reports it). */
export function useOnline(): boolean {
  const { network } = useDataLayer();
  const subscribe = useCallback((cb: () => void) => network.subscribe(cb), [network]);
  const get = useCallback(() => network.online, [network]);
  return useSyncExternalStore(subscribe, get, get);
}

export type BalanceView =
  | { status: 'loading' }
  /** BAL-6: only one person so far. */
  | { status: 'waiting-for-partner' }
  /** A row that can't be money reached the phone; the figure is not shown rather than shown wrong. */
  | { status: 'error'; error: Error }
  | {
      status: 'ready';
      /** In the order they joined. */
      members: readonly [UserId, UserId];
      /** Positive = this person is owed. The two always sum to zero (BAL-1). */
      nets: Record<UserId, Pence>;
      state: BalanceState;
      /** BAL-4: "Next one's on Sam", or null. */
      nextOneOn: UserId | null;
      /** BAL-5: computed from the phone's copy while offline. */
      offline: boolean;
    };

/** The one balance (BAL-1): core `netPositions` over the cached rows with waiting writes applied. */
export function useBalance(): BalanceView {
  const members = useMembers();
  const entries = useEntries();
  const settlements = useSettlements();
  const online = useOnline();
  return useMemo((): BalanceView => {
    if (!members.data || !entries.data || !settlements.data) return { status: 'loading' };
    const [a, b] = members.data;
    if (!a || !b) return { status: 'waiting-for-partner' };
    const pair = [a.user_id, b.user_id] as const;
    try {
      const nets = netPositions(pair, entries.data.map(expenseToLedger), settlements.data.map(settlementToLedger));
      const state = balanceState(nets, pair);
      return { status: 'ready', members: pair, nets, state, nextOneOn: nextOneOn(state), offline: !online };
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }, [members.data, entries.data, settlements.data, online]);
}

export interface SyncStatus {
  online: boolean;
  /** "3 changes waiting to sync" (OFF-5). */
  waiting: number;
  /** Ids of entries and settle-ups with a change still waiting. */
  pendingIds: ReadonlySet<string>;
  /** Writes the server refused, kept for the person to fix (OFF-5). */
  problems: readonly WriteProblem[];
  /** This app is too old to write and is updating; writes are waiting for the new version. */
  updating: boolean;
  /**
   * smsm is open in another window on this phone, which saves the changes; this one only shows them
   * (strings.windows.otherWindow). Money writes here throw OtherWindowError.
   */
  otherWindow: boolean;
}

/** Whether this window owns the queue, or another window does (read-only here). */
export function useWindowRole(): WindowRole {
  const layer = useDataLayer();
  const subscribe = useCallback((cb: () => void) => layer.subscribeRole(cb), [layer]);
  const get = useCallback(() => layer.role(), [layer]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useSyncStatus(): SyncStatus {
  const layer = useDataLayer();
  const online = useOnline();
  const ops = useWaitingOps();
  const uid = useUid();
  const all = useSyncExternalStore(layer.problems.subscribe, layer.problems.list, layer.problems.list);
  const problems = useMemo(() => all.filter((p) => p.by === undefined || uid === null || p.by === uid), [all, uid]);
  const subscribeStale = useCallback((cb: () => void) => layer.subscribeStale(cb), [layer]);
  const isStale = useCallback(() => layer.stale(), [layer]);
  const updating = useSyncExternalStore(subscribeStale, isStale, isStale);
  const otherWindow = useWindowRole() === 'follower';
  const pendingIds = useMemo(() => new Set(ops.map((o) => (o.op === 'upsert' ? o.row.id : o.id))), [ops]);
  return { online, waiting: ops.length, pendingIds, problems, updating, otherWindow };
}
