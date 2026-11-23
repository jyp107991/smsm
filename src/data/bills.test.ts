/**
 * S3 data layer (docs/slices/S3.md "Interfaces → Data layer"): regular payments, the Inbox and categories, over
 * the in-memory Api. Written before the build (ENGINEERING §5, tests first by someone else); each test names its
 * SPEC ids and fails on the code at 357a2fa because the functions, hooks and tables below don't exist yet.
 *
 * Interface these tests expect (new; consistent with the money writes in mutations.ts):
 *
 *   Reads (hooks.ts, exported from src/data/index.ts) — from the phone's copy with waiting writes applied:
 *     useRecurring(): DataResult<RecurringRow[]>   every template, paused and ended ones included
 *     useInbox(): DataResult<InboxItemRow[]>        OPEN items only, oldest first; an item kept or dismissed on
 *                                                   this phone leaves at once (offline too)
 *   RecurringRow / InboxItemRow are the database rows (api.ts exports them like ExpenseRow).
 *
 *   Writes (mutations.ts, exported from src/data/index.ts). Each returns at once, works offline and goes through
 *   the persisted queue in order with the money writes (OFF-2, OFF-5); each counts in "changes waiting to sync"
 *   (useSyncStatus().waiting) until sent; ids are made on the phone and writes are upserts or patches by id, so
 *   a replay can't duplicate (OFF-7). Nothing is ever hard-deleted.
 *
 *     interface RecurringDraft {
 *       description: string; amount: Pence; categoryId: string | null; payer: UserId; split: SplitParams;
 *       notes?: string | null;
 *       frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate; endDate: IsoDate | null;
 *       amountVaries: boolean; isSubscription: boolean;
 *     }
 *     saveRecurring(input: RecurringDraft & { id?: string }, layer?): string
 *       REC-1, REC-6: adds (or, with the id of an existing template, edits) a template; returns its id. paid and
 *       shares are built with the core's split maths like an entry's (check_money applies to templates too); the
 *       phone never sends posted_count (the server owns it), so an edit changes future occurrences only. A
 *       second submit of the same NEW form (same id, Q-F1) changes nothing. Refuses on the phone with
 *       EntryInvalidError what the database would refuse (no description, amount ≤ 0, every < 1, an end before
 *       the start). Once a template has reached the server the phone calls post_due_recurring(), so one due
 *       today posts at once (REC-2) rather than at the next open or the nightly job.
 *     pauseRecurring(id, layer?): boolean      active = false (true when something changed)
 *     resumeRecurring(id, layer?): boolean     active = true
 *     endRecurring(id, endDate = today, layer?): boolean   sets end_date; the template stays
 *     keepInboxItem(itemId, draft: ExpenseDraft & { id?: string }, layer?): string
 *       INB-2: saves the entry (an expense, as addExpense) and marks the item kept with that entry's id, in that
 *       order, through the queue; returns the entry's id. A bill's entry carries the item's recurring_id and
 *       occurrence_date and source 'recurring', at the home country and in no chapter (REC-4), so the database's
 *       one-entry-per-occurrence index refuses a second keep from the other phone. A second tap with the same id
 *       records nothing more (Q-F1); an item already kept or dismissed on this phone is not kept again.
 *     dismissInboxItem(itemId, layer?): boolean   INB-2 "Not ours": status 'dismissed', no entry
 *     interface CategoryDraft { name: string; emoji: string; colour: CategoryColour }
 *       CategoryColour = 'moss' | 'amber' | 'walnut' | 'honey' | 'slate' | 'plum' | 'oak' | 'berry' | 'lake' |
 *       'clay' | 'fern' | 'stone' (the palette, DESIGN §3.1); anything else is refused on the phone.
 *     saveCategory(input: CategoryDraft & { id?: string }, layer?): string   CAT-1 add (sorted last) or edit
 *     archiveCategory(id, archived = true, layer?): boolean                  CAT-1 archive / bring back
 *     reorderCategories(ids: readonly string[], layer?): void                CAT-1: sort follows the given order
 *
 *   Api (api.ts) gains recurring(hid), inboxItems(hid), upsertRecurring(row), patchInboxItem(id, patch) and
 *   upsertCategory(row) (names chosen here; the in-memory Api records its calls under the method's name, and
 *   these tests look for 'upsertRecurring' followed by 'postDueRecurring').
 *
 *   Realtime: 'recurring' and 'inbox_items' are watched tables (api.ts WatchedTable), so the partner's template,
 *   keep or dismiss reaches this phone (realtime.ts refetches them).
 *
 *   In-memory Api (memoryApi.ts), used by demo mode and these tests: MemoryTables gains `recurring:
 *   RecurringRow[]` and `inboxItems: InboxItemRow[]`; createMemoryApi takes option `today?: () => IsoDate` (the
 *   server's UK date; default the London date of `now`), and its postDueRecurring does what the SQL function
 *   does (fixed → expenses with source 'recurring', recurring_id, occurrence_date, at home, no chapter;
 *   amount varies → an open inbox item with payload { description, estimate_pence, date, category_id };
 *   posted_count moves on; paused and ended templates post nothing). It logs template edits in activity like
 *   expenses (entity 'recurring'), refuses a second expense for the same (recurring_id, occurrence_date), and
 *   refuses a hard delete of anything.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  categoryId, couple, HID, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedRecurring, TODAY,
  type InboxItemRow, type RecurringRow,
} from '../../tests/fixtures/couple';
import type { IsoDate } from '../core/dates';
import { pence, type Pence } from '../core/money';
import type { SplitParams, UserId } from '../core/split';
import type { CategoryRow } from './api';
import { DataProvider } from './DataProvider';
import * as hooksModule from './hooks';
import type { DataResult } from './hooks';
import type { MemoryTables } from './memoryApi';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import { memoryStorage } from './storage';
import { EntryInvalidError, type ExpenseDraft } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
interface RecurringDraft {
  description: string; amount: Pence; categoryId: string | null; payer: UserId; split: SplitParams; notes?: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate; endDate: IsoDate | null;
  amountVaries: boolean; isSubscription: boolean;
}
type CategoryColour = 'moss' | 'amber' | 'walnut' | 'honey' | 'slate' | 'plum' | 'oak' | 'berry' | 'lake' | 'clay' | 'fern' | 'stone';
interface CategoryDraft { name: string; emoji: string; colour: CategoryColour }
interface S3Mutations {
  saveRecurring(input: RecurringDraft & { id?: string }, layer?: DataLayer): string;
  pauseRecurring(id: string, layer?: DataLayer): boolean;
  resumeRecurring(id: string, layer?: DataLayer): boolean;
  endRecurring(id: string, endDate?: IsoDate, layer?: DataLayer): boolean;
  keepInboxItem(itemId: string, draft: ExpenseDraft & { id?: string }, layer?: DataLayer): string;
  dismissInboxItem(itemId: string, layer?: DataLayer): boolean;
  saveCategory(input: CategoryDraft & { id?: string }, layer?: DataLayer): string;
  archiveCategory(id: string, archived?: boolean, layer?: DataLayer): boolean;
  reorderCategories(ids: readonly string[], layer?: DataLayer): void;
}
interface S3Hooks {
  useRecurring(): DataResult<RecurringRow[]>;
  useInbox(): DataResult<InboxItemRow[]>;
}
const m = mutations as unknown as typeof mutations & S3Mutations;
const hooks = hooksModule as unknown as typeof hooksModule & S3Hooks;
type S3Tables = MemoryTables & { recurring: RecurringRow[]; inboxItems: InboxItemRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S3Tables;

// ───────── helpers ─────────
const open: DataLayer[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}

const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });

/** Everything the screens would read, live. */
function watch(layer: DataLayer) {
  return renderHook(
    () => ({
      recurring: hooks.useRecurring(),
      inbox: hooks.useInbox(),
      entries: hooks.useEntries(),
      categories: hooks.useCategories(),
      balance: hooks.useBalance(),
      sync: hooks.useSyncStatus(),
    }),
    { wrapper: wrapperFor(layer) },
  );
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const FORM_ID = '00000000-0000-4000-8000-0000000f0301';
const ENERGY_ID = '00000000-0000-4000-8000-00000000d0e1';

function rent(over: Partial<RecurringDraft> = {}): RecurringDraft {
  return {
    description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even,
    frequency: 'monthly', every: 1, startDate: '2026-12-01', endDate: null, amountVaries: false, isSubscription: false, ...over,
  };
}

const netflix = (over: Partial<RecurringDraft> = {}) =>
  rent({ description: 'Netflix', amount: pence(1099), categoryId: categoryId('Subscriptions'), isSubscription: true, startDate: TODAY, ...over });

/** The Energy template whose 3 Nov bill is waiting in the Inbox (paid by Sam, 50/50). */
const energyTemplate = (over: Partial<RecurringRow> = {}) =>
  storedRecurring({
    id: ENERGY_ID, description: 'Energy', amount_pence: 9000, amount_varies: true, category_id: categoryId('Utilities'),
    paid: { [SAM_ID]: 9000 }, shares: { [JAE_ID]: 4500, [SAM_ID]: 4500 }, start_date: '2026-01-03', posted_count: 11, ...over,
  });

/** What Keep's sheet saves for the 3 Nov Energy bill: £84.37, paid by Sam, 50/50. */
const energyDraft = (amount = 8437): ExpenseDraft => ({
  description: 'Energy', amount: pence(amount), date: '2026-11-03', categoryId: categoryId('Utilities'), payer: SAM_ID, split: even,
});

// ─────────────────────────────── REC-1 REC-6: templates ───────────────────────────────

describe('saveRecurring (REC-1, OFF-2)', () => {
  it('REC-1 OFF-2 OFF-5: offline, a new regular payment shows at once, waits to sync, then is stored with its money built by the core', async () => {
    const c = household();
    const { layer } = c;
    await layer.ready;
    await settle(layer);
    c.network.set(false); // the household was on the phone already (OFF-1); now no connection
    const view = watch(layer);
    let id = '';
    act(() => { id = m.saveRecurring(rent(), layer); });
    await waitFor(() => { expect(view.result.current.recurring.data?.map((r) => r.id)).toEqual([id]); });
    expect(view.result.current.recurring.data?.[0]).toMatchObject({ description: 'Rent', amount_pence: 145000, frequency: 'monthly', active: true });
    expect(view.result.current.sync.waiting).toBeGreaterThanOrEqual(1);
    expect(tablesOf(c).recurring).toEqual([]);

    c.network.set(true);
    await settle(layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({
      id, household_id: HID, description: 'Rent', amount_pence: 145000, amount_varies: false, is_subscription: false,
      category_id: categoryId('Rent & bills'), paid: { [JAE_ID]: 145000 }, paid_via: 'person', split_mode: 'ratio',
      split_params: { [JAE_ID]: 50, [SAM_ID]: 50 }, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 },
      frequency: 'monthly', every: 1, start_date: '2026-12-01', end_date: null, active: true,
    });
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    // REC-1 is not money until it posts: nothing owed yet (it starts on 1 Dec).
    expect(layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 });
    view.unmount();
  });

  it('REC-1: every, an end date, "amount varies" and "subscription" are kept as entered', async () => {
    const c = household();
    await c.layer.ready;
    const id = m.saveRecurring(
      rent({ description: 'Window cleaner', amount: pence(1200), frequency: 'weekly', every: 2, startDate: '2026-11-21', endDate: '2027-06-30', amountVaries: true, isSubscription: false }),
      c.layer,
    );
    await settle(c.layer);
    expect(tablesOf(c).recurring.find((r) => r.id === id)).toMatchObject({
      frequency: 'weekly', every: 2, start_date: '2026-11-21', end_date: '2027-06-30', amount_varies: true, is_subscription: false,
    });
  });

  it('Q-F1 REC-1: the same form saved twice is one template', async () => {
    const c = household();
    await c.layer.ready;
    expect(m.saveRecurring({ ...rent(), id: FORM_ID }, c.layer)).toBe(FORM_ID);
    expect(m.saveRecurring({ ...rent(), id: FORM_ID }, c.layer)).toBe(FORM_ID);
    await settle(c.layer);
    expect(tablesOf(c).recurring.map((r) => r.id)).toEqual([FORM_ID]);
  });

  it('OFF-5 OFF-7: a template saved offline survives closing the app and is sent once on the next open', async () => {
    const storage = memoryStorage();
    const first = household({ storage });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    const id = m.saveRecurring(rent(), first.layer);
    await first.layer.flush();
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);
    expect(tablesOf(first).recurring).toEqual([]);

    const second = household({ storage });
    await second.layer.ready;
    await settle(second.layer);
    expect(tablesOf(second).recurring.map((r) => r.id)).toEqual([id]);
  });

  it('REC-1 SPL-5: what the database would refuse is refused on the phone', async () => {
    const c = household();
    await c.layer.ready;
    expect(() => m.saveRecurring(rent({ amount: pence(0) }), c.layer)).toThrow(EntryInvalidError);
    expect(() => m.saveRecurring(rent({ description: '  ' }), c.layer)).toThrow(EntryInvalidError);
    expect(() => m.saveRecurring(rent({ every: 0 }), c.layer)).toThrow(EntryInvalidError);
    expect(() => m.saveRecurring(rent({ startDate: '2026-12-01', endDate: '2026-11-30' }), c.layer)).toThrow(EntryInvalidError);
    await settle(c.layer);
    expect(tablesOf(c).recurring).toEqual([]);
  });
});

describe('editing a template (REC-6)', () => {
  it('REC-6: a new amount changes the template only; posted entries stay; the server keeps counting where it was', async () => {
    const posted = storedExpense({
      id: '00000000-0000-4000-8000-00000000e301', description: 'Rent', amount_pence: 145000, date: '2026-11-01', paid: { [JAE_ID]: 145000 },
      shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 }, source: 'recurring', recurring_id: storedRecurring().id, occurrence_date: '2026-11-01',
    });
    const c = household({ recurring: [storedRecurring()], expenses: [posted] });
    await c.layer.ready;
    await settle(c.layer);
    // Meanwhile the server's count moved on (the nightly job), unheard by this phone: its copy still says 11.
    const server = tablesOf(c).recurring[0];
    if (server) server.posted_count = 12;
    m.saveRecurring({ ...rent({ amount: pence(150000), startDate: '2026-01-01' }), id: storedRecurring().id }, c.layer);
    await settle(c.layer);
    expect(tablesOf(c).recurring[0]).toMatchObject({ amount_pence: 150000, paid: { [JAE_ID]: 150000 }, shares: { [JAE_ID]: 75000, [SAM_ID]: 75000 }, posted_count: 12 });
    expect(c.controls.tables.expenses.find((e) => e.id === posted.id)).toMatchObject({ amount_pence: 145000, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 } });
    // The price change is in the template's history (the Bills sheet words it: "Rent £1,450.00 → £1,500.00 from December").
    const edit = c.controls.tables.activity.find((a) => a.entity === 'recurring' && a.entity_id === storedRecurring().id && a.action === 'edited');
    expect(edit?.summary).toMatchObject({ amount_pence: { before: 145000, after: 150000 } });
  });
});

describe('pause and end (REC-1: nothing is hard-deleted)', () => {
  it('REC-1: pause makes a template inactive, resume brings it back; a second tap changes nothing', async () => {
    const c = household({ recurring: [storedRecurring()] });
    await c.layer.ready;
    expect(m.pauseRecurring(storedRecurring().id, c.layer)).toBe(true);
    expect(m.pauseRecurring(storedRecurring().id, c.layer)).toBe(false);
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]?.active).toBe(false);
    expect(m.resumeRecurring(storedRecurring().id, c.layer)).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).recurring[0]?.active).toBe(true);
    expect(c.controls.calls.some((call) => /delete/i.test(call.name))).toBe(false);
  });

  it('REC-1: end sets the last day and keeps the template (and its history)', async () => {
    const c = household({ recurring: [storedRecurring()] });
    await c.layer.ready;
    const view = watch(c.layer);
    act(() => { expect(m.endRecurring(storedRecurring().id, '2026-12-31', c.layer)).toBe(true); });
    await waitFor(() => { expect(view.result.current.recurring.data?.[0]?.end_date).toBe('2026-12-31'); });
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]?.end_date).toBe('2026-12-31');
    view.unmount();
  });

  it('REC-2: a paused template posts nothing, even when its day has come', async () => {
    const c = household({ recurring: [storedRecurring({ start_date: '2026-01-14', posted_count: 10, active: false })] });
    await c.layer.ready;
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
  });
});

// ───────── OFF-2 OFF-5: editing, pausing and ending offline (the owner's check of regular payments) ─────────

describe('changing a regular payment offline (OFF-2, OFF-5, REC-1, REC-6)', () => {
  const ID = storedRecurring().id;
  /** What reached the "server" for this template, in order: the columns each write changed. */
  const logged = (c: ReturnType<typeof household>) => c.controls.tables.activity
    .filter((a) => a.entity === 'recurring' && a.entity_id === ID && a.action === 'edited')
    .map((a) => Object.keys(a.summary as object).sort());

  it('OFF-2: a new amount, a pause and an end made offline show at once, wait in order, and reach the server in that order', async () => {
    const c = household({ recurring: [storedRecurring()] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    act(() => {
      m.saveRecurring({ ...rent({ amount: pence(150000), startDate: '2026-01-01' }), id: ID }, c.layer);
      expect(m.pauseRecurring(ID, c.layer)).toBe(true);
      expect(m.endRecurring(ID, '2026-12-31', c.layer)).toBe(true);
    });
    await waitFor(() => { expect(view.result.current.recurring.data?.[0]).toMatchObject({ amount_pence: 150000, active: false, end_date: '2026-12-31' }); });
    expect(view.result.current.sync.waiting).toBe(3);
    expect(tablesOf(c).recurring[0]).toMatchObject({ amount_pence: 145000, active: true, end_date: null });

    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({ amount_pence: 150000, shares: { [JAE_ID]: 75000, [SAM_ID]: 75000 }, active: false, end_date: '2026-12-31', posted_count: 11 });
    expect(logged(c)).toEqual([['amount_pence', 'paid', 'shares'], ['active'], ['end_date']]);
    expect(c.controls.calls.filter((call) => call.name === 'upsertRecurring')).toHaveLength(3);
    view.unmount();
  });

  it('OFF-5: the same three, waiting when the app is closed, are sent once and in order on the next open; resume after a reload too', async () => {
    const storage = memoryStorage();
    const first = household({ recurring: [storedRecurring()], storage });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    m.saveRecurring({ ...rent({ amount: pence(150000), startDate: '2026-01-01', description: 'Rent (flat)' }), id: ID }, first.layer);
    m.pauseRecurring(ID, first.layer);
    m.endRecurring(ID, '2026-12-31', first.layer);
    await first.layer.flush();
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);
    expect(tablesOf(first).recurring[0]).toMatchObject({ amount_pence: 145000, active: true, end_date: null });

    // The phone restarts over the same storage, still offline: the three are still waiting, and still shown.
    const second = household({ recurring: tablesOf(first).recurring, storage, online: false });
    await second.layer.ready;
    const view = watch(second.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(3); });
    expect(view.result.current.recurring.data?.[0]).toMatchObject({ description: 'Rent (flat)', amount_pence: 150000, active: false, end_date: '2026-12-31' });
    // Resumed while still offline: a fourth, after the three.
    act(() => { expect(m.resumeRecurring(ID, second.layer)).toBe(true); });
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(4); });

    second.network.set(true);
    await settle(second.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    expect(tablesOf(second).recurring).toHaveLength(1);
    expect(tablesOf(second).recurring[0]).toMatchObject({ description: 'Rent (flat)', amount_pence: 150000, active: true, end_date: '2026-12-31' });
    expect(logged(second)).toEqual([['amount_pence', 'description', 'paid', 'shares'], ['active'], ['end_date'], ['active']]);
    view.unmount();
  });

  it('REC-1: End on a payment that hasn’t started yet is stored (its end before its start, as the database allows), and it can still be edited', async () => {
    const later = storedRecurring({ start_date: '2026-12-20', posted_count: 0 });
    const c = household({ recurring: [later] });
    await c.layer.ready;
    expect(m.endRecurring(ID, undefined, c.layer)).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).recurring[0]).toMatchObject({ end_date: TODAY, start_date: '2026-12-20' });
    expect(c.layer.problems.list()).toEqual([]);
    m.saveRecurring({ ...rent({ description: 'Rent (old flat)', startDate: '2026-12-20', endDate: TODAY }), id: ID }, c.layer);
    await settle(c.layer);
    expect(tablesOf(c).recurring[0]).toMatchObject({ description: 'Rent (old flat)', end_date: TODAY });
    // A new end picked before the start is still refused on the phone.
    expect(() => m.saveRecurring({ ...rent({ startDate: '2026-12-20', endDate: '2026-12-01' }), id: ID }, c.layer)).toThrow(EntryInvalidError);
  });
});

// ─────────────────────────────── REC-2: posting ───────────────────────────────

describe('posting (REC-2, REC-4, OFF-4)', () => {
  it('REC-2 REC-4: a template due today posts as soon as it reaches the server, once, at home and in no chapter', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const view = watch(c.layer);
    let id = '';
    act(() => { id = m.saveRecurring({ ...netflix(), id: FORM_ID }, c.layer); });
    await settle(c.layer);
    act(() => { m.saveRecurring({ ...netflix(), id: FORM_ID }, c.layer); }); // a double tap
    await settle(c.layer);

    const names = c.controls.calls.map((call) => call.name);
    expect(names.lastIndexOf('postDueRecurring')).toBeGreaterThan(names.indexOf('upsertRecurring'));
    const posted = c.controls.tables.expenses.filter((e) => e.recurring_id === id);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      description: 'Netflix', amount_pence: 1099, date: TODAY, occurrence_date: TODAY, source: 'recurring', country: 'GB', chapter_id: null,
      paid: { [JAE_ID]: 1099 }, shares: { [JAE_ID]: 550, [SAM_ID]: 549 },
    });
    expect(tablesOf(c).recurring[0]?.posted_count).toBe(1);
    // Both the phone's list and its balance show it, once.
    await waitFor(() => { expect(view.result.current.entries.data?.filter((e) => e.recurring_id === id)).toHaveLength(1); });
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 549, [SAM_ID]: -549 });
    view.unmount();
  });

  it('OFF-4 REC-2: saved offline, a template due today is not money until it posts; back online it posts once', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = m.saveRecurring(netflix(), c.layer);
    await settle(c.layer);
    expect(c.layer.entries().filter((e) => e.recurring_id === id)).toEqual([]);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 });
    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(c.layer.entries().filter((e) => e.recurring_id === id)).toHaveLength(1); });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === id)).toHaveLength(1);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 549, [SAM_ID]: -549 });
  });

  it('REC-2 REC-3: opening the app posts what is due; a bill whose amount varies arrives in the Inbox, not in the balance', async () => {
    // Energy's 3 Nov bill is due and not posted yet (posted_count 10: Jan…Oct).
    const c = household({ recurring: [energyTemplate({ posted_count: 10 })] });
    await c.layer.ready;
    const view = watch(c.layer);
    await settle(c.layer);
    await waitFor(() => { expect(view.result.current.inbox.data).toHaveLength(1); });
    expect(view.result.current.inbox.data?.[0]).toMatchObject({
      source: 'bill', status: 'open', recurring_id: ENERGY_ID, occurrence_date: '2026-11-03',
      payload: { description: 'Energy', estimate_pence: 9000, date: '2026-11-03' },
    });
    expect(c.controls.tables.expenses).toEqual([]);
    // INB-3: never counted.
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 });
    expect(view.result.current.balance).toMatchObject({ status: 'ready', nets: { [JAE_ID]: 0, [SAM_ID]: 0 } });
    view.unmount();
  });
});

// ─────────────────────────────── INB-1…INB-3: the Inbox ───────────────────────────────

describe('the Inbox (INB-1, INB-2, INB-3)', () => {
  it('INB-1: useInbox lists the open items, oldest first; kept and dismissed ones are not waiting', async () => {
    const older = storedInboxItem();
    const newer = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c2', recurring_id: '00000000-0000-4000-8000-00000000d0e2', occurrence_date: '2026-11-10', created_at: '2026-11-10T00:05:00.000Z', payload: { description: 'Water', estimate_pence: 3000, date: '2026-11-10', category_id: null } });
    const kept = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c3', occurrence_date: '2026-10-03', status: 'kept', created_at: '2026-10-03T00:05:00.000Z' });
    const dismissed = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c4', occurrence_date: '2026-09-03', status: 'dismissed', created_at: '2026-09-03T00:05:00.000Z' });
    const c = household({ recurring: [energyTemplate()], inboxItems: [newer, kept, older, dismissed] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.inbox.data?.map((i) => i.id)).toEqual([older.id, newer.id]); });
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 }); // INB-3
    view.unmount();
  });

  it('INB-2 REC-3 REC-4 OFF-2: Keep, offline: the item leaves the Inbox at once, the entry shows at once; online it is stored once and the item points at it', async () => {
    const c = household({ recurring: [energyTemplate()], inboxItems: [storedInboxItem()] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.inbox.data).toHaveLength(1); });
    c.network.set(false);
    let id = '';
    act(() => { id = m.keepInboxItem(storedInboxItem().id, { ...energyDraft(), id: FORM_ID }, c.layer); });
    expect(id).toBe(FORM_ID);
    await waitFor(() => { expect(view.result.current.inbox.data).toEqual([]); });
    expect(view.result.current.entries.data?.find((e) => e.id === FORM_ID)).toMatchObject({ amount_pence: 8437, description: 'Energy' });
    // Sam paid £84.37, half each: Jae owes Sam £42.18 (the leftover penny is the payer's).
    expect(c.layer.balance()).toEqual({ [JAE_ID]: -4218, [SAM_ID]: 4218 });
    expect(view.result.current.sync.waiting).toBeGreaterThanOrEqual(1);

    c.network.set(true);
    await settle(c.layer);
    const stored = c.controls.tables.expenses.filter((e) => e.recurring_id === ENERGY_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: FORM_ID, description: 'Energy', amount_pence: 8437, date: '2026-11-03', occurrence_date: '2026-11-03', source: 'recurring',
      country: 'GB', chapter_id: null, paid: { [SAM_ID]: 8437 }, shares: { [JAE_ID]: 4218, [SAM_ID]: 4219 },
    });
    expect(tablesOf(c).inboxItems[0]).toMatchObject({ status: 'kept', expense_id: FORM_ID });
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    view.unmount();
  });

  it('INB-2 Q-F1: Keep tapped twice records one entry and keeps the item once', async () => {
    const c = household({ recurring: [energyTemplate()], inboxItems: [storedInboxItem()] });
    await c.layer.ready;
    await settle(c.layer);
    const input = { ...energyDraft(), id: FORM_ID };
    expect(m.keepInboxItem(storedInboxItem().id, input, c.layer)).toBe(FORM_ID);
    expect(m.keepInboxItem(storedInboxItem().id, input, c.layer)).toBe(FORM_ID);
    // A second, different tap on an item this phone has already kept doesn't make another entry either.
    m.keepInboxItem(storedInboxItem().id, { ...energyDraft(), id: '00000000-0000-4000-8000-0000000f0302' }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === ENERGY_ID).map((e) => e.id)).toEqual([FORM_ID]);
    expect(tablesOf(c).inboxItems[0]).toMatchObject({ status: 'kept', expense_id: FORM_ID });
    expect(c.layer.balance()).toEqual({ [JAE_ID]: -4218, [SAM_ID]: 4218 });
  });

  it('INB-2: Not ours dismisses the item and makes no entry; a second tap changes nothing', async () => {
    const c = household({ recurring: [energyTemplate()], inboxItems: [storedInboxItem()] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.inbox.data).toHaveLength(1); });
    act(() => { expect(m.dismissInboxItem(storedInboxItem().id, c.layer)).toBe(true); });
    await waitFor(() => { expect(view.result.current.inbox.data).toEqual([]); });
    expect(m.dismissInboxItem(storedInboxItem().id, c.layer)).toBe(false);
    await settle(c.layer);
    expect(tablesOf(c).inboxItems).toHaveLength(1);
    expect(tablesOf(c).inboxItems[0]).toMatchObject({ status: 'dismissed', expense_id: null });
    expect(c.controls.tables.expenses).toEqual([]);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 0, [SAM_ID]: 0 });
    view.unmount();
  });

  it('INB-2 ACT-5: when the partner keeps the bill, this phone’s Inbox clears as soon as it hears (Realtime)', async () => {
    const c = household({ as: 'sam', recurring: [energyTemplate()], inboxItems: [storedInboxItem()] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.inbox.data).toHaveLength(1); });
    // Jae kept it on the other phone.
    const expense = storedExpense({ id: '00000000-0000-4000-8000-00000000e302', description: 'Energy', amount_pence: 8437, date: '2026-11-03', paid: { [SAM_ID]: 8437 }, shares: { [JAE_ID]: 4218, [SAM_ID]: 4219 }, source: 'recurring', recurring_id: ENERGY_ID, occurrence_date: '2026-11-03' });
    c.controls.tables.expenses.push(expense);
    const item = tablesOf(c).inboxItems[0];
    if (item) Object.assign(item, { status: 'kept', expense_id: expense.id });
    act(() => {
      c.controls.emitChange('inbox_items');
      c.controls.emitChange('expenses');
    });
    await waitFor(() => { expect(view.result.current.inbox.data).toEqual([]); });
    await waitFor(() => { expect(view.result.current.entries.data?.map((e) => e.id)).toContain(expense.id); });
    view.unmount();
  });

  it('REC-1 ACT-5: the partner’s new template reaches this phone through Realtime', async () => {
    const c = household({ as: 'sam' });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.recurring.data).toEqual([]); });
    tablesOf(c).recurring.push(storedRecurring());
    act(() => { c.controls.emitChange('recurring'); });
    await waitFor(() => { expect(view.result.current.recurring.data?.map((r) => r.id)).toEqual([storedRecurring().id]); });
    view.unmount();
  });
});

// ─────────────────────────────── CAT-1: categories ───────────────────────────────

describe('categories (CAT-1)', () => {
  const names = (rows: CategoryRow[] | undefined) => rows?.map((r) => r.name);

  it('CAT-1 OFF-2: a new category, offline, shows at once (last) and is stored when back online', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.categories.data).toHaveLength(12); });
    let id = '';
    act(() => { id = m.saveCategory({ name: 'Pets', emoji: '🐾', colour: 'fern' }, c.layer); });
    await waitFor(() => { expect(names(view.result.current.categories.data)?.at(-1)).toBe('Pets'); });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === id)).toMatchObject({ household_id: HID, name: 'Pets', emoji: '🐾', colour: 'fern', archived: false });
    const sorts = c.controls.tables.categories.map((r) => r.sort);
    expect(c.controls.tables.categories.find((r) => r.id === id)?.sort).toBe(Math.max(...sorts));
    view.unmount();
  });

  it('CAT-1: rename, re-emoji and recolour keep the same category, so its entries follow', async () => {
    const lamp = storedExpense({ category_id: categoryId('Groceries') });
    const c = household({ expenses: [lamp] });
    await c.layer.ready;
    expect(m.saveCategory({ id: categoryId('Groceries'), name: 'Food shop', emoji: '🥕', colour: 'amber' }, c.layer)).toBe(categoryId('Groceries'));
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Groceries'))).toMatchObject({ name: 'Food shop', emoji: '🥕', colour: 'amber' });
    expect(c.controls.tables.categories).toHaveLength(12);
    expect(c.controls.tables.expenses.find((e) => e.id === lamp.id)?.category_id).toBe(categoryId('Groceries'));
  });

  it('CAT-1: a colour outside the palette, or no name, is refused on the phone', async () => {
    const c = household();
    await c.layer.ready;
    expect(() => m.saveCategory({ name: 'Neon', emoji: '•', colour: '#ff00ff' as CategoryColour }, c.layer)).toThrow(EntryInvalidError);
    expect(() => m.saveCategory({ name: '   ', emoji: '•', colour: 'stone' }, c.layer)).toThrow(EntryInvalidError);
    await settle(c.layer);
    expect(c.controls.tables.categories).toHaveLength(12);
  });

  it('CAT-1: archiving keeps the category and its entries; it can be brought back', async () => {
    const lamp = storedExpense({ category_id: categoryId('Household') });
    const c = household({ expenses: [lamp] });
    await c.layer.ready;
    const view = watch(c.layer);
    act(() => { expect(m.archiveCategory(categoryId('Household'), true, c.layer)).toBe(true); });
    await waitFor(() => { expect(view.result.current.categories.data?.find((r) => r.id === categoryId('Household'))?.archived).toBe(true); });
    expect(m.archiveCategory(categoryId('Household'), true, c.layer)).toBe(false);
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Household'))?.archived).toBe(true);
    expect(c.controls.tables.categories).toHaveLength(12);
    expect(c.controls.tables.expenses.find((e) => e.id === lamp.id)?.category_id).toBe(categoryId('Household'));
    expect(m.archiveCategory(categoryId('Household'), false, c.layer)).toBe(true);
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Household'))?.archived).toBe(false);
    view.unmount();
  });

  it('CAT-1: reordering shows the new order at once and stores it', async () => {
    const c = household();
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.categories.data).toHaveLength(12); });
    const order = ['Other', 'Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health'];
    act(() => { m.reorderCategories(order.map(categoryId), c.layer); });
    await waitFor(() => { expect(names(view.result.current.categories.data)).toEqual(order); });
    await settle(c.layer);
    const stored = [...c.controls.tables.categories].sort((a, b) => a.sort - b.sort).map((r) => r.name);
    expect(stored).toEqual(order);
    view.unmount();
  });
});
