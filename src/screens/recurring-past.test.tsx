/**
 * S9 (OPEN_ITEMS, "A regular payment started long ago back-posts every occurrence at once"; DECISIONS 23 Nov "S9: a
 * regular payment started long ago"). On Sat 14 Nov 2026 (TODAY) a new £1,450.00 rent starting Sat 24 Jan 2026 would
 * post ten past payments (24 Jan … 24 Oct) the moment it is saved. Under "code computes, people decide" the sheet
 * says so under Starts, worked out by the core (`pastOccurrences`), and asks: "Add them" keeps the start (the ten post,
 * once), "Start from Tue 24 Nov instead" moves the start to the next occurrence on or after today (nothing past
 * posts). Save does nothing until one is chosen; nothing changes unseen. Offline it is the same choice, and the
 * template goes through the queue as before.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID, type InboxItemRow, type RecurringRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { MemoryTables } from '../data/memoryApi';
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

type Tables = MemoryTables & { recurring: RecurringRow[]; inboxItems: InboxItemRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as Tables;
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
async function goBills() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Bills' }));
  await screen.findByRole('heading', { level: 1, name: 'Bills' });
}
async function newRegularPayment(amount: string, description: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add a regular payment' }));
  const sheet = await screen.findByRole('dialog', { name: 'Regular payment' });
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: amount } });
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: description } });
  return sheet;
}
/** Starts → the month grid (open on the start) → back `monthsBack` months (forward when negative) → the day named `day` ("Sat 24 Jan"). */
async function pickStart(sheet: HTMLElement, monthsBack: number, day: string) {
  const starts = within(sheet).getByRole('group', { name: 'Starts' });
  fireEvent.click(within(starts).getAllByRole('button')[1] as HTMLElement);
  const picker = await screen.findByRole('dialog', { name: 'When it starts' });
  for (let i = 0; i < Math.abs(monthsBack); i += 1) fireEvent.click(within(picker).getByRole('button', { name: monthsBack > 0 ? 'Previous month' : 'Next month' }));
  fireEvent.click(within(picker).getByRole('button', { name: day }));
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'When it starts' })).toBeNull(); });
}
const startsGroup = (sheet: HTMLElement) => within(sheet).getByRole('group', { name: 'Starts' });
const closed = () => waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Regular payment' })).toBeNull(); });
const rentExpenses = (c: { controls: { tables: MemoryTables } }) =>
  c.controls.tables.expenses.filter((e) => e.description === 'Rent' && e.deleted_at === null).map((e) => e.date).sort();

describe('a regular payment started long ago (S9, REC-1, REC-2)', () => {
  it('REC-1 REC-2: the sheet says what a past start adds, worked out exactly, with the two choices', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('1450', 'Rent');
    // Today: nothing in the past, nothing to say.
    expect(within(sheet).queryByText(/past payment/)).toBeNull();
    await pickStart(sheet, 10, 'Sat 24 Jan');
    const line = await within(startsGroup(sheet)).findByText('This adds 10 past payments, £14,500.00 in all.');
    expect(line).toBeTruthy();
    expect(within(startsGroup(sheet)).getByRole('button', { name: 'Add them' })).toBeTruthy();
    expect(within(startsGroup(sheet)).getByRole('button', { name: 'Start from Tue 24 Nov instead' })).toBeTruthy();
    // The amount is the person's: a new one changes the total at once.
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1500' } });
    expect(await within(startsGroup(sheet)).findByText('This adds 10 past payments, £15,000.00 in all.')).toBeTruthy();
    // Weekly from the same day: 42 past (24 Jan … 7 Nov), next Sat 14 Nov is today.
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Weekly' }));
    expect(await within(startsGroup(sheet)).findByText('This adds 42 past payments, £63,000.00 in all.')).toBeTruthy();
    expect(within(startsGroup(sheet)).getByRole('button', { name: 'Start from today instead' })).toBeTruthy();
  });

  it('REC-2: Save before choosing saves nothing and asks; "Add them" then posts each past payment once, from the start picked', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('1450', 'Rent');
    await pickStart(sheet, 10, 'Sat 24 Jan');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('First choose: add the past payments, or start from the next one.')).toBeTruthy();
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Regular payment' })).toBeTruthy();

    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Add them' }));
    // The line stays, and says when they are added; the other choice is still there until Save.
    expect(text(startsGroup(sheet))).toContain('This adds 10 past payments, £14,500.00 in all.');
    expect(text(startsGroup(sheet))).toContain('They’re added when you save.');
    expect(within(startsGroup(sheet)).queryByRole('button', { name: 'Add them' })).toBeNull();
    expect(within(startsGroup(sheet)).getByRole('button', { name: 'Start from Tue 24 Nov instead' })).toBeTruthy();
    expect(within(sheet).queryByText('First choose: add the past payments, or start from the next one.')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({ description: 'Rent', amount_pence: 145000, start_date: '2026-01-24', frequency: 'monthly', every: 1, posted_count: 10 });
    expect(rentExpenses(c)).toEqual(['2026-01-24', '2026-02-24', '2026-03-24', '2026-04-24', '2026-05-24', '2026-06-24', '2026-07-24', '2026-08-24', '2026-09-24', '2026-10-24']);
    expect(c.controls.tables.expenses.filter((e) => e.description === 'Rent').reduce((t, e) => t + e.amount_pence, 0)).toBe(1_450_000);
  });

  it('REC-2: "Start from Tue 24 Nov instead" moves the start there, says nothing more, and posts nothing past', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('1450', 'Rent');
    await pickStart(sheet, 10, 'Sat 24 Jan');
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Start from Tue 24 Nov instead' }));
    // The start the person sees is the new one; nothing past remains to say.
    await waitFor(() => { expect(within(startsGroup(sheet)).getByRole('button', { name: 'Tue 24 Nov' })).toBeTruthy(); });
    expect(within(sheet).queryByText(/past payment/)).toBeNull();
    expect(within(startsGroup(sheet)).queryByRole('button', { name: /^Start from/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({ description: 'Rent', start_date: '2026-11-24', posted_count: 0, paid: { [JAE_ID]: 145000 }, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 } });
    expect(rentExpenses(c)).toEqual([]);
  });

  it('REC-2: "Start from" keeps the start as the anchor: from 31 Jan it offers Mon 30 Nov (REC-2\'s date), not the 14th or the 28th', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('20', 'Cleaner');
    await pickStart(sheet, 10, 'Sat 31 Jan');
    expect(await within(startsGroup(sheet)).findByText('This adds 10 past payments, £200.00 in all.')).toBeTruthy();
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Start from Mon 30 Nov instead' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    expect(tablesOf(c).recurring[0]).toMatchObject({ start_date: '2026-11-30', posted_count: 0 });
  });

  it('a choice is for the schedule it was made on: picking another start asks again', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('1450', 'Rent');
    await pickStart(sheet, 10, 'Sat 24 Jan');
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Add them' }));
    await pickStart(sheet, -9, 'Sat 24 Oct');
    expect(await within(startsGroup(sheet)).findByText('This adds 1 past payment, £1,450.00.')).toBeTruthy();
    expect(within(startsGroup(sheet)).getByRole('button', { name: 'Add it' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('First choose: add the past payments, or start from the next one.')).toBeTruthy();
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(0);
  });

  it('REC-3: an amount that varies puts its past bills in the Inbox, and says so', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await newRegularPayment('90', 'Energy');
    await pickStart(sheet, 2, 'Thu 3 Sep');
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Amount varies' }));
    expect(await within(startsGroup(sheet)).findByText('This puts 3 past bills in the Inbox to fill in.')).toBeTruthy();
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Add them' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    await settle(c.layer);
    expect(tablesOf(c).inboxItems.filter((i) => i.status === 'open').map((i) => i.occurrence_date).sort()).toEqual(['2026-09-03', '2026-10-03', '2026-11-03']);
  });

  it('OFF-4: offline the same choice is offered, the template waits in the queue, and posts once back online', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    act(() => { c.network.set(false); });
    let sheet = await newRegularPayment('1450', 'Rent');
    await pickStart(sheet, 10, 'Sat 24 Jan');
    expect(await within(startsGroup(sheet)).findByText('This adds 10 past payments, £14,500.00 in all.')).toBeTruthy();
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Start from Tue 24 Nov instead' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await new Promise((resolve) => setTimeout(resolve, 600));
    sheet = await newRegularPayment('30', 'Gym');
    await pickStart(sheet, 2, 'Mon 14 Sep');
    fireEvent.click(within(startsGroup(sheet)).getByRole('button', { name: 'Add them' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await closed();
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(0);
    act(() => { c.network.set(true); });
    await settle(c.layer);
    await settle(c.layer);
    await settle(c.layer);
    const byName = (d: string) => tablesOf(c).recurring.find((r) => r.description === d);
    expect(byName('Rent')).toMatchObject({ start_date: '2026-11-24', posted_count: 0 });
    expect(byName('Gym')).toMatchObject({ start_date: '2026-09-14', posted_count: 3 });
    expect(rentExpenses(c)).toEqual([]);
    expect(c.controls.tables.expenses.filter((e) => e.description === 'Gym').map((e) => e.date).sort()).toEqual(['2026-09-14', '2026-10-14', '2026-11-14']);
  });
});
