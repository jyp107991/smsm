/**
 * S10 fresh review (data layer). Written before the fix.
 *   Finding 1: the in-memory Api does what migration 20261125000100 does (tests/sql/whose_slots_test.sql): a phone never
 *     adds an own entry (only an own regular payment's posting makes one); an entry takes a regular payment's day only
 *     from that day's bill in the Inbox, as a shared entry; a phone never names a regular payment's day on an Inbox item.
 *     The Inbox's Keep still works.
 *   Finding 8: two phones of the same person: a queued edit of a regular payment, built while it was shared (or theirs),
 *     is refused when it reaches the server if whose it is changed meanwhile on the other phone, never written over it.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedRecurring, TODAY } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import { ApiError, type RecurringRow } from './api';
import * as data from './index';
import type { DataLayer } from './queryClient';
import { expenseWrite } from './writes';

const open: DataLayer[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});
function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
async function refused(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).kind).toBe('refused');
  return err as ApiError;
}

const RENT = storedRecurring();
const own = (owner: string, amount: number): Partial<RecurringRow> => ({ paid: { [owner]: amount }, shares: { [owner]: amount }, split_mode: 'treat', split_params: null, owner_id: owner });
const GYM = storedRecurring({ id: '00000000-0000-4000-8000-00000000d0a1', description: 'Gym', amount_pence: 3500, start_date: '2026-09-02', posted_count: 3, ...own(JAE_ID, 3500) });
const AUDIBLE = storedRecurring({ id: '00000000-0000-4000-8000-00000000d0a2', description: 'Audible', amount_pence: 899, start_date: '2026-11-05', posted_count: 1, ...own(SAM_ID, 899) });
const GYM_NOV = storedExpense({
  id: '00000000-0000-4000-8000-00000000e0a1', description: 'Gym', amount_pence: 3500, date: '2026-11-02', paid: { [JAE_ID]: 3500 }, shares: { [JAE_ID]: 3500 },
  split_mode: 'treat', split_params: null, source: 'recurring', recurring_id: GYM.id, occurrence_date: '2026-11-02', owner_id: JAE_ID,
});
const ENERGY = storedRecurring({ id: '00000000-0000-4000-8000-00000000d0e1', description: 'Energy', amount_pence: 9000, amount_varies: true, start_date: '2026-11-03', posted_count: 1 });
const BILL = storedInboxItem();
const entry = (over: Parameters<typeof storedExpense>[0]) => expenseWrite(storedExpense({ id: '00000000-0000-4000-8000-00000000e0f1', ...over }));

describe('S10 review 1: a regular payment’s day is taken only by its posting or its Inbox bill (the in-memory Api, as the database)', () => {
  it('REC-10: a phone never adds an own entry of its own (typed, or on any day)', async () => {
    const c = household({ recurring: [RENT, GYM] });
    await c.layer.ready;
    await refused(c.layer.api.upsertExpense(entry({ description: 'Own coffee', amount_pence: 350, paid: { [JAE_ID]: 350 }, shares: { [JAE_ID]: 350 }, split_mode: 'treat', split_params: null, owner_id: JAE_ID })));
    expect(c.controls.tables.expenses.some((e) => e.description === 'Own coffee')).toBe(false);
  });

  it('REC-12: Jae can’t take the shared rent’s next day with 1p of her own, nor with a shared 1p; the rent still posts', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    const day = '2026-12-01';
    await refused(c.layer.api.upsertExpense(entry({ amount_pence: 1, paid: { [JAE_ID]: 1 }, shares: { [JAE_ID]: 1 }, split_mode: 'treat', split_params: null, owner_id: JAE_ID, source: 'recurring', recurring_id: RENT.id, occurrence_date: day })));
    await refused(c.layer.api.upsertExpense(entry({ amount_pence: 1, paid: { [JAE_ID]: 1 }, shares: { [JAE_ID]: 1 }, split_mode: 'treat', split_params: null, source: 'recurring', recurring_id: RENT.id, occurrence_date: day })));
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === RENT.id)).toHaveLength(0);
  });

  it('REC-11: Sam can’t take Jae’s own gym’s day, shared or as his own', async () => {
    const c = household({ as: 'sam', recurring: [GYM] });
    await c.layer.ready;
    const day = '2026-12-02';
    await refused(c.layer.api.upsertExpense(entry({ amount_pence: 2, paid: { [SAM_ID]: 2 }, shares: { [SAM_ID]: 2 }, split_mode: 'treat', split_params: null, source: 'recurring', recurring_id: GYM.id, occurrence_date: day })));
    await refused(c.layer.api.upsertExpense(entry({ amount_pence: 2, paid: { [SAM_ID]: 2 }, shares: { [SAM_ID]: 2 }, split_mode: 'treat', split_params: null, owner_id: SAM_ID, source: 'recurring', recurring_id: GYM.id, occurrence_date: day })));
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === GYM.id)).toHaveLength(0);
  });

  it('REC-12: never by an edit either (her own entry onto another day; a shared one onto Sam’s own day); her own edit still saves', async () => {
    const lamp = storedExpense();
    const c = household({ recurring: [GYM, AUDIBLE], expenses: [GYM_NOV, lamp] });
    await c.layer.ready;
    await refused(c.layer.api.upsertExpense(expenseWrite({ ...GYM_NOV, occurrence_date: '2026-12-02', date: '2026-12-02' })));
    await refused(c.layer.api.upsertExpense(expenseWrite({ ...lamp, source: 'recurring', recurring_id: AUDIBLE.id, occurrence_date: '2026-12-05' })));
    expect(c.controls.tables.expenses.find((e) => e.id === GYM_NOV.id)?.occurrence_date).toBe('2026-11-02');
    expect(c.controls.tables.expenses.find((e) => e.id === lamp.id)?.recurring_id).toBeNull();
    const saved = await c.layer.api.upsertExpense(expenseWrite({ ...GYM_NOV, description: 'Gym, lanes' }));
    expect(saved.description).toBe('Gym, lanes');
  });

  it('REC-12: a phone never names a regular payment’s day on an Inbox item (a receipt to sort still goes in)', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    const fake = { id: '00000000-0000-4000-8000-00000000b0f1', household_id: c.controls.tables.households[0]?.id ?? '', source: 'bill', status: 'open', payload: {}, receipt_path: null };
    await refused(c.layer.api.insertInboxItem({ ...fake, recurring_id: RENT.id, occurrence_date: '2026-12-01' } as Parameters<typeof c.layer.api.insertInboxItem>[0]));
    const scan = await c.layer.api.insertInboxItem({ ...fake, source: 'scan' });
    expect(scan.recurring_id).toBeNull();
  });

  it('INB-2: Keep still saves the bill as a shared entry; kept as someone’s own, it is refused', async () => {
    const c = household({ recurring: [ENERGY], inboxItems: [BILL] });
    await c.layer.ready;
    await settle(c.layer);
    await refused(c.layer.api.upsertExpense(entry({ amount_pence: 9120, paid: { [JAE_ID]: 9120 }, shares: { [JAE_ID]: 9120 }, split_mode: 'treat', split_params: null, owner_id: JAE_ID, source: 'recurring', recurring_id: ENERGY.id, occurrence_date: BILL.occurrence_date })));
    let id = '';
    act(() => {
      id = data.keepInboxItem(BILL.id, {
        description: 'Energy', amount: pence(9120), date: '2026-11-03', categoryId: categoryId('Utilities'), payer: JAE_ID,
        split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } },
      }, c.layer);
    });
    await settle(c.layer);
    expect(c.layer.problems.list()).toEqual([]);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ recurring_id: ENERGY.id, occurrence_date: '2026-11-03', owner_id: null, amount_pence: 9120 });
    expect(c.controls.tables.inboxItems[0]).toMatchObject({ status: 'kept', expense_id: id });
  });
});

describe('S10 review 8: a queued edit built against another owner is refused at replay, not written over it', () => {
  const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
  const rentDraft = { description: 'Rent', amount: pence(150000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even, frequency: 'monthly' as const, every: 1, startDate: '2026-01-01', endDate: null, amountVaries: false, isSubscription: false };

  it('REC-11: offline, Jae raises the shared rent; her other phone made it her own meanwhile: refused, her own stays as it is', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    data.saveRecurring({ ...rentDraft, id: RENT.id }, c.layer);
    const row = c.controls.tables.recurring[0];
    if (row) Object.assign(row, own(JAE_ID, 145000));
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ owner_id: JAE_ID, amount_pence: 145000, split_mode: 'treat', shares: { [JAE_ID]: 145000 } });
    expect(c.layer.problems.list().map((p) => p.reason)).toEqual(['whose-changed']);
  });

  it('REC-11: offline, Jae raises her own gym; her other phone made it shared meanwhile: refused, the shared one never becomes her treat', async () => {
    const c = household({ recurring: [GYM] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    data.saveRecurring({ ...rentDraft, description: 'Gym', amount: pence(3800), startDate: '2026-09-02', id: GYM.id, ownerId: JAE_ID }, c.layer);
    const row = c.controls.tables.recurring[0];
    if (row) Object.assign(row, { owner_id: null, split_mode: 'ratio', split_params: { [JAE_ID]: 50, [SAM_ID]: 50 }, paid: { [JAE_ID]: 3500 }, shares: { [JAE_ID]: 1750, [SAM_ID]: 1750 } });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ owner_id: null, amount_pence: 3500, split_mode: 'ratio' });
    expect(c.layer.problems.list().map((p) => p.reason)).toEqual(['whose-changed']);
  });

  it('REC-6: whose unchanged, the queued edit saves as before', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    data.saveRecurring({ ...rentDraft, id: RENT.id }, c.layer);
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.recurring[0]).toMatchObject({ owner_id: null, amount_pence: 150000 });
    expect(c.layer.problems.list()).toEqual([]);
    expect(TODAY).toBe('2026-11-14');
  });
});
