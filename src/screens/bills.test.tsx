/**
 * S3 screens (docs/slices/S3.md): Bills, the regular payment sheet, the Inbox, "looks monthly" and the
 * categories editor, on the real screens over the in-memory Api. Written before the build (ENGINEERING §5,
 * tests first by someone else); each test names its SPEC ids and fails on 357a2fa because the screen isn't
 * there yet. The accessible names are the contract in docs/slices/S3.md "Interfaces"; the layout half (320 px,
 * both themes, axe) is tests/e2e/bills.spec.ts.
 *
 * The household on Sat 14 Nov 2026 (TODAY), every template already posted up to today:
 *   Rent           £1,450.00 monthly from 1 Jan, Jae, posted 1 Nov                      next Tue 1 Dec
 *   Netflix        £10.99 monthly from 20 Jan, subscription                             next Fri 20 Nov
 *   Spotify        £11.99 monthly from 5 Dec 2025, subscription, Sam, posted 5 Nov      next Sat 5 Dec
 *   Prime          £95.00 yearly from 2 Mar, subscription                               next 2 Mar 2027
 *   Energy         about £90.00 monthly from 3 Jan, amount varies, Sam; 3 Nov waits in the Inbox; next Thu 3 Dec
 *   Window cleaner £12.00 every 2 weeks from 7 Nov, posted 7 Nov                        next Sat 21 Nov, Sat 5 Dec
 *   Old gym        £30.00 monthly, paused
 *   Magazine       £4.50 monthly, subscription, ended 31 Oct
 * What home costs: 145000 + 1099 + 1199 + 792 (9500 ÷ 12) + 9000 + 2600 (1200 × 52 ÷ 12 ÷ 2) = £1,596.90 a month.
 * November: posted 145000 + 1199 + 1200, upcoming 1099 + 1200 (Energy's open Inbox bill is not counted, INB-3)
 *   = £1,496.98. Subscriptions: £131.88 + £143.88 + £95.00 = £370.76 a year.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedRecurring, TODAY,
  type InboxItemRow, type RecurringRow,
} from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import type { MemoryTables } from '../data/memoryApi';
import { memoryStorage } from '../data/storage';
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

type S3Tables = MemoryTables & { recurring: RecurringRow[]; inboxItems: InboxItemRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S3Tables;
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el as HTMLInputElement).checked;
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

// ───────── the household ─────────
const R = (n: number) => `00000000-0000-4000-8000-00000000d${n.toString().padStart(3, '0')}`;
const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;
const ENERGY = R(5);

function template(n: number, over: Partial<RecurringRow>): RecurringRow {
  return storedRecurring({ id: R(n), ...over });
}
function bySam(amount: number): Partial<RecurringRow> {
  return { paid: { [SAM_ID]: amount }, shares: { [JAE_ID]: Math.floor(amount / 2), [SAM_ID]: amount - Math.floor(amount / 2) } };
}
function byJae(amount: number): Partial<RecurringRow> {
  return { paid: { [JAE_ID]: amount }, shares: { [JAE_ID]: amount - Math.floor(amount / 2), [SAM_ID]: Math.floor(amount / 2) } };
}

const TEMPLATES: RecurringRow[] = [
  template(1, {}),
  template(2, { description: 'Netflix', amount_pence: 1099, ...byJae(1099), category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-01-20', posted_count: 10 }),
  template(3, { description: 'Spotify', amount_pence: 1199, ...bySam(1199), category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2025-12-05', posted_count: 12 }),
  template(4, { description: 'Prime', amount_pence: 9500, ...byJae(9500), category_id: categoryId('Subscriptions'), is_subscription: true, frequency: 'yearly', start_date: '2026-03-02', posted_count: 1 }),
  template(5, { description: 'Energy', amount_pence: 9000, ...bySam(9000), amount_varies: true, category_id: categoryId('Utilities'), start_date: '2026-01-03', posted_count: 11 }),
  template(6, { description: 'Window cleaner', amount_pence: 1200, ...byJae(1200), category_id: categoryId('Household'), frequency: 'weekly', every: 2, start_date: '2026-11-07', posted_count: 1 }),
  template(7, { description: 'Old gym', amount_pence: 3000, ...byJae(3000), category_id: categoryId('Health'), start_date: '2026-01-10', posted_count: 10, active: false }),
  template(8, { description: 'Magazine', amount_pence: 450, ...byJae(450), category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-01-15', end_date: '2026-10-31', posted_count: 10 }),
];

function posted(n: number, t: RecurringRow, date: string, amount = t.amount_pence): ExpenseRow {
  return storedExpense({
    id: E(n), description: t.description, amount_pence: amount, date, category_id: t.category_id, paid: t.paid, shares: t.shares,
    source: 'recurring', recurring_id: t.id, occurrence_date: date, created_at: `${date}T00:05:00.000Z`, updated_at: `${date}T00:05:00.000Z`,
  });
}

/** The bills posted so far this month; they balance out (Jae's rent against Sam's share) as they would in life. */
const POSTED: ExpenseRow[] = [
  posted(401, TEMPLATES[0] as RecurringRow, '2026-11-01'),
  posted(402, TEMPLATES[2] as RecurringRow, '2026-11-05'),
  posted(403, TEMPLATES[5] as RecurringRow, '2026-11-07'),
];
const ENERGY_BILL = storedInboxItem({ recurring_id: ENERGY });

function billsHousehold(opts: Parameters<typeof couple>[0] = {}) {
  return couple({ recurring: TEMPLATES, expenses: POSTED, inboxItems: [ENERGY_BILL], ...opts });
}

// ───────── getting around ─────────
async function goBills() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Bills' }));
  return screen.findByRole('heading', { level: 1, name: 'Bills' });
}

/** The Bills page shows one segment at a time (DESIGN §4.5): a tab or radio with that name, when there is one. */
function showSegment(name: string) {
  const main = screen.getByRole('main');
  const seg = within(main).queryAllByRole('tab', { name }).concat(within(main).queryAllByRole('radio', { name }));
  if (seg[0]) fireEvent.click(seg[0]);
}

async function goInbox() {
  fireEvent.click(await screen.findByRole('button', { name: /^Inbox\W+\d+/ }));
  return screen.findByRole('heading', { level: 1, name: 'Inbox' });
}

async function goCategories() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  const link = screen.queryByRole('link', { name: 'Categories' }) ?? screen.getByRole('button', { name: 'Categories' });
  fireEvent.click(link);
  return screen.findByRole('heading', { level: 1, name: 'Categories' });
}

const balance = () => screen.getByRole('region', { name: 'Balance' });

/** A day of the calendar: a gridcell, or a button in one, named "Sun 1 Nov" (and ": Rent posted" when it has bills). */
function day(grid: HTMLElement, name: RegExp): HTMLElement | undefined {
  return within(grid).queryAllByRole('gridcell', { name }).concat(within(grid).queryAllByRole('button', { name }))[0];
}

/** Picks a toggle (a switch or a checkbox) by name. */
function toggle(scope: HTMLElement, name: string): HTMLElement {
  const found = within(scope).queryAllByRole('switch', { name }).concat(within(scope).queryAllByRole('checkbox', { name }));
  if (!found[0]) throw new Error(`no switch or checkbox "${name}"`);
  return found[0];
}

// ─────────────────────────────── REC-7 REC-8: the Bills tab ───────────────────────────────

describe('the Bills tab (REC-7, REC-8)', () => {
  it('REC-7: the third tab is "Bills"; it opens the Bills page with "Add a regular payment"', async () => {
    const { layer } = billsHousehold();
    show(layer);
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent.trim());
    expect(tabs.slice(0, 3)).toEqual(['Home', 'Activity', 'Bills']);
    await goBills();
    expect(screen.getByRole('button', { name: 'Add a regular payment' })).toBeTruthy();
    expect(location.pathname).toBe('/bills');
  });

  it('REC-8: "What home costs" is the active regular payments a month, in one sentence (paused and ended ones left out)', async () => {
    const { layer } = billsHousehold();
    show(layer);
    await goBills();
    const region = screen.getByRole('region', { name: 'What home costs' });
    expect(text(region)).toContain('£1,596.90 a month to run');
  });

  it('REC-7 INB-3: this month as a calendar: posted and upcoming days marked, and the month’s total (an Inbox bill not counted)', async () => {
    const { layer } = billsHousehold();
    show(layer);
    await goBills();
    showSegment('This month');
    const grid = await screen.findByRole('grid', { name: 'November 2026' });
    expect(day(grid, /^Sun 1 Nov: Rent posted$/)).toBeTruthy();
    expect(day(grid, /^Thu 5 Nov: Spotify posted$/)).toBeTruthy();
    expect(day(grid, /^Sat 7 Nov: Window cleaner posted$/)).toBeTruthy();
    expect(day(grid, /^Fri 20 Nov: Netflix due$/)).toBeTruthy();
    expect(day(grid, /^Sat 21 Nov: Window cleaner due$/)).toBeTruthy();
    // A day with nothing on it is just the day.
    expect(day(grid, /^Mon 16 Nov$/)).toBeTruthy();
    // Paused and ended templates mark nothing.
    expect(within(grid).queryAllByRole('gridcell', { name: /Old gym|Magazine/ })).toHaveLength(0);
    expect(within(grid).queryAllByRole('button', { name: /Old gym|Magazine/ })).toHaveLength(0);
    expect(text(screen.getByRole('main'))).toContain('£1,496.98 this month');
  });

  it('REC-7 REC-3: the next 30 days as a list, in date order, a varying bill shown as "about"', async () => {
    const { layer } = billsHousehold();
    show(layer);
    await goBills();
    showSegment('Next 30 days');
    const list = await screen.findByRole('list', { name: 'Next 30 days' });
    const rows = within(list).getAllByRole('listitem').map(text);
    expect(rows).toHaveLength(6);
    const expected: [string, string, string][] = [
      ['Netflix', 'Fri 20 Nov', '£10.99'],
      ['Window cleaner', 'Sat 21 Nov', '£12.00'],
      ['Rent', 'Tue 1 Dec', '£1,450.00'],
      ['Energy', 'Thu 3 Dec', 'about £90.00'],
      ['Spotify', 'Sat 5 Dec', '£11.99'],
      ['Window cleaner', 'Sat 5 Dec', '£12.00'],
    ];
    expected.forEach(([description, date, amount], i) => {
      expect(rows[i]).toContain(description);
      expect(rows[i]).toContain(date);
      expect(rows[i]).toContain(amount);
    });
    expect(rows.join(' ')).not.toMatch(/Old gym|Magazine|Prime/);
  });

  it('REC-7: Subscriptions: each active one with its monthly and yearly cost, and a yearly total', async () => {
    const { layer } = billsHousehold();
    show(layer);
    await goBills();
    showSegment('Subscriptions');
    const list = await screen.findByRole('list', { name: 'Subscriptions' });
    const rows = within(list).getAllByRole('listitem').map(text);
    expect(rows).toHaveLength(3);
    const row = (name: string) => rows.find((r) => r.includes(name)) ?? '';
    expect(row('Netflix')).toContain('£10.99 a month');
    expect(row('Netflix')).toContain('£131.88 a year');
    expect(row('Spotify')).toContain('£11.99 a month');
    expect(row('Spotify')).toContain('£143.88 a year');
    expect(row('Prime')).toContain('£7.92 a month');
    expect(row('Prime')).toContain('£95.00 a year');
    expect(rows.join(' ')).not.toMatch(/Rent|Magazine|Old gym/);
    expect(text(screen.getByRole('main'))).toContain('£370.76 a year in all');
  });

  it('REC-7: with no regular payments yet, Bills invites the first one', async () => {
    const { layer } = couple();
    show(layer);
    await goBills();
    expect(screen.getByRole('region', { name: 'What home costs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a regular payment' })).toBeTruthy();
  });
});

// ─────────────────────────────── REC-1 REC-6: the regular payment sheet ───────────────────────────────

async function openRegularPayment() {
  fireEvent.click(screen.getByRole('button', { name: 'Add a regular payment' }));
  return screen.findByRole('dialog', { name: 'Regular payment' });
}

describe('the regular payment sheet (REC-1, REC-6, SPL-2)', () => {
  it('REC-1: How often, Every, Starts, Ends, Amount varies and Subscription, with the usual entry fields; Save stores the template', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    const sheet = await openRegularPayment();
    for (const name of ['Weekly', 'Monthly', 'Yearly']) {
      expect(within(within(sheet).getByRole('radiogroup', { name: 'How often' })).getByRole('radio', { name })).toBeTruthy();
    }
    expect(isChecked(within(sheet).getByRole('radio', { name: 'Monthly' }))).toBe(true);
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Every' }).value).toBe('1');
    expect(within(sheet).getByRole('group', { name: 'Starts' })).toBeTruthy();
    expect(within(sheet).getByRole('group', { name: 'Ends' })).toBeTruthy();
    expect(within(sheet).getByRole('group', { name: 'Category' })).toBeTruthy();
    expect(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).toBeTruthy();
    expect(within(sheet).getByRole('radiogroup', { name: 'How it’s shared' })).toBeTruthy();
    expect(isChecked(toggle(sheet, 'Amount varies'))).toBe(false);
    expect(isChecked(toggle(sheet, 'Subscription'))).toBe(false);

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '12' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Window cleaner' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Weekly' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Every' }), { target: { value: '2' } });
    fireEvent.click(toggle(sheet, 'Subscription'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Regular payment' })).toBeNull(); });
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({
      description: 'Window cleaner', amount_pence: 1200, frequency: 'weekly', every: 2, start_date: TODAY, end_date: null,
      amount_varies: false, is_subscription: true, paid: { [JAE_ID]: 1200 }, shares: { [JAE_ID]: 600, [SAM_ID]: 600 },
    });
  });

  it('SPL-2 PPL-5: a new regular payment starts from the household’s usual split', async () => {
    const { layer } = couple({ defaultRatio: { [JAE_ID]: 60, [SAM_ID]: 40 } });
    show(layer);
    await goBills();
    const sheet = await openRegularPayment();
    const shared = within(sheet).getByRole('radiogroup', { name: 'How it’s shared' });
    await waitFor(() => { expect(isChecked(within(shared).getByRole('radio', { name: 'Jae 60 · Sam 40' }))).toBe(true); });
  });

  it('REC-1 ADD-3: the Add sheet’s "More details" → "Repeat" makes it a regular payment; one due today posts once (not twice)', async () => {
    const c = couple();
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10.99' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Netflix' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Repeat' }));
    const repeating = await screen.findByRole('dialog');
    const often = await within(repeating).findByRole('radiogroup', { name: 'How often' });
    expect(isChecked(within(often).getByRole('radio', { name: 'Monthly' }))).toBe(true);
    // What was typed is kept.
    expect(within(repeating).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Netflix');
    fireEvent.click(within(repeating).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    await settle(c.layer);
    expect(tablesOf(c).recurring).toHaveLength(1);
    expect(tablesOf(c).recurring[0]).toMatchObject({ description: 'Netflix', amount_pence: 1099, frequency: 'monthly', start_date: TODAY });
    const netflix = c.controls.tables.expenses.filter((e) => e.description === 'Netflix' && e.deleted_at === null);
    expect(netflix).toHaveLength(1);
    expect(netflix[0]?.recurring_id).toBe(tablesOf(c).recurring[0]?.id);
    await waitFor(() => { expect(within(balance()).getByText('Sam owes Jae £5.49')).toBeTruthy(); });
  });

  it('REC-6: editing the amount changes future occurrences only; the sheet’s history notes the price change', async () => {
    const c = billsHousehold();
    show(c.layer);
    await goBills();
    showSegment('Next 30 days');
    const list = await screen.findByRole('list', { name: 'Next 30 days' });
    fireEvent.click(within(list).getByRole('button', { name: /^Rent\b/ }));
    let sheet = await screen.findByRole('dialog', { name: 'Edit regular payment' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('1450.00');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1500' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit regular payment' })).toBeNull(); });
    await settle(c.layer);
    expect(tablesOf(c).recurring.find((r) => r.id === R(1))?.amount_pence).toBe(150000);
    expect(c.controls.tables.expenses.find((e) => e.id === E(401))?.amount_pence).toBe(145000);

    fireEvent.click(within(await screen.findByRole('list', { name: 'Next 30 days' })).getByRole('button', { name: /^Rent\b/ }));
    sheet = await screen.findByRole('dialog', { name: 'Edit regular payment' });
    const history = within(sheet).getByRole('region', { name: 'History' });
    await waitFor(() => { expect(text(history)).toContain('Rent £1,450.00 → £1,500.00 from December'); });
  });

  it('REC-1 REC-8: Pause leaves a template in place but out of what home costs; End stops it; nothing is deleted', async () => {
    const c = billsHousehold();
    show(c.layer);
    await goBills();
    showSegment('Subscriptions');
    fireEvent.click(within(await screen.findByRole('list', { name: 'Subscriptions' })).getByRole('button', { name: /^Netflix\b/ }));
    let sheet = await screen.findByRole('dialog', { name: 'Edit regular payment' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pause' }));
    await waitFor(() => { expect(text(screen.getByRole('region', { name: 'What home costs' }))).toContain('£1,585.91 a month to run'); });
    await settle(c.layer);
    expect(tablesOf(c).recurring.find((r) => r.id === R(2))).toMatchObject({ active: false });

    showSegment('Subscriptions');
    fireEvent.click(within(await screen.findByRole('list', { name: 'Subscriptions' })).getByRole('button', { name: /^Spotify\b/ }));
    sheet = await screen.findByRole('dialog', { name: 'Edit regular payment' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'End' }));
    await settle(c.layer);
    expect(tablesOf(c).recurring.find((r) => r.id === R(3))?.end_date).toBe(TODAY);
    expect(tablesOf(c).recurring).toHaveLength(TEMPLATES.length);
    await waitFor(() => { expect(text(screen.getByRole('region', { name: 'What home costs' }))).toContain('£1,573.92 a month to run'); });
  });

  it('OFF-4: saved offline, a bill due today says it will post when back online, and is not counted until it does', async () => {
    const c = couple();
    show(c.layer);
    await goBills();
    act(() => { c.network.set(false); });
    const sheet = await openRegularPayment();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10.99' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Netflix' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Netflix is due today and will post when you’re back online')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    await waitFor(() => { expect(within(balance()).getByText('All square')).toBeTruthy(); });
    act(() => { c.network.set(true); });
    await settle(c.layer);
    await settle(c.layer);
    await waitFor(() => { expect(within(balance()).getByText('Sam owes Jae £5.49')).toBeTruthy(); });
    expect(c.controls.tables.expenses.filter((e) => e.description === 'Netflix')).toHaveLength(1);
  });
});

// ─────────────────────────────── INB-1…INB-3, REC-3: the Inbox ───────────────────────────────

describe('the Inbox (INB-1, INB-2, INB-3, REC-3)', () => {
  it('INB-2: Home shows the Inbox with its count; none when it is empty', async () => {
    const { layer } = billsHousehold();
    const view = show(layer);
    expect(await screen.findByRole('button', { name: /^Inbox\W+1(\D|$)/ })).toBeTruthy();
    view.unmount();
    await layer.dispose();
    open = null;
    const empty = couple({ recurring: TEMPLATES, expenses: POSTED });
    show(empty.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(empty.layer);
    expect(screen.queryByRole('button', { name: /^Inbox\b/ })).toBeNull();
  });

  it('INB-3: an open Inbox bill is not money: the balance and Activity leave it out', async () => {
    const { layer } = couple({ recurring: TEMPLATES, inboxItems: [ENERGY_BILL] });
    show(layer);
    await screen.findByRole('button', { name: /^Inbox\W+1(\D|$)/ });
    expect(within(balance()).getByText('All square')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    await screen.findByRole('searchbox', { name: 'Search' });
    expect(within(screen.getByRole('main')).queryByText('Energy')).toBeNull();
  });

  it('REC-3 INB-2: "Energy is due: how much was it?" with the usual amount; Keep opens the Add sheet prefilled, Save makes it an entry and clears it', async () => {
    const c = couple({ recurring: TEMPLATES, inboxItems: [ENERGY_BILL] });
    show(c.layer);
    await goInbox();
    const main = screen.getByRole('main');
    expect(within(main).getByText('Energy is due: how much was it?')).toBeTruthy();
    expect(text(main)).toContain('1 of 1');
    expect(text(main)).toContain('£90.00');
    expect(within(main).getByRole('button', { name: 'Not ours' })).toBeTruthy();
    fireEvent.click(within(main).getByRole('button', { name: 'Keep' }));

    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('90.00');
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Energy');
    expect(isChecked(within(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).getByRole('radio', { name: 'Sam' }))).toBe(true);
    expect(isPressed(within(within(sheet).getByRole('group', { name: 'Category' })).getByRole('button', { name: /Utilities/ }))).toBe(true);
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '84.37' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy();
    await settle(c.layer);
    const kept = c.controls.tables.expenses.filter((e) => e.recurring_id === ENERGY);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ amount_pence: 8437, occurrence_date: '2026-11-03', country: 'GB', chapter_id: null });
    expect(tablesOf(c).inboxItems[0]).toMatchObject({ status: 'kept', expense_id: kept[0]?.id });

    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    await waitFor(() => { expect(within(balance()).getByText('Jae owes Sam £42.18')).toBeTruthy(); });
    expect(screen.queryByRole('button', { name: /^Inbox\b/ })).toBeNull();
  });

  it('INB-2: Not ours dismisses it; nothing becomes money', async () => {
    const c = couple({ recurring: TEMPLATES, inboxItems: [ENERGY_BILL] });
    show(c.layer);
    await goInbox();
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Not ours' }));
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy();
    await settle(c.layer);
    expect(tablesOf(c).inboxItems[0]).toMatchObject({ status: 'dismissed', expense_id: null });
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('INB-2: one card at a time, with a counter; deciding one moves to the next', async () => {
    const water = storedInboxItem({
      id: '00000000-0000-4000-8000-00000000b0c2', recurring_id: R(9), occurrence_date: '2026-11-10', created_at: '2026-11-10T00:05:00.000Z',
      payload: { description: 'Water', estimate_pence: 3000, date: '2026-11-10', category_id: categoryId('Utilities') },
    });
    const c = couple({ recurring: TEMPLATES, inboxItems: [ENERGY_BILL, water] });
    show(c.layer);
    await goInbox();
    const main = screen.getByRole('main');
    expect(text(main)).toContain('1 of 2');
    expect(within(main).getByText('Energy is due: how much was it?')).toBeTruthy();
    expect(within(main).queryByText('Water is due: how much was it?')).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: 'Not ours' }));
    expect(await within(main).findByText('Water is due: how much was it?')).toBeTruthy();
    expect(text(main)).toContain('1 of 1');
  });
});

// ─────────────────────────────── REC-5: "looks monthly" ───────────────────────────────

describe('suggest recurring (REC-5)', () => {
  const netflixHistory = ['2026-08-20', '2026-09-20', '2026-10-20'].map((date, i) =>
    storedExpense({ id: E(500 + i), description: 'Netflix', amount_pence: 1099, date, category_id: categoryId('Subscriptions'), paid: { [JAE_ID]: 1099 }, shares: { [JAE_ID]: 550, [SAM_ID]: 549 }, created_at: `${date}T20:00:00.000Z` }),
  );
  const SUGGESTION = 'Netflix looks monthly. Make it a regular payment?';

  it('REC-5: three at a steady interval: Home offers it; Yes opens the regular payment sheet prefilled', async () => {
    const { layer } = couple({ expenses: netflixHistory });
    show(layer);
    expect(await screen.findByText(SUGGESTION)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    const sheet = await screen.findByRole('dialog', { name: 'Regular payment' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('10.99');
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Netflix');
    expect(isChecked(within(within(sheet).getByRole('radiogroup', { name: 'How often' })).getByRole('radio', { name: 'Monthly' }))).toBe(true);
    // It starts with the next one, so nothing already entered is posted again.
    expect(text(within(sheet).getByRole('group', { name: 'Starts' }))).toContain('Fri 20 Nov');
  });

  it('REC-5: No: it never asks again for that description, even after the app is opened again', async () => {
    const storage = memoryStorage();
    const first = couple({ expenses: netflixHistory, storage });
    const view = show(first.layer);
    expect(await screen.findByText(SUGGESTION)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() => { expect(screen.queryByText(SUGGESTION)).toBeNull(); });
    await settle(first.layer);
    view.unmount();
    await first.layer.dispose();
    open = null;

    const again = couple({ expenses: netflixHistory, storage });
    show(again.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(again.layer);
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });

  it('REC-5: not offered when it is already a regular payment, or with only two', async () => {
    const already = couple({ expenses: netflixHistory, recurring: [TEMPLATES[1] as RecurringRow] });
    const view = show(already.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(already.layer);
    expect(screen.queryByText(/looks monthly/)).toBeNull();
    view.unmount();
    await already.layer.dispose();
    open = null;

    const twice = couple({ expenses: netflixHistory.slice(1) });
    show(twice.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(twice.layer);
    expect(screen.queryByText(/looks monthly/)).toBeNull();
  });
});

// ─────────────────────────────── CAT-1: the categories editor ───────────────────────────────

describe('categories (CAT-1)', () => {
  const rowNames = () => within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem').map(text);

  it('CAT-1: Settings → Categories lists the twelve in order; rename, re-emoji and recolour from the palette', async () => {
    const c = couple();
    show(c.layer);
    await goCategories();
    const rows = rowNames();
    expect(rows).toHaveLength(12);
    expect(rows[0]).toContain('Groceries');
    expect(rows[11]).toContain('Other');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Groceries' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit category' });
    const palette = within(sheet).getByRole('radiogroup', { name: 'Colour' });
    const radios = within(palette).getAllByRole('radio');
    expect(radios).toHaveLength(12);
    const positions = ['Moss', 'Amber', 'Walnut', 'Honey', 'Slate', 'Plum', 'Oak', 'Berry', 'Lake', 'Clay', 'Fern', 'Stone']
      .map((name) => radios.indexOf(within(palette).getByRole('radio', { name })));
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(isChecked(within(sheet).getByRole('radio', { name: 'Moss' }))).toBe(true);
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Food shop' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Emoji' }), { target: { value: '🥕' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Amber' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(rowNames()[0]).toContain('Food shop'); });
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Groceries'))).toMatchObject({ name: 'Food shop', emoji: '🥕', colour: 'amber' });
  });

  it('CAT-1: reorder with Move up / Move down', async () => {
    const c = couple();
    show(c.layer);
    await goCategories();
    fireEvent.click(screen.getByRole('button', { name: 'Move Other up' }));
    await waitFor(() => { expect(rowNames()[10]).toContain('Other'); });
    fireEvent.click(screen.getByRole('button', { name: 'Move Groceries down' }));
    await waitFor(() => { expect(rowNames()[1]).toContain('Groceries'); });
    await settle(c.layer);
    const stored = [...c.controls.tables.categories].sort((a, b) => a.sort - b.sort).map((r) => r.name);
    expect(stored.slice(0, 2)).toEqual(['Eating out', 'Groceries']);
    expect(stored.slice(10)).toEqual(['Other', 'Health']);
  });

  it('CAT-1: archive keeps the history: gone from the Add sheet, still on its entries, and can be restored', async () => {
    const lamp = storedExpense({ category_id: categoryId('Household') });
    const c = couple({ expenses: [lamp] });
    show(c.layer);
    await goCategories();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Household' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit category' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Archive' }));
    await waitFor(() => { expect(rowNames().join(' ')).not.toContain('Household'); });
    const archived = screen.getByRole('list', { name: 'Archived' });
    expect(text(archived)).toContain('Household');
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Household'))?.archived).toBe(true);

    // Its entries keep it.
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lamp, £40.00, Jae paid' }));
    await screen.findByRole('region', { name: 'History' });
    expect(text(screen.getByRole('main'))).toContain('Household');
    // It isn't offered for new entries.
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    const add = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(within(add).getByRole('group', { name: 'Category' })).queryByRole('button', { name: /Household/ })).toBeNull();
    fireEvent.click(within(add).getByRole('button', { name: 'Close' }));

    await goCategories();
    fireEvent.click(within(screen.getByRole('list', { name: 'Archived' })).getByRole('button', { name: 'Restore Household' }));
    await waitFor(() => { expect(rowNames().join(' ')).toContain('Household'); });
  });

  it('CAT-1: add a category: name, emoji and colour; it goes last', async () => {
    const c = couple();
    show(c.layer);
    await goCategories();
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    const sheet = await screen.findByRole('dialog', { name: 'New category' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Pets' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Emoji' }), { target: { value: '🐾' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Fern' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(rowNames()).toHaveLength(13); });
    expect(rowNames()[12]).toContain('Pets');
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.name === 'Pets')).toMatchObject({ emoji: '🐾', colour: 'fern', archived: false });
  });
});
