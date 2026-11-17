/**
 * The data layer author's own focused tests, beyond the independent contract tests (store/session/version):
 * ordering under uneven latency, a write mid-request at close, immediate persistence, entries made before
 * the partner joins, a forced sign-out keeping the queue, the hooks, and the updater. Against the fake
 * Supabase in tests/fixtures.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pence } from '../core/money';
import { FakeNetwork, FakeServer, FakeStorage, type FakeUser, type Household } from '../../tests/fixtures/fake-supabase';
import type { Database } from './database.types';
import { DataProvider } from './DataProvider';
import { useBalance, useEntries, useSession, useSyncStatus } from './hooks';
import { ChangesWaitingError, OfflineError, createHousehold, signOut } from './mutations';
import { QUEUE_KEY } from './queryClient';
import { createAppUpdater } from './staleApp';
import { createStore, type Store } from './store';
import { requestPersistentStorage } from './storage';
import { EntryInvalidError } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = '2026-11-14';
const open: Store[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.dispose();
});

function openStore(server: FakeServer, user: FakeUser, opts: { storage?: FakeStorage; network?: FakeNetwork } = {}) {
  const storage = opts.storage ?? new FakeStorage();
  const network = opts.network ?? new FakeNetwork(true);
  const phone = server.phone(user.email, user, network);
  const store = createStore({ client: phone.client as SupabaseClient<Database>, storage, network, appVersion: '0.1.0', today: () => TODAY });
  open.push(store);
  return { store, storage, network, phone };
}

const tesco = (h: Household, amount = 4250, description = 'Tesco') => ({
  description, amount: pence(amount), date: TODAY, categoryId: h.categories.Groceries ?? null, payer: h.members[0].id,
  split: { mode: 'ratio' as const, ratio: { [h.members[0].id]: 50, [h.members[1].id]: 50 } },
});

const writtenIds = (server: FakeServer) => server.writes().flatMap((w) => w.rows.map((r) => r.id).filter((id): id is string => typeof id === 'string'));

describe('order and durability', () => {
  it('OFF-2 ADD-6 writes go one at a time: a slow first answer is not overtaken', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;
    network.set(false);
    const a = store.addExpense(tesco(h, 1000, 'First'));
    const b = store.addExpense(tesco(h, 2000, 'Second'));
    // Every request to the server is slowed, the first one most: in parallel, B would land before A.
    const query = (server.phone('probe2', h.members[0]).client as { from: (t: string) => object }).from('expenses');
    const qproto: { then: (...args: unknown[]) => unknown } = Object.getPrototypeOf(query);
    const original = qproto.then;
    let first = true;
    qproto.then = function (this: unknown, ...args: unknown[]) {
      const delay = first ? 40 : 0;
      first = false;
      return new Promise((r) => setTimeout(r, delay)).then((): unknown => original.apply(this, args));
    };
    try {
      network.set(true);
      await store.idle();
      await vi.waitFor(() => { expect(store.pendingCount()).toBe(0); });
    } finally {
      qproto.then = original;
    }
    const order = writtenIds(server);
    expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
  });

  it('OFF-5 a waiting change is in storage (under the queue’s own key) the moment it is made, before any idle or close', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, storage, network } = openStore(server, h.members[0]);
    await store.ready;
    network.set(false);
    const id = store.addExpense(tesco(h));
    await vi.waitFor(() => { expect(storage.map.get(QUEUE_KEY) ?? '').toContain(id); }, { timeout: 100 });
  });

  it('OFF-5 OFF-7 a write still being retried when the app closes is sent once after the restart', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const network = new FakeNetwork(true);
    const first = openStore(server, h.members[0], { network });
    await first.store.ready;
    server.dropResponses = 1000; // the server applies it but the answer never arrives in this session
    const id = first.store.addExpense(tesco(h));
    await first.store.idle();
    expect(first.store.pendingCount()).toBe(1);
    open.splice(open.indexOf(first.store), 1);
    await first.store.dispose();

    server.dropResponses = 0;
    const second = openStore(server, h.members[0], { network, storage: first.storage });
    await second.store.ready;
    await second.store.idle();
    await vi.waitFor(() => { expect(second.store.pendingCount()).toBe(0); });
    expect(server.rows('expenses').filter((r) => r.id === id)).toHaveLength(1);
  });
});

describe('before the partner joins (BAL-6)', () => {
  it('BAL-6 an entry made alone is kept on the phone and becomes a 50/50 shared entry once the partner joins', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    // Sam hasn't joined yet.
    const sam = server.rows('members').splice(1, 1)[0];
    const { store } = openStore(server, h.members[0]);
    await store.ready;
    // The form only knows Jae: the ratio names Jae alone.
    const id = store.addExpense({ ...tesco(h), split: { mode: 'ratio', ratio: { [J]: 50 } } });
    await store.idle();
    expect(store.entries().map((e) => e.id)).toEqual([id]);
    expect(store.balance()).toEqual({}); // nobody to owe yet
    expect(server.rows('expenses')).toHaveLength(0);
    expect(store.pendingCount()).toBe(1);

    // Sam joins on their phone; Jae's phone hears it and sends the entry with the shares worked out.
    if (sam) server.serverWrite('members', sam, S);
    await vi.waitFor(() => { expect(server.rows('expenses')).toHaveLength(1); });
    await store.idle();
    expect(server.rows('expenses')[0]).toMatchObject({ id, paid: { [J]: 4250, [S]: 0 }, shares: { [J]: 2125, [S]: 2125 } });
    expect(store.balance()).toEqual({ [J]: 2125, [S]: -2125 });
  });
});

describe('sessions and the queue', () => {
  it('OFF-5 a sign-out the server forces keeps the waiting changes on the phone', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, network, phone } = openStore(server, h.members[0]);
    await store.ready;
    network.set(false);
    store.addExpense(tesco(h));
    network.set(true);
    phone.auth.refreshTokenValid = false;
    phone.auth.expire();
    server.dropResponses = 0;
    await phone.auth.getSession(); // auth-js finds the refresh token revoked: SIGNED_OUT
    await store.idle();
    expect(store.me()).toBeNull();
    expect(store.pendingCount()).toBe(1);
  });

  it('a chosen sign-out refuses while changes are waiting; setup needs a connection (OFF-4)', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;
    network.set(false);
    store.addExpense(tesco(h));
    await expect(signOut({}, store.layer)).rejects.toBeInstanceOf(ChangesWaitingError);
    await expect(createHousehold(store.layer)).rejects.toBeInstanceOf(OfflineError);
  });

  it('SPL-5 the phone refuses what the database would, before anything is queued', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store } = openStore(server, h.members[0]);
    await store.ready;
    const [J, S] = [h.members[0].id, h.members[1].id];
    expect(() => store.addExpense({ ...tesco(h), split: { mode: 'exact', amounts: { [J]: pence(100), [S]: pence(100) } } })).toThrow(EntryInvalidError);
    expect(() => store.addExpense({ ...tesco(h), description: '  ' })).toThrow(EntryInvalidError);
    expect(store.pendingCount()).toBe(0);
  });
});

describe('hooks over the store', () => {
  it('BAL-1 BAL-5 useBalance is the core figure, moves at once offline and is marked offline; the sync count follows', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const { store, network } = openStore(server, h.members[0]);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer: store.layer, children });
    const { result } = renderHook(() => ({ session: useSession(), balance: useBalance(), entries: useEntries(), sync: useSyncStatus() }), { wrapper });
    await waitFor(() => { expect(result.current.balance.status).toBe('ready'); });
    expect(result.current.session).toEqual({ status: 'signed-in', userId: J, refreshPending: false });

    act(() => { network.set(false); });
    act(() => { store.addExpense(tesco(h, 4251)); });
    await waitFor(() => { expect(result.current.entries.data).toHaveLength(1); });
    const b = result.current.balance;
    if (b.status !== 'ready') throw new Error('not ready');
    // Jae paid £42.51 at 50/50: Sam owes Jae £21.25 (the penny goes to the payer's own share).
    expect(b).toMatchObject({ offline: true, state: { kind: 'owes', debtor: S, creditor: J, amount: 2125 } });
    expect(b.nets).toEqual(store.balance());
    expect(result.current.sync).toMatchObject({ online: false, waiting: 1 });

    act(() => { network.set(true); });
    await waitFor(() => { expect(result.current.sync.waiting).toBe(0); });
    expect(server.rows('expenses')).toHaveLength(1);
  });
});

describe('the app asks for its update; the browser keeps the storage', () => {
  it('a waiting service worker is asked to take over; the queue is saved, then the page reloads', async () => {
    const postMessage = vi.fn();
    let onController: (() => void) | null = null;
    const reg = { waiting: { postMessage }, installing: null, update: vi.fn(), addEventListener: vi.fn() };
    const container = {
      getRegistration: () => Promise.resolve(reg),
      addEventListener: (_: string, cb: () => void) => { onController = cb; },
    } as unknown as ServiceWorkerContainer;
    const beforeReload = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    createAppUpdater({ container, beforeReload, reload })();
    await vi.waitFor(() => { expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }); });
    (onController as unknown as () => void)();
    await vi.waitFor(() => { expect(reload).toHaveBeenCalled(); });
    expect(beforeReload).toHaveBeenCalled();
  });

  it('OFF-1 asks the browser to keep the storage', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    expect(await requestPersistentStorage({ persisted: () => Promise.resolve(false), persist })).toBe(true);
    expect(await requestPersistentStorage({ persisted: () => Promise.resolve(true), persist })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistentStorage(undefined)).toBe(false);
  });
});
