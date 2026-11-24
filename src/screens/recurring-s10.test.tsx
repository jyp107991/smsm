/**
 * S10 screens (the owner's two asks for regular payments; DECISIONS 24 Nov). On Sat 14 Nov 2026 (TODAY):
 *   1. Delete, on a paused or ended regular payment only (a running one says to pause or end it first). It leaves
 *      Bills everywhere; the toast says "Deleted Old gym" with Undo, which brings it back. What it posted stays: in
 *      Activity, in the balance, and on the calendar as plain text (its regular payment is gone, so no link).
 *   2. Starts can change after one has posted (How often stays fixed). Under Starts the core's line says what
 *      happens: "From now on it posts on the 15th. Next: Sun 15 Nov. Past payments stay as they are." There is no
 *      past-start choice for it; Save posts nothing.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring, TODAY, type RecurringRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(async () => { await open?.dispose(); open = null; });

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

const R = (n: number) => `00000000-0000-4000-8000-00000000d${n.toString().padStart(3, '0')}`;
function byJae(amount: number): Partial<RecurringRow> {
  return { paid: { [JAE_ID]: amount, [SAM_ID]: 0 }, shares: { [JAE_ID]: amount - Math.floor(amount / 2), [SAM_ID]: Math.floor(amount / 2) } };
}
const RENT = storedRecurring({ id: R(1), ...byJae(145000) });
const GYM = storedRecurring({ id: R(7), description: 'Old gym', amount_pence: 3000, ...byJae(3000), category_id: categoryId('Health'), start_date: '2026-01-10', posted_count: 10, active: false });
const MAGAZINE = storedRecurring({ id: R(8), description: 'Magazine', amount_pence: 450, ...byJae(450), category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-01-15', end_date: '2026-10-31', posted_count: 10 });
// Weekly every 2 from Sat 7 Nov, posted 7 Nov; next Sat 21 Nov.
const CLEANER = storedRecurring({ id: R(6), description: 'Window cleaner', amount_pence: 1200, ...byJae(1200), category_id: categoryId('Household'), frequency: 'weekly', every: 2, start_date: '2026-11-07', posted_count: 1 });
// Weekly, ended yesterday; posted Fri 6 Nov.
const DOG = storedRecurring({ id: R(9), description: 'Dog walker', amount_pence: 2000, ...byJae(2000), category_id: categoryId('Household'), frequency: 'weekly', start_date: '2026-11-06', end_date: '2026-11-13', posted_count: 2 });

function posted(id: string, t: RecurringRow, date: string): ExpenseRow {
  return storedExpense({
    id, description: t.description, amount_pence: t.amount_pence, date, category_id: t.category_id, paid: t.paid, shares: t.shares,
    source: 'recurring', recurring_id: t.id, occurrence_date: date, created_at: `${date}T00:05:00.000Z`, updated_at: `${date}T00:05:00.000Z`,
  });
}
const POSTED = [
  posted('00000000-0000-4000-8000-00000000e401', RENT, '2026-11-01'),
  posted('00000000-0000-4000-8000-00000000e403', CLEANER, '2026-11-07'),
  posted('00000000-0000-4000-8000-00000000e404', DOG, '2026-11-06'),
  posted('00000000-0000-4000-8000-00000000e405', DOG, '2026-11-13'),
];
function household() {
  return couple({ recurring: [RENT, CLEANER, GYM, MAGAZINE, DOG], expenses: POSTED });
}

async function goBills() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Bills' }));
  return screen.findByRole('heading', { level: 1, name: 'Bills' });
}
function showSegment(name: string) {
  const main = screen.getByRole('main');
  const seg = within(main).queryAllByRole('tab', { name }).concat(within(main).queryAllByRole('radio', { name }));
  if (seg[0]) fireEvent.click(seg[0]);
}
async function openFrom(list: 'Subscriptions' | 'Next 30 days' | 'Paused or ended', name: RegExp) {
  if (list !== 'Paused or ended') showSegment(list);
  fireEvent.click(within(await screen.findByRole('list', { name: list })).getAllByRole('button', { name })[0] as HTMLElement);
  return screen.findByRole('dialog', { name: 'Edit regular payment' });
}
const closed = async () => { await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit regular payment' })).toBeNull(); }); };
const homeCost = () => text(screen.getByRole('region', { name: 'What home costs' }));
const startsGroup = (sheet: HTMLElement) => within(sheet).getByRole('group', { name: 'Starts' });
/** Starts → the month grid (open on the start) → forward `monthsOn` months → the day named `day` ("Thu 15 Jan"). */
async function pickStart(sheet: HTMLElement, monthsOn: number, day: string) {
  fireEvent.click(within(startsGroup(sheet)).getAllByRole('button')[1] as HTMLElement);
  const picker = await screen.findByRole('dialog', { name: 'When it starts' });
  for (let i = 0; i < monthsOn; i += 1) fireEvent.click(within(picker).getByRole('button', { name: 'Next month' }));
  fireEvent.click(within(picker).getByRole('button', { name: day }));
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'When it starts' })).toBeNull(); });
}

describe('deleting a regular payment (S10, REC-1, REC-7, REC-8)', () => {
  it('S10 REC-1: Delete is on a paused or an ended one; a running one has none and says to pause or end it first', async () => {
    show(household().layer);
    await goBills();
    let sheet = await openFrom('Paused or ended', /^Old gym\b/);
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await closed();
    sheet = await openFrom('Paused or ended', /^Magazine\b/);
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await closed();
    sheet = await openFrom('Next 30 days', /^Rent\b/);
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(text(sheet)).toContain('To delete it, pause or end it first.');
  });

  it('S10 REC-7 REC-8: deleted, it leaves Bills; the toast says so with Undo, which brings it back as it was', async () => {
    const c = household();
    show(c.layer);
    await goBills();
    const cost = homeCost();
    fireEvent.click(within(await openFrom('Paused or ended', /^Old gym\b/)).getByRole('button', { name: 'Delete' }));
    await closed();
    const status = await screen.findByRole('status');
    await waitFor(() => { expect(text(status)).toContain('Deleted Old gym'); });
    await waitFor(() => { expect(within(screen.getByRole('list', { name: 'Paused or ended' })).queryByRole('button', { name: /^Old gym\b/ })).toBeNull(); });
    expect(homeCost()).toBe(cost);
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(7))?.deleted_at).not.toBeNull();
    expect(c.controls.tables.recurring).toHaveLength(5);

    fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    expect(await within(await screen.findByRole('list', { name: 'Paused or ended' })).findByRole('button', { name: /^Old gym\b/ })).toBeTruthy();
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(7))).toMatchObject({ deleted_at: null, active: false });
  });

  it('S10 REC-7: an ended one deleted: gone from Paused or ended; what it posted stays on the calendar as plain text, in the month’s total and in the balance', async () => {
    const c = household();
    show(c.layer);
    await goBills();
    const balanceBefore = c.layer.balance();
    const monthTotal = () => text(screen.getByRole('main')).match(/£[\d,]+\.\d\d this month/)?.[0] ?? '';
    showSegment('This month');
    const totalBefore = monthTotal();
    fireEvent.click(within(await openFrom('Paused or ended', /^Dog walker\b/)).getByRole('button', { name: 'Delete' }));
    await closed();
    await waitFor(() => { expect(within(screen.getByRole('list', { name: 'Paused or ended' })).queryByRole('button', { name: /^Dog walker\b/ })).toBeNull(); });
    showSegment('This month');
    expect(monthTotal()).toBe(totalBefore);
    const grid = screen.getByRole('grid');
    fireEvent.click(within(grid).getByRole('button', { name: /^Fri 6 Nov\b.*Dog walker/ }));
    const dayList = await screen.findByRole('list', { name: 'Fri 6 Nov' });
    expect(text(dayList)).toContain('Dog walker');
    expect(within(dayList).queryByRole('button', { name: /^Dog walker\b/ })).toBeNull();
    await settle(c.layer);
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === R(9)).map((e) => e.deleted_at)).toEqual([null, null]);
    expect(c.layer.balance()).toEqual(balanceBefore);
  });
});

describe('a new start after one has posted (S10, REC-2)', () => {
  it('S10 REC-2: How often is fixed, Starts can change; the line says from when, the next day and that past payments stay; no past-start choice; Save posts nothing', async () => {
    const c = household();
    show(c.layer);
    await goBills();
    const sheet = await openFrom('Next 30 days', /^Rent\b/);
    expect(within(sheet).queryByRole('radiogroup', { name: 'How often' })).toBeNull();
    expect(text(within(sheet).getByRole('group', { name: 'How often' }))).toContain('Monthly');
    expect(text(sheet)).toContain('It has started, so how often stays as it is. To change that, end it and add a new one.');
    expect(text(startsGroup(sheet))).not.toContain('From now on');
    await pickStart(sheet, 0, 'Thu 15 Jan');
    await waitFor(() => { expect(text(startsGroup(sheet))).toContain('From now on it posts on the 15th. Next: Sun 15 Nov. Past payments stay as they are.'); });
    expect(within(sheet).queryByText(/past payments?,|This adds/)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /^Add (them|it)$/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(1))).toMatchObject({ start_date: '2026-01-15', posted_count: 10 });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === R(1)).map((e) => e.date)).toEqual(['2026-11-01']);
    // Bills follows at once: the next is Sun 15 Nov.
    showSegment('Next 30 days');
    expect(text(within(await screen.findByRole('list', { name: 'Next 30 days' })).getByRole('button', { name: /^Rent\b/ }))).toContain('Sun 15 Nov');
    // The history says the start changed.
    const again = await openFrom('Next 30 days', /^Rent\b/);
    const history = within(again).getByRole('region', { name: 'History' });
    await waitFor(() => { expect(text(history)).toMatch(/Jae changed the start/); });
  });

  it('S10 REC-2: weekly names the weekday; moved to today, today counts as done and the next is two weeks on', async () => {
    const c = household();
    show(c.layer);
    await goBills();
    const sheet = await openFrom('Next 30 days', /^Window cleaner\b/);
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Today' }));
    await waitFor(() => { expect(text(startsGroup(sheet))).toContain('From now on it posts every 2 weeks on Saturday. Next: Sat 28 Nov. Past payments stay as they are.'); });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(6))).toMatchObject({ start_date: TODAY, posted_count: 1 });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === R(6)).map((e) => e.date)).toEqual(['2026-11-07']);
  });

  it('S10: a start moved back to where it was says nothing more', async () => {
    show(household().layer);
    await goBills();
    const sheet = await openFrom('Next 30 days', /^Rent\b/);
    await pickStart(sheet, 0, 'Thu 15 Jan');
    await waitFor(() => { expect(text(startsGroup(sheet))).toContain('From now on'); });
    await pickStart(sheet, 0, 'Thu 1 Jan');
    await waitFor(() => { expect(text(startsGroup(sheet))).not.toContain('From now on'); });
  });
});
