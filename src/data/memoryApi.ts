/**
 * The Api in memory: demo mode serves the seeded household from it (writes change the in-memory copy), and
 * tests use it as the fake backend. It refuses what the database refuses (check_money via validateEntry,
 * the RPCs' own checks), and `controls` lets a test go offline, refuse a call, or play the partner.
 * It holds no data of its own: the demo's seed is passed in, so none of it reaches the production bundle.
 */
import { pence, type Pence } from '../core/money';
import { validateEntry, type PenceMap, type SplitMode, type UserId } from '../core/split';
import {
  ApiError,
  type ActivityRow, type Api, type AuthUser, type CategoryRow, type ChangeRequestRow, type ChannelStatus, type ExpenseRow,
  type ExpenseWrite, type HouseholdRow, type MemberRow, type SettlementRow, type SettlementWrite, type WatchedTable,
} from './api';
import type { Json } from './database.types';

export interface MemoryTables {
  households: HouseholdRow[];
  members: MemberRow[];
  categories: CategoryRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  changeRequests: ChangeRequestRow[];
  activity: ActivityRow[];
  minClientVersion: string | null;
}

export interface MemoryCall { name: string; arg: unknown }

export interface MemoryControls {
  tables: MemoryTables;
  /** false: every call fails as if there were no connection. */
  online: boolean;
  /** Return a message to refuse a call (as the server would), or null to let it through. */
  refuse: ((name: string, arg: unknown) => string | null) | null;
  /** How long the "server" takes to answer this call, in ms (to test ordering under uneven latency). */
  delay: ((name: string, arg: unknown) => number) | null;
  /** Return true to apply a call on the "server" but lose its response (the connection drops on the way back). */
  dropResponse: ((name: string, arg: unknown) => boolean) | null;
  /** Every call that reached the "server", in order. */
  calls: MemoryCall[];
  /** The code `verifyCode` accepts. */
  code: string;
  /** Tell the app a table changed, as Realtime would. */
  emitChange(table: WatchedTable): void;
  /** Make the channel report a status (e.g. 'subscribed' again after a reconnect). */
  emitStatus(status: ChannelStatus): void;
  /** Resolves when every call made so far has finished. */
  settle(): Promise<void>;
  /** Who the "server" sees as signed in (another account on the same phone, in tests). */
  signInAs(user: AuthUser | null): void;
}

const DEFAULT_CATEGORIES: readonly [string, string, string][] = [
  ['Groceries', '🛒', 'moss'], ['Eating out', '🍜', 'amber'], ['Rent & bills', '🏠', 'walnut'], ['Utilities', '💡', 'honey'],
  ['Transport', '🚆', 'slate'], ['Subscriptions', '📺', 'plum'], ['Household', '🧺', 'oak'], ['Going out', '🍸', 'berry'],
  ['Travel', '✈️', 'lake'], ['Gifts', '🎁', 'clay'], ['Health', '💊', 'fern'], ['Other', '•', 'stone'],
];

function clone<T>(v: T): T {
  return structuredClone(v);
}

function toPenceMap(j: Json): PenceMap {
  const out: Record<string, Pence> = {};
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    for (const [k, v] of Object.entries(j)) out[k] = pence(typeof v === 'number' ? v : Number.NaN);
  }
  return out;
}

export function createMemoryApi(
  seed: Partial<MemoryTables> = {},
  opts: { user?: AuthUser | null; latencyMs?: number; now?: () => Date } = {},
): { api: Api; controls: MemoryControls } {
  const now = opts.now ?? (() => new Date());
  const tables: MemoryTables = {
    households: clone(seed.households ?? []),
    members: clone(seed.members ?? []),
    categories: clone(seed.categories ?? []),
    expenses: clone(seed.expenses ?? []),
    settlements: clone(seed.settlements ?? []),
    changeRequests: clone(seed.changeRequests ?? []),
    activity: clone(seed.activity ?? []),
    minClientVersion: seed.minClientVersion ?? null,
  };
  let user: AuthUser | null = opts.user ?? null;
  const watchers = new Set<{ householdId: string; onChange: (t: WatchedTable) => void; onStatus: (s: ChannelStatus) => void }>();
  const inflight = new Set<Promise<unknown>>();
  let activityId = 1;

  const controls: MemoryControls = {
    tables,
    online: true,
    refuse: null,
    delay: null,
    dropResponse: null,
    calls: [],
    code: '123456',
    emitChange(table) {
      for (const w of watchers) w.onChange(table);
    },
    emitStatus(status) {
      for (const w of watchers) w.onStatus(status);
    },
    async settle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
    signInAs(u) {
      user = u;
    },
  };

  /** One "server" call: checks the connection and the refusal hook, then runs `fn` on the tables. */
  function call<T>(name: string, arg: unknown, fn: () => T): Promise<T> {
    const p = (async () => {
      const wait = controls.delay?.(name, arg) ?? opts.latencyMs ?? 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      else await Promise.resolve();
      if (!controls.online) throw new ApiError('network', 'TypeError: Failed to fetch', 0);
      controls.calls.push({ name, arg: clone(arg) });
      const refusal = controls.refuse?.(name, arg) ?? null;
      if (refusal !== null) throw new ApiError('refused', refusal, 400, 'P0001');
      const out = clone(fn());
      if (controls.dropResponse?.(name, arg)) throw new ApiError('network', 'TypeError: Failed to fetch', 0);
      return out;
    })();
    inflight.add(p);
    void p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  }

  const me = (): AuthUser => {
    if (!user) throw new ApiError('auth', 'not signed in', 401);
    return user;
  };
  const myMember = () => tables.members.find((m) => m.user_id === me().userId) ?? null;
  const myHousehold = () => myMember()?.household_id ?? null;
  const mine = <R extends { household_id: string }>(rows: R[]) => rows.filter((r) => r.household_id === myHousehold());
  const refuse = (message: string, code = 'P0001'): never => { throw new ApiError('refused', message, 400, code); };

  function log(entity: string, id: string, action: string, summary: Json, householdId: string) {
    tables.activity.push({ id: activityId++, household_id: householdId, actor: user?.userId ?? null, entity, entity_id: id, action, summary: summary ?? {}, at: now().toISOString() });
  }

  function checkMoney(row: ExpenseRow) {
    const ids = tables.members.filter((m) => m.household_id === row.household_id).map((m) => m.user_id);
    const [a, b] = ids;
    if (a === undefined || b === undefined) refuse('paid or shares name a non-member');
    const members = [a, b] as readonly [UserId, UserId];
    let paid: PenceMap;
    let shares: PenceMap;
    try {
      paid = toPenceMap(row.paid);
      shares = toPenceMap(row.shares);
    } catch {
      return refuse('amounts must be whole pence');
    }
    const errors = validateEntry({ amount: row.amount_pence as Pence, paid, shares, mode: row.split_mode as SplitMode, members });
    if (errors.length > 0) refuse(errors.join(' '));
  }

  function writeRow<R extends { id: string; household_id: string; updated_at: string; deleted_at: string | null }>(
    list: R[], write: Partial<R> & { id: string; household_id: string }, entity: string, fill: (w: typeof write) => R, check?: (r: R) => void,
  ): R {
    if (write.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
    const i = list.findIndex((r) => r.id === write.id);
    const stamp = now().toISOString();
    const existing = i === -1 ? undefined : list[i];
    if (existing && existing.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
    const next: R = existing ? { ...existing, ...write, updated_at: stamp } : fill(write);
    check?.(next);
    if (existing) list[i] = next;
    else list.push(next);
    log(entity, next.id, existing ? 'edited' : 'created', {}, next.household_id);
    return next;
  }

  function patchRow<R extends { id: string; household_id: string; updated_at: string; deleted_at: string | null }>(
    list: R[], id: string, patch: { deleted_at: string | null }, entity: string,
  ): R {
    const i = list.findIndex((r) => r.id === id && r.household_id === myHousehold());
    const existing = list[i];
    if (!existing) return refuse('JSON object requested, multiple (or no) rows returned', 'PGRST116');
    const next: R = { ...existing, ...patch, updated_at: now().toISOString() };
    list[i] = next;
    const action = existing.deleted_at === null && patch.deleted_at !== null ? 'deleted' : existing.deleted_at !== null && patch.deleted_at === null ? 'restored' : 'edited';
    log(entity, id, action, {}, next.household_id);
    return next;
  }

  const api: Api = {
    auth: {
      sendCode: (email) => call('auth.sendCode', email, () => undefined),
      verifyCode: (email, code) =>
        call('auth.verifyCode', { email, code }, () => {
          if (code !== controls.code) return refuse('Token has expired or is invalid', 'otp_expired');
          const u: AuthUser = { userId: user?.userId ?? crypto.randomUUID(), email };
          user = u;
          return u;
        }),
      signOut: () => call('auth.signOut', null, () => { user = null; }),
    },
    membership: (userId) => call('membership', userId, () => tables.members.find((m) => m.user_id === userId) ?? null),
    household: (hid) => call('household', hid, () => tables.households.find((h) => h.id === hid && h.id === myHousehold()) ?? null),
    members: (hid) => call('members', hid, () => mine(tables.members).sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1))),
    categories: (hid) => call('categories', hid, () => mine(tables.categories).sort((a, b) => a.sort - b.sort)),
    expenses: (hid) => call('expenses', hid, () => mine(tables.expenses)),
    settlements: (hid) => call('settlements', hid, () => mine(tables.settlements)),
    changeRequests: (hid) => call('changeRequests', hid, () => mine(tables.changeRequests)),
    activity: (_hid, entityId) =>
      call('activity', entityId, () => mine(tables.activity).filter((a) => a.entity_id === entityId).reverse()),
    upsertExpense: (row: ExpenseWrite) =>
      call('upsertExpense', row, () =>
        writeRow(tables.expenses, row, 'expense', (w) => ({
          items: null, bill_total_pence: null, place: null, lat: null, lng: null, original_amount: null, original_currency: null,
          fx_rate: null, receipt_path: null, external_id: null, merchant: null, external_category: null, account_id: null,
          recurring_id: null, occurrence_date: null, created_by: me().userId, created_at: now().toISOString(), updated_by: me().userId,
          updated_at: now().toISOString(), deleted_at: null, ...(w as ExpenseWrite),
        }), checkMoney)),
    patchExpense: (id, patch) => call('patchExpense', { id, patch }, () => patchRow(tables.expenses, id, patch, 'expense')),
    upsertSettlement: (row: SettlementWrite) =>
      call('upsertSettlement', row, () =>
        writeRow(tables.settlements, row, 'settlement', (w) => ({
          created_by: me().userId, created_at: now().toISOString(), updated_at: now().toISOString(), deleted_at: null, ...(w as SettlementWrite),
        }), (r) => {
          if (r.from_user === r.to_user || r.amount_pence <= 0) refuse('new row violates check constraint "settlements_check"', '23514');
        })),
    patchSettlement: (id, patch) => call('patchSettlement', { id, patch }, () => patchRow(tables.settlements, id, patch, 'settlement')),
    createHousehold: () =>
      call('createHousehold', null, () => {
        if (myMember()) refuse('already in a household');
        const id = crypto.randomUUID();
        const stamp = now().toISOString();
        tables.households.push({
          id, join_code: crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), home_country: 'GB', default_ratio: null,
          joint_enabled: false, joint_ratio: null, created_at: stamp,
        });
        tables.members.push({ household_id: id, user_id: me().userId, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: stamp });
        DEFAULT_CATEGORIES.forEach(([name, emoji, colour], i) => {
          tables.categories.push({ id: crypto.randomUUID(), household_id: id, name, emoji, colour, default_ratio: null, archived: false, sort: i + 1, updated_at: stamp });
        });
        return id;
      }),
    joinHousehold: (code) =>
      call('joinHousehold', code, () => {
        if (myMember()) refuse('already in a household');
        const h = tables.households.find((x) => x.join_code === code.trim().toUpperCase());
        if (!h) return null;
        if (tables.members.filter((m) => m.household_id === h.id).length >= 2) refuse('this household already has two people');
        tables.members.push({ household_id: h.id, user_id: me().userId, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: now().toISOString() });
        return h.id;
      }),
    setIdentity: (name, animal) =>
      call('setIdentity', { name, animal }, () => {
        const m = myMember();
        if (!m) return refuse('not in a household');
        if (m.locked_at) refuse('already set; request a change instead');
        if (mine(tables.members).some((x) => x.user_id !== m.user_id && x.animal === animal)) refuse(`your partner already picked the ${animal}`);
        Object.assign(m, { display_name: name.trim(), animal, locked_at: now().toISOString() });
      }),
    setMonzoMe: (username) =>
      call('setMonzoMe', username, () => {
        if (username !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(username)) refuse('that does not look like a monzo.me name');
        const m = myMember();
        if (m) m.monzo_me = username;
      }),
    requestChange: (kind, payload) =>
      call('requestChange', { kind, payload }, () => {
        const hid = myHousehold();
        if (!hid) return refuse('not in a household');
        if (mine(tables.members).length < 2) refuse('your partner has not joined yet');
        if (tables.changeRequests.some((c) => c.household_id === hid && c.kind === kind && c.status === 'pending')) {
          refuse('duplicate key value violates unique constraint "change_requests_one_pending"', '23505');
        }
        const id = crypto.randomUUID();
        tables.changeRequests.push({ id, household_id: hid, requested_by: me().userId, kind, payload: payload ?? {}, status: 'pending', decided_by: null, created_at: now().toISOString(), decided_at: null });
        return id;
      }),
    decideChange: (id, approve) =>
      call('decideChange', { id, approve }, () => {
        const cr = tables.changeRequests.find((c) => c.id === id && c.household_id === myHousehold());
        if (!cr || cr.status !== 'pending') return refuse('no pending request');
        const stamp = now().toISOString();
        if (cr.requested_by === me().userId) {
          if (approve) refuse('your partner has to approve this');
          Object.assign(cr, { status: 'cancelled', decided_by: me().userId, decided_at: stamp });
          return;
        }
        if (approve) {
          const p = cr.payload as Record<string, Json>;
          if (cr.kind === 'identity') {
            const target = tables.members.find((m) => m.household_id === cr.household_id && m.user_id === p['user_id']);
            const other = tables.members.find((m) => m.household_id === cr.household_id && m.user_id !== p['user_id']);
            if (target) {
              if (other && typeof p['animal'] === 'string' && other.animal === p['animal']) other.animal = target.animal;
              if (typeof p['display_name'] === 'string') target.display_name = p['display_name'].trim();
              if (typeof p['animal'] === 'string') target.animal = p['animal'];
            }
          } else {
            const h = tables.households.find((x) => x.id === cr.household_id);
            if (h) h.default_ratio = p['ratio'] ?? null;
          }
        }
        Object.assign(cr, { status: approve ? 'approved' : 'declined', decided_by: me().userId, decided_at: stamp });
      }),
    postDueRecurring: () => call('postDueRecurring', null, () => 0),
    watchHousehold(householdId, onChange, onStatus) {
      const w = { householdId, onChange, onStatus };
      watchers.add(w);
      queueMicrotask(() => { if (watchers.has(w)) onStatus('subscribed'); });
      return () => { watchers.delete(w); };
    },
  };
  return { api, controls };
}
