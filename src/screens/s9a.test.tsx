/**
 * S9a screens (docs/slices/S9a.md "Tests → Screens"; the findings in docs/qa/S9-acceptance.md): on the real screens over
 * the in-memory Api, with a fake rate service (never the network). Written before the build (ENGINEERING §5, tests
 * first by someone else). The layout half (390 px, both themes, axe) is tests/e2e/s9a.spec.ts.
 *
 * What these tests read (the brief fixes these words; apostrophes may be straight or curly):
 *   Recap "Between you": the balance at the month's end ("Sam owes Jae £40.00").
 *   Quick add abroad: the reading "¥2,000 · £10.53 · …"; Home's country chip (a button naming the country, e.g.
 *     "Japan 🇯🇵"), which leads to a "Current country" choice.
 *   Quick add: "There's no 31 February"; one line naming the maximum (£1,000,000.00, MAX_PENCE) that the sheet shows
 *     word for word for a too-large amount (never "Write an amount, like 12.50.").
 *   Activity: with a search or filter on, a line "3 entries · £30.00" above the rows (1: "1 entry · …").
 *   Settle up: "That's more than Sam owes (£20.00)" and a button "Use £20.00"; the record button "Record Sam's payment"
 *     / "Record Jae's payment", whoever's phone it is.
 *   Inbox: "Not ours" has Undo on its toast; a variable bill has a button "Usually £90.00" that keeps it at that amount.
 *   Money back: "Refund this" prefills what is still to come back; more is refused with "That's more than the £30.00
 *     still to come back".
 *   Payer change on "For Sam": the shares stay; the sheet says "Sam paid for Sam, so this won't change the balance".
 *
 * Choices made here where the brief leaves a shape open (the builder matches these or says why not):
 *   - Settle up refuses on the record button (no settle-up is saved); "Use £20.00" puts the amount in the field (or
 *     records it at once: either passes).
 *   - The Inbox's "Usually £90.00" saves the bill as an entry at £90.00 at once (as Keep would after Save), with the
 *     template's payer and split, and clears the card.
 *   - The country chip opens a "Current country" choice (in a sheet, or Settings → Where you are).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedRecurring, storedSettlement,
} from '../../tests/fixtures/couple';
import * as money from '../core/money';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The app's maximum (src/core/money.ts MAX_PENCE, exported in S9a), read so this file compiles before it is. */
const MAX = (money as unknown as { MAX_PENCE?: number }).MAX_PENCE ?? 100_000_000;

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
/** A sentence whole, wherever its parts are their own elements. */
const sentences = (scope: HTMLElement, s: RegExp) => within(scope).queryAllByText((_, el) => (el ? s.test(text(el)) : false));
const findSentence = (scope: HTMLElement, s: RegExp) => waitFor(() => { expect(sentences(scope, s).length, String(s)).toBeGreaterThan(0); }, { timeout: 3000 });
const toasts = () => screen.getByRole('status', { name: 'Notifications', hidden: true });
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'on' || (el instanceof HTMLInputElement && el.checked);
const APOS = '[’\']';

const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;
function spent(n: number, description: string, amount: number, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: E(n), description, amount_pence: amount, date, category_id: categoryId('Groceries'), paid: { [JAE_ID]: amount },
    shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, ...over,
  });
}

/** JPY at 0.005265 pounds per yen: ¥2,000 = £10.53. */
function rates(table: Record<string, number> = { JPY: 0.005265 }) {
  return {
    rate: vi.fn((...args: [from: string, date?: string]) => {
      const rate = table[args[0]];
      return rate === undefined ? Promise.reject(new Error('404')) : Promise.resolve({ date: '2026-11-13', base: args[0], quote: 'GBP', rate });
    }),
  };
}
const quickAddBox = () => screen.findByRole('textbox', { name: 'Quick add' });
async function quickAdd(words: string) {
  const box = await quickAddBox();
  fireEvent.change(box, { target: { value: words } });
  return box;
}
function enter(box: HTMLElement) {
  const form = box.closest('form');
  if (!form) throw new Error('quick add is not a form');
  act(() => { form.requestSubmit(); });
}

// ─────────────────────────────── fix 1: recap at the month's end ───────────────────────────────

describe('the recap shows the month-end balance (fix 1, INS-2)', () => {
  it('INS-2: October’s "Between you" says Sam owed Jae £40.00 at the end of October, though Sam owes £60.00 today', async () => {
    const c = couple({
      expenses: [spent(101, 'Big shop', 10000, '2026-10-05'), spent(102, 'Lamp', 4000, '2026-11-03')],
      settlements: [storedSettlement({ id: '00000000-0000-4000-8000-00000000f101', amount_pence: 1000, date: '2026-10-20', created_at: '2026-10-20T12:00:00.000Z' })],
    });
    at('/recap/2026-10');
    show(c.layer);
    const between = await screen.findByRole('region', { name: 'Between you' });
    await findSentence(between, /Sam owes Jae £40\.00/);
    expect(between.textContent).not.toMatch(/£60\.00/);
  });
});

// ─────────────────────────────── fix 2: quick add abroad ───────────────────────────────

describe('quick add abroad (fix 2, PLC-6)', () => {
  it('PLC-6 ADD-2: in Japan "2000 ramen" reads "¥2,000 · £10.53 · …" and Enter saves pounds with the yen and the rate', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    const box = await quickAdd('2000 ramen');
    const home = await screen.findByRole('main');
    await findSentence(home, /^¥2,000 · £10\.53 · /);
    enter(box);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description.toLowerCase() === 'ramen');
    expect(row).toMatchObject({ amount_pence: 1053, country: 'JP', original_currency: 'JPY' });
    expect(String(row?.original_amount)).toBe('2000');
    expect(String(row?.fx_rate)).toBe('0.005265');
    expect(c.controls.tables.expenses.some((e) => e.amount_pence === 200000)).toBe(false);
  });

  it('PLC-6: quick add stores exactly what the sheet stores for the same yen and rate', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    const box = await quickAdd('1,200 noodles');
    await findSentence(await screen.findByRole('main'), /^¥1,200 · £6\.32 · /);
    enter(box);
    await settle(c.layer);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add expense' })[0] ?? document.body);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    const paidIn = within(sheet).queryByRole('switch', { name: 'Paid in JPY' }) ?? within(sheet).getByRole('checkbox', { name: 'Paid in JPY' });
    if (!isChecked(paidIn)) fireEvent.click(paidIn);
    const rate = await within(sheet).findByRole<HTMLInputElement>('textbox', { name: 'Rate' });
    await waitFor(() => { expect(rate.value).toBe('0.005265'); });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1,200' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Udon' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const pick = (d: string) => {
      const r = c.controls.tables.expenses.find((e) => e.description.toLowerCase() === d);
      return { amount: r?.amount_pence, original: String(r?.original_amount), currency: r?.original_currency, rate: String(r?.fx_rate), country: r?.country };
    };
    expect(pick('noodles')).toEqual(pick('udon'));
    expect(pick('noodles')).toMatchObject({ amount: 632, original: '1200', currency: 'JPY', rate: '0.005265' });
  });

  it('PLC-6 OFF-4: with no rate today, quick add uses the last rate this phone has for yen', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    localStorage.setItem('smsm-rates', JSON.stringify({ JPY: { rate: '0.005', date: '2026-11-10', fetchedOn: '2026-11-10' } }));
    const c = couple({ rates: rates({}) });
    show(c.layer);
    const box = await quickAdd('2000 ramen');
    await findSentence(await screen.findByRole('main'), /^¥2,000 · £10\.00 · /);
    enter(box);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description.toLowerCase() === 'ramen')).toMatchObject({ amount_pence: 1000, original_currency: 'JPY' });
  });

  it('PLC-6: with no rate at all, Enter opens the sheet prefilled and never saves the number as pounds', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates({}) });
    show(c.layer);
    const box = await quickAdd('2000 ramen');
    await new Promise((resolve) => setTimeout(resolve, 50));
    enter(box);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value.replace(/,/g, '')).toMatch(/^2000(\.00)?$/);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(0);
  });

  it('PLC-3 DESIGN §4.1: abroad, Home shows the country chip; tapping it changes the current country; at home there is none', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    await quickAddBox();
    const chip = await screen.findByRole('button', { name: /Japan/ });
    expect(text(chip)).not.toMatch(/Adding to|Start a trip/);
    fireEvent.click(chip);
    const country = await screen.findByRole('combobox', { name: 'Current country' });
    if (country instanceof HTMLSelectElement) {
      const gb = within(country).getByRole<HTMLOptionElement>('option', { name: 'United Kingdom' });
      fireEvent.change(country, { target: { value: gb.value } });
    } else {
      fireEvent.click(country);
      fireEvent.click(await screen.findByRole('option', { name: 'United Kingdom' }));
    }
    await waitFor(() => { expect(localStorage.getItem('smsm-current-country') ?? 'GB').toContain('GB'); });
    // A sheet the choice was made in may stay open until it is put away.
    const left = screen.queryByRole('dialog');
    if (left) fireEvent.keyDown(left, { key: 'Escape' });
    const homeTab = screen.queryByRole('tab', { name: 'Home' });
    if (homeTab) fireEvent.click(homeTab);
    await quickAddBox();
    await waitFor(() => { expect(screen.queryByRole('button', { name: /Japan/ })).toBeNull(); });
  });
});

// ─────────────────────────────── fix 3: search folds apostrophes ───────────────────────────────

describe('Activity search folds apostrophes (fix 3, TXT-3)', () => {
  it('TXT-3: "sainsbury\'s" and "sainsburys" find "Sainsbury’s"', async () => {
    const c = couple({ expenses: [spent(301, 'Sainsbury’s', 2400, '2026-11-10'), spent(302, 'Tesco', 1500, '2026-11-11')] });
    at('/activity');
    show(c.layer);
    const search = await screen.findByRole('searchbox', { name: 'Search' });
    for (const typed of ["sainsbury's", 'sainsburys']) {
      fireEvent.change(search, { target: { value: typed } });
      await waitFor(() => { expect(document.querySelector(`[data-row="${E(301)}"]`), typed).not.toBeNull(); });
      expect(document.querySelector(`[data-row="${E(302)}"]`)).toBeNull();
    }
  });
});

// ─────────────────────────────── fixes 4 and 5: Insights and the pace ───────────────────────────────

/** July to October: £10.00 of groceries a day and rent of £1,500.00 on the 25th (a regular payment); November to the 14th: £10.00 a day. */
function steadyHousehold(): ExpenseRow[] {
  const rows: ExpenseRow[] = [];
  let n = 400;
  for (const [m, days] of [['2026-07', 31], ['2026-08', 31], ['2026-09', 30], ['2026-10', 31]] as const) {
    for (let d = 1; d <= days; d += 1) rows.push(spent((n += 1), 'Shop', 1000, `${m}-${String(d).padStart(2, '0')}`));
    rows.push(spent((n += 1), 'Rent', 150000, `${m}-25`, {
      category_id: categoryId('Rent & bills'), recurring_id: '00000000-0000-4000-8000-00000000d001', source: 'recurring', occurrence_date: `${m}-25`,
    }));
  }
  for (let d = 1; d <= 14; d += 1) rows.push(spent((n += 1), 'Shop', 1000, `2026-11-${String(d).padStart(2, '0')}`));
  return rows;
}

describe('Home’s pace matches Insights (fix 5, INS-1)', () => {
  it('INS-1: spending as usual with the rent still to come: Home says on pace, not "under", and Insights says the same as last month', async () => {
    const rent = storedRecurring({ amount_pence: 150000, start_date: '2026-07-25', posted_count: 4 });
    const c = couple({ expenses: steadyHousehold(), recurring: [rent] });
    show(c.layer);
    const home = await screen.findByRole('main');
    await findSentence(home, /£140\.00 so far/);
    expect(sentences(home, /under your usual pace/)).toHaveLength(0);
    await findSentence(home, /on your usual pace/);
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    await screen.findByRole('heading', { level: 1, name: 'Insights' });
    await findSentence(await screen.findByRole('main'), /£140\.00, the same as the same days last month/);
  });
});

describe('Insights compares like with like (fix 4, INS-4)', () => {
  it('INS-4: history from 23 May 2026: "Last 12 months" shows no comparison; "This month" still does', async () => {
    const c = couple({ expenses: [spent(501, 'First shop', 2000, '2026-05-23'), spent(502, 'October shop', 3000, '2026-10-10'), spent(503, 'Shop', 4000, '2026-11-10')] });
    at('/insights');
    show(c.layer);
    const main = await screen.findByRole('main');
    await findSentence(main, /^£40\.00, £10\.00 more than the same days last month$/);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Period' })).getByRole('radio', { name: 'Last 12 months' }));
    await findSentence(main, /£90\.00 in all|Not enough history yet/);
    expect(sentences(main, /a year earlier/)).toHaveLength(0);
  });
});

// ─────────────────────────────── fix 7: money back ───────────────────────────────

describe('money back (fix 7, MB-2, MB-3)', () => {
  const lamp = storedExpense({ id: E(701), category_id: categoryId('Household') });
  const tenBack = storedExpense({
    id: E(702), kind: 'money_back', description: 'Lamp refund', amount_pence: 1000, paid: { [JAE_ID]: 1000 }, shares: { [JAE_ID]: 500, [SAM_ID]: 500 },
    refund_of: lamp.id, created_at: '2026-11-11T12:00:00.000Z',
  });

  it('MB-2: "Refund this" prefills what is still to come back (£30.00), with the category, who got it and the split', async () => {
    const c = couple({ expenses: [lamp, tenBack] });
    at(`/entry/${lamp.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('30.00');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const backs = c.controls.tables.expenses.filter((e) => e.kind === 'money_back' && e.id !== tenBack.id);
    expect(backs).toHaveLength(1);
    expect(backs[0]).toMatchObject({ amount_pence: 3000, refund_of: lamp.id, category_id: categoryId('Household'), paid: { [JAE_ID]: 3000 }, shares: { [JAE_ID]: 1500, [SAM_ID]: 1500 } });
  });

  it('MB-2: more than is still to come back is refused: "That’s more than the £30.00 still to come back"', async () => {
    const c = couple({ expenses: [lamp, tenBack] });
    at(`/entry/${lamp.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '35' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await findSentence(sheet, new RegExp(`That${APOS}s more than the £30\\.00 still to come back`));
    await settle(c.layer);
    expect(c.controls.tables.expenses.filter((e) => e.kind === 'money_back')).toHaveLength(1);
  });

  it('MB-3 ACT-3: deleting the original takes its money back with it; the balance is as if neither was there', async () => {
    const c = couple({ expenses: [lamp, tenBack] });
    at(`/entry/${lamp.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    expect(c.layer.balance()[JAE_ID]).toBe(1500);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === tenBack.id)?.deleted_at).not.toBeNull();
    expect(c.layer.balance()[JAE_ID]).toBe(0);
  });
});

// ─────────────────────────────── fix 8: changing the payer ───────────────────────────────

describe('changing the payer keeps "For Sam" (fix 8, SPL-1)', () => {
  it('SPL-1: Sam now paid for Sam’s haircut: the shares stay Sam’s, and the sheet says it won’t change the balance', async () => {
    const haircut = storedExpense({
      id: E(801), description: 'Haircut', amount_pence: 3000, paid: { [JAE_ID]: 3000 }, split_mode: 'for_other', split_params: null,
      shares: { [JAE_ID]: 0, [SAM_ID]: 3000 }, category_id: categoryId('Health'),
    });
    const c = couple({ expenses: [haircut] });
    at(`/entry/${haircut.id}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Haircut' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' });
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).getByRole('radio', { name: 'Sam' }));
    await findSentence(sheet, new RegExp(`^Sam paid for Sam, so this won${APOS}t change the balance\\.?$`));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.id === haircut.id);
    expect(row?.paid).toMatchObject({ [SAM_ID]: 3000 });
    expect(row?.shares).toMatchObject({ [JAE_ID]: 0, [SAM_ID]: 3000 });
    expect(c.layer.balance()[JAE_ID]).toBe(0);
  });
});

// ─────────────────────────────── fix 9: Inbox ───────────────────────────────

describe('the Inbox (fix 9, INB-2, REC-3, DESIGN §4.9)', () => {
  const energy = storedRecurring({
    id: '00000000-0000-4000-8000-00000000d0e1', description: 'Energy', amount_pence: 9000, amount_varies: true, category_id: categoryId('Utilities'),
    paid: { [SAM_ID]: 9000 }, shares: { [JAE_ID]: 4500, [SAM_ID]: 4500 }, start_date: '2026-09-03', posted_count: 3,
  });

  it('REC-3: a variable bill has a one-tap "Usually £90.00" that keeps it at £90.00', async () => {
    const c = couple({ recurring: [energy], inboxItems: [storedInboxItem()] });
    at('/inbox');
    show(c.layer);
    const usually = await screen.findByRole('button', { name: /^Usually £90\.00/ });
    fireEvent.click(usually);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Energy');
    expect(row).toMatchObject({ amount_pence: 9000, category_id: categoryId('Utilities'), date: '2026-11-03', paid: { [SAM_ID]: 9000 } });
    expect(c.controls.tables.inboxItems.find((i) => i.id === storedInboxItem().id)?.status).toBe('kept');
  });

  it('INB-2: "Not ours" has Undo on its toast, which puts the bill back', async () => {
    const c = couple({ recurring: [energy], inboxItems: [storedInboxItem()] });
    at('/inbox');
    show(c.layer);
    const main = await screen.findByRole('main');
    await findSentence(main, /^Energy is due: how much was it\?$/);
    fireEvent.click(screen.getByRole('button', { name: 'Not ours' }));
    await settle(c.layer);
    fireEvent.click(await within(toasts()).findByRole('button', { name: 'Undo', hidden: true }));
    await settle(c.layer);
    await findSentence(main, /^Energy is due: how much was it\?$/);
    expect(c.controls.tables.inboxItems.find((i) => i.id === storedInboxItem().id)?.status).toBe('open');
  });
});

// ─────────────────────────────── fix 10: filtered Activity's total ───────────────────────────────

describe('filtered Activity shows a total (fix 10, PLC-7, CHP-6)', () => {
  it('PLC-7: searching "tesco": "3 entries · £30.00" (money back subtracted, the settle-up left out); none without a search', async () => {
    const c = couple({
      expenses: [
        spent(1001, 'Tesco', 2000, '2026-11-10'), spent(1002, 'Tesco Express', 1500, '2026-11-11'),
        spent(1003, 'Tesco refund', 500, '2026-11-12', { kind: 'money_back', paid: { [JAE_ID]: 500 }, shares: { [JAE_ID]: 250, [SAM_ID]: 250 } }),
        spent(1004, 'Dishoom', 8600, '2026-11-12'),
      ],
      settlements: [storedSettlement({ note: 'for the Tesco shop' })],
    });
    at('/activity');
    show(c.layer);
    const main = await screen.findByRole('main');
    const search = await screen.findByRole('searchbox', { name: 'Search' });
    await waitFor(() => { expect(document.querySelector(`[data-row="${E(1004)}"]`)).not.toBeNull(); });
    expect(sentences(main, /^\d+ entr(y|ies) · /)).toHaveLength(0);
    fireEvent.change(search, { target: { value: 'tesco' } });
    await findSentence(main, /^3 entries · £30\.00$/);
  });

  it('CHP-6 PLC-7: the total is of every match, not only the rows drawn so far (30 ramen, one screenful shown)', async () => {
    const ramen = Array.from({ length: 30 }, (_, i) => spent(1100 + i, `Ramen ${String(i + 1)}`, 1001, `2026-11-${String((i % 14) + 1).padStart(2, '0')}`));
    const c = couple({ expenses: [...ramen, spent(1200, 'Tesco', 2000, '2026-11-10')] });
    at('/activity');
    show(c.layer);
    const main = await screen.findByRole('main');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search' }), { target: { value: 'ramen' } });
    await findSentence(main, new RegExp(`^30 entries · ${money.formatPence(money.pence(30030)).replace('.', '\\.')}$`));
  });

  it('PLC-7: one match: "1 entry · £86.00"', async () => {
    const c = couple({ expenses: [spent(1301, 'Dishoom', 8600, '2026-11-12'), spent(1302, 'Tesco', 2000, '2026-11-10')] });
    at('/activity');
    show(c.layer);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search' }), { target: { value: 'dishoom' } });
    await findSentence(await screen.findByRole('main'), /^1 entry · £86\.00$/);
  });
});

// ─────────────────────────────── fix 15: settle up ───────────────────────────────

describe('settle up (fix 15, SET-1)', () => {
  async function openSettle() {
    const balance = await screen.findByRole('region', { name: 'Balance' });
    fireEvent.click(await within(balance).findByRole('button', { name: 'Settle up' }));
    return screen.findByRole('dialog', { name: 'Settle up' });
  }

  it('SET-1: paying more than Sam owes is refused: "That’s more than Sam owes (£20.00)", with "Use £20.00"', async () => {
    const c = couple({ expenses: [storedExpense()] });
    show(c.layer);
    const sheet = await openSettle();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '30' } });
    fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^Record Sam${APOS}s payment$`) }));
    await findSentence(sheet, new RegExp(`That${APOS}s more than Sam owes \\(£20\\.00\\)`));
    await settle(c.layer);
    expect(c.controls.tables.settlements).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use £20.00' }));
    await settle(c.layer);
    if (c.controls.tables.settlements.length === 0) {
      expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Amount' }).value).toBe('20.00');
      fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^Record Sam${APOS}s payment$`) }));
      await settle(c.layer);
    }
    expect(c.controls.tables.settlements).toMatchObject([{ from_user: SAM_ID, to_user: JAE_ID, amount_pence: 2000 }]);
  });

  it('SET-1: on Sam’s own phone, when Sam owes, the button is "Record Sam’s payment"', async () => {
    const c = couple({ as: 'sam', expenses: [storedExpense()] });
    show(c.layer);
    const sheet = await openSettle();
    expect(within(sheet).getByRole('button', { name: new RegExp(`^Record Sam${APOS}s payment$`) })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Record it' })).toBeNull();
  });

  it('SET-1: when Jae owes, the button is "Record Jae’s payment" (on Jae’s phone too)', async () => {
    const c = couple({ expenses: [storedExpense({ paid: { [SAM_ID]: 4000 }, created_by: SAM_ID })] });
    show(c.layer);
    const sheet = await openSettle();
    expect(within(sheet).getByRole('button', { name: new RegExp(`^Record Jae${APOS}s payment$`) })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Record it' })).toBeNull();
  });
});

// ─────────────────────────────── fix 21: quick add says why ───────────────────────────────

describe('quick add says why (fix 21, ADD-1, ADD-5)', () => {
  const maxWords = money.formatPence(money.pence(MAX)).replace(/[.]/g, '\\.').replace('\\.00', '(\\.00)?');

  it('ADD-1 ADD-5: more than the maximum gets one line naming it, the same line in quick add and in the sheet', async () => {
    const c = couple();
    show(c.layer);
    const box = await quickAdd('2000000 car');
    enter(box);
    const main = await screen.findByRole('main');
    await findSentence(main, new RegExp(maxWords));
    // The line itself (the shortest element that says it in words, not a span holding only the figure).
    const quickLine = sentences(main, new RegExp(maxWords)).map(text).filter((t) => t.replace(new RegExp(maxWords), '').trim() !== '')
      .sort((a, b) => a.length - b.length)[0] ?? '';
    expect(quickLine).not.toBe('');
    expect(c.controls.tables.expenses).toHaveLength(0);

    fireEvent.change(box, { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add expense' })[0] ?? document.body);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '99999999' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Car' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await findSentence(sheet, new RegExp(maxWords));
    expect(sentences(sheet, /^Write an amount, like 12\.50\.$/)).toHaveLength(0);
    expect(sentences(sheet, new RegExp(maxWords)).map(text)).toContain(quickLine);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(0);
  });

  it('ADD-1 DAT-3: "12 tesco 31/02" says "There’s no 31 February" and saves nothing', async () => {
    const c = couple();
    show(c.layer);
    const main = await screen.findByRole('main');
    enter(await quickAdd('12 tesco 31/02'));
    await findSentence(main, new RegExp(`There${APOS}s no 31 February`));
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull();
  });

  it('ADD-1: Enter on "abc" or "30.555 x" shows a short line under the box', async () => {
    const c = couple();
    show(c.layer);
    for (const words of ['abc', '30.555 x']) {
      const box = await quickAdd(words);
      enter(box);
      const form = box.closest('form');
      if (!form) throw new Error('no form');
      await waitFor(() => { expect(within(form).queryAllByRole('status').some((s) => text(s) !== ''), words).toBe(true); });
    }
    expect(c.controls.tables.expenses).toHaveLength(0);
  });
});

// ─────────────────────────────── fix 23: standing-order hint ───────────────────────────────

describe('the standing-order hint (fix 23, INS-6)', () => {
  const monthly = ['2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => spent(2300 + i, 'Big shop', 30000, `${m}-10`));
  const hint = /A standing order of £\d+ a month/;

  it('INS-6: owing at each month end, no settle day: the hint shows (as before)', async () => {
    const c = couple({ expenses: monthly });
    at('/insights');
    show(c.layer);
    await findSentence(await screen.findByRole('main'), hint);
  });

  it('INS-6 SET-4: with a settle day the rhythm covers it: no hint', async () => {
    const c = couple({ expenses: monthly, settleDay: 1 });
    at('/insights');
    show(c.layer);
    const main = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: 'Insights' });
    await findSentence(main, /in all|than the same days/);
    expect(sentences(main, hint)).toHaveLength(0);
  });
});

// ─────────────────────────────── fix 24: one order ───────────────────────────────

describe('one order everywhere (fix 24, ACT-1)', () => {
  it('ACT-1: Home’s Recent and Activity list the same day’s entries in the same order (date, then added, then id)', async () => {
    const same = '2026-11-12T09:00:00.000Z';
    const expenses = [
      spent(2401, 'Apples', 300, '2026-11-12', { created_at: same }),
      spent(2403, 'Coffee', 300, '2026-11-12', { created_at: same }),
      spent(2402, 'Bread', 300, '2026-11-12', { created_at: same }),
      spent(2404, 'Dinner', 300, '2026-11-12', { created_at: '2026-11-12T20:00:00.000Z' }),
      spent(2405, 'Eggs', 300, '2026-11-11'),
    ];
    const c = couple({ expenses, settlements: [storedSettlement({ id: '00000000-0000-4000-8000-00000000f240', date: '2026-11-12', created_at: same })] });
    show(c.layer);
    const ids = (root: ParentNode) => Array.from(root.querySelectorAll('[data-row]')).map((el) => el.getAttribute('data-row') ?? '');
    await waitFor(() => { expect(ids(document).length).toBeGreaterThanOrEqual(5); });
    const homeOrder = ids(document).slice(0, 5);
    expect(homeOrder[0]).toBe(E(2404));
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    await screen.findByRole('heading', { level: 1, name: 'Activity' });
    await waitFor(() => { expect(ids(document).length).toBeGreaterThanOrEqual(6); });
    expect(ids(document).slice(0, 5)).toEqual(homeOrder);
  });
});
