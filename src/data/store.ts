/**
 * The phone's copy of the household and its queue of changes, over a Supabase client (DATA_MODEL §6). This
 * is the data layer as one object: what the hooks wrap, what the tests drive. Built from the real client in
 * the app; from a fake one in tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IsoDate } from '../core/dates';
import type { Pence } from '../core/money';
import { supabaseApi, type AuthUser, type ExpenseRow, type SettlementRow } from './api';
import type { Database } from './database.types';
import * as m from './mutations';
import type { Network } from './network';
import { createDataLayer, type DataLayer } from './queryClient';
import { createSessionKeeper } from './session';
import { checkClientVersion } from './version';
import type { ExpenseDraft, SettlementDraft } from './writes';

/** idb-keyval-shaped; the persisted cache, the queue and kept-back writes live here. */
export interface StoreStorage {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

export interface StoreDeps {
  client: SupabaseClient<Database>;
  storage: StoreStorage;
  network: Network;
  /** Compared with app_config.min_client_version before the first write. */
  appVersion: string;
  /** The phone's own today, YYYY-MM-DD (DAT-2). */
  today: () => IsoDate;
  /** Called instead of writing when this app is older than the minimum. */
  onStale?: () => void;
  report?: (err: unknown, context: Record<string, unknown>) => void;
  onSignedIn?: (user: AuthUser) => void;
}

export interface RefusedChange {
  /** The entry's id. */
  id: string;
  /** For the person, in plain words. */
  message: string;
  /** What they entered, to fix it. */
  input: unknown;
}

export interface Store {
  layer: DataLayer;
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
  refused(): RefusedChange[];
  addExpense(input: ExpenseDraft): string;
  editExpense(id: string, patch: Partial<ExpenseDraft>): void;
  deleteExpense(id: string): void;
  restoreExpense(id: string): void;
  addSettlement(input: SettlementDraft): string;
  editSettlement(id: string, patch: Partial<SettlementDraft>): void;
  deleteSettlement(id: string): void;
  restoreSettlement(id: string): void;
  setIdentity(name: string, animal: 'cat' | 'dog'): Promise<void>;
  requestChange(change: m.ChangeRequest): Promise<string>;
  decideChange(id: string, approve: boolean): Promise<void>;
  setMonzoMe(username: string | null): Promise<void>;
  createHousehold(): Promise<string>;
  joinHousehold(code: string): Promise<string | null>;
}

export function createStore(deps: StoreDeps): Store {
  const { client, storage, network } = deps;
  const session = createSessionKeeper({ client, storage, network });
  const layer = createDataLayer({
    api: supabaseApi(client),
    storage: {
      getItem: (k) => storage.getItem(k),
      setItem: async (k, v) => { await storage.setItem(k, v); },
      removeItem: async (k) => { await storage.removeItem(k); },
    },
    network,
    session,
    today: deps.today,
    versionCheck: () => checkClientVersion(client, deps.appVersion),
    ...(deps.onStale ? { onStale: deps.onStale } : {}),
    ...(deps.report ? { report: deps.report } : {}),
    ...(deps.onSignedIn ? { onSignedIn: deps.onSignedIn } : {}),
  });
  return storeOver(layer, () => { session.dispose(); });
}

/** The Store face over any data layer (the demo's in-memory one included). */
export function storeOver(layer: DataLayer, onDispose: () => void = () => undefined): Store {
  return {
    layer,
    ready: layer.ready,
    idle: () => layer.idle(),
    refresh: () => layer.refresh(),
    async dispose() {
      await layer.dispose();
      onDispose();
    },
    me: () => layer.me(),
    householdId: () => layer.householdId(),
    entries: () => layer.entries(),
    settlements: () => layer.settlements(),
    balance: () => layer.balance(),
    pendingCount: () => layer.waiting().length,
    refused: () => layer.problems.list().map((p) => ({ id: p.rowId, message: p.message, input: p.input })),
    addExpense: (input) => m.addExpense(input, layer),
    editExpense: (id, patch) => { m.editExpense(id, patch, layer); },
    deleteExpense: (id) => { m.deleteExpense(id, layer); },
    restoreExpense: (id) => { m.restoreExpense(id, layer); },
    addSettlement: (input) => m.addSettlement(input, layer),
    editSettlement: (id, patch) => { m.editSettlement(id, patch, layer); },
    deleteSettlement: (id) => { m.deleteSettlement(id, layer); },
    restoreSettlement: (id) => { m.restoreSettlement(id, layer); },
    setIdentity: (name, animal) => m.setIdentity(name, animal, layer),
    requestChange: (change) => m.requestChange(change, layer),
    decideChange: (id, approve) => m.decideChange(id, approve, layer),
    setMonzoMe: (username) => m.setMonzoMe(username, layer),
    createHousehold: () => m.createHousehold(layer),
    joinHousehold: (code) => m.joinHousehold(code, layer),
  };
}
