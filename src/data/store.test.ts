/**
 * The phone's copy and its queue of changes (DATA_MODEL §6; SPEC ADD-6, BAL-5, OFF-2, OFF-5, OFF-7), against a
 * fake Supabase (tests/fixtures/fake-supabase.ts) that answers as supabase-js does, refuses what the database
 * refuses, broadcasts writes over Realtime, and can go offline or lose an answer.
 *
 * Contract (written by the tests-first writer; the brief fixes the mutation names):
 *
 *   createStore(deps: {
 *     client: SupabaseClient<Database>;
 *     storage: { getItem(k): Promise<string | null>; setItem(k, v: string): Promise<void>; removeItem(k): Promise<void> };
 *                                       // idb-keyval-shaped; the persisted cache and queue live here
 *     network: { readonly online: boolean; subscribe(listener: (online: boolean) => void): () => void };
 *     appVersion: string;               // compared with app_config.min_client_version before the first write
 *     today: () => string;              // the phone's own today, YYYY-MM-DD (DAT-2)
 *     onStale?: () => void;             // called instead of writing when this app is older than the minimum
 *   }): Store
 *
 *   Store {
 *     ready: Promise<void>;             // restored from storage, then (if online) fetched from the server
 *     idle(): Promise<void>;            // nothing in flight: queue sent, or waiting for the network; storage written
 *     refresh(): Promise<void>;         // refetch everything (also runs on open, reconnect, Realtime)
 *     dispose(): Promise<void>;         // the app closes: stop listening, flush storage
 *     me(): string | null; householdId(): string | null;
 *     entries(): ExpenseRow[];          // the phone's copy, optimistic changes included, soft-deleted included
 *     settlements(): SettlementRow[];
 *     balance(): Record<string, Pence>; // core netPositions over the phone's copy (BAL-5)
 *     pendingCount(): number;           // changes waiting to sync (one per change made)
 *     refused(): { id: string; message: string; input: unknown }[];   // OFF-5: told, and kept to fix
 *     addExpense(input: ExpenseInput): string;          // returns the id made on the phone, at once
 *     editExpense(id: string, patch: Partial<ExpenseInput>): void;
 *     deleteExpense(id: string): void;  // soft
 *     restoreExpense(id: string): void;
 *     addSettlement(input: { from: string; to: string; amount: Pence; date: string; note?: string | null; method?: 'monzo' | 'other' }): string;
 *   }
 *   ExpenseInput { kind?: 'expense' | 'money_back'; description: string; amount: Pence; date: string;
 *                  categoryId: string | null; payer: string; split: SplitParams; notes?: string | null;
 *                  tags?: string[]; refundOf?: string | null }
 * paid and shares are computed by core/split from amount, payer and split; writes are upserts by id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { netPositions } from '../core/balance';
import { pence, type Pence } from '../core/money';
import type { SplitParams } from '../core/split';
import type { Database } from './database.types';
import { expenseToLedger, settlementToLedger, type ExpenseRow, type SettlementRow } from './rows';
import { createStore } from './store';
import { FakeNetwork, FakeServer, FakeStorage, type FakeUser, type Household, type LogEntry, type Row } from '../../tests/fixtures/fake-supabase';

/** The contract above as a type: createStore's result must be assignable to it. */
interface ExpenseInput {
  kind?: 'expense' | 'money_back';
  description: string;
  amount: Pence;
  date: string;
  categoryId: string | null;
  payer: string;
  split: SplitParams;
  notes?: string | null;
  tags?: string[];
  refundOf?: string | null;
}
interface Store {
  ready: Promise<void>;
  idle(): Promise<void>;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
  me(): string | null;
  householdId(): string | null;
  entries(): ExpenseRow[];
  settlements(): SettlementRow[];
  balance(): Record<string, Pence>;
  pendingCount(): number;
  refused(): { id: string; message: string; input: unknown }[];
  addExpense(input: ExpenseInput): string;
  editExpense(id: string, patch: Partial<ExpenseInput>): void;
  deleteExpense(id: string): void;
  restoreExpense(id: string): void;
  addSettlement(input: { from: string; to: string; amount: Pence; date: string; note?: string | null; method?: 'monzo' | 'other' }): string;
}

const TODAY = '2026-11-14';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Opened {
  store: Store;
  storage: FakeStorage;
  network: FakeNetwork;
}

const open: Store[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.dispose();
});

function openStore(server: FakeServer, user: FakeUser, opts: { storage?: FakeStorage; network?: FakeNetwork; appVersion?: string; onStale?: () => void } = {}): Opened {
  const storage = opts.storage ?? new FakeStorage();
  const network = opts.network ?? new FakeNetwork(true);
  const phone = server.phone(user.email, user, network);
  const store: Store = createStore({
    client: phone.client as SupabaseClient<Database>,
    storage,
    network,
    appVersion: opts.appVersion ?? '0.1.0',
    today: () => TODAY,
    ...(opts.onStale ? { onStale: opts.onStale } : {}),
  });
  open.push(store);
  return { store, storage, network };
}

async function closeStore(store: Store): Promise<void> {
  open.splice(open.indexOf(store), 1);
  await store.dispose();
}

function split5050(h: Household) {
  const [j, s] = h.members;
  return { mode: 'ratio' as const, ratio: { [j.id]: 50, [s.id]: 50 } };
}

function tesco(h: Household, amount = 4250, description = 'Tesco') {
  return { description, amount: pence(amount), date: TODAY, categoryId: h.categories.Groceries ?? null, payer: h.members[0].id, split: split5050(h) };
}

function nonZero(map: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries((map ?? {}) as Record<string, number>).filter(([, v]) => v !== 0));
}

/** The balance the database would compute from the server's rows. */
function serverBalance(server: FakeServer, h: Household) {
  const ids = [h.members[0].id, h.members[1].id] as const;
  return netPositions(
    ids,
    server.rows('expenses').filter((r) => r.household_id === h.id).map((r) => expenseToLedger(r as unknown as ExpenseRow)),
    server.rows('settlements').filter((r) => r.household_id === h.id).map((r) => settlementToLedger(r as unknown as SettlementRow)),
  );
}

/** Every id a write touched (payload ids and id filters). */
function touches(entry: LogEntry): string[] {
  return [...entry.rows.map((r: Row) => r.id), ...entry.filters.filter((f) => f.col === 'id').map((f) => f.value)].filter((v): v is string => typeof v === 'string');
}

const summary = (rows: readonly ExpenseRow[]) =>
  rows.map((r) => ({ id: r.id, description: r.description, amount: r.amount_pence, deleted: r.deleted_at !== null, paid: nonZero(r.paid), shares: nonZero(r.shares) })).sort((a, b) => (a.id < b.id ? -1 : 1));

describe('store: saving is instant (ADD-6, DATA_MODEL §6)', () => {
  it('ADD-6: the entry is in the phone\'s copy before the server answers, with an id made on the phone; the write is an upsert', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const { store } = openStore(server, h.members[0]);
    await store.ready;
    expect(store.me()).toBe(J);
    expect(store.householdId()).toBe(h.id);

    const id = store.addExpense(tesco(h));
    // Synchronously: no await between saving and seeing it.
    expect(id).toMatch(UUID);
    const local = store.entries().find((e) => e.id === id);
    expect(local).toMatchObject({ id, household_id: h.id, description: 'Tesco', amount_pence: 4250, date: TODAY, kind: 'expense', deleted_at: null });
    expect(nonZero(local?.paid)).toEqual({ [J]: 4250 });
    expect(nonZero(local?.shares)).toEqual({ [J]: 2125, [S]: 2125 });
    expect(store.balance()).toEqual({ [J]: 2125, [S]: -2125 });

    await store.idle();
    expect(store.pendingCount()).toBe(0);
    const rows = server.rows('expenses');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, amount_pence: 4250, split_mode: 'ratio', household_id: h.id });
    const writes = server.writes('expenses');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]?.op).toBe('upsert');
    expect(store.balance()).toEqual(serverBalance(server, h));
  });

  it('ADD-6: Undo of a save is a soft delete (no hard deletes), and the balance goes back', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store } = openStore(server, h.members[0]);
    await store.ready;
    const id = store.addExpense(tesco(h));
    store.deleteExpense(id);
    expect(store.balance()).toEqual({ [h.members[0].id]: 0, [h.members[1].id]: 0 });
    await store.idle();
    expect(server.writes('expenses').every((w) => w.op !== 'delete')).toBe(true);
    const row = server.rows('expenses').find((r) => r.id === id);
    expect(row === undefined || row.deleted_at !== null).toBe(true);
    store.restoreExpense(id);
    await store.idle();
    expect(server.rows('expenses').find((r) => r.id === id)?.deleted_at).toBeNull();
  });
});

describe('store: offline, in order, never duplicated (BAL-5, OFF-2, OFF-5, ADD-6)', () => {
  it('BAL-5 OFF-2: offline every change waits, in order, and the balance comes from the phone\'s copy', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;

    network.set(false);
    const a = store.addExpense(tesco(h));
    store.editExpense(a, { amount: pence(4520) });
    const b = store.addExpense(tesco(h, 1800, 'Pret'));
    store.deleteExpense(b);
    const s = store.addSettlement({ from: S, to: J, amount: pence(1000), date: TODAY });
    await store.idle();

    expect(store.pendingCount()).toBe(5);
    expect(server.writes()).toHaveLength(0);
    // Tesco £45.20 (+22.60), Pret deleted, Sam paid Jae £10 (−10.00).
    expect(store.balance()).toEqual({ [J]: 1260, [S]: -1260 });
    expect(store.entries().find((e) => e.id === a)?.amount_pence).toBe(4520);
    expect(store.entries().find((e) => e.id === b)?.deleted_at).not.toBeNull();
    expect(store.settlements().map((x) => x.id)).toEqual([s]);

    network.set(true);
    await store.idle();
    expect(store.pendingCount()).toBe(0);
    const order = server.writes().flatMap(touches);
    const firstA = order.indexOf(a);
    const firstB = order.indexOf(b);
    expect(firstA).toBeGreaterThanOrEqual(0);
    expect(firstB).toBeGreaterThan(firstA); // A was made before B, and is sent first
    expect(order.lastIndexOf(a)).toBeLessThan(order.lastIndexOf(b)); // A's edit before B's delete
    expect(order.indexOf(s)).toBeGreaterThan(order.lastIndexOf(b));
    expect(server.rows('expenses').filter((r) => r.id === a)).toHaveLength(1);
    expect(server.rows('expenses').find((r) => r.id === a)?.amount_pence).toBe(4520);
    expect(server.rows('expenses').find((r) => r.id === b)?.deleted_at).not.toBeNull();
    expect(server.rows('settlements').map((r) => r.id)).toEqual([s]);
    expect(store.balance()).toEqual(serverBalance(server, h));
  });

  it('OFF-5 OFF-2: waiting changes survive closing the app; the next open sends them once', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const network = new FakeNetwork(true);
    const first = openStore(server, h.members[0], { network });
    await first.store.ready;
    network.set(false);
    const a = first.store.addExpense(tesco(h));
    const s = first.store.addSettlement({ from: S, to: J, amount: pence(500), date: TODAY });
    await first.store.idle();
    await closeStore(first.store);

    // Opened again, still offline, from what the phone stored.
    const second = openStore(server, h.members[0], { network, storage: first.storage });
    await second.store.ready;
    expect(second.store.pendingCount()).toBe(2);
    expect(second.store.entries().map((e) => e.id)).toContain(a);
    expect(second.store.balance()).toEqual({ [J]: 1625, [S]: -1625 });

    network.set(true);
    await second.store.idle();
    expect(second.store.pendingCount()).toBe(0);
    expect(server.rows('expenses').filter((r) => r.id === a)).toHaveLength(1);
    expect(server.rows('settlements').filter((r) => r.id === s)).toHaveLength(1);
  });

  it('ADD-6 OFF-7: when the answer to a write is lost, it is sent again and still makes one row', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;

    server.dropResponses = 1; // the server stores it, the phone hears a network failure
    const a = store.addExpense(tesco(h));
    await store.idle();
    // A lost answer is not a refusal: nothing is reported, nothing rolled back.
    expect(store.refused()).toEqual([]);
    expect(store.entries().filter((e) => e.id === a)).toHaveLength(1);

    // However the retry comes (backoff, or the next reconnect), it is the same id.
    network.set(false);
    network.set(true);
    await store.idle();
    await vi.waitFor(() => {
      expect(store.pendingCount()).toBe(0);
    });
    expect(server.writes('expenses').filter((w) => touches(w).includes(a)).length).toBeGreaterThanOrEqual(2);
    expect(server.rows('expenses').filter((r) => r.id === a)).toHaveLength(1);
    expect(store.entries().filter((e) => e.id === a)).toHaveLength(1);
    expect(store.refused()).toEqual([]);
  });

  it('ADD-6: a write that never reached the server (a failed fetch while "online") is not taken as saved; it is sent again', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;
    server.failWrites = 1;
    const a = store.addExpense(tesco(h));
    await store.idle();
    expect(store.refused()).toEqual([]);
    expect(store.entries().map((e) => e.id)).toContain(a);
    network.set(false);
    network.set(true);
    await store.idle();
    await vi.waitFor(() => {
      expect(server.rows('expenses').map((r) => r.id)).toEqual([a]);
    });
    await store.idle();
    expect(store.pendingCount()).toBe(0);
  });
});

describe('store: refusals (OFF-5, DESIGN §6)', () => {
  it('OFF-5: a change the server refuses is rolled back with a message, kept to fix, and the rest goes through', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    server.refuse = (table, row) => (table === 'expenses' && row.description === 'Bad' ? 'shares (1) must sum to amount (2)' : null);
    const { store, network, storage } = openStore(server, h.members[0]);
    await store.ready;

    network.set(false);
    const good = store.addExpense(tesco(h, 1000, 'Good'));
    const bad = store.addExpense(tesco(h, 2000, 'Bad'));
    const after = store.addExpense(tesco(h, 3000, 'After'));
    await store.idle();
    expect(store.entries().map((e) => e.id)).toContain(bad);

    network.set(true);
    await store.idle();
    // Rolled back from the phone's copy and from the balance…
    expect(store.entries().map((e) => e.id)).not.toContain(bad);
    expect(store.balance()).toEqual(serverBalance(server, h));
    // …the person is told in plain words, and the entry is kept for them to fix…
    const refused = store.refused();
    expect(refused).toHaveLength(1);
    expect(refused[0]?.id).toBe(bad);
    expect(refused[0]?.message.length).toBeGreaterThan(0);
    expect(refused[0]?.message).not.toMatch(/P0001|23503|exception|violates/);
    expect(refused[0]?.input).toMatchObject({ description: 'Bad', amount: 2000 });
    // …and nothing else was held up or dropped.
    expect(server.rows('expenses').map((r) => r.id).sort()).toEqual([good, after].sort());
    expect(store.pendingCount()).toBe(0);

    // Kept across a restart too: nothing is dropped silently.
    await closeStore(store);
    const reopened = openStore(server, h.members[0], { storage, network });
    await reopened.store.ready;
    expect(reopened.store.refused().map((r) => r.id)).toEqual([bad]);
  });

  it('OFF-5: online, the optimistic entry shows at once and is rolled back when refused', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const { store } = openStore(server, h.members[0]);
    await store.ready;
    // A category the other phone has since removed: the database refuses the foreign key.
    const input = { ...tesco(h), categoryId: '00000000-0000-4000-8000-0000000fffff' };
    const id = store.addExpense(input);
    expect(store.entries().map((e) => e.id)).toContain(id);
    await store.idle();
    expect(store.entries().map((e) => e.id)).not.toContain(id);
    expect(store.refused().map((r) => r.id)).toEqual([id]);
    expect(store.balance()).toEqual({ [h.members[0].id]: 0, [h.members[1].id]: 0 });
  });
});

describe('store: two phones in step (OFF-7, DATA_MODEL §6)', () => {
  it('OFF-7: both phones offline, both changing things (the same row too), then online: identical copies, the right balance', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const shared = server.serverWrite('expenses', {
      id: '11111111-1111-4111-8111-111111111111', household_id: h.id, description: 'Tesco', amount_pence: 4250, date: TODAY,
      paid: { [J]: 4250 }, shares: { [J]: 2125, [S]: 2125 }, split_mode: 'ratio', category_id: h.categories.Groceries,
    }, J);
    const jae = openStore(server, h.members[0]);
    const sam = openStore(server, h.members[1]);
    await Promise.all([jae.store.ready, sam.store.ready]);
    expect(jae.store.entries().map((e) => e.id)).toEqual([shared.id]);
    expect(sam.store.entries().map((e) => e.id)).toEqual([shared.id]);

    jae.network.set(false);
    sam.network.set(false);
    jae.store.addExpense(tesco(h, 1000, 'Bread'));
    jae.store.editExpense(shared.id as string, { amount: pence(5000) });
    sam.store.addExpense({ ...tesco(h, 3000, 'Dishoom'), payer: S });
    sam.store.editExpense(shared.id as string, { amount: pence(4400) });
    sam.store.addSettlement({ from: S, to: J, amount: pence(500), date: TODAY });
    await Promise.all([jae.store.idle(), sam.store.idle()]);
    expect(jae.store.balance()).toEqual({ [J]: 3000, [S]: -3000 });
    expect(sam.store.balance()).toEqual({ [J]: 200, [S]: -200 });

    jae.network.set(true);
    sam.network.set(true);
    for (let round = 0; round < 3; round++) await Promise.all([jae.store.idle(), sam.store.idle()]);

    const truth = summary(server.rows('expenses') as unknown as ExpenseRow[]);
    expect(truth.filter((r) => r.description === 'Tesco')).toHaveLength(1);
    expect([5000, 4400]).toContain(truth.find((r) => r.description === 'Tesco')?.amount); // last write wins
    expect(summary(jae.store.entries())).toEqual(truth);
    expect(summary(sam.store.entries())).toEqual(truth);
    expect(jae.store.settlements().map((x) => x.id)).toEqual(server.rows('settlements').map((r) => r.id));
    expect(sam.store.settlements().map((x) => x.id)).toEqual(server.rows('settlements').map((r) => r.id));
    const right = serverBalance(server, h);
    expect(jae.store.balance()).toEqual(right);
    expect(sam.store.balance()).toEqual(right);
    expect((right[J] ?? 0) + (right[S] ?? 0)).toBe(0);
    expect(jae.store.pendingCount() + sam.store.pendingCount()).toBe(0);
  });

  it('Realtime: the partner\'s change reaches this phone\'s copy without a refresh; missed ones arrive on reconnect', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold();
    const [J, S] = [h.members[0].id, h.members[1].id];
    const { store, network } = openStore(server, h.members[0]);
    await store.ready;
    const row = (id: string, amount: number) => ({
      id, household_id: h.id, description: 'Dishoom', amount_pence: amount, date: TODAY, paid: { [S]: amount },
      shares: { [J]: amount / 2, [S]: amount / 2 }, split_mode: 'ratio', category_id: null,
    });

    server.serverWrite('expenses', row('22222222-2222-4222-8222-222222222222', 3000), S);
    await vi.waitFor(() => {
      expect(store.entries().map((e) => e.id)).toContain('22222222-2222-4222-8222-222222222222');
    });
    await store.idle();
    expect(store.balance()).toEqual({ [J]: -1500, [S]: 1500 });

    // While offline, broadcasts are missed; reconnecting refetches.
    network.set(false);
    server.serverWrite('expenses', row('33333333-3333-4333-8333-333333333333', 1000), S);
    await store.idle();
    expect(store.entries().map((e) => e.id)).not.toContain('33333333-3333-4333-8333-333333333333');
    network.set(true);
    await vi.waitFor(() => {
      expect(store.entries().map((e) => e.id)).toContain('33333333-3333-4333-8333-333333333333');
    });
    await store.idle();
    expect(store.balance()).toEqual(serverBalance(server, h));
  });
});

describe('store: a stale app refreshes before writing (DATA_MODEL §6)', () => {
  it('an app older than app_config.min_client_version does not write; it asks to refresh and the change waits', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold({ minClientVersion: '0.2.0' });
    const onStale = vi.fn();
    const network = new FakeNetwork(true);
    const old = openStore(server, h.members[0], { appVersion: '0.1.0', onStale, network });
    await old.store.ready;
    const id = old.store.addExpense(tesco(h));
    expect(old.store.entries().map((e) => e.id)).toContain(id); // saving still never blocks
    await old.store.idle();
    expect(onStale).toHaveBeenCalled();
    expect(server.writes('expenses')).toHaveLength(0);
    expect(old.store.pendingCount()).toBe(1);
    await closeStore(old.store);

    // The refreshed (newer) app sends what was waiting.
    const updated = openStore(server, h.members[0], { appVersion: '0.2.0', storage: old.storage, network });
    await updated.store.ready;
    await updated.store.idle();
    expect(server.rows('expenses').map((r) => r.id)).toEqual([id]);
    expect(updated.store.pendingCount()).toBe(0);
  });

  it('an app at or above the minimum writes normally', async () => {
    const server = new FakeServer();
    const h = server.seedHousehold({ minClientVersion: '0.1.0' });
    const onStale = vi.fn();
    const { store } = openStore(server, h.members[0], { appVersion: '0.10.0', onStale });
    await store.ready;
    store.addExpense(tesco(h));
    await store.idle();
    expect(onStale).not.toHaveBeenCalled();
    expect(server.rows('expenses')).toHaveLength(1);
  });
});
