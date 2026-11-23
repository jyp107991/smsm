/**
 * S9a fresh review, on the real screens over the in-memory Api (docs/DECISIONS.md, 23 Nov, "S9a review"):
 *   1. Quick add in France: "12,50 café" is €12.50 (never £12.50); "1.200,50 hotel" opens the sheet and saves nothing.
 *   2. Money back whose original was deleted: refused on the phone (restore) and, when it arrives from a queue, the
 *      Home line says why ("The original was deleted, so this can't be money back for it.").
 *   4. An original edited below its money back: "Money back on this is £50.00, more than the new amount."
 *   9. Kept AI wording for a month with chapters: no "Plus £X in chapters" line beside it (it may count them already).
 *  10. "Usually £90.00" in the Inbox has Undo: the entry goes and the bill is back.
 *  11. Home and Insights' This month agree, with months that differ (a low last month, higher before).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, storedInboxItem, storedRecurring, type RecapRow,
} from '../../tests/fixtures/couple';
import { fakeAi } from '../../tests/fixtures/smart';
import { pence } from '../core/money';
import * as dataModule from '../data';
import { addExpense, DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = dataModule as unknown as { setSmartFeatures(on: boolean): void };

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(async () => { vi.restoreAllMocks(); await open?.dispose(); open = null; });

function at(path: string) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
}
function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
const sentences = (scope: HTMLElement, s: RegExp) => within(scope).queryAllByText((_, el) => (el ? s.test(text(el)) : false));
const findSentence = (scope: HTMLElement, s: RegExp) => waitFor(() => { expect(sentences(scope, s).length, String(s)).toBeGreaterThan(0); }, { timeout: 3000 });
const toasts = () => screen.getByRole('status', { name: 'Notifications', hidden: true });
const APOS = '[’\']';

const E = (n: number) => `00000000-0000-4000-8000-0000000ab${n.toString().padStart(3, '0')}`;
function spent(n: number, description: string, amount: number, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: E(n), description, amount_pence: amount, date, category_id: categoryId('Groceries'), paid: { [JAE_ID]: amount },
    shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, ...over,
  });
}
function backFor(n: number, original: ExpenseRow, amount: number, over: Partial<ExpenseRow> = {}): ExpenseRow {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: E(n), kind: 'money_back', description: `${original.description} refund`, amount_pence: amount, paid: { [JAE_ID]: amount },
    shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, refund_of: original.id, category_id: original.category_id, ...over,
  });
}
function rates(table: Record<string, number>) {
  return {
    rate: vi.fn((...args: [from: string, date?: string]) => {
      const rate = table[args[0]];
      return rate === undefined ? Promise.reject(new Error('404')) : Promise.resolve({ date: '2026-11-13', base: args[0], quote: 'GBP', rate });
    }),
  };
}
async function quickAdd(words: string) {
  const box = await screen.findByRole('textbox', { name: 'Quick add' });
  fireEvent.change(box, { target: { value: words } });
  return box;
}
function enter(box: HTMLElement) {
  const form = box.closest('form');
  if (!form) throw new Error('quick add is not a form');
  act(() => { form.requestSubmit(); });
}

// ─────────────────────────────── finding 1: quick add abroad ───────────────────────────────

describe('quick add in France reads euros (PLC-6, review finding 1)', () => {
  it('PLC-6 ADD-5: "12,50 café" reads "€12.50 · £10.63 · …" and saves £10.63 with the euros (never £12.50)', async () => {
    localStorage.setItem('smsm-current-country', 'FR');
    const c = couple({ rates: rates({ EUR: 0.85 }) });
    show(c.layer);
    const box = await quickAdd('12,50 café');
    await findSentence(await screen.findByRole('main'), /^€12\.50 · £10\.63 · /);
    enter(box);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description.toLowerCase() === 'café');
    expect(row).toMatchObject({ amount_pence: 1063, original_currency: 'EUR' });
    expect(String(row?.original_amount)).toBe('12.5');
    expect(c.controls.tables.expenses.some((e) => e.amount_pence === 1250)).toBe(false);
  });

  it('PLC-6: "1.200,50 hotel" is no amount in euros: Enter opens the sheet, and nothing is saved as pounds', async () => {
    localStorage.setItem('smsm-current-country', 'FR');
    const c = couple({ rates: rates({ EUR: 0.85 }) });
    show(c.layer);
    const box = await quickAdd('1.200,50 hotel');
    await new Promise((resolve) => setTimeout(resolve, 50));
    enter(box);
    await screen.findByRole('dialog', { name: 'Add expense' });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(0);
  });
});

// ─────────────────────────────── findings 2 and 4: money back and its original ───────────────────────────────

describe('money back and its original (MB-2, MB-3, review findings 2 and 4)', () => {
  const desk = spent(201, 'Desk', 10000, '2026-11-05', { category_id: categoryId('Household') });

  it('MB-2: an original edited below its money back: "Money back on this is £50.00, more than the new amount."', async () => {
    const c = couple({ expenses: [desk, backFor(202, desk, 5000)] });
    at(`/entry/${desk.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Desk' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '40' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await findSentence(sheet, /^Money back on this is £50\.00, more than the new amount\.$/);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === desk.id)?.amount_pence).toBe(10000);
    // Down to what came back is fine.
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '50' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === desk.id)?.amount_pence).toBe(5000);
  });

  it('MB-3: money back whose original was deleted can’t be restored on its own, and says why', async () => {
    const gone = '2026-11-12T10:00:00.000Z';
    const refund = backFor(203, desk, 2000, { deleted_at: gone });
    const c = couple({ expenses: [{ ...desk, deleted_at: gone }, refund] });
    at(`/entry/${refund.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Desk refund' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await findSentence(toasts(), new RegExp(`^The original was deleted, so this can${APOS}t be money back for it\\.$`));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === refund.id)?.deleted_at).toBe(gone);
  });

  it('MB-3 OFF-5: a refund queued offline for an original the partner deleted meanwhile: Home says it wasn’t saved, and why', async () => {
    const kettle = spent(204, 'Kettle', 5000, '2026-11-05', { category_id: categoryId('Household') });
    const c = couple({ as: 'sam', expenses: [kettle] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    c.network.set(false);
    c.controls.online = false;
    act(() => {
      addExpense({
        kind: 'money_back', description: 'Kettle back', amount: pence(5000), date: '2026-11-14', categoryId: kettle.category_id, payer: SAM_ID,
        split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } }, refundOf: kettle.id,
      }, c.layer);
    });
    c.controls.tables.expenses = c.controls.tables.expenses.map((e) => (e.id === kettle.id ? { ...e, deleted_at: '2026-11-14T08:00:00.000Z' } : e));
    c.controls.online = true;
    act(() => { c.network.set(true); });
    await settle(c.layer);
    await findSentence(await screen.findByRole('main'), new RegExp(`wasn${APOS}t saved\\. The original was deleted, so this can${APOS}t be money back for it\\.$`));
  });
});

// ─────────────────────────────── finding 9: the recap's kept wording ───────────────────────────────

describe('kept wording and the chapters line (INS-2, review finding 9)', () => {
  const trip = storedChapter({ id: '00000000-0000-4000-8000-00000000c9a1', name: 'Cornwall', country: 'GB', start_date: '2026-10-20', end_date: '2026-10-22' });
  const expenses = [
    spent(301, 'First shop', 1000, '2026-04-10'),
    ...['05', '06', '07', '08', '09'].map((m, i) => spent(310 + i, 'Big shop', 100000, `2026-${m}-10`)),
    spent(320, 'Big shop', 90000, '2026-10-10'),
    spent(321, 'Cottage', 30000, '2026-10-21', { chapter_id: trip.id }),
  ];
  // Kept before S9a: the whole month's total (chapters and all) with the everyday comparison.
  const kept: RecapRow = {
    household_id: HID, period: '2026-10', stats: { total: '£1,200.00' }, created_at: '2026-11-01T08:00:00.000Z',
    prose: JSON.stringify({ headline: 'October cost £1,200.00 together, about £100 less than usual.', aside: null }),
  };

  it('INS-2: kept wording is shown alone: no "Plus £300.00 in chapters" beside a total that may already count them', async () => {
    data.setSmartFeatures(true);
    const c = couple({ expenses, chapters: [trip], recaps: [kept], ai: fakeAi() });
    at('/recap/2026-10');
    show(c.layer);
    const region = await screen.findByRole('region', { name: 'Headline' });
    await findSentence(region, /^October cost £1,200\.00 together, about £100 less than usual\.$/);
    expect(sentences(region, /in chapters/)).toHaveLength(0);
  });

  it('INS-2: the template headline (everyday) keeps its chapters line', async () => {
    const c = couple({ expenses, chapters: [trip] });
    at('/recap/2026-10');
    show(c.layer);
    const region = await screen.findByRole('region', { name: 'Headline' });
    await findSentence(region, /^Everyday spending in October was £900\.00, about £100 less than usual\.$/);
    await findSentence(region, /^Plus £300\.00 in chapters \(trips and projects\)\.$/);
  });
});

// ─────────────────────────────── finding 10: Undo of "Usually" ───────────────────────────────

describe('"Usually £90.00" has Undo (INB-2, REC-3, review finding 10)', () => {
  const energy = storedRecurring({
    id: '00000000-0000-4000-8000-00000000d0e1', description: 'Energy', amount_pence: 9000, amount_varies: true, category_id: categoryId('Utilities'),
    paid: { [SAM_ID]: 9000 }, shares: { [JAE_ID]: 4500, [SAM_ID]: 4500 }, start_date: '2026-09-03', posted_count: 3,
  });

  it('INB-2: Undo on its toast deletes the entry and puts the bill back; it can be kept again', async () => {
    const c = couple({ recurring: [energy], inboxItems: [storedInboxItem()] });
    at('/inbox');
    show(c.layer);
    const main = await screen.findByRole('main');
    fireEvent.click(await screen.findByRole('button', { name: /^Usually £90\.00/ }));
    await settle(c.layer);
    const kept = c.controls.tables.expenses.find((e) => e.description === 'Energy');
    expect(kept?.deleted_at).toBeNull();
    fireEvent.click(await within(toasts()).findByRole('button', { name: 'Undo', hidden: true }));
    await settle(c.layer);
    await findSentence(main, /^Energy is due: how much was it\?$/);
    expect(c.controls.tables.expenses.find((e) => e.id === kept?.id)?.deleted_at).not.toBeNull();
    expect(c.controls.tables.inboxItems.find((i) => i.id === storedInboxItem().id)?.status).toBe('open');
    expect(c.layer.balance()[JAE_ID] ?? 0).toBe(0);
    fireEvent.click(await screen.findByRole('button', { name: /^Usually £90\.00/ }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.filter((e) => e.description === 'Energy')).toMatchObject([{ id: kept?.id, deleted_at: null, amount_pence: 9000 }]);
    expect(c.controls.tables.inboxItems.find((i) => i.id === storedInboxItem().id)?.status).toBe('kept');
    expect(c.layer.problems.list()).toHaveLength(0);
  });
});

// ─────────────────────────────── finding 11: one pace ───────────────────────────────

describe('Home and Insights use one pace (INS-1, review finding 11)', () => {
  it('INS-1: a low last month and higher months before: both say "about £120 under your usual pace" (not "£240 more than last month")', async () => {
    const c = couple({
      expenses: [
        spent(401, 'First shop', 1000, '2026-07-20'),
        spent(402, 'Big shop', 60000, '2026-08-05'), spent(403, 'Big shop', 60000, '2026-09-05'), spent(404, 'Small shop', 6000, '2026-10-05'),
        spent(405, 'Shop', 30000, '2026-11-05'),
      ],
    });
    show(c.layer);
    const home = await screen.findByRole('main');
    await findSentence(home, /^£300\.00 so far · about £120 under your usual pace$/);
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    await screen.findByRole('heading', { level: 1, name: 'Insights' });
    const insights = await screen.findByRole('main');
    await findSentence(insights, /^£300\.00 · about £120 under your usual pace$/);
    expect(sentences(insights, /last month/)).toHaveLength(0);
  });
});
