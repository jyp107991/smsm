/**
 * A small household for screen and data tests: Jae (the cat, joined first) and Sam (the dog), the twelve
 * starting categories, no entries yet, served by the in-memory Api. Signed in as whoever `as` names.
 *
 * S3 (docs/slices/S3.md "Interfaces"): regular payments (`recurring`) and Inbox items (`inboxItems`) can be
 * seeded too; the in-memory Api keeps them in `controls.tables.recurring` and `controls.tables.inboxItems`, and
 * its post_due_recurring posts by the fixture's TODAY (the "server's" UK date, option `today`).
 *
 * S4a (docs/slices/S4.md "Interfaces"): chapters can be seeded too (`chapters`); the in-memory Api keeps them in
 * `controls.tables.chapters`.
 *
 * S4b (docs/slices/S4b.md "Interfaces → Data"): the place-name and rate services can be passed (`geo`, `rates`) and
 * reach the data layer's options, so tests use fakes and never the network.
 *
 * S5b (docs/slices/S5b.md "Interfaces"): comments can be seeded (`comments`; the in-memory Api keeps them in
 * `controls.tables.comments`), the household's settle day set (`settleDay`, households.settle_day), and the date
 * moved (`today`, default TODAY) for the phone and the "server" alike.
 *
 * S6a (docs/slices/S6.md "Data"): the smart-feature service (`ai`), where the phone keeps photos (`photos`) and the
 * photo shrinker (`downscale`) can be passed and reach the data layer's options, so tests use fakes (jsdom has no
 * canvas or IndexedDB, and never the network). Category memory can be seeded (`categoryMemory`).
 *
 * S6b (docs/slices/S6b.md "Data"): stored recap wording can be seeded (`recaps`, rows of the `recaps` table); the
 * in-memory Api keeps them in `controls.tables.recaps`, reads them for the signed-in household, and answers
 * `saveRecapProse(period, stats, prose)` (its call name in controls.calls) as the save_recap_prose RPC does: insert-only,
 * returning the stored prose. It honours controls.refuse / online for it like any other call.
 */
import type { AsyncStorage } from '@tanstack/react-query-persist-client';
import { createMemoryApi, type MemoryControls, type MemoryTables } from '../../src/data/memoryApi';
import { manualNetwork } from '../../src/data/network';
import { createDataLayer, type DataLayer, type DataLayerOptions } from '../../src/data/queryClient';
import { fixedSession } from '../../src/data/session';
import { memoryStorage } from '../../src/data/storage';
import type { ActivityRow, CategoryRow, ChangeRequestRow, ExpenseRow, HouseholdRow, MemberRow, SettlementRow } from '../../src/data/api';
import type { Database, Json } from '../../src/data/database.types';

export type RecurringRow = Database['public']['Tables']['recurring']['Row'];
export type InboxItemRow = Database['public']['Tables']['inbox_items']['Row'];
export type ChapterRow = Database['public']['Tables']['chapters']['Row'];
export type CommentRow = Database['public']['Tables']['comments']['Row'];
export type RecapRow = Database['public']['Tables']['recaps']['Row'];

export const HID = '00000000-0000-4000-8000-0000000000c1';
export const JAE_ID = '00000000-0000-4000-8000-0000000000a1';
export const SAM_ID = '00000000-0000-4000-8000-0000000000b1';
export const TODAY = '2026-11-14';

const CATEGORIES: readonly [string, string, string][] = [
  ['Groceries', '🛒', 'moss'], ['Eating out', '🍜', 'amber'], ['Rent & bills', '🏠', 'walnut'], ['Utilities', '💡', 'honey'],
  ['Transport', '🚆', 'slate'], ['Subscriptions', '📺', 'plum'], ['Household', '🧺', 'oak'], ['Going out', '🍸', 'berry'],
  ['Travel', '✈️', 'lake'], ['Gifts', '🎁', 'clay'], ['Health', '💊', 'fern'], ['Other', '📦', 'stone'],
];

export function categoryId(name: string): string {
  const i = CATEGORIES.findIndex(([n]) => n === name);
  return `00000000-0000-4000-8000-${(0x900 + i).toString(16).padStart(12, '0')}`;
}

export interface Couple {
  layer: DataLayer;
  controls: MemoryControls;
  network: ReturnType<typeof manualNetwork>;
}

/** A stored entry (as the server holds it), Jae paying £40.00 split 50/50 unless told otherwise. */
export function storedExpense(over: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: '00000000-0000-4000-8000-00000000e001', household_id: HID, kind: 'expense', description: 'Lamp', amount_pence: 4000, date: TODAY,
    category_id: categoryId('Household'), paid: { [JAE_ID]: 4000 }, paid_via: 'person', split_mode: 'ratio', split_params: { [JAE_ID]: 50, [SAM_ID]: 50 },
    shares: { [JAE_ID]: 2000, [SAM_ID]: 2000 }, chapter_id: null, country: 'GB', place: null, lat: null, lng: null, original_amount: null,
    original_currency: null, fx_rate: null, notes: null, tags: [], receipt_path: null, category_guess: false, source: 'manual', external_id: null, merchant: null,
    external_category: null, account_id: null, recurring_id: null, occurrence_date: null, refund_of: null, created_by: JAE_ID,
    created_at: '2026-11-10T12:00:00.000Z', updated_by: JAE_ID, updated_at: '2026-11-10T12:00:00.000Z', deleted_at: null, bill_total_pence: null, items: null,
    ...over,
  };
}

/** A stored settle-up (as the server holds it): Sam paying Jae £5.00 today unless told otherwise. */
export function storedSettlement(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    id: '00000000-0000-4000-8000-00000000f001', household_id: HID, from_user: SAM_ID, to_user: JAE_ID, amount_pence: 500, date: TODAY,
    method: 'other', note: null, created_by: SAM_ID, created_at: '2026-11-14T09:00:00.000Z', updated_at: '2026-11-14T09:00:00.000Z', deleted_at: null,
    ...over,
  };
}

/**
 * A stored regular payment (as the server holds it): Rent, £1,450.00 a month from 1 Jan 2026, paid by Jae and
 * split 50/50, with the occurrences up to 1 Nov already posted (posted_count 11), unless told otherwise.
 */
export function storedRecurring(over: Partial<RecurringRow> = {}): RecurringRow {
  const amount = over.amount_pence ?? 145000;
  const half = Math.floor(amount / 2);
  return {
    id: '00000000-0000-4000-8000-00000000d001', household_id: HID, description: 'Rent', amount_pence: amount, amount_varies: false,
    category_id: categoryId('Rent & bills'), paid: { [JAE_ID]: amount }, paid_via: 'person', split_mode: 'ratio',
    split_params: { [JAE_ID]: 50, [SAM_ID]: 50 }, shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, is_subscription: false,
    frequency: 'monthly', every: 1, start_date: '2026-01-01', end_date: null, posted_count: 11, active: true, notes: null,
    created_by: JAE_ID, created_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-01-01T09:00:00.000Z', deleted_at: null,
    ...over,
  };
}

/** A stored Inbox item: the variable Energy bill of 3 Nov asking for its amount (REC-3), unless told otherwise. */
export function storedInboxItem(over: Partial<InboxItemRow> = {}): InboxItemRow {
  const payload: Json = { description: 'Energy', estimate_pence: 9000, date: '2026-11-03', category_id: categoryId('Utilities') };
  return {
    id: '00000000-0000-4000-8000-00000000b0c1', household_id: HID, source: 'bill', status: 'open', payload, receipt_path: null,
    recurring_id: '00000000-0000-4000-8000-00000000d0e1', occurrence_date: '2026-11-03', external_id: null, expense_id: null,
    created_by: null, created_at: '2026-11-03T00:05:00.000Z', updated_at: '2026-11-03T00:05:00.000Z',
    ...over,
  };
}

/** A stored chapter (S4a): the Japan trip, 1–9 Nov 2026, open, unless told otherwise. */
export function storedChapter(over: Partial<ChapterRow> = {}): ChapterRow {
  return {
    id: '00000000-0000-4000-8000-00000000c401', household_id: HID, name: 'Japan', emoji: '🗾', kind: 'trip', country: 'JP',
    start_date: '2026-11-01', end_date: '2026-11-09', closed: false, created_by: JAE_ID, created_at: '2026-10-20T12:00:00.000Z',
    updated_at: '2026-10-20T12:00:00.000Z',
    ...over,
  };
}

/** A stored comment (S5b): Sam asking about the Lamp, unless told otherwise. */
export function storedComment(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: '00000000-0000-4000-8000-00000000cc01', household_id: HID, expense_id: '00000000-0000-4000-8000-00000000e001', author: SAM_ID,
    body: 'Was this the big shop?', created_at: '2026-11-12T18:00:00.000Z', deleted_at: null,
    ...over,
  };
}

export function couple(
  opts: {
    as?: 'jae' | 'sam'; partnerJoined?: boolean; expenses?: ExpenseRow[]; changeRequests?: ChangeRequestRow[];
    settlements?: SettlementRow[]; activity?: ActivityRow[];
    /** S3: regular payments and Inbox items on the "server". */
    recurring?: RecurringRow[]; inboxItems?: InboxItemRow[];
    /** S4a: trips and projects. */
    chapters?: ChapterRow[];
    /** S5b: comments on entries, the household's settle day (1–28 or null) and the date (default TODAY). */
    comments?: CommentRow[]; settleDay?: number | null; today?: string;
    /** S4b: fake location / place-name and exchange-rate services (data layer options `geo`, `rates`). */
    geo?: unknown; rates?: unknown;
    /** S6a: fake smart features, photo store and photo shrinker (data layer options `ai`, `photos`, `downscale`). */
    ai?: unknown; photos?: unknown; downscale?: unknown;
    /** S6a: what the household has taught the app (category_memory rows). */
    categoryMemory?: MemoryTables['categoryMemory'];
    /** S6b: recap wording already kept on the "server" (recaps rows). */
    recaps?: RecapRow[];
    /** The household's approved default split (PPL-5), e.g. { [JAE_ID]: 60, [SAM_ID]: 40 }. */
    defaultRatio?: Record<string, number> | null;
    /** The phone's storage and network, to restart the app over the same storage or start offline. */
    storage?: AsyncStorage; online?: boolean;
  } = {},
): Couple {
  const stamp = '2026-11-01T12:00:00.000Z';
  const today = opts.today ?? TODAY;
  // `settle_day` is S5b's addition to households (docs/slices/S5b.md "Data").
  const household: HouseholdRow = Object.assign({
    id: HID, join_code: 'AB12CD', home_country: 'GB', default_ratio: opts.defaultRatio ?? null, joint_enabled: false, joint_ratio: null, created_at: stamp,
  }, { settle_day: opts.settleDay ?? null });
  const members: MemberRow[] = [
    { household_id: HID, user_id: JAE_ID, display_name: 'Jae', animal: 'cat', locked_at: stamp, monzo_me: 'jaetest', joined_at: stamp },
  ];
  if (opts.partnerJoined !== false) {
    members.push({ household_id: HID, user_id: SAM_ID, display_name: 'Sam', animal: 'dog', locked_at: stamp, monzo_me: null, joined_at: '2026-11-02T12:00:00.000Z' });
  }
  const categories: CategoryRow[] = CATEGORIES.map(([name, emoji, colour], i) => ({
    id: categoryId(name), household_id: HID, name, emoji, colour, default_ratio: null, archived: false, sort: i + 1, updated_at: stamp,
  }));
  const me = opts.as === 'sam' ? SAM_ID : JAE_ID;
  // `recurring`, `inboxItems` and the `today` option are S3's additions to the in-memory Api (docs/slices/S3.md).
  const seed = {
    households: [household], members, categories, expenses: opts.expenses ?? [], changeRequests: opts.changeRequests ?? [],
    settlements: opts.settlements ?? [], activity: opts.activity ?? [], recurring: opts.recurring ?? [], inboxItems: opts.inboxItems ?? [],
    chapters: opts.chapters ?? [], comments: opts.comments ?? [], categoryMemory: opts.categoryMemory ?? [],
    // `recaps` is S6b's addition to the in-memory Api (docs/slices/S6b.md "Data").
    recaps: opts.recaps ?? [],
  } as Partial<MemoryTables>;
  const apiOpts = { user: { userId: me, email: null }, today: () => today } as Parameters<typeof createMemoryApi>[1];
  const { api, controls } = createMemoryApi(seed, apiOpts);
  const network = manualNetwork(opts.online ?? true);
  // `geo` and `rates` are S4b's additions to the data layer options (docs/slices/S4b.md).
  // `ai`, `photos` and `downscale` are S6a's (docs/slices/S6.md "Data").
  const services = {
    ...(opts.geo === undefined ? {} : { geo: opts.geo }), ...(opts.rates === undefined ? {} : { rates: opts.rates }),
    ...(opts.ai === undefined ? {} : { ai: opts.ai }), ...(opts.photos === undefined ? {} : { photos: opts.photos }),
    ...(opts.downscale === undefined ? {} : { downscale: opts.downscale }),
  } as Pick<DataLayerOptions, 'geo' | 'rates'>;
  const layer = createDataLayer(Object.assign({ api, storage: opts.storage ?? memoryStorage(), network, session: fixedSession(me), today: () => today }, services));
  return { layer, controls, network };
}
