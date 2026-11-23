/**
 * S9a fresh review, the data layer (docs/DECISIONS.md, 23 Nov, "S9a review"). The in-memory Api does what the
 * database does (supabase/migrations/20261123000000_money_back_links.sql; tests/sql/s9a_review_test.sql):
 *   2. Money back for an original that was deleted is refused (a refund queued offline while the partner deleted the
 *      original is kept on the phone with the line "The original was deleted, so this can't be money back for it.");
 *      restoring the original brings back its own refunds, not checked against the limit again.
 *   3. The "still to come back" refusal is a money-back refusal with its own line.
 *   4. An original is never edited below the live money back linked to it.
 *   6. A row deleted again keeps the moment it was first deleted.
 *   7. Keys learned before apostrophes were folded still match (import rules and category memory).
 *   8. Money back is only for the household's own expense.
 *  10. Undo of "Usually £90.00": the entry is deleted and the bill waits again; keeping it again brings that entry back.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedRecurring } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { pence } from '../core/money';
import type { ExpenseRow, ExpenseWrite, ImportRuleRow } from './api';
import { EXPENSE_WRITE_COLUMNS } from './api';
import { importQueue, keepImport, startImport, type BankRow } from './imports';
import type { MemoryTables } from './memoryApi';
import { addExpense, keepInboxItem, learned, rememberChoice, restoreExpense, unkeepInboxItem } from './mutations';
import { moneyBackLine, problemFrom, refusalReason } from './problems';
import type { DataLayer } from './queryClient';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); idbData.clear(); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
async function household(opts: Parameters<typeof couple>[0] & { rules?: ImportRuleRow[] } = {}) {
  const { rules = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = c.controls.tables as MemoryTables & { importRules?: ImportRuleRow[] };
  t.importRules ??= [];
  t.importRules.push(...rules);
  await c.layer.ready;
  await settle(c.layer);
  return { ...c, t };
}
const write = (row: ExpenseRow): ExpenseWrite => Object.fromEntries(EXPENSE_WRITE_COLUMNS.map((k) => [k, row[k]])) as ExpenseWrite;
const id = (n: number) => `00000000-0000-4000-8000-0000000a9${n.toString().padStart(3, '0')}`;

/** A £50.00 kettle Jae paid, 50/50, and money back linked to it. */
const KETTLE = storedExpense({ id: id(1), description: 'Kettle', amount_pence: 5000, paid: { [JAE_ID]: 5000 }, shares: { [JAE_ID]: 2500, [SAM_ID]: 2500 } });
function back(n: number, amount: number, over: Partial<ExpenseRow> = {}): ExpenseRow {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: id(n), kind: 'money_back', description: `Kettle back ${String(n)}`, amount_pence: amount, paid: { [JAE_ID]: amount },
    shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, refund_of: KETTLE.id, ...over,
  });
}
const row = (c: { controls: { tables: MemoryTables } }, rowId: string) => c.controls.tables.expenses.find((e) => e.id === rowId);

describe('money back for a deleted original (MB-3, review finding 2)', () => {
  it('MB-3: Sam’s refund queued offline arrives after Jae deleted the kettle: refused, kept with its own line, and the kettle can still be restored', async () => {
    const c = await household({ as: 'sam', expenses: [KETTLE, back(2, 5000)] });
    // Offline on Sam's phone: £50.00 back for the kettle, queued.
    c.network.set(false);
    c.controls.online = false;
    const queued = addExpense({
      kind: 'money_back', description: 'Kettle back again', amount: pence(5000), date: '2026-11-14', categoryId: KETTLE.category_id,
      payer: SAM_ID, split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } }, refundOf: KETTLE.id,
    }, c.layer);
    // Meanwhile Jae deletes the kettle, and the database takes its live refund with it (the same moment).
    const gone = '2026-11-14T08:00:00.000Z';
    c.controls.tables.expenses = c.controls.tables.expenses.map((e) => (e.id === KETTLE.id || e.id === id(2) ? { ...e, deleted_at: gone } : e));
    c.controls.online = true;
    c.network.set(true);
    await settle(c.layer);
    expect(row(c, queued)).toBeUndefined();
    const [problem] = c.layer.problems.list();
    expect(problem).toMatchObject({ rowId: queued, reason: 'money-back', message: 'The original was deleted, so this can’t be money back for it.' });
    // Restoring the kettle brings back what was deleted with it (before the fix, the refund that slipped in made
    // this restore impossible: the refund's own restore was over the limit).
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: null });
    expect(row(c, KETTLE.id)?.deleted_at).toBeNull();
    expect(row(c, id(2))?.deleted_at).toBeNull();
  });

  it('MB-3: the database refuses money back for a deleted original, and a refund restored on its own; the original restores with its own', async () => {
    const c = await household({ expenses: [KETTLE, back(2, 5000)] });
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: '2026-11-14T08:00:00.000Z' });
    expect(row(c, id(2))?.deleted_at).toBe('2026-11-14T08:00:00.000Z');
    await expect(c.layer.api.upsertExpense(write(back(3, 5000)))).rejects.toThrow(/the original was deleted/);
    await expect(c.layer.api.patchExpense(id(2), { deleted_at: null })).rejects.toThrow(/the original was deleted/);
    expect(row(c, id(3))).toBeUndefined();
    // A refund from before the rule still counted against the kettle (live): restoring is not checked against the limit.
    c.controls.tables.expenses.push(back(4, 5000));
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: null });
    expect(row(c, id(2))?.deleted_at).toBeNull();
  });

  it('MB-3: on the phone, money back is never saved for a deleted original, nor restored on its own', async () => {
    const gone = '2026-11-14T08:00:00.000Z';
    const c = await household({ expenses: [{ ...KETTLE, deleted_at: gone }, back(2, 5000, { deleted_at: gone })] });
    expect(() => addExpense({
      kind: 'money_back', description: 'Kettle back', amount: pence(1000), date: '2026-11-14', categoryId: null, payer: JAE_ID,
      split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } }, refundOf: KETTLE.id,
    }, c.layer)).toThrow(expect.objectContaining({ reasons: ['originalDeleted'] }) as Error);
    expect(() => restoreExpense(id(2), c.layer)).toThrow(expect.objectContaining({ reasons: ['originalDeleted'] }) as Error);
    expect(restoreExpense(KETTLE.id, c.layer)).toBe(true);
    await settle(c.layer);
    expect(row(c, id(2))?.deleted_at).toBeNull();
  });
});

describe('the money-back refusals have their own lines (MB-2, review findings 2–4)', () => {
  it('MB-2: "still to come back", a deleted original and an original edited too low are money-back refusals, each with its line', () => {
    expect(refusalReason('that\'s more than the £30.00 still to come back', '23514')).toBe('money-back');
    expect(refusalReason('the original was deleted, so this can\'t be money back for it', '23514')).toBe('money-back');
    expect(refusalReason('money back on this is £50.00, more than the new amount', '23514')).toBe('money-back');
    expect(refusalReason('money back can only be for an expense of yours', '23514')).toBe('money-back');
    expect(moneyBackLine('that\'s more than the £1500.00 still to come back')).toBe('That’s more than the £1,500.00 still to come back.');
    expect(moneyBackLine('that\'s more than the £0.00 still to come back')).toBe('That’s more than the £0.00 still to come back.');
    expect(moneyBackLine('money back on this is £50.00, more than the new amount')).toBe('Money back on this is £50.00, more than the new amount.');
    expect(moneyBackLine('the original was deleted, so this can\'t be money back for it')).toBe('The original was deleted, so this can’t be money back for it.');
    expect(moneyBackLine('money back can only be for an expense of yours')).toMatch(/money back for/);
    expect(moneyBackLine('shares (1) must sum to amount (2)')).toBeNull();
    // The other reasons are as they were.
    expect(refusalReason('shares (1) must sum to amount (2)', 'P0001')).toBe('money');
  });

  it('MB-2: the problem kept for a refused refund says the line with the figure', () => {
    const op = {
      opId: 'op-1', by: JAE_ID, table: 'expenses', op: 'upsert', isNew: true, row: back(2, 3500), input: null,
    } as unknown as Parameters<typeof problemFrom>[0];
    const p = problemFrom(op, 'that\'s more than the £30.00 still to come back', '23514', new Date('2026-11-14T10:00:00Z'));
    expect(p).toMatchObject({ reason: 'money-back', message: 'That’s more than the £30.00 still to come back.' });
  });
});

describe('the in-memory Api does what the database does (review findings 3, 4, 6, 8)', () => {
  it('MB-2: an upsert of an old refund already past the limit, renamed, is never refused; raising one past it is', async () => {
    const c = await household({ expenses: [KETTLE, back(2, 6000)] });
    await expect(c.layer.api.upsertExpense(write({ ...back(2, 6000), description: 'Renamed' }))).resolves.toMatchObject({ description: 'Renamed' });
    const c2 = await household({ expenses: [KETTLE, back(2, 1000)] });
    await expect(c2.layer.api.upsertExpense(write(back(2, 5001)))).rejects.toThrow(/still to come back/);
  });

  it('MB-2: an original edited below its live money back is refused, naming what came back; down to it is fine', async () => {
    const c = await household({ expenses: [KETTLE, back(2, 3000), back(3, 1000, { deleted_at: '2026-11-12T10:00:00.000Z' })] });
    const lower = (amount: number) => write({ ...KETTLE, amount_pence: amount, paid: { [JAE_ID]: amount }, shares: { [JAE_ID]: amount - Math.floor(amount / 2), [SAM_ID]: Math.floor(amount / 2) } });
    await expect(c.layer.api.upsertExpense(lower(2999))).rejects.toThrow('money back on this is £30.00, more than the new amount');
    expect(row(c, KETTLE.id)?.amount_pence).toBe(5000);
    await expect(c.layer.api.upsertExpense(lower(3000))).resolves.toMatchObject({ amount_pence: 3000 });
  });

  it('ACT-3: a row deleted again keeps its first moment, so restoring the original still brings its refunds back', async () => {
    const c = await household({ expenses: [KETTLE, back(2, 1000)] });
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: '2026-11-13T10:00:00.000Z' });
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: '2026-11-14T10:00:00.000Z' });
    expect(row(c, KETTLE.id)?.deleted_at).toBe('2026-11-13T10:00:00.000Z');
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: null });
    expect(row(c, id(2))?.deleted_at).toBeNull();
  });

  it('MB-2: money back only for the household’s own expense (not another household’s, not money back)', async () => {
    const c = await household({ expenses: [KETTLE, back(2, 1000)] });
    const theirs = storedExpense({ id: id(9), household_id: '00000000-0000-4000-8000-0000000000c9', description: 'Theirs' });
    c.controls.tables.expenses.push(theirs);
    await expect(c.layer.api.upsertExpense(write(back(3, 100, { refund_of: theirs.id })))).rejects.toThrow(/only be for an expense of yours/);
    await expect(c.layer.api.upsertExpense(write(back(4, 100, { refund_of: id(2) })))).rejects.toThrow(/only be for an expense of yours/);
    // Deleting an original follows only its own household's rows.
    c.controls.tables.expenses.push(back(5, 100, { household_id: theirs.household_id }));
    await c.layer.api.patchExpense(KETTLE.id, { deleted_at: '2026-11-14T10:00:00.000Z' });
    expect(row(c, id(5))?.deleted_at).toBeNull();
    expect(row(c, id(2))?.deleted_at).toBe('2026-11-14T10:00:00.000Z');
  });
});

describe('keys learned before apostrophes were folded (TXT-3, CAT-4, review finding 7)', () => {
  const bankRow: BankRow = { bankId: 'tx_0000S9AREVIEW0001', date: '2026-11-02', description: 'Sainsbury’s', amount: pence(2400), categoryHint: null, note: null };
  const oldRule = (over: Partial<ImportRuleRow> = {}): ImportRuleRow => ({
    id: '00000000-0000-4000-8000-0000000a9r01', household_id: HID, match_text: 'sainsbury’s', decision: 'keep', category_id: categoryId('Groceries'),
    split_mode: null, split_params: null, created_at: '2026-10-01T12:00:00.000Z', ...over,
  });

  it('IMP-3 TXT-3: an "always keep" rule saved as "sainsbury’s" still applies to "Sainsbury’s"', async () => {
    const c = await household({ rules: [oldRule()] });
    const counts = await startImport([bankRow], 'monzo', c.layer);
    expect(counts.rules.keep).toBe(1);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.external_id === bankRow.bankId)).toMatchObject({ category_id: categoryId('Groceries') });
  });

  it('IMP-3 TXT-3: "Always do this" on the same words changes that rule (its id and stored words), not a second one', async () => {
    const c = await household();
    await startImport([bankRow], 'monzo', c.layer);
    // The partner's phone made the rule meanwhile, under the old key (read here once the rules are fetched again).
    c.t.importRules?.push(oldRule({ category_id: categoryId('Household') }));
    await c.layer.client.refetchQueries({ type: 'all' });
    await settle(c.layer);
    const card = (await importQueue(c.layer)).find((x) => x.description === 'Sainsbury’s');
    if (!card) throw new Error('no card');
    await keepImport(card.id, { always: true, categoryId: categoryId('Groceries') }, c.layer);
    await settle(c.layer);
    expect(c.layer.problems.list()).toHaveLength(0);
    expect(c.t.importRules).toMatchObject([{ id: oldRule().id, match_text: 'sainsbury’s', decision: 'keep', category_id: categoryId('Groceries') }]);
  });

  it('CAT-4 TXT-3: a split learned as "sainsbury’s" is kept when a category is taught for "Sainsbury\'s"', async () => {
    const c = await household({
      categoryMemory: [{
        household_id: HID, key: 'sainsbury’s', category_id: categoryId('Groceries'), split_mode: 'ratio', split_params: { [JAE_ID]: 70, [SAM_ID]: 30 },
        uses: 3, source: 'user', updated_at: '2026-10-01T12:00:00.000Z',
      }],
    });
    rememberChoice('Sainsbury\'s', { categoryId: categoryId('Household') }, c.layer);
    await settle(c.layer);
    const taught = c.controls.tables.categoryMemory.find((m) => m.key === 'sainsburys');
    expect(taught).toMatchObject({ category_id: categoryId('Household'), split_mode: 'ratio', split_params: { [JAE_ID]: 70, [SAM_ID]: 30 }, uses: 4 });
  });

  it('CAT-4: of two keys that now meet, the one taught last is read', () => {
    const rows = [
      { key: 'sainsbury’s', updated_at: '2026-10-01T12:00:00.000Z', n: 1 },
      { key: 'sainsburys', updated_at: '2026-11-01T12:00:00.000Z', n: 2 },
      { key: 'sainsbury\'s', updated_at: '2026-09-01T12:00:00.000Z', n: 3 },
      { key: 'tesco', updated_at: '2026-12-01T12:00:00.000Z', n: 4 },
    ];
    expect(learned(rows, 'sainsburys')?.n).toBe(2);
    expect(learned(rows, 'aldi')).toBeUndefined();
  });
});

describe('Undo of "Usually £90.00" (INB-2, REC-3, review finding 10)', () => {
  const energy = storedRecurring({
    id: '00000000-0000-4000-8000-00000000d0e1', description: 'Energy', amount_pence: 9000, amount_varies: true, category_id: categoryId('Utilities'),
    paid: { [SAM_ID]: 9000 }, shares: { [JAE_ID]: 4500, [SAM_ID]: 4500 }, start_date: '2026-09-03', posted_count: 3,
  });
  const draft = {
    kind: 'expense' as const, description: 'Energy', amount: pence(9000), date: '2026-11-03', categoryId: categoryId('Utilities'), payer: SAM_ID,
    split: { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } },
  };

  it('INB-2: the entry is deleted (soft, logged) and the bill waits again; keeping it again brings that entry back, once', async () => {
    const c = await household({ recurring: [energy], inboxItems: [storedInboxItem()] });
    const item = storedInboxItem().id;
    const kept = keepInboxItem(item, draft, c.layer);
    await settle(c.layer);
    expect(unkeepInboxItem(item, c.layer)).toBe(true);
    await settle(c.layer);
    expect(row(c, kept)?.deleted_at).not.toBeNull();
    expect(c.controls.tables.inboxItems.find((i) => i.id === item)?.status).toBe('open');
    expect(c.layer.balance()[JAE_ID] ?? 0).toBe(0);
    expect(c.controls.tables.activity.some((a) => a.entity_id === kept && a.action === 'deleted')).toBe(true);
    // A second Undo changes nothing.
    expect(unkeepInboxItem(item, c.layer)).toBe(false);
    // Kept again at another amount: the same entry, back and changed (one entry per bill), and the card is kept.
    const again = keepInboxItem(item, { ...draft, amount: pence(9500) }, c.layer);
    await settle(c.layer);
    expect(again).toBe(kept);
    expect(c.layer.problems.list()).toHaveLength(0);
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === energy.id)).toMatchObject([{ id: kept, amount_pence: 9500, deleted_at: null }]);
    expect(c.controls.tables.inboxItems.find((i) => i.id === item)).toMatchObject({ status: 'kept', expense_id: kept });
  });
});
