/**
 * S2 polish wave 1a (docs/slices/S2-polish.md), the data layer: Q-F1 (ADD-6, SET-1, MB-2) and Q-F4.
 * Written before the fix (ENGINEERING §5: tests first, by someone else), over the in-memory Api.
 *
 * Interface these tests expect (new):
 *
 *   addExpense(input: ExpenseDraft & { id?: string }, layer?): string
 *   addSettlement(input: SettlementDraft & { id?: string }, layer?): string
 *
 *   `id`: the row id, made once per form or action instance (crypto.randomUUID) by the screen and passed
 *   in, so a second submit of the same form is an idempotent upsert of the same row, never a second row.
 *   Without it a new id is made, as now. The function returns the row's id (the one given). The id is not
 *   part of the draft kept with the queued write (`input`).
 *
 *   deleteExpense / restoreExpense / deleteSettlement / restoreSettlement: a no-op (nothing queued, nothing
 *   logged) when the row is already in that state (Q-F4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { couple, HID, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import * as m from './mutations';
import type { DataLayer } from './queryClient';
import type { SettlementRow } from './api';

const open: DataLayer[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}

const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const draft = (amount: number, description = 'Tesco') => ({ description, amount: pence(amount), date: TODAY, categoryId: null, payer: JAE_ID, split: even });

const FORM_ID = '00000000-0000-4000-8000-0000000f0001';

describe('Q-F1 ADD-6: the same form saved twice records once', () => {
  it('Q-F1 ADD-6: addExpense with the form\'s id, twice: one row, the balance moves once', async () => {
    const { layer, controls } = household();
    await layer.ready;
    // The id is made once by the form and passed with every submit of that form.
    const input = { ...draft(4250), id: FORM_ID };
    const first = m.addExpense(input, layer);
    const second = m.addExpense(input, layer);
    expect(first).toBe(FORM_ID);
    expect(second).toBe(FORM_ID);
    expect(layer.entries().filter((e) => e.description === 'Tesco')).toHaveLength(1);
    expect(layer.balance()[JAE_ID]).toBe(2125);
    await layer.idle();
    expect(controls.tables.expenses.map((e) => e.id)).toEqual([FORM_ID]);
    expect(layer.balance()).toEqual({ [JAE_ID]: 2125, [SAM_ID]: -2125 });
  });

  it('Q-F1 ADD-6 OFF-7: offline, a double submit still syncs as one row', async () => {
    const { layer, controls, network } = household();
    await layer.ready;
    network.set(false);
    const input = { ...draft(1000, 'Bakery'), id: FORM_ID };
    m.addExpense(input, layer);
    m.addExpense(input, layer);
    expect(layer.entries().filter((e) => e.id === FORM_ID)).toHaveLength(1);
    network.set(true);
    await layer.idle();
    expect(controls.tables.expenses.filter((e) => e.description === 'Bakery')).toHaveLength(1);
    expect(layer.balance()[JAE_ID]).toBe(500);
  });

  it('Q-F1 MB-2: money back saved twice from one form is one refund', async () => {
    const lamp = storedExpense();
    const { layer, controls } = household({ expenses: [lamp] });
    await layer.ready;
    await layer.idle();
    const input = { ...draft(1000, 'Lamp refund'), kind: 'money_back' as const, refundOf: lamp.id, id: FORM_ID };
    m.addExpense(input, layer);
    m.addExpense(input, layer);
    await layer.idle();
    expect(controls.tables.expenses.filter((e) => e.kind === 'money_back')).toHaveLength(1);
    // £20.00 owed for the lamp, less £5.00 back once.
    expect(layer.balance()[JAE_ID]).toBe(1500);
  });

  it('Q-F1 SET-1: addSettlement with the sheet\'s id, twice: one settle-up', async () => {
    const { layer, controls } = household({ expenses: [storedExpense()] });
    await layer.ready;
    await layer.idle();
    const input = { from: SAM_ID, to: JAE_ID, amount: pence(1000), date: TODAY, id: FORM_ID };
    expect(m.addSettlement(input, layer)).toBe(FORM_ID);
    expect(m.addSettlement(input, layer)).toBe(FORM_ID);
    expect(layer.settlements()).toHaveLength(1);
    await layer.idle();
    expect(controls.tables.settlements.map((s: SettlementRow) => s.id)).toEqual([FORM_ID]);
    // £20.00 owed, £10.00 paid once.
    expect(layer.balance()).toEqual({ [JAE_ID]: 1000, [SAM_ID]: -1000 });
  });

  it('Q-F1: different forms still make different rows (an id is per form, not per description)', async () => {
    const { layer } = household();
    await layer.ready;
    const one = { ...draft(300, 'Milk'), id: '00000000-0000-4000-8000-0000000f00a1' };
    const other = { ...draft(300, 'Milk'), id: '00000000-0000-4000-8000-0000000f00a2' };
    const a = m.addExpense(one, layer);
    const b = m.addExpense(other, layer);
    expect(a).not.toBe(b);
    expect(layer.entries().filter((e) => e.description === 'Milk')).toHaveLength(2);
  });
});

describe('Q-F4 ACT-3: Delete and Restore do nothing when the row is already in that state', () => {
  const edits = (activity: readonly { entity_id: string | null; action: string }[], id: string) =>
    activity.filter((a) => a.entity_id === id).map((a) => a.action);

  it('Q-F4 ACT-3: deleting a deleted entry queues nothing and logs no "changed the details" line', async () => {
    const lamp = storedExpense();
    const { layer, controls, network } = household({ expenses: [lamp] });
    await layer.ready;
    await layer.idle();
    network.set(false);
    m.deleteExpense(lamp.id, layer);
    expect(layer.waiting()).toHaveLength(1);
    m.deleteExpense(lamp.id, layer);
    expect(layer.waiting()).toHaveLength(1);
    network.set(true);
    await layer.idle();
    expect(edits(controls.tables.activity, lamp.id)).toEqual(['deleted']);
  });

  it('Q-F4 ACT-3: restoring a live entry queues nothing; restoring twice logs one "restored"', async () => {
    const lamp = storedExpense();
    const { layer, controls, network } = household({ expenses: [lamp] });
    await layer.ready;
    await layer.idle();
    network.set(false);
    m.restoreExpense(lamp.id, layer);
    expect(layer.waiting()).toHaveLength(0);
    m.deleteExpense(lamp.id, layer);
    m.restoreExpense(lamp.id, layer);
    m.restoreExpense(lamp.id, layer);
    expect(layer.waiting()).toHaveLength(2);
    network.set(true);
    await layer.idle();
    expect(edits(controls.tables.activity, lamp.id)).toEqual(['deleted', 'restored']);
    expect(controls.tables.expenses.find((e) => e.id === lamp.id)?.deleted_at).toBeNull();
  });

  it('Q-F4 SET-3: the same for settle-ups', async () => {
    const settled: SettlementRow = {
      id: '00000000-0000-4000-8000-00000000a5e1', household_id: HID, from_user: SAM_ID, to_user: JAE_ID, amount_pence: 1000, date: TODAY,
      note: null, method: 'other', created_by: SAM_ID, created_at: '2026-11-13T12:00:00.000Z', updated_at: '2026-11-13T12:00:00.000Z', deleted_at: null,
    };
    const { layer, controls, network } = household({ expenses: [storedExpense()] });
    controls.tables.settlements.push(settled);
    await layer.ready;
    await layer.refresh();
    await layer.idle();
    expect(layer.settlements().map((s) => s.id)).toEqual([settled.id]);
    network.set(false);
    m.restoreSettlement(settled.id, layer);
    expect(layer.waiting()).toHaveLength(0);
    m.deleteSettlement(settled.id, layer);
    m.deleteSettlement(settled.id, layer);
    expect(layer.waiting()).toHaveLength(1);
    network.set(true);
    await layer.idle();
    expect(edits(controls.tables.activity, settled.id)).toEqual(['deleted']);
  });
});

describe('Q-F4 review: Delete and Restore say whether they changed anything (so a no-op shows no toast)', () => {
  it('Q-F4 ACT-3: true when the row changed, false when it was already so', async () => {
    const lamp = storedExpense();
    const { layer } = household({ expenses: [lamp] });
    await layer.ready;
    await layer.idle();
    expect(m.restoreExpense(lamp.id, layer)).toBe(false);
    expect(m.deleteExpense(lamp.id, layer)).toBe(true);
    expect(m.deleteExpense(lamp.id, layer)).toBe(false);
    expect(m.restoreExpense(lamp.id, layer)).toBe(true);
  });

  it('Q-F4 SET-3: the same for settle-ups', async () => {
    const { layer } = household({ expenses: [storedExpense()] });
    await layer.ready;
    await layer.idle();
    const id = m.addSettlement({ from: SAM_ID, to: JAE_ID, amount: pence(500), date: TODAY }, layer);
    expect(m.restoreSettlement(id, layer)).toBe(false);
    expect(m.deleteSettlement(id, layer)).toBe(true);
    expect(m.deleteSettlement(id, layer)).toBe(false);
    expect(m.restoreSettlement(id, layer)).toBe(true);
  });
});
