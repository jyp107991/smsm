/**
 * S10 data layer (the owner's two asks for regular payments; DECISIONS 24 Nov): delete a paused or ended regular
 * payment, and a new start after one has posted. Over the in-memory Api, which does what recurring_guard and
 * post_due_recurring do (migration 20261124000000; tests/sql/recurring_delete_test.sql, recurring_restart_test.sql).
 *
 *   deleteRecurring(id, layer?): boolean    deleted_at = now, through the queue (offline too), the column alone;
 *                                           refused on the phone (EntryInvalidError 'stillRunning') while it runs
 *   restoreRecurring(id, layer?): boolean   Undo: deleted_at = null, the column alone
 *   isDeleted(row): boolean                 a template with deleted_at set (a row stored before the column: not)
 *   saveRecurring({ ...draft, id })         a new start on a template that has posted: the waiting copy carries
 *                                           the count the server will make (core restart), so nothing past looks due
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring, TODAY, type RecurringRow } from '../../tests/fixtures/couple';
import { restart } from '../core/recurring';
import { pence } from '../core/money';
import { backupJson } from './backup';
import { DataProvider } from './DataProvider';
import * as hooks from './hooks';
import * as data from './index';
import { memoryStorage } from './storage';
import type { DataLayer } from './queryClient';
import { EntryInvalidError } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = data as typeof data & {
  deleteRecurring(id: string, layer?: DataLayer): boolean;
  restoreRecurring(id: string, layer?: DataLayer): boolean;
  isDeleted(row: Pick<RecurringRow, 'deleted_at'>): boolean;
};

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
function watch(layer: DataLayer) {
  return renderHook(() => ({ recurring: hooks.useRecurring(), entries: hooks.useEntries(), balance: hooks.useBalance(), sync: hooks.useSyncStatus() }), { wrapper: wrapperFor(layer) });
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const ID = storedRecurring().id;
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const rentDraft = (startDate: string) => ({
  description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even,
  frequency: 'monthly' as const, every: 1, startDate, endDate: null, amountVaries: false, isSubscription: false,
});
/** What reached the "server" for this template: the action and, for an edit, the columns it changed. */
const logged = (c: ReturnType<typeof household>) => c.controls.tables.activity
  .filter((a) => a.entity === 'recurring' && a.entity_id === ID)
  .map((a) => (a.action === 'edited' ? Object.keys(a.summary as object).sort().join(',') : a.action));

describe('deleting a regular payment (S10, REC-1)', () => {
  it('S10 REC-1 OFF-2: a paused one, offline: shown deleted at once, waits in the queue, reaches the server as deleted_at alone, logged as deleted', async () => {
    const c = household({ recurring: [storedRecurring({ active: false })] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.recurring.data).toHaveLength(1); });
    act(() => { expect(m.deleteRecurring(ID, c.layer)).toBe(true); });
    await waitFor(() => { expect(m.isDeleted(view.result.current.recurring.data?.[0] ?? { deleted_at: null })).toBe(true); });
    expect(view.result.current.sync.waiting).toBe(1);
    expect(c.controls.tables.recurring[0]?.deleted_at).toBeNull();
    // A second tap changes nothing.
    expect(m.deleteRecurring(ID, c.layer)).toBe(false);

    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    expect(c.controls.tables.recurring).toHaveLength(1);
    expect(c.controls.tables.recurring[0]).toMatchObject({ active: false, description: 'Rent', posted_count: 11 });
    expect(c.controls.tables.recurring[0]?.deleted_at).not.toBeNull();
    expect(logged(c)).toEqual(['deleted']);
    expect(c.controls.tables.activity.find((a) => a.action === 'deleted')).toMatchObject({ actor: JAE_ID, summary: { description: 'Rent', amount_pence: 145000 } });
    expect(c.controls.calls.some((call) => /delete/i.test(call.name))).toBe(false);
    view.unmount();
  });

  it('S10: Undo restores it (deleted_at cleared, logged as restored), still paused', async () => {
    const c = household({ recurring: [storedRecurring({ active: false })] });
    await c.layer.ready;
    m.deleteRecurring(ID, c.layer);
    expect(m.restoreRecurring(ID, c.layer)).toBe(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ deleted_at: null, active: false });
    expect(logged(c)).toEqual(['deleted', 'restored']);
    expect(m.restoreRecurring(ID, c.layer)).toBe(false);
  });

  it('S10: an ended one (its end on or before today) can be deleted; a running one is refused on the phone', async () => {
    const c = household({ recurring: [storedRecurring({ end_date: TODAY }), storedRecurring({ id: '00000000-0000-4000-8000-00000000d002', end_date: '2026-11-15' })] });
    await c.layer.ready;
    expect(m.deleteRecurring(ID, c.layer)).toBe(true);
    expect(() => m.deleteRecurring('00000000-0000-4000-8000-00000000d002', c.layer)).toThrow(EntryInvalidError);
    await settle(c.layer);
    expect(c.controls.tables.recurring.map((r) => r.deleted_at !== null)).toEqual([true, false]);
  });

  it('S10 REC-2: a deleted template never posts, even with a day due; what it posted stays, with its recurring_id, in the balance', async () => {
    const posted = storedExpense({ description: 'Rent', amount_pence: 145000, date: '2026-11-01', paid: { [JAE_ID]: 145000 }, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 }, source: 'recurring', recurring_id: ID, occurrence_date: '2026-11-01' });
    // Weekly, ended yesterday, with 1 Nov posted and 8 Nov never posted; deleted on the other phone. Opening the app posts
    // what is due (REC-2): nothing for it.
    const c = household({ recurring: [storedRecurring({ frequency: 'weekly', start_date: '2026-11-01', end_date: '2026-11-13', posted_count: 1, deleted_at: '2026-11-13T20:00:00.000Z' })], expenses: [posted] });
    await c.layer.ready;
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({ id: posted.id, recurring_id: ID, deleted_at: null, amount_pence: 145000 });
    expect(c.controls.tables.recurring[0]?.posted_count).toBe(1);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 72500, [SAM_ID]: -72500 });
  });

  it('S10: a deleted one can’t be resumed (on the phone), and a stale phone’s queued resume is refused by the server and shown as a problem', async () => {
    const storage = memoryStorage();
    const sam = household({ as: 'sam', recurring: [storedRecurring({ active: false })], storage });
    await sam.layer.ready;
    await settle(sam.layer);
    sam.network.set(false);
    // Sam resumes it offline; meanwhile Jae deleted it on the other phone.
    expect(m.resumeRecurring(ID, sam.layer)).toBe(true);
    const row = sam.controls.tables.recurring[0];
    if (row) row.deleted_at = '2026-11-14T08:00:00.000Z';
    sam.network.set(true);
    await settle(sam.layer);
    expect(sam.controls.tables.recurring[0]).toMatchObject({ active: false, deleted_at: '2026-11-14T08:00:00.000Z' });
    expect(sam.layer.problems.list().map((p) => p.reason)).toEqual(['deleted-regular']);
    // And this phone, now knowing, refuses before sending.
    await act(async () => { await sam.layer.refresh(); });
    expect(() => m.resumeRecurring(ID, sam.layer)).toThrow(EntryInvalidError);
  });

  it('S10 review 5: deleting one that ends today, before today’s day has posted, posts it first, once', async () => {
    const weekly = storedRecurring({ frequency: 'weekly', start_date: '2026-11-07', end_date: TODAY, posted_count: 0, ever_posted: false, paid: { [JAE_ID]: 145000, [SAM_ID]: 0 } });
    const c = household({ recurring: [weekly] });
    await c.layer.ready;
    await settle(c.layer);
    const server = c.controls.tables;
    server.expenses = server.expenses.filter((e) => e.occurrence_date !== TODAY);
    const row = server.recurring[0];
    if (row) row.posted_count = 1;
    await act(async () => { await c.layer.refresh(); });
    expect(m.deleteRecurring(ID, c.layer)).toBe(true);
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    expect(server.recurring[0]?.posted_count).toBe(2);
    expect(server.recurring[0]?.deleted_at).not.toBeNull();
    expect(server.expenses.filter((e) => e.recurring_id === ID).map((e) => e.occurrence_date).sort()).toEqual(['2026-11-07', TODAY]);
  });

  it('S10 OFF-5: a delete waiting when the app closes is sent once on the next open', async () => {
    const storage = memoryStorage();
    const first = household({ recurring: [storedRecurring({ active: false })], storage });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    m.deleteRecurring(ID, first.layer);
    await first.layer.flush();
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);
    const second = household({ recurring: first.controls.tables.recurring, storage, online: false });
    await second.layer.ready;
    const view = watch(second.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(1); });
    expect(m.isDeleted(view.result.current.recurring.data?.[0] ?? { deleted_at: null })).toBe(true);
    second.network.set(true);
    await settle(second.layer);
    expect(second.controls.tables.recurring[0]?.deleted_at).not.toBeNull();
    expect(logged(second)).toEqual(['deleted']);
    view.unmount();
  });

  it('S10 EXP-1: the backup holds a deleted template with its deleted_at, as it holds deleted entries', async () => {
    const c = household({ recurring: [storedRecurring({ active: false })] });
    await c.layer.ready;
    await settle(c.layer);
    m.deleteRecurring(ID, c.layer);
    const file = JSON.parse(backupJson({ appVersion: 'test' }, c.layer)) as { recurring: RecurringRow[] };
    expect(file.recurring).toHaveLength(1);
    expect(file.recurring[0]?.deleted_at).not.toBeNull();
  });

  it('S10: isDeleted reads a row stored before the column existed as not deleted', () => {
    expect(m.isDeleted({ deleted_at: null })).toBe(false);
    expect(m.isDeleted({} as Pick<RecurringRow, 'deleted_at'>)).toBe(false);
    expect(m.isDeleted({ deleted_at: '2026-11-14T08:00:00.000Z' })).toBe(true);
  });
});

describe('a new start after one has posted (S10, REC-2, REC-6)', () => {
  /** The stored rent with its money exactly as the phone builds it (each person named in paid), so only the start differs. */
  const rentAsSaved = () => storedRecurring({ paid: { [JAE_ID]: 145000, [SAM_ID]: 0 } });

  it('S10 OFF-2: offline, the waiting copy shows the count the server will make; the server stores the start and the next payment is the nearest to the old next day', async () => {
    // Rent from 1 Jan, posted to 1 Nov (11): D = 1 Dec. Moved to the 15th: 15 Dec (14 days) is nearer than 15 Nov (16).
    const c = household({ recurring: [rentAsSaved()] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    act(() => { m.saveRecurring({ ...rentDraft('2026-01-15'), id: ID }, c.layer); });
    expect(restart({ frequency: 'monthly', every: 1, startDate: '2026-01-01', endDate: null }, 11, '2026-01-15')).toMatchObject({ done: 11, next: '2026-12-15' });
    await waitFor(() => { expect(view.result.current.recurring.data?.[0]).toMatchObject({ start_date: '2026-01-15', posted_count: 11 }); });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2026-01-15', posted_count: 11, ever_posted: true });
    expect(c.controls.tables.expenses).toEqual([]);
    expect(logged(c)).toEqual(['start_date']);
    view.unmount();
  });

  it('S10 REC-2: the review’s 15th → 5th: the nearest new day is before today, and it posts at once on its own date, once', async () => {
    // Monthly from 15 Jan, posted to 15 Oct (10): D = 15 Nov. Moved to the 5th: 5 Nov (10 days) beats 5 Dec (20).
    const c = household({ recurring: [storedRecurring({ start_date: '2026-01-15', posted_count: 10, paid: { [JAE_ID]: 145000, [SAM_ID]: 0 } })] });
    await c.layer.ready;
    await settle(c.layer);
    m.saveRecurring({ ...rentDraft('2026-01-05'), id: ID }, c.layer);
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    await act(async () => { await c.layer.api.postDueRecurring(); });
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2026-01-05', posted_count: 11 });
    expect(c.controls.tables.expenses.map((e) => e.occurrence_date)).toEqual(['2026-11-05']);
  });

  it('S10: moved to before the first posting, nothing back-posts', async () => {
    const c = household({ recurring: [rentAsSaved()] });
    await c.layer.ready;
    m.saveRecurring({ ...rentDraft('2024-06-01'), id: ID }, c.layer);
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2024-06-01', posted_count: 30 });
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('S10 review 1: "has posted" survives a start moved into the future (count 0): moving it far back then back-posts nothing', async () => {
    const c = household({ recurring: [rentAsSaved()] });
    await c.layer.ready;
    m.saveRecurring({ ...rentDraft('2026-12-04'), id: ID }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2026-12-04', posted_count: 0, ever_posted: true });
    // D = 4 Dec; from 11 Jan the days are 11 Nov (23 days) and 11 Dec (7): 11 Dec, nothing posts now.
    m.saveRecurring({ ...rentDraft('2026-01-11'), id: ID }, c.layer);
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2026-01-11', posted_count: 11 });
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('S10 REC-2: a day due today not posted yet (before the nightly post): the nearest new day replaces it, billed once', async () => {
    // Weekly from Sat 7 Nov. Opening posts 7 and 14 Nov; then, as if the nightly post hadn't run yet, 14 Nov isn't posted.
    const weekly = storedRecurring({ frequency: 'weekly', start_date: '2026-11-07', posted_count: 0, ever_posted: false, paid: { [JAE_ID]: 145000, [SAM_ID]: 0 } });
    const c = household({ recurring: [weekly] });
    await c.layer.ready;
    await settle(c.layer);
    const server = c.controls.tables;
    server.expenses = server.expenses.filter((e) => e.occurrence_date !== TODAY);
    const row = server.recurring[0];
    if (row) row.posted_count = 1;
    await act(async () => { await c.layer.refresh(); });
    c.network.set(false);
    const view = watch(c.layer);
    // Moved to Wed 11 Nov: D = 14 Nov; 11 Nov (3 days) beats 18 Nov (4). The phone's waiting copy says so at once.
    act(() => { m.saveRecurring({ ...rentDraft('2026-11-11'), frequency: 'weekly', id: ID }, c.layer); });
    await waitFor(() => { expect(view.result.current.recurring.data?.[0]).toMatchObject({ start_date: '2026-11-11', posted_count: 0 }); });
    c.network.set(true);
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); });
    expect(server.recurring[0]).toMatchObject({ start_date: '2026-11-11', posted_count: 1 });
    expect(server.expenses.filter((e) => e.recurring_id === ID).map((e) => e.occurrence_date).sort()).toEqual(['2026-11-07', '2026-11-11']);
    view.unmount();
  });

  it('S10 review 2: a stale edit (only the amount) never undoes the partner’s new start, even with the sheet opened before it', async () => {
    const c = household({ as: 'sam', recurring: [rentAsSaved()] });
    await c.layer.ready;
    await settle(c.layer);
    // Jae moved it to the 15th on the other phone; this phone has heard (or not): either way the form opened on the 1st.
    const row = c.controls.tables.recurring[0];
    if (row) Object.assign(row, { start_date: '2026-01-15', posted_count: 11 });
    await act(async () => { await c.layer.refresh(); });
    m.saveRecurring({ ...rentDraft('2026-01-01'), amount: pence(150000), id: ID, opened: { frequency: 'monthly', every: 1, startDate: '2026-01-01', endDate: null } }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ amount_pence: 150000, start_date: '2026-01-15', posted_count: 11 });
    const edit = c.controls.tables.activity.filter((a) => a.entity === 'recurring' && a.action === 'edited').at(-1);
    expect(Object.keys(edit?.summary as object).sort()).toEqual(['amount_pence', 'paid', 'shares']);
  });

  it('S10 review 2: offline, a stale phone’s amount change sent later leaves the start alone too (no opened: compared with its own copy)', async () => {
    const c = household({ as: 'sam', recurring: [rentAsSaved()] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    m.saveRecurring({ ...rentDraft('2026-01-01'), amount: pence(150000), id: ID }, c.layer);
    const row = c.controls.tables.recurring[0];
    if (row) Object.assign(row, { start_date: '2026-01-15', posted_count: 11 });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ amount_pence: 150000, start_date: '2026-01-15', posted_count: 11 });
  });

  it('S10: a template that hasn’t posted yet moves as before (its past is the past-start choice’s, not counted done)', async () => {
    const c = household({ recurring: [storedRecurring({ start_date: '2026-12-01', posted_count: 0 })] });
    await c.layer.ready;
    m.saveRecurring({ ...rentDraft('2026-12-20'), id: ID }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ start_date: '2026-12-20', posted_count: 0 });
  });
});
