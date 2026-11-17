/**
 * Regression tests for the second review of the S2 data layer (ENGINEERING §5, "Bugs"): each reproduces a
 * finding, failed before its fix, and stays. Against the in-memory Api (memoryApi.ts); two "windows" share
 * one storage and one in-memory Web Locks.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AsyncStorage } from '@tanstack/react-query-persist-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pence } from '../core/money';
import { demoHousehold, JAE, SAM } from '../../tests/fixtures/household';
import { FakeServer } from '../../tests/fixtures/fake-supabase';
import { supabaseApi, type Api, type ExpenseRow, type ExpenseWrite } from './api';
import type { Database } from './database.types';
import { DataProvider } from './DataProvider';
import { useBalance, useSyncStatus } from './hooks';
import { createMemoryApi } from './memoryApi';
import * as m from './mutations';
import { manualNetwork, type Network } from './network';
import { refusalReason } from './problems';
import { CACHE_KEY, CACHE_BUSTER, QUEUE_KEY, createDataLayer, type DataLayer } from './queryClient';
import type { SessionKeeper, SessionState } from './session';
import { memoryStorage } from './storage';
import type { VersionCheck } from './version';
import { claimQueue, memoryLocks, OtherWindowError, type QueueLocks } from './windows';
import { EntryInvalidError, expenseWrite } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = '2026-11-14';

function manualSession(userId: string | null) {
  let st: SessionState = userId ? { status: 'signed-in', userId, refreshPending: false } : { status: 'signed-out' };
  const ls = new Set<() => void>();
  const k: SessionKeeper & { set(u: string | null): void } = {
    ready: Promise.resolve(),
    state: () => st,
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l); }; },
    dispose: () => undefined,
    set(u) {
      st = u ? { status: 'signed-in', userId: u, refreshPending: false } : { status: 'signed-out' };
      for (const l of ls) l();
    },
  };
  return k;
}

function seed() {
  const s = demoHousehold(TODAY);
  return { households: [s.household], members: s.members, categories: s.categories, expenses: [] as ExpenseRow[], settlements: [] };
}

const draft = (amount: number, description = 'Tesco') => ({
  description, amount: pence(amount), date: TODAY, categoryId: null, payer: JAE,
  split: { mode: 'ratio' as const, ratio: { [JAE]: 50, [SAM]: 50 } },
});

const open: DataLayer[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

function layerOn(o: {
  api: Api; storage?: AsyncStorage; network?: Network; session?: SessionKeeper; locks?: QueueLocks;
  versionCheck?: () => Promise<VersionCheck>; retryDelay?: (attempt: number) => number;
}): DataLayer {
  const layer = createDataLayer({
    api: o.api, storage: o.storage ?? memoryStorage(), network: o.network ?? manualNetwork(true), session: o.session ?? manualSession(JAE),
    today: () => TODAY,
    ...(o.locks ? { locks: o.locks } : {}),
    ...(o.versionCheck ? { versionCheck: o.versionCheck } : {}),
    ...(o.retryDelay ? { retryDelay: o.retryDelay } : {}),
  });
  open.push(layer);
  return layer;
}

const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });

describe('two windows of the app on one phone (OFF-5, OFF-7, ADD-6)', () => {
  it('OFF-7 ADD-6 only the window that owns the queue sends it; the other can’t replay an old queue over a newer value (£50 stays £50)', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const amountOf = (id: string) => controls.tables.expenses.find((e) => e.id === id)?.amount_pence;
    const storage = memoryStorage();
    const locks = memoryLocks();
    const netA = manualNetwork(true);
    const A = layerOn({ api, storage, network: netA, locks });
    await A.ready;
    await A.idle();
    netA.set(false);
    const id = m.addExpense(draft(1000), A);
    m.editExpense(id, { amount: pence(2000) }, A);
    await A.flush();

    const netB = manualNetwork(false);
    const B = layerOn({ api, storage, network: netB, locks });
    await B.ready;
    expect(A.role()).toBe('owner');
    expect(B.role()).toBe('follower');
    expect(B.waiting()).toHaveLength(0); // the queue is A's: B never restores it
    expect(() => m.addExpense(draft(700), B)).toThrow(OtherWindowError);

    netA.set(true);
    await vi.waitFor(() => { expect(A.waiting()).toHaveLength(0); });
    m.editExpense(id, { amount: pence(5000) }, A);
    await vi.waitFor(() => { expect(A.waiting()).toHaveLength(0); });
    expect(amountOf(id)).toBe(5000);

    netB.set(true);
    await B.idle();
    expect(amountOf(id)).toBe(5000);

    // A closes: B takes the queue over, finds nothing old to replay, and now saves.
    await A.dispose();
    await vi.waitFor(() => { expect(B.role()).toBe('owner'); });
    await B.idle();
    expect(amountOf(id)).toBe(5000);
    const bakery = m.addExpense(draft(700, 'Bakery'), B);
    await vi.waitFor(() => { expect(amountOf(bakery)).toBe(700); });
  });

  it('OFF-5 a write queued in one window is never erased by the other; when the owner closes, the other takes it over and sends it once', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const storage = memoryStorage();
    const locks = memoryLocks();
    const nA = manualNetwork(true);
    const nB = manualNetwork(true);
    const A = layerOn({ api, storage, network: nA, locks });
    const B = layerOn({ api, storage, network: nB, locks });
    await A.ready;
    await B.ready;
    await A.idle();
    await B.idle();
    nA.set(false);
    nB.set(false);
    const id = m.addExpense(draft(1000), A);
    await A.flush();
    await B.flush(); // B goes to the background, or any cache event: it must not write the queue
    await A.dispose();
    await vi.waitFor(() => { expect(B.role()).toBe('owner'); });
    await vi.waitFor(() => { expect(B.waiting().map((o) => o.opId)).toHaveLength(1); });
    await B.dispose();

    const nC = manualNetwork(false);
    const C = layerOn({ api, storage, network: nC, locks });
    await C.ready;
    // (C may open a moment before B's lock is given back; it then takes over at once.)
    await vi.waitFor(() => { expect(C.role()).toBe('owner'); });
    await vi.waitFor(() => { expect(C.waiting()).toHaveLength(1); });
    nC.set(true);
    await vi.waitFor(() => { expect(C.waiting()).toHaveLength(0); });
    expect(controls.tables.expenses.filter((e) => e.id === id)).toHaveLength(1);
  });

  it('OFF-5 the other window says so (useSyncStatus().otherWindow) until it takes over', async () => {
    const { api } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const storage = memoryStorage();
    const locks = memoryLocks();
    const A = layerOn({ api, storage, locks });
    await A.ready;
    const B = layerOn({ api, storage, locks });
    const { result } = renderHook(() => useSyncStatus(), { wrapper: wrapperFor(B) });
    await waitFor(() => { expect(result.current.otherWindow).toBe(true); });
    expect(() => { m.dismissProblem('x', B); }).toThrow(OtherWindowError);
    await A.dispose();
    await waitFor(() => { expect(result.current.otherWindow).toBe(false); });
  });

  it('OFF-5 a reloaded page opens as the owner when the page it replaces lets go a moment later (no "another window" flash)', async () => {
    const locks = memoryLocks();
    const first = claimQueue(locks, () => undefined);
    await expect(first.role).resolves.toBe('owner');
    const tookOver = vi.fn();
    const second = claimQueue(locks, tookOver);
    setTimeout(() => { first.release(); }, 50);
    await expect(second.role).resolves.toBe('owner');
    expect(tookOver).not.toHaveBeenCalled();
    // A window opened while the owner stays is a follower, and is handed the queue when the owner closes.
    const third = claimQueue(locks, tookOver, 20);
    await expect(third.role).resolves.toBe('follower');
    second.release();
    await vi.waitFor(() => { expect(tookOver).toHaveBeenCalledTimes(1); });
    third.release();
  });

  it('OFF-5 where the browser refuses Web Locks, the window works as the only one', async () => {
    const refusing: QueueLocks = { request: () => Promise.reject(new DOMException('no', 'SecurityError')) };
    await expect(claimQueue(refusing, () => undefined).role).resolves.toBe('owner');
    await expect(claimQueue(null, () => undefined).role).resolves.toBe('owner');
  });
});

describe('edits that don’t touch money keep it exactly (ACT-5, SPL-5)', () => {
  async function withRow(row: Partial<ExpenseRow>) {
    const s = seed();
    const base = {
      id: '11111111-1111-4111-8111-111111111111', household_id: s.households[0]?.id ?? '', kind: 'expense', description: 'Sofa', date: TODAY,
      category_id: null, chapter_id: null, items: null, bill_total_pence: null, country: 'GB', place: null, lat: null, lng: null,
      original_amount: null, original_currency: null, fx_rate: null, notes: null, tags: [], receipt_path: null, source: 'recurring', external_id: null,
      merchant: null, external_category: null, account_id: null, recurring_id: null, occurrence_date: null, refund_of: null,
      created_by: JAE, created_at: '2026-11-01T00:00:00Z', updated_by: JAE, updated_at: '2026-11-01T00:00:00Z', deleted_at: null, ...row,
    } as ExpenseRow;
    const { api, controls } = createMemoryApi({ ...s, expenses: [base] }, { user: { userId: JAE, email: null } });
    const layer = layerOn({ api });
    await layer.ready;
    await layer.idle();
    return { layer, controls, id: base.id };
  }
  const money = (r: ExpenseRow | undefined) => r && { amount: r.amount_pence, paid: r.paid, shares: r.shares, via: r.paid_via, mode: r.split_mode, params: r.split_params };

  it('ACT-5 renaming a joint-account entry (70/30) keeps its money; changing its amount is refused in plain words', async () => {
    const { layer, controls, id } = await withRow({
      amount_pence: 10000, paid: { [JAE]: 5000, [SAM]: 5000 }, paid_via: 'joint', split_mode: 'ratio',
      split_params: { [JAE]: 70, [SAM]: 30 }, shares: { [JAE]: 7000, [SAM]: 3000 },
    });
    const before = money(controls.tables.expenses[0]);
    const balance = layer.balance();
    m.editExpense(id, { description: 'Sofa (renamed)' }, layer);
    await layer.idle();
    expect(controls.tables.expenses[0]?.description).toBe('Sofa (renamed)');
    expect(money(controls.tables.expenses[0])).toEqual(before);
    expect(layer.balance()).toEqual(balance);
    expect(() => { m.editExpense(id, { amount: pence(12000) }, layer); }).toThrow(new EntryInvalidError([m.JOINT_MONEY_EDIT]));
  });

  it('ACT-5 renaming a £10.01 entry stored as 334/667 with no percentages keeps every penny; an amount change asks for the split', async () => {
    const { layer, controls, id } = await withRow({
      amount_pence: 1001, paid: { [JAE]: 1001 }, paid_via: 'person', split_mode: 'ratio', split_params: null, shares: { [JAE]: 334, [SAM]: 667 },
    });
    const before = money(controls.tables.expenses[0]);
    const balance = layer.balance();
    m.editExpense(id, { description: 'Sofa (renamed)', tags: ['home'] }, layer);
    await layer.idle();
    expect(money(controls.tables.expenses[0])).toEqual(before);
    expect(layer.balance()).toEqual(balance);
    expect(() => { m.editExpense(id, { amount: pence(2000) }, layer); }).toThrow(new EntryInvalidError([m.SPLIT_AGAIN]));
    m.editExpense(id, { amount: pence(2000), split: { mode: 'ratio', ratio: { [JAE]: 50, [SAM]: 50 } } }, layer);
    await layer.idle();
    expect(controls.tables.expenses[0]).toMatchObject({ amount_pence: 2000, shares: { [JAE]: 1000, [SAM]: 1000 } });
  });

  it('SPL-5 a ratio stored without percentages that a whole-number split gives back exactly is read back for an amount change', async () => {
    const { layer, controls, id } = await withRow({
      amount_pence: 1000, paid: { [JAE]: 1000 }, paid_via: 'person', split_mode: 'ratio', split_params: null, shares: { [JAE]: 600, [SAM]: 400 },
    });
    m.editExpense(id, { amount: pence(2000) }, layer);
    await layer.idle();
    expect(controls.tables.expenses[0]).toMatchObject({ amount_pence: 2000, shares: { [JAE]: 1200, [SAM]: 800 } });
  });
});

describe('sign-out (OFF-5)', () => {
  it('OFF-5 writes discarded at sign-out are never sent, even when the same person signs in again without a reload', async () => {
    const { api: raw, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    // Signing out and in again, as far as the server is concerned, is a no-op here.
    const api: Api = { ...raw, auth: { ...raw.auth, signOut: () => Promise.resolve() } };
    let v: VersionCheck = 'unknown';
    const session = manualSession(JAE);
    const layer = layerOn({ api, session, versionCheck: () => Promise.resolve(v), retryDelay: () => 20 });
    await layer.ready;
    const id = m.addExpense(draft(1000), layer);
    await new Promise((r) => setTimeout(r, 30));
    expect(layer.waiting()).toHaveLength(1);
    await m.signOut({ discardWaiting: true }, layer);
    session.set(null);
    expect(layer.waiting()).toHaveLength(0);
    session.set(JAE);
    v = 'current';
    await new Promise((r) => setTimeout(r, 200));
    expect(controls.calls.filter((c) => c.name === 'upsertExpense')).toHaveLength(0);
    expect(controls.tables.expenses.map((e) => e.id)).not.toContain(id);
    expect(layer.problems.list()).toHaveLength(0);
  });

  it('OFF-5 sign-out refuses while a refused entry is kept to fix, unless discarding was chosen', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    controls.refuse = (name) => (name === 'upsertExpense' ? 'shares (1) must sum to amount (2)' : null);
    const layer = layerOn({ api });
    await layer.ready;
    m.addExpense(draft(1000), layer);
    await layer.idle();
    expect(layer.problems.list()).toHaveLength(1);
    const err = await m.signOut({}, layer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(m.ChangesWaitingError);
    expect(err).toMatchObject({ count: 1, refused: 1 });
    expect(layer.problems.list()).toHaveLength(1);
    await m.signOut({ discardWaiting: true }, layer);
    expect(layer.problems.list()).toHaveLength(0);
  });
});

describe('before the partner joins (BAL-6)', () => {
  it('BAL-6 an entry made alone shows its shares in the balance as soon as both people are known, before it is sent (version check unknown)', async () => {
    const s = seed();
    const sam = s.members.find((x) => x.user_id === SAM);
    const { api, controls } = createMemoryApi({ ...s, members: s.members.filter((x) => x.user_id === JAE) }, { user: { userId: JAE, email: null } });
    const layer = layerOn({ api, versionCheck: () => Promise.resolve('unknown' as const), retryDelay: () => 10_000 });
    await layer.ready;
    const id = m.addExpense({ ...draft(4250), split: { mode: 'ratio', ratio: { [JAE]: 50 } } }, layer);
    expect(layer.balance()).toEqual({});
    if (sam) controls.tables.members.push(sam);
    await layer.refresh();
    expect(layer.members()).toHaveLength(2);
    expect(layer.entries().find((e) => e.id === id)).toMatchObject({ shares: { [JAE]: 2125, [SAM]: 2125 } });
    expect(layer.balance()).toEqual({ [JAE]: 2125, [SAM]: -2125 });
    const { result } = renderHook(() => useBalance(), { wrapper: wrapperFor(layer) });
    await waitFor(() => { expect(result.current).toMatchObject({ status: 'ready', nets: { [JAE]: 2125, [SAM]: -2125 } }); });
    expect(controls.calls.filter((c) => c.name === 'upsertExpense')).toHaveLength(0);
  });
});

describe('smaller findings', () => {
  it('OFF-5 fixing a refused edit starts from what the person entered, not from the stored row', async () => {
    const s = seed();
    const [good, removed] = [s.categories[0]?.id ?? null, s.categories[1]?.id ?? null];
    const { api, controls } = createMemoryApi(s, { user: { userId: JAE, email: null } });
    const layer = layerOn({ api });
    await layer.ready;
    const id = m.addExpense(draft(1000), layer);
    await layer.idle();
    controls.refuse = (name, arg) =>
      name === 'upsertExpense' && (arg as ExpenseWrite).category_id === removed ? 'insert or update on table "expenses" violates foreign key constraint' : null;
    m.editExpense(id, { description: 'Big shop', amount: pence(2000), categoryId: removed }, layer);
    await layer.idle();
    expect(layer.problems.list()).toHaveLength(1);
    m.editExpense(id, { categoryId: good }, layer); // the fix: another category
    await layer.idle();
    expect(controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ description: 'Big shop', amount_pence: 2000, category_id: good });
    expect(layer.problems.list()).toHaveLength(0);
  });

  it('ADD-6 Undo (delete) of a refused new entry just lets the problem go', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    controls.refuse = (name) => (name === 'upsertExpense' ? 'shares (1) must sum to amount (2)' : null);
    const layer = layerOn({ api });
    await layer.ready;
    const id = m.addExpense(draft(1000), layer);
    await layer.idle();
    expect(layer.problems.list()).toHaveLength(1);
    m.deleteExpense(id, layer);
    await layer.idle();
    expect(layer.problems.list()).toHaveLength(0);
    expect(controls.calls.filter((c) => c.name === 'patchExpense')).toHaveLength(0);
  });

  it('OFF-5 writes left waiting by another account on this phone don’t hold up the person signed in now', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const session = manualSession(JAE);
    const net = manualNetwork(true);
    const layer = layerOn({ api, session, network: net, retryDelay: () => 20 });
    await layer.ready;
    await layer.idle();
    net.set(false);
    const jaes = m.addExpense(draft(1000), layer);
    // Jae was signed out by the server (the queue is kept for Jae); Sam signs in on this phone.
    session.set(SAM);
    controls.signInAs({ userId: SAM, email: null });
    net.set(true);
    await vi.waitFor(() => { expect(layer.members()).toHaveLength(2); });
    const sams = m.addExpense({ ...draft(2000, 'Sam’s shop'), payer: SAM }, layer);
    await vi.waitFor(() => { expect(controls.tables.expenses.map((e) => e.id)).toContain(sams); });
    expect(controls.tables.expenses.map((e) => e.id)).not.toContain(jaes);
    expect(layer.waiting()).toHaveLength(0); // Sam's own: none left
  });

  it('OFF-5 the queue is kept apart from the cache: a corrupt or discarded cache doesn’t lose it', async () => {
    for (const cache of ['{not json', JSON.stringify({ buster: 'an-older-buster', timestamp: 0, clientState: { mutations: [], queries: [] } })]) {
      const { api } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
      const storage = memoryStorage();
      const netA = manualNetwork(true);
      const A = layerOn({ api, storage, network: netA });
      await A.ready;
      await A.idle();
      netA.set(false);
      m.addExpense(draft(1000), A);
      await A.dispose();
      storage.map.set(CACHE_KEY, cache);
      const B = layerOn({ api, storage, network: manualNetwork(false) });
      await B.ready;
      expect(B.waiting()).toHaveLength(1);
    }
  });

  it('OFF-5 a queue saved inside the cache by the first S2 build is kept and moved to its own key', async () => {
    const { api } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const first = memoryStorage();
    const netA = manualNetwork(true);
    const A = layerOn({ api, storage: first, network: netA });
    await A.ready;
    await A.idle();
    netA.set(false);
    m.addExpense(draft(1000), A);
    await A.dispose();
    const { mutations } = JSON.parse(first.map.get(QUEUE_KEY) ?? '{}') as { mutations: unknown[] };
    const old = memoryStorage([[CACHE_KEY, JSON.stringify({ buster: CACHE_BUSTER, timestamp: 0, clientState: { mutations, queries: [] } })]]);
    const B = layerOn({ api, storage: old, network: manualNetwork(false) });
    await B.ready;
    expect(B.waiting()).toHaveLength(1);
    expect(old.map.get(QUEUE_KEY)).toContain(B.waiting()[0]?.opId);
  });

  it('OFF-5 a refusal is named by what the server said: a message that only mentions an amount is not a money problem', () => {
    expect(refusalReason("Could not find the 'amount' column of 'expenses' in the schema cache", 'PGRST204')).toBe('other');
    expect(refusalReason('shares (1) must sum to amount (2)', 'P0001')).toBe('money');
    expect(refusalReason('new row for relation "expenses" violates check constraint "expenses_amount_pence_check"', '23514')).toBe('money');
    expect(refusalReason('treat: whoever pays covers it', 'P0001')).toBe('money');
    expect(refusalReason('paid or shares name a non-member', 'P0001')).toBe('not-member');
  });

  it('OFF-7 every Realtime subscription has a topic of its own (supabase-js reuses a channel by topic)', () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const phone = server.phone('jae', h.members[0]);
    const api = supabaseApi(phone.client as SupabaseClient<Database>);
    const stops = [api.watchHousehold(h.id, () => undefined, () => undefined), api.watchHousehold(h.id, () => undefined, () => undefined)];
    const names = [...phone.channels].map((c) => c.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n.startsWith(`household:${h.id}:`)).toBe(true);
    for (const stop of stops) stop();
  });

  it('ACT-2 the phone never says who made a row; the database records the person signed in', async () => {
    const { api, controls } = createMemoryApi(seed(), { user: { userId: JAE, email: null } });
    const layer = layerOn({ api });
    await layer.ready;
    m.addExpense(draft(1000), layer);
    await layer.idle();
    const sent = controls.calls.find((c) => c.name === 'upsertExpense')?.arg as Record<string, unknown> | undefined;
    expect(sent).toBeDefined();
    expect(sent).not.toHaveProperty('created_by');
    expect(Object.keys(expenseWrite(layer.entries()[0] as ExpenseRow))).not.toContain('created_by');
  });
});
