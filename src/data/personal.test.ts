/**
 * S10 data layer: personal regular payments (owner, 25 Nov; DECISIONS 25 Nov "Personal regular payments"; SPEC REC-9…
 * REC-12). Written before the build. Over the in-memory Api, which does what migration 20261125000000 does
 * (tests/sql/personal_test.sql): row-level security (only the owner writes a personal row), check_personal, posting
 * the owner's own entries, a change of whose applying from the next payment on.
 *
 *   saveRecurring({ ...draft, ownerId })   ownerId: my id, mine (paid and shares all mine, a treat; a fixed amount);
 *                                          null, shared; not given, as it was. The partner's: refused (notTheirs).
 *   useEntries / useRecurring              shared only; useAllEntries / useAllRecurring: everything
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring, TODAY } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import { backupJson } from './backup';
import { DataProvider } from './DataProvider';
import * as hooks from './hooks';
import * as data from './index';
import type { DataLayer } from './queryClient';
import { EntryInvalidError } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  return renderHook(() => ({
    shared: hooks.useEntries(), all: hooks.useAllEntries(), recurring: hooks.useRecurring(), allRecurring: hooks.useAllRecurring(),
    balance: hooks.useBalance(), sync: hooks.useSyncStatus(),
  }), { wrapper: wrapperFor(layer) });
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const GYM = '00000000-0000-4000-8000-00000000d0a1';
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const gymDraft = (over: Partial<Parameters<typeof data.saveRecurring>[0]> = {}) => ({
  description: 'Gym', amount: pence(3500), categoryId: categoryId('Health'), payer: JAE_ID, split: even,
  frequency: 'monthly' as const, every: 1, startDate: '2026-09-02', endDate: null, amountVaries: false, isSubscription: false,
  ...over,
});
/** Jae's own gym as the server holds it, posted up to 2 Nov. */
const storedGym = () => storedRecurring({
  id: GYM, description: 'Gym', amount_pence: 3500, category_id: categoryId('Health'), paid: { [JAE_ID]: 3500 }, split_mode: 'treat', split_params: null,
  shares: { [JAE_ID]: 3500 }, start_date: '2026-09-02', posted_count: 3, owner_id: JAE_ID,
});
const gymEntry = (date: string) => storedExpense({
  id: `00000000-0000-4000-8000-0000000e${date.slice(5, 7)}${date.slice(8, 10)}`, description: 'Gym', amount_pence: 3500, date, paid: { [JAE_ID]: 3500 },
  split_mode: 'treat', split_params: null, shares: { [JAE_ID]: 3500 }, source: 'recurring', recurring_id: GYM, occurrence_date: date, owner_id: JAE_ID,
  category_id: categoryId('Health'),
});

describe('REC-9, REC-10: adding your own regular payment', () => {
  it('REC-9 REC-10: "Mine" saves it all yours (a treat by you), posts your own entries, and the balance never moves', async () => {
    const lamp = storedExpense();
    const c = household({ expenses: [lamp] });
    await c.layer.ready;
    await settle(c.layer);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.balance.status).toBe('ready'); });
    const before = c.layer.balance();
    let id = '';
    act(() => { id = data.saveRecurring({ ...gymDraft(), ownerId: JAE_ID }, c.layer); });
    await settle(c.layer);
    await act(async () => { await c.layer.api.postDueRecurring(); await c.layer.refresh(); });
    await settle(c.layer);
    const stored = c.controls.tables.recurring.find((r) => r.id === id);
    expect(stored).toMatchObject({ owner_id: JAE_ID, split_mode: 'treat', paid: { [JAE_ID]: 3500 }, amount_varies: false });
    expect((stored?.shares as Record<string, number>)[JAE_ID]).toBe(3500);
    const posted = c.controls.tables.expenses.filter((e) => e.recurring_id === id);
    expect(posted.map((e) => e.date)).toEqual(['2026-09-02', '2026-10-02', '2026-11-02']);
    expect(posted.every((e) => e.owner_id === JAE_ID && e.split_mode === 'treat')).toBe(true);
    // Never in a shared list or the balance; there in the full list.
    await waitFor(() => { expect(view.result.current.all.data?.filter((e) => e.recurring_id === id)).toHaveLength(3); });
    expect(view.result.current.shared.data?.map((e) => e.id)).toEqual([lamp.id]);
    expect(view.result.current.recurring.data).toEqual([]);
    expect(view.result.current.allRecurring.data?.map((t) => t.id)).toEqual([id]);
    expect(c.layer.balance()).toEqual(before);
    view.unmount();
  });

  it('REC-9: a payment of your own has a fixed amount; you can’t make one someone else’s', async () => {
    const c = household();
    await c.layer.ready;
    expect(() => data.saveRecurring({ ...gymDraft({ amountVaries: true }), ownerId: JAE_ID }, c.layer)).toThrow(EntryInvalidError);
    expect(() => data.saveRecurring({ ...gymDraft(), ownerId: SAM_ID }, c.layer)).toThrow(EntryInvalidError);
    try {
      data.saveRecurring({ ...gymDraft(), ownerId: SAM_ID }, c.layer);
    } catch (err) {
      expect((err as EntryInvalidError).reasons).toContain('notTheirs');
    }
    expect(c.layer.waiting()).toHaveLength(0);
  });

  it('REC-9 OFF-2: offline, it is saved on the phone at once (yours, in the full list only) and reaches the server later', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    let id = '';
    act(() => { id = data.saveRecurring({ ...gymDraft({ startDate: '2026-12-02' }), ownerId: JAE_ID }, c.layer); });
    await waitFor(() => { expect(view.result.current.allRecurring.data?.find((t) => t.id === id)?.owner_id).toBe(JAE_ID); });
    expect(view.result.current.recurring.data).toEqual([]);
    expect(view.result.current.sync.waiting).toBe(1);
    expect(c.controls.tables.recurring).toHaveLength(0);
    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    expect(c.controls.tables.recurring[0]).toMatchObject({ id, owner_id: JAE_ID });
    view.unmount();
  });
});

describe('REC-9: both of you see them; only the owner changes them', () => {
  it('REC-9: Sam sees Jae’s own payment and entries (read-only): every change is refused on the phone, nothing queued', async () => {
    const c = household({ as: 'sam', recurring: [storedGym()], expenses: [gymEntry('2026-11-02')] });
    await c.layer.ready;
    await settle(c.layer);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.allRecurring.data).toHaveLength(1); });
    expect(view.result.current.all.data?.map((e) => e.description)).toEqual(['Gym']);
    for (const change of [
      () => data.saveRecurring({ ...gymDraft({ amount: pence(100) }), id: GYM }, c.layer),
      () => data.pauseRecurring(GYM, c.layer),
      () => data.endRecurring(GYM, undefined, c.layer),
      () => { data.editExpense(gymEntry('2026-11-02').id, { description: 'Mine now' }, c.layer); },
      () => data.deleteExpense(gymEntry('2026-11-02').id, c.layer),
    ]) {
      expect(change).toThrow(EntryInvalidError);
    }
    expect(c.layer.waiting()).toHaveLength(0);
    view.unmount();
  });

  it('REC-9: and the "server" refuses Sam’s write of it, as row-level security does', async () => {
    const c = household({ as: 'sam', recurring: [storedGym()], expenses: [gymEntry('2026-11-02')] });
    await c.layer.ready;
    const row = c.controls.tables.recurring[0];
    if (!row) throw new Error('no row');
    await expect(c.layer.api.upsertRecurring({ ...row, description: 'Taken' })).rejects.toMatchObject({ kind: 'refused' });
    await expect(c.layer.api.patchExpense(gymEntry('2026-11-02').id, { deleted_at: '2026-11-14T10:00:00.000Z' })).rejects.toMatchObject({ kind: 'refused' });
    expect(c.controls.tables.recurring[0]?.description).toBe('Gym');
    expect(c.controls.tables.expenses[0]?.deleted_at).toBeNull();
  });

  it('REC-10: Jae edits her own entry; it stays all hers, in no chapter, whatever the form sends', async () => {
    const c = household({ recurring: [storedGym()], expenses: [gymEntry('2026-11-02')] });
    await c.layer.ready;
    await settle(c.layer);
    act(() => { data.editExpense(gymEntry('2026-11-02').id, { amount: pence(3900), payer: SAM_ID, split: even, chapterId: null }, c.layer); });
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]).toMatchObject({ amount_pence: 3900, owner_id: JAE_ID, split_mode: 'treat', paid: { [JAE_ID]: 3900 }, chapter_id: null });
    expect((c.controls.tables.expenses[0]?.shares as Record<string, number>)[JAE_ID]).toBe(3900);
    expect(c.layer.problems.list()).toHaveLength(0);
  });
});

describe('REC-11: whose it is changes from the next payment on', () => {
  it('REC-11: shared → mine: what is already due posts shared first; the next is mine; past entries stay as they were', async () => {
    // Shared rent, posted to 1 Oct (so 1 Nov is due and not yet posted).
    const rent = storedRecurring({ posted_count: 10 });
    const c = household({ recurring: [rent] });
    await c.layer.ready;
    await settle(c.layer);
    act(() => {
      data.saveRecurring({
        description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even, frequency: 'monthly', every: 1,
        startDate: '2026-01-01', endDate: null, amountVaries: false, isSubscription: false, id: rent.id, ownerId: JAE_ID,
      }, c.layer);
    });
    await settle(c.layer);
    const t = c.controls.tables.recurring[0];
    expect(t).toMatchObject({ owner_id: JAE_ID, posted_count: 11, split_mode: 'treat' });
    expect(c.controls.tables.expenses.map((e) => [e.date, e.owner_id])).toEqual([['2026-11-01', null]]);
    // History: "Jae made it Jae's own".
    expect(c.controls.tables.activity.some((a) => a.entity_id === rent.id && a.action === 'edited'
      && (a.summary as Record<string, { before: unknown; after: unknown }>)['owner_id']?.after === JAE_ID)).toBe(true);
    // Back to shared (only the owner can): from the next payment on.
    act(() => {
      data.saveRecurring({
        description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even, frequency: 'monthly', every: 1,
        startDate: '2026-01-01', endDate: null, amountVaries: false, isSubscription: false, id: rent.id, ownerId: null,
      }, c.layer);
    });
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ owner_id: null, split_mode: 'ratio' });
    expect(c.layer.problems.list()).toHaveLength(0);
  });

  it('REC-11: Sam can’t make Jae’s own shared again (or his)', async () => {
    const c = household({ as: 'sam', recurring: [storedGym()] });
    await c.layer.ready;
    expect(() => data.saveRecurring({ ...gymDraft(), id: GYM, ownerId: null }, c.layer)).toThrow(EntryInvalidError);
    expect(() => data.saveRecurring({ ...gymDraft(), id: GYM, ownerId: SAM_ID }, c.layer)).toThrow(EntryInvalidError);
  });
});

describe('REC-9 EXP-1: backup, restore and export keep whose each row is', () => {
  it('REC-9: the backup carries owner_id; the CSV says whose', async () => {
    const c = household({ recurring: [storedGym()], expenses: [gymEntry('2026-11-02'), storedExpense()] });
    await c.layer.ready;
    await settle(c.layer);
    const backup = JSON.parse(backupJson({ appVersion: 'test' }, c.layer)) as { recurring: { owner_id: string | null }[]; expenses: { owner_id: string | null; description: string }[] };
    expect(backup.recurring.map((r) => r.owner_id)).toEqual([JAE_ID]);
    expect(backup.expenses.map((e) => [e.description, e.owner_id]).sort()).toEqual([['Gym', JAE_ID], ['Lamp', null]]);
    const csv = data.exportEntriesCsv({ from: '2026-11-01', to: TODAY }, c.layer);
    expect(csv).toContain('Whose');
    expect(csv).toMatch(/Gym.*Jae's own/u);
    expect(csv).toMatch(/Lamp.*Shared/u);
  });
});
