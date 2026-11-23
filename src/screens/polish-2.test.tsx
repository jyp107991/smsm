/**
 * S2 polish, wave 2 (docs/slices/S2-polish.md): the Add sheet, Home and Activity, on the real screens over the
 * in-memory Api. Written before the build (ENGINEERING §5.2, tests first by someone else): each test names its
 * Q-id (and SPEC ids) and fails on the code at 06adbc5 for the reason in its title. The layout half (sizes,
 * colours, fonts, overlaps, no native controls in a real browser) is tests/e2e/polish-2.spec.ts.
 *
 * Interfaces these tests expect (new or changed; docs/slices/S2.md "Interfaces" is updated to match):
 *
 *   Add / edit sheet
 *   - The split is ONE radiogroup "How it’s shared" (replaces radiogroup "Split" and the "How it’s split"
 *     preset chips and the slider). Its radios, in the household's order (first to join first), never the
 *     payer's: "50/50", "Jae 60 · Sam 40", "Jae 40 · Sam 60", (more presets allowed), "Other", "Exact",
 *     "For Sam" (the person who didn't pay), "My treat" / "Sam’s treat". The visible heading says
 *     "How it’s shared". A ratio radio names each person's own share, so changing who paid never changes it.
 *     In Money back the treat / for-other options read "All Jae’s" and "All Sam’s" (whose money it is).
 *   - "Other" shows a −/+ stepper in 5 % steps: buttons "Less for Jae" and "More for Jae" (44 px), and the
 *     split in words beside them ("Jae 55 · Sam 45"). No <input type="range">.
 *   - Date: chips "Today", "Yesterday", "Pick a date". "Pick a date" opens a small sheet, dialog
 *     "Pick a date", holding an in-app month grid (role "grid"); each day is a button named as DESIGN §5
 *     writes dates ("Tue 10 Nov"; "10 Nov 2025" for another year); the phone's today has aria-current="date";
 *     days after today are disabled (Q-F2); "Previous month" / "Next month" buttons move the month. Picking a
 *     day closes the small sheet; the third chip then reads that day ("Tue 10 Nov") and is pressed; picking
 *     today presses "Today" instead. No <input type="date">.
 *   - Amount: placeholder "0.00" (the ghost); the sum's result ("= £34.50") sits inside the field.
 *   - "From before" (the suggestions row) shows recent descriptions before anything is typed.
 *   - "More" becomes button "More details" (aria-expanded, a chevron svg inside); Notes under it.
 *
 *   Quick add
 *   - A button "Save" appears inside the box when the reading is complete (confident); Enter still saves.
 *   - The description is tidied when read and saved: the merchant list's spelling when it is a known
 *     merchant ("ikea" → "IKEA", "easyjet" → "easyJet": content/merchants.json gains display spellings), else a
 *     capital first letter ("tesco" → "Tesco", "bread" → "Bread"); other scripts untouched ("이마트"). The
 *     reading and the form prefilled from it show the same tidy description.
 *   - The reading names a ratio split, payer first, as typed: "60/40" with Sam paying reads "Sam 60 · Jae 40";
 *     an even split stays "50/50".
 *
 *   Home
 *   - Section heading "Recent" (h2) replaces "Today": the last few entries and settle-ups (chosen: at most 5,
 *     newest first), grouped under day headings (h3: "Today", "Yesterday", "Tue 10 Nov"); each day's rows are a
 *     list named by its heading (so list "Today" still holds today's rows). "Nothing today yet" never shows
 *     when there is history. The balance region says "Settled up today" when square after a settle-up today.
 *   - The plank's description names people: "Jae, the cat, is owed; Sam, the dog, owes".
 *
 *   Toasts (one live region, "Notifications")
 *   - "Saved Tesco £42.50" (quick add and the sheet), Undo → "Removed Tesco"; Duplicate → "Copied to today"
 *     with button "Open" (opens the copy); Money back → "Money back saved".
 *
 *   Entry page
 *   - "Sam owes Jae £21.25 for this" after the split sentence (nothing when nobody owes, as for a treat);
 *   - an original that got money back shows a link "£20.00 came back · Today" to that money back;
 *   - history reads "Jae added this, today 12:02" (was "Jae added it, …") and runs oldest first, so it starts
 *     with who added it.
 *
 *   Activity
 *   - Each row's accessible name is "<description>, <amount>, <payer> paid" ("Big shop, £79.08, Jae paid").
 *   - Empty with a filter on: button "Clear filters". Any filter on: a button "Clear all" in the filters group.
 *   - Dates offers "Last 7 days" (today and the six days before) and "Pick dates" too.
 *
 *   Settings and Settle up
 *   - Under the monzo.me name a check line "Sam will pay you at monzo.me/jaetest", live as you type; "@name"
 *     is accepted and saved without the "@". "Usual split" is not in the "Paying each other" section.
 *   - Settle up opened by the person owed says "Sam paid Jae" and its button is "Record Sam’s payment" (the
 *     one who owes still reads "Sam pays Jae"; S9a: its button is "Record Sam’s payment" too). Editing a settle-up: dialog "Edit settle-up".
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedExpense, storedSettlement, TODAY } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ActivityRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  // A sheet the last test left closing takes its history entry back a moment later: let that land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
});
afterEach(async () => { await open?.dispose(); open = null; });

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

async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}

const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el as HTMLInputElement).checked;
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';

/** The one toast live region (it stays in the page; `hidden` because an open sheet hides the page behind it). */
const toasts = () => screen.getByRole('status', { name: 'Notifications', hidden: true });

function shared(sheet: HTMLElement) {
  return within(sheet).getByRole('radiogroup', { name: 'How it’s shared' });
}

const YESTERDAY = '2026-11-13';
const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;

// ─────────────────────────────── Q-L12 ───────────────────────────────

describe('Q-L12 ADD-4 ADD-5: the top of the Add sheet', () => {
  it('Q-L12 ADD-4: before anything is typed, "From before" offers recent descriptions (the row is never an empty gap)', async () => {
    const { layer } = couple({
      expenses: [
        storedExpense({ id: E(1), description: 'Lamp' }),
        storedExpense({ id: E(2), description: 'Tesco', date: YESTERDAY, created_at: '2026-11-13T12:00:00.000Z' }),
      ],
    });
    show(layer);
    const sheet = await openAddSheet();
    const row = within(sheet).getByRole('group', { name: 'From before' });
    const offered = within(row).getAllByRole('button').map((b) => b.textContent.trim());
    expect(offered).toEqual(expect.arrayContaining(['Lamp', 'Tesco']));
    fireEvent.click(within(row).getByRole('button', { name: 'Tesco' }));
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Tesco');
  });

  it('Q-L12 ADD-5: the amount shows a ghost "0.00" until something is typed', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).getByRole('textbox', { name: 'Amount' }).getAttribute('placeholder')).toBe('0.00');
  });
});

// ─────────────────────────────── Q-L13 ───────────────────────────────

describe('Q-L13 Q-F2 ADD-4: the date is an in-app month grid in a small sheet (no native date input)', () => {
  // `hidden`: while the small sheet closes (it lingers a moment in jsdom) the sheet under it may be hidden from
  // the accessibility tree; the chips are found inside the Date group so a lingering grid can't be mistaken for them.
  const dateChip = (sheet: HTMLElement, name: string) =>
    within(within(sheet).getByRole('group', { name: 'Date', hidden: true })).getByRole('button', { name, hidden: true });
  const pickerGone = () => waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull(); }, { timeout: 3000 });

  async function pickADate(sheet: HTMLElement) {
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pick a date' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick a date' });
    expect(within(picker).getByRole('grid')).toBeTruthy();
    return picker;
  }

  it('Q-L13: "Pick a date" opens a month grid; picking Tue 10 Nov closes it, the chip reads "Tue 10 Nov", and it saves that day', async () => {
    const { layer, controls } = couple();
    const { container } = show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '3' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    const picker = await pickADate(sheet);
    expect(document.querySelector('input[type="date"]'), 'no browser date input').toBeNull();
    // TODAY is Sat 14 Nov 2026: it is marked as today.
    expect(within(picker).getByRole('button', { name: 'Sat 14 Nov' }).getAttribute('aria-current')).toBe('date');
    fireEvent.click(within(picker).getByRole('button', { name: 'Tue 10 Nov' }));
    await pickerGone();
    expect(isPressed(dateChip(sheet, 'Tue 10 Nov'))).toBe(true);
    expect(isPressed(dateChip(sheet, 'Today'))).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save', hidden: true }));
    await settle(layer);
    expect(controls.tables.expenses.map((e) => [e.description, e.date])).toEqual([['Milk', '2026-11-10']]);
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('Q-L13 Q-F2: days after today are disabled in the grid', async () => {
    const { layer } = couple();
    show(layer);
    const picker = await pickADate(await openAddSheet());
    expect(isDisabled(within(picker).getByRole('button', { name: 'Sun 15 Nov' }))).toBe(true);
    expect(isDisabled(within(picker).getByRole('button', { name: 'Mon 30 Nov' }))).toBe(true);
    expect(isDisabled(within(picker).getByRole('button', { name: 'Fri 13 Nov' }))).toBe(false);
  });

  it('Q-L13: picking today in the grid selects "Today" (the third chip stays "Pick a date")', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.click(within(within(sheet).getByRole('group', { name: 'Date' })).getByRole('button', { name: 'Yesterday' }));
    const picker = await pickADate(sheet);
    fireEvent.click(within(picker).getByRole('button', { name: 'Sat 14 Nov' }));
    await pickerGone();
    expect(isPressed(dateChip(sheet, 'Today'))).toBe(true);
    expect(isPressed(dateChip(sheet, 'Pick a date'))).toBe(false);
  });

  it('Q-L13: "Previous month" shows October (Sat 31 Oct can be picked)', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '4' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Pumpkin' } });
    const picker = await pickADate(sheet);
    fireEvent.click(within(picker).getByRole('button', { name: 'Previous month' }));
    fireEvent.click(await within(picker).findByRole('button', { name: 'Sat 31 Oct' }));
    await pickerGone();
    expect(isPressed(dateChip(sheet, 'Sat 31 Oct'))).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save', hidden: true }));
    await settle(layer);
    expect(controls.tables.expenses.map((e) => e.date)).toEqual(['2026-10-31']);
  });
});

// ─────────────────────────────── Q-U5 ───────────────────────────────

describe('Q-U5 SPL-1 MB-1: splits say who', () => {
  it('Q-U5 SPL-1: one radiogroup "How it’s shared" with names (50/50 · Jae 60 · Sam 40 · Jae 40 · Sam 60 · Other) and the other ways; no "Split" radiogroup, no slider', async () => {
    const { layer } = couple();
    const { container } = show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).getAllByText('How it’s shared').length, 'the heading says "How it’s shared"').toBeGreaterThanOrEqual(1);
    const group = shared(sheet);
    for (const name of ['50/50', 'Jae 60 · Sam 40', 'Jae 40 · Sam 60', 'Other', 'Exact', 'For Sam', 'My treat']) {
      expect(within(group).getByRole('radio', { name }), name).toBeTruthy();
    }
    expect(isChecked(within(group).getByRole('radio', { name: '50/50' }))).toBe(true);
    expect(within(sheet).queryByRole('radiogroup', { name: 'Split' })).toBeNull();
    expect(container.ownerDocument.querySelector('input[type="range"]'), 'no native slider').toBeNull();
  });

  it('Q-U5 SPL-1 SPL-4: the meaning never flips when the payer changes: "Jae 60 · Sam 40" stays Jae 60 / Sam 40 with Sam paying', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    fireEvent.click(within(shared(sheet)).getByRole('radio', { name: 'Jae 60 · Sam 40' }));
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).getByRole('radio', { name: 'Sam' }));
    expect(isChecked(within(shared(sheet)).getByRole('radio', { name: 'Jae 60 · Sam 40' })), 'the chosen split is still Jae 60 · Sam 40').toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    const [milk] = controls.tables.expenses;
    expect(milk?.paid).toMatchObject({ [SAM_ID]: 1000 });
    expect(milk?.shares).toMatchObject({ [JAE_ID]: 600, [SAM_ID]: 400 });
  });

  it('Q-U5 SPL-1: editing an entry split Jae 60 / Sam 40 that Sam paid shows "Jae 60 · Sam 40" chosen', async () => {
    const row = storedExpense({
      description: 'Rug', amount_pence: 1000, paid: { [SAM_ID]: 1000 }, split_params: { [JAE_ID]: 60, [SAM_ID]: 40 }, shares: { [JAE_ID]: 600, [SAM_ID]: 400 },
    });
    const { layer } = couple({ expenses: [row] });
    at(`/entry/${row.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Rug' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' });
    expect(isChecked(within(shared(sheet)).getByRole('radio', { name: 'Jae 60 · Sam 40' }))).toBe(true);
  });

  it('SPL-1 (fresh review): the 70/30 presets and their reverse are offered as named chips', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    for (const name of ['Jae 70 · Sam 30', 'Jae 30 · Sam 70']) {
      expect(within(shared(sheet)).getByRole('radio', { name }), name).toBeTruthy();
    }
  });

  it('Q-U5 (fresh review): a split that started off the chips keeps its stepper while stepping past a preset', async () => {
    const row = storedExpense({
      description: 'Lamp', amount_pence: 1000, paid: { [JAE_ID]: 1000 }, split_params: { [JAE_ID]: 55, [SAM_ID]: 45 }, shares: { [JAE_ID]: 550, [SAM_ID]: 450 },
    });
    const { layer } = couple({ expenses: [row] });
    at(`/entry/${row.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'More for Jae' }));
    expect(within(sheet).getAllByText('Jae 60 · Sam 40').length).toBeGreaterThanOrEqual(1);
    expect(within(sheet).getByRole('button', { name: 'More for Jae' }), 'the stepper stays under the finger').toBeTruthy();
    expect(isChecked(within(shared(sheet)).getByRole('radio', { name: 'Other' }))).toBe(true);
  });

  it('Q-U5 Q-L13 SPL-1: "Other" is a −/+ stepper in 5 % steps ("Jae 45 · Sam 55" saves £9.00 / £11.00 of £20.00)', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Plants' } });
    fireEvent.click(within(shared(sheet)).getByRole('radio', { name: 'Other' }));
    const more = await within(sheet).findByRole('button', { name: 'More for Jae' });
    const less = within(sheet).getByRole('button', { name: 'Less for Jae' });
    fireEvent.click(more);
    expect(within(sheet).getAllByText('Jae 55 · Sam 45').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(less);
    fireEvent.click(less);
    expect(within(sheet).getAllByText('Jae 45 · Sam 55').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('input[type="range"]')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    expect(controls.tables.expenses[0]?.shares).toMatchObject({ [JAE_ID]: 900, [SAM_ID]: 1100 });
  });

  it('Q-U5 ADD-2: the quick-add reading names a ratio, payer first ("Sam paid · Sam 60 · Jae 40"); an even split stays "50/50"', async () => {
    const { layer } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '30 Dinner sam paid 60/40' } });
    expect(screen.getByRole('button', { name: /Sam paid · Sam 60 · Jae 40$/ })).toBeTruthy();
    fireEvent.change(box, { target: { value: '42.50 Tesco' } });
    expect(screen.getByRole('button', { name: '£42.50 · Tesco · Groceries · Jae paid · 50/50' })).toBeTruthy();
  });

  it('Q-U5 MB-1: in Money back the options read "All Jae’s" / "All Sam’s"; "All Sam’s" puts all of it on Sam', async () => {
    const { layer, controls } = couple({ expenses: [storedExpense()] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    const group = shared(sheet);
    expect(within(group).getByRole('radio', { name: 'All Jae’s' })).toBeTruthy();
    expect(within(group).queryByRole('radio', { name: 'For Sam' })).toBeNull();
    expect(within(group).queryByRole('radio', { name: 'My treat' })).toBeNull();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } });
    fireEvent.click(within(group).getByRole('radio', { name: 'All Sam’s' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    const back = controls.tables.expenses.find((e) => e.kind === 'money_back');
    expect(back?.paid).toMatchObject({ [JAE_ID]: 1000 });
    expect(Object.fromEntries(Object.entries(back?.shares ?? {}).filter(([, v]) => v !== 0))).toEqual({ [SAM_ID]: 1000 });
  });
});

// ─────────────────────────────── Q-L14 ───────────────────────────────

describe('Q-L14 ADD-4: "More details" is a disclosure row', () => {
  it('Q-L14: button "More details" with aria-expanded and a chevron; it opens Notes', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('button', { name: 'More' })).toBeNull();
    const more = within(sheet).getByRole('button', { name: 'More details' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.querySelector('svg'), 'the chevron').not.toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Notes' })).toBeNull();
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(within(sheet).getByRole('textbox', { name: 'Notes' })).toBeTruthy();
  });
});

// ─────────────────────────────── Q-U6 ───────────────────────────────

describe('Q-U6 ADD-1 ADD-2 TXT-1: quick add while typing', () => {
  it('Q-U6 ADD-1: a Save button appears in the box once the reading is complete, and saves', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    const form = box.closest('form') as HTMLFormElement;
    expect(within(form).queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.change(box, { target: { value: '30 dinner 70/30 for sam' } }); // not confident (Q-F3): no Save
    expect(within(form).queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.change(box, { target: { value: '42.50 Tesco' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await settle(layer);
    expect(controls.tables.expenses.map((e) => [e.description, e.amount_pence])).toEqual([['Tesco', 4250]]);
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('Q-U6 TXT-1: descriptions are saved tidy: "tesco" → "Tesco", "bread" → "Bread", the merchant list\'s spelling ("ikea" → "IKEA", "easyjet" → "easyJet"); Hangul untouched', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    for (const typed of ['42.50 tesco', '2 bread', '80 ikea', '120 easyjet', '15 이마트', '5 Tesco']) {
      fireEvent.change(box, { target: { value: typed } });
      fireEvent.submit(box.closest('form') as HTMLFormElement);
      await waitFor(() => { expect((box as HTMLInputElement).value).toBe(''); });
    }
    await settle(layer);
    expect(controls.tables.expenses.map((e) => e.description).sort()).toEqual(['Bread', 'IKEA', 'Tesco', 'Tesco', 'easyJet', '이마트'].sort());
  });

  it('Q-U6 ADD-2: the reading and the form opened from it show the same tidy description', async () => {
    const { layer } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42.50 tesco' } });
    expect(screen.getByRole('button', { name: '£42.50 · Tesco · Groceries · Jae paid · 50/50' })).toBeTruthy();
    fireEvent.change(box, { target: { value: '12 pret 60/40 yesterday' } });
    fireEvent.click(screen.getByRole('button', { name: /^£12\.00 · Pret · / }));
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Pret');
  });
});

// ─────────────────────────────── Q-U7 ───────────────────────────────

describe('Q-U7 ACT-1: Home shows the ledger ("Recent", by day)', () => {
  it('Q-U7: "Recent" groups the last entries and settle-ups under Today, Yesterday, Tue 10 Nov; never "Nothing today yet"', async () => {
    const { layer } = couple({
      expenses: [
        storedExpense({ id: E(1), description: 'Lamp', date: TODAY }),
        storedExpense({ id: E(2), description: 'Bread', date: YESTERDAY, amount_pence: 300, paid: { [JAE_ID]: 300 }, shares: { [JAE_ID]: 150, [SAM_ID]: 150 } }),
        storedExpense({ id: E(3), description: 'Rent', date: '2026-11-10' }),
      ],
      settlements: [storedSettlement({ date: YESTERDAY })],
    });
    show(layer);
    const recent = await screen.findByRole('heading', { name: 'Recent', level: 2 });
    const section = recent.closest('section') as HTMLElement;
    expect(within(section).getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Yesterday' })).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Tue 10 Nov' })).toBeTruthy();
    expect(within(within(section).getByRole('list', { name: 'Today' })).getByText('Lamp')).toBeTruthy();
    const yesterday = within(section).getByRole('list', { name: 'Yesterday' });
    expect(within(yesterday).getByText('Bread')).toBeTruthy();
    expect(within(yesterday).getByText('Sam paid Jae £5.00')).toBeTruthy();
    expect(screen.queryByText(/Nothing today yet/)).toBeNull();
  });

  it('Q-U7: nothing today but history: yesterday\'s rows show, not "Nothing today yet"', async () => {
    const { layer } = couple({ expenses: [storedExpense({ id: E(2), description: 'Bread', date: YESTERDAY })] });
    show(layer);
    await screen.findByRole('heading', { name: 'Recent', level: 2 });
    expect(within(screen.getByRole('list', { name: 'Yesterday' })).getByText('Bread')).toBeTruthy();
    expect(screen.queryByText(/Nothing today yet/)).toBeNull();
  });

  it('Q-U7: only the last few (chosen: at most 5, newest first) with "See all"', async () => {
    const expenses = Array.from({ length: 9 }, (_, i) => storedExpense({
      id: E(10 + i), description: `Thing ${String(i + 1)}`, created_at: `2026-11-14T0${String(i)}:00:00.000Z`, updated_at: `2026-11-14T0${String(i)}:00:00.000Z`,
    }));
    const { layer } = couple({ expenses });
    show(layer);
    const section = (await screen.findByRole('heading', { name: 'Recent', level: 2 })).closest('section') as HTMLElement;
    const rows = within(section).getAllByRole('listitem');
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]?.textContent).toContain('Thing 9');
    expect(within(section).getByRole('link', { name: 'See all' })).toBeTruthy();
  });

  it('Q-U7 SET-5: square after a settle-up today, the balance keeps a quiet "Settled up today" line', async () => {
    const { layer } = couple({ expenses: [storedExpense()], settlements: [storedSettlement({ amount_pence: 2000 })] });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await within(balance).findByText('All square');
    expect(within(balance).getByText('Settled up today')).toBeTruthy();
  });
});

// ─────────────────────────────── Q-U8 ───────────────────────────────

describe('Q-U8 ADD-6 ADD-7 MB-2: toasts say what happened', () => {
  it('Q-U8 ADD-6: quick add says "Saved Tesco £42.50"; Undo says "Removed Tesco"', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42.50 tesco' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Saved Tesco £42\.50/); });
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Undo' }));
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Removed Tesco/); });
    await settle(layer);
    expect(controls.tables.expenses.every((e) => e.deleted_at !== null)).toBe(true);
  });

  it('Q-U8 ADD-6: the Add sheet says "Saved Milk £3.00"', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '3' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Saved Milk £3\.00/); });
  });

  it('Q-U8 ADD-7 ADD-6 (owner, 17 Nov): Duplicate says "Copied to today" with Undo, which removes only the copy', async () => {
    const original = storedExpense({ date: '2026-11-10' });
    const { layer, controls } = couple({ expenses: [original] });
    at(`/entry/${original.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Copied to today/); });
    expect(within(toasts()).queryByRole('button', { name: 'Open' })).toBeNull();
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Undo' }));
    await settle(layer);
    const copy = controls.tables.expenses.find((e) => e.id !== original.id);
    expect(copy?.date).toBe(TODAY);
    expect(copy?.deleted_at, 'the copy is removed (soft delete)').not.toBeNull();
    expect(controls.tables.expenses.find((e) => e.id === original.id)?.deleted_at ?? null, 'the original stays').toBeNull();
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Removed Lamp/); });
    expect(location.pathname).toBe(`/entry/${original.id}`);
  });

  it('Q-U8 MB-2: Money back says "Money back saved"', async () => {
    const { layer } = couple({ expenses: [storedExpense()] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '5' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(toasts().textContent).toMatch(/^Money back saved/); });
  });
});

// ─────────────────────────────── Q-U9 ───────────────────────────────

describe('Q-U9 ACT-2 MB-2: the entry page says what it means', () => {
  it('Q-U9: "Sam owes Jae £21.25 for this" under the split line', async () => {
    const row = storedExpense({ amount_pence: 4250, paid: { [JAE_ID]: 4250 }, shares: { [JAE_ID]: 2125, [SAM_ID]: 2125 } });
    const { layer } = couple({ expenses: [row] });
    at(`/entry/${row.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    const split = screen.getByText('Jae paid. Jae £21.25, Sam £21.25');
    const owes = screen.getByText('Sam owes Jae £21.25 for this');
    expect(split.compareDocumentPosition(owes) & Node.DOCUMENT_POSITION_FOLLOWING, 'after the split line').toBeTruthy();
  });

  it('Q-U9: paid for the other: "Jae owes Sam £9.00 for this"; a treat owes nothing', async () => {
    const forJae = storedExpense({ id: E(5), description: 'Flowers', amount_pence: 900, paid: { [SAM_ID]: 900 }, split_mode: 'for_other', split_params: {}, shares: { [JAE_ID]: 900 } });
    const treat = storedExpense({ id: E(6), description: 'Cake', amount_pence: 600, paid: { [JAE_ID]: 600 }, split_mode: 'treat', split_params: {}, shares: { [JAE_ID]: 600 } });
    const { layer } = couple({ expenses: [forJae, treat] });
    at(`/entry/${forJae.id}`);
    const view = show(layer);
    await screen.findByRole('heading', { name: 'Flowers' });
    expect(screen.getByText('Jae owes Sam £9.00 for this')).toBeTruthy();
    view.unmount();
    at(`/entry/${treat.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Cake' });
    expect(screen.queryByText(/owes .* for this/)).toBeNull();
  });

  it('Q-U9 MB-2: a refunded original shows "£20.00 came back · Today", linking to the money back', async () => {
    const original = storedExpense();
    const back = storedExpense({
      id: E(9), kind: 'money_back', description: 'Lamp', amount_pence: 2000, paid: { [JAE_ID]: 2000 }, shares: { [JAE_ID]: 1000, [SAM_ID]: 1000 },
      refund_of: original.id, date: TODAY, created_at: '2026-11-14T10:00:00.000Z', updated_at: '2026-11-14T10:00:00.000Z',
    });
    const { layer } = couple({ expenses: [original, back] });
    at(`/entry/${original.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    const link = screen.getByRole('link', { name: '£20.00 came back · Today' });
    expect(link.getAttribute('href')).toBe(`/entry/${back.id}`);
    fireEvent.click(link);
    await waitFor(() => { expect(location.pathname).toBe(`/entry/${back.id}`); });
  });

  const activity = (over: Partial<ActivityRow>): ActivityRow => ({
    id: 1, household_id: '00000000-0000-4000-8000-0000000000c1', actor: JAE_ID, entity: 'expense', entity_id: storedExpense().id,
    action: 'created', summary: {}, at: '2026-11-14T12:02:00.000Z', ...over,
  });

  it('Q-U9 ACT-2: the history line reads "Jae added this, today <time>"', async () => {
    const { layer } = couple({ expenses: [storedExpense()], activity: [activity({})] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    const region = await screen.findByRole('region', { name: 'History' });
    await within(region).findByText(/^Jae added this, today \d\d:\d\d$/);
    expect(region.textContent).not.toContain('added it');
  });

  it('Q-U9 ACT-2: history runs oldest first, so it starts with who added it', async () => {
    const { layer } = couple({
      expenses: [storedExpense()],
      activity: [
        activity({}),
        activity({ id: 2, actor: SAM_ID, action: 'edited', at: '2026-11-14T13:30:00.000Z', summary: { description: { before: 'Lmap', after: 'Lamp' } } }),
      ],
    });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    const region = await screen.findByRole('region', { name: 'History' });
    await within(region).findByText(/^Sam changed/);
    const lines = within(region).getAllByRole('listitem').map((li) => li.textContent.trim());
    expect(lines[0]).toMatch(/^Jae added this, /);
    expect(lines[1]).toMatch(/^Sam changed /);
  });
});

// ─────────────────────────────── Q-L15 ───────────────────────────────

describe('Q-L15 ACT-1 BAL-3: Activity rows and the plank say who', () => {
  it('Q-L15 ACT-1: a row\'s accessible name includes who paid ("Big shop, £79.08, Jae paid")', async () => {
    const row = storedExpense({ description: 'Big shop', amount_pence: 7908, paid: { [JAE_ID]: 7908 }, shares: { [JAE_ID]: 3954, [SAM_ID]: 3954 } });
    const { layer } = couple({ expenses: [row] });
    at('/activity');
    show(layer);
    expect(await screen.findByRole('link', { name: 'Big shop, £79.08, Jae paid' })).toBeTruthy();
  });

  it('Q-L15 BAL-3: the plank names people ("Jae, the cat, is owed; Sam, the dog, owes")', async () => {
    const { layer } = couple({ expenses: [storedExpense()] });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await within(balance).findByText((_, el) => el?.textContent === 'Sam owes Jae £20.00');
    expect(within(balance).getByRole('img', { name: 'Jae, the cat, is owed; Sam, the dog, owes' })).toBeTruthy();
  });
});

// ─────────────────────────────── Q-U10 ───────────────────────────────

describe('Q-U10 ACT-1: Activity filters are easy to undo', () => {
  async function activity(expenses = [storedExpense()]) {
    const { layer } = couple({ expenses });
    at('/activity');
    show(layer);
    await screen.findByRole('searchbox', { name: 'Search' });
    return layer;
  }
  // `hidden`: a picker sheet that just closed lingers in jsdom and hides the page behind it for a moment.
  const filters = () => screen.getByRole('group', { name: 'Filters', hidden: true });

  it('Q-U10: an empty result offers "Clear filters", which brings everything back', async () => {
    await activity();
    await screen.findByText('Lamp');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'zzz' } });
    await waitFor(() => { expect(screen.queryByText('Lamp')).toBeNull(); });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Lamp')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' }).value).toBe('');
  });

  it('Q-U10: a "Clear all" chip shows whenever a filter is on, and clears them', async () => {
    await activity();
    await screen.findByText('Lamp');
    expect(within(filters()).queryByRole('button', { name: 'Clear all' })).toBeNull();
    fireEvent.click(within(filters()).getByRole('button', { name: 'Type' }));
    const picker = await screen.findByRole('dialog', { name: 'Type' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Money back' }));
    const clear = await within(filters()).findByRole('button', { name: 'Clear all', hidden: true });
    fireEvent.click(clear);
    await waitFor(() => { expect(within(filters()).getByRole('button', { name: 'Type', hidden: true })).toBeTruthy(); });
    expect(within(filters()).queryByRole('button', { name: 'Clear all', hidden: true })).toBeNull();
    expect(await screen.findByText('Lamp')).toBeTruthy();
  });

  it('Q-U10 ACT-1: Dates offers "Last 7 days" (today and the six days before) and "Pick dates"', async () => {
    await activity([
      storedExpense({ id: E(1), description: 'Lamp', date: TODAY }),
      storedExpense({ id: E(2), description: 'Kettle', date: '2026-11-08' }),
      storedExpense({ id: E(3), description: 'Toaster', date: '2026-11-07' }),
    ]);
    await screen.findByText('Toaster');
    fireEvent.click(within(filters()).getByRole('button', { name: 'Dates' }));
    const picker = await screen.findByRole('dialog', { name: 'Dates' });
    expect(within(picker).getByRole('radio', { name: 'Pick dates' })).toBeTruthy();
    fireEvent.click(within(picker).getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() => { expect(screen.queryByText('Toaster')).toBeNull(); });
    expect(screen.getByText('Lamp')).toBeTruthy();
    expect(screen.getByText('Kettle')).toBeTruthy();
  });
});

// ─────────────────────────────── Q-U11 ───────────────────────────────

describe('Q-U11 SET-1 SET-2 SET-3 PPL-5: Settings and Settle up say who', () => {
  it('Q-U11 SET-2: the monzo.me name shows "Sam will pay you at monzo.me/jaetest"; "Usual split" is not under "Paying each other"', async () => {
    const { layer } = couple();
    at('/settings');
    show(layer);
    const paying = await screen.findByRole('region', { name: 'Paying each other' });
    expect(await within(paying).findByText('Sam will pay you at monzo.me/jaetest')).toBeTruthy();
    expect(within(paying).queryByText('Usual split')).toBeNull();
    expect(screen.getByText('Usual split')).toBeTruthy();
  });

  it('Q-U11 SET-2: "@jaepark" is accepted: the check line follows as you type and it is saved without the "@"', async () => {
    const { layer, controls } = couple();
    at('/settings');
    show(layer);
    const field = await screen.findByRole('textbox', { name: 'monzo.me name' });
    fireEvent.change(field, { target: { value: '@jaepark' } });
    expect(screen.getByText('Sam will pay you at monzo.me/jaepark')).toBeTruthy();
    fireEvent.blur(field);
    await settle(layer);
    await waitFor(() => { expect(controls.tables.members.find((m) => m.user_id === JAE_ID)?.monzo_me).toBe('jaepark'); });
  });

  it('Q-U11 SET-1: Settle up for the person owed reads "Sam paid Jae" and "Record Sam’s payment", and records Sam → Jae', async () => {
    const { layer, controls } = couple({ expenses: [storedExpense()] });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    fireEvent.click(await within(balance).findByRole('button', { name: 'Settle up' }));
    const sheet = await screen.findByRole('dialog', { name: 'Settle up' });
    expect(within(sheet).getByText('Sam paid Jae')).toBeTruthy();
    expect(within(sheet).queryByText('Sam pays Jae')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Record it' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Record Sam’s payment' }));
    await settle(layer);
    expect(controls.tables.settlements.map((s) => [s.from_user, s.to_user, s.amount_pence])).toEqual([[SAM_ID, JAE_ID, 2000]]);
  });

  it('Q-U11 SET-1: the one who owes still reads "Sam pays Jae"; the button names Sam’s payment (S9a fix 15, was "Record it")', async () => {
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    fireEvent.click(await within(balance).findByRole('button', { name: 'Settle up' }));
    const sheet = await screen.findByRole('dialog', { name: 'Settle up' });
    expect(within(sheet).getByText('Sam pays Jae')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Record Sam’s payment' })).toBeTruthy();
  });

  it('Q-U11 SET-3: editing a settle-up is titled "Edit settle-up"', async () => {
    const row = storedSettlement();
    const { layer } = couple({ expenses: [storedExpense()], settlements: [row] });
    at(`/entry/${row.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Sam paid Jae £5.00' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit settle-up' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Settle up' })).toBeNull();
  });
});
