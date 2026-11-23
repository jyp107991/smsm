/**
 * S2 polish wave 1a (docs/slices/S2-polish.md) on the real screens over the in-memory Api: Q-F1, Q-F2, Q-F3,
 * Q-F5, Q-U1, Q-U2, Q-U3. Written before the fix (ENGINEERING §5: tests first, by someone else). The browser
 * half (real double taps 0–15 ms apart, Enter held, implicit form submission) is tests/e2e/polish1a.spec.ts.
 *
 * Interfaces these tests expect (new or changed):
 *
 *   addExpense / addSettlement take `{ ...draft, id }` (src/data/polish1a.test.ts): each sheet, the entry
 *   page's Duplicate and "Did it go through?" make the row id once and ignore a submit after the first.
 *
 *   src/screens/settle/monzo.ts (Q-U2): the "Did it go through?" question is kept in IndexedDB, not
 *   sessionStorage, so it survives the app being closed:
 *     savePending(p: PendingMonzo | null): Promise<void>   // resolves once stored; null forgets it
 *     loadPending(): Promise<PendingMonzo | null>
 *   stored through `idbStorage()` (src/data/storage.ts: idb-keyval, database "smsm", store "cache") under the
 *   key "smsm-monzo-pending" as JSON. The app reads it when it opens: a question never answered opens
 *   "Did it go through?"; after "Not yet" Home shows a quiet banner until it is answered:
 *     "Did Sam’s £20.00 to Jae go through?"  with buttons "Yes" · "Not yet" · "Forget it".
 *   Yes records the settle-up (method monzo) and forgets the question; Forget it only forgets it. Signing out
 *   forgets it too (as now).
 *
 * jsdom has no IndexedDB, so idb-keyval is replaced by an in-memory one that outlives a render
 * (tests/fixtures/fake-idb-keyval.ts).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { DataProvider, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';
import * as monzoModule from './settle/monzo';
import type { PendingMonzo } from './settle/monzo';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Q-U2: the pending question's store, as the brief asks for it (async, IndexedDB). */
const monzo = monzoModule as unknown as {
  savePending(p: PendingMonzo | null): Promise<void>;
  loadPending(): Promise<PendingMonzo | null>;
};

let open: DataLayer | null = null;
beforeEach(async () => {
  // A sheet the last test left closing takes its history entry back a moment later: let that land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  idbData.clear();
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

/** The app is closed: the screens go, the data layer stops, and this tab's sessionStorage is gone. */
async function closeApp(unmount: () => void) {
  unmount();
  await open?.dispose();
  open = null;
  sessionStorage.clear();
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

/** Two taps on the same button before the screen can change (a double tap, or Enter held down). */
function doubleTap(el: HTMLElement) {
  act(() => {
    el.click();
    el.click();
  });
}

async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}

const SAMS_20: PendingMonzo = { from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null };
const BANNER = 'Did Sam’s £20.00 to Jae go through?';

/**
 * The banner holding this sentence: the nearest element around it that also holds "Forget it". (`hidden`:
 * while the closing sheet lingers in jsdom the page behind it is still hidden from the accessibility tree.)
 */
function bannerAround(text: HTMLElement): HTMLElement {
  let el: HTMLElement | null = text;
  while (el && !within(el).queryByRole('button', { name: 'Forget it', hidden: true })) el = el.parentElement;
  if (!el) throw new Error(`no "Forget it" button around "${text.textContent}"`);
  return el;
}

describe('Q-F1 ADD-6 SET-1 MB-2: a double tap records once', () => {
  it('Q-F1 ADD-6: Save tapped twice in the Add expense sheet saves one entry', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '3' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    doubleTap(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === 'Milk')).toHaveLength(1);
    expect(layer.balance()[JAE_ID]).toBe(150);
  });

  it('Q-F1 ADD-6: Enter twice in Description saves one entry', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '4' } });
    const description = within(sheet).getByRole('textbox', { name: 'Description' });
    fireEvent.change(description, { target: { value: 'Bread' } });
    const form = description.closest('form') as HTMLFormElement;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === 'Bread')).toHaveLength(1);
  });

  it('Q-F1 MB-2: Save tapped twice in Money back saves one refund', async () => {
    const { layer, controls } = couple({ expenses: [storedExpense()] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } });
    doubleTap(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.kind === 'money_back')).toHaveLength(1);
    // £20.00 owed for the lamp, less £5.00 back once.
    expect(layer.balance()[JAE_ID]).toBe(1500);
  });

  it('Q-F1 ADD-7: Duplicate tapped twice makes one copy', async () => {
    const { layer, controls } = couple({ expenses: [storedExpense()] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    doubleTap(screen.getByRole('button', { name: 'Duplicate' }));
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === 'Lamp')).toHaveLength(2);
  });

  it('Q-F1 SET-1: Record (Sam’s payment) tapped twice records one settle-up', async () => {
    const { layer, controls } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    fireEvent.click(await within(balance).findByRole('button', { name: 'Settle up' }));
    const sheet = await screen.findByRole('dialog', { name: 'Settle up' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '5' } });
    // S9a (fix 15): the button names whoever pays (was "Record it").
    doubleTap(within(sheet).getByRole('button', { name: 'Record Sam’s payment' }));
    await settle(layer);
    expect(controls.tables.settlements).toHaveLength(1);
    expect(layer.balance()[SAM_ID]).toBe(-1500);
  });

  it('Q-F1 SET-2: "Yes" tapped twice on "Did it go through?" records one settle-up', async () => {
    await monzo.savePending(SAMS_20);
    const { layer, controls } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    doubleTap(within(asked).getByRole('button', { name: 'Yes' }));
    await settle(layer);
    expect(controls.tables.settlements).toHaveLength(1);
    expect(layer.balance()[SAM_ID]).toBe(0);
  });
});

describe('Q-F2: a date after the phone\'s today is refused in the form', () => {
  // Was: typed 2026-11-15 into the native date input and expected an alert on Save. S2 polish wave 2 (Q-L13)
  // replaces that input with an in-app month grid whose days after today are disabled, so tomorrow can no
  // longer be chosen at all; the rule (Q-F2) is now checked there.
  it('Q-F2 Q-L13 ADD-4 DAT-2: tomorrow cannot be picked (disabled in the month grid) and nothing is saved for it; today still saves', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '3' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pick a date' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick a date' });
    const tomorrow = within(picker).getByRole('button', { name: 'Sun 15 Nov' });
    expect((tomorrow as HTMLButtonElement).disabled || tomorrow.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(tomorrow);
    await settle(layer);
    expect(controls.tables.expenses).toHaveLength(0);
    expect(within(within(sheet).getByRole('group', { name: 'Date', hidden: true })).queryByRole('button', { name: 'Sun 15 Nov', hidden: true })).toBeNull();
    // Today: it saves.
    fireEvent.click(within(picker).getByRole('button', { name: 'Sat 14 Nov' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull(); }, { timeout: 3000 });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save', hidden: true }));
    await settle(layer);
    expect(controls.tables.expenses.map((e) => [e.description, e.date])).toEqual([['Milk', TODAY]]);
  });
});

describe('Q-F3 ADD-1: "70/30 for sam" is not read as Sam paying', () => {
  it('Q-F3 ADD-1: Enter opens the form (the reading is not confident) with Jae as the payer; nothing is saved', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '30 dinner 70/30 for sam' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).getByRole('radio', { name: 'Jae' }).getAttribute('aria-checked')).toBe('true');
    await settle(layer);
    expect(controls.tables.expenses).toHaveLength(0);
  });
});

describe('Q-F5 MB-1 MB-2: Refund this on an exact split starts as the same proportion', () => {
  const exact = (over: Parameters<typeof storedExpense>[0] = {}) => storedExpense({
    description: 'Shoes', amount_pence: 1000, paid: { [JAE_ID]: 1000 }, split_mode: 'exact',
    split_params: { [JAE_ID]: 300, [SAM_ID]: 700 }, shares: { [JAE_ID]: 300, [SAM_ID]: 700 }, ...over,
  });

  async function refund(layer: DataLayer, row: ReturnType<typeof exact>, amount: string) {
    at(`/entry/${row.id}`);
    show(layer);
    await screen.findByRole('heading', { name: row.description });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: amount } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    return sheet;
  }

  it('Q-F5 MB-1: £10.00 split £3.00 / £7.00, £5.00 back: saves at once as £1.50 / £3.50', async () => {
    const row = exact();
    const { layer, controls } = couple({ expenses: [row] });
    const sheet = await refund(layer, row, '5');
    expect(within(sheet).queryByRole('alert')).toBeNull();
    const back = controls.tables.expenses.filter((e) => e.kind === 'money_back');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ refund_of: row.id, amount_pence: 500, paid: { [JAE_ID]: 500 }, shares: { [JAE_ID]: 150, [SAM_ID]: 350 } });
  });

  it('Q-F5 SPL-3: largest remainder in pence, a tie goes to whoever paid (Jae)', async () => {
    const row = exact({ amount_pence: 200, paid: { [JAE_ID]: 200 }, split_params: { [JAE_ID]: 100, [SAM_ID]: 100 }, shares: { [JAE_ID]: 100, [SAM_ID]: 100 } });
    const { layer, controls } = couple({ expenses: [row] });
    await refund(layer, row, '0.03');
    expect(controls.tables.expenses.find((e) => e.kind === 'money_back')).toMatchObject({ amount_pence: 3, shares: { [JAE_ID]: 2, [SAM_ID]: 1 } });
  });

  it('Q-F5 SPL-3: a tie goes to whoever paid (Sam)', async () => {
    const row = exact({ paid: { [SAM_ID]: 1000 }, created_by: SAM_ID });
    const { layer, controls } = couple({ expenses: [row] });
    // 5p of £3.00 / £7.00 is 1.5p / 3.5p: the leftover penny is Sam's.
    await refund(layer, row, '0.05');
    expect(controls.tables.expenses.find((e) => e.kind === 'money_back')).toMatchObject({ amount_pence: 5, paid: { [SAM_ID]: 5 }, shares: { [JAE_ID]: 1, [SAM_ID]: 4 } });
  });
});

describe('Q-U1: Enter moves on through the form; only Enter in Description (or Save) saves', () => {
  it('Q-U1 ADD-4: Enter in Amount moves to Description and saves nothing', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    const amount = within(sheet).getByRole('textbox', { name: 'Amount' });
    const description = within(sheet).getByRole('textbox', { name: 'Description' });
    fireEvent.change(description, { target: { value: 'Milk' } });
    amount.focus();
    fireEvent.change(amount, { target: { value: '3' } });
    fireEvent.keyDown(amount, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(description);
    await settle(layer);
    expect(controls.tables.expenses).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Add expense' })).toBeTruthy();
  });

  it('Q-U1 SPL-1: Enter in the first Exact share moves to the second', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } });
    fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: 'How it’s shared' })).getByRole('radio', { name: 'Exact' }));
    const first = within(sheet).getByRole('textbox', { name: "Jae's share" });
    const second = within(sheet).getByRole('textbox', { name: "Sam's share" });
    first.focus();
    fireEvent.change(first, { target: { value: '4' } });
    fireEvent.keyDown(first, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(second);
  });

  it('Q-U1 TXT-2: Enter while composing in Amount still moves nowhere and saves nothing', async () => {
    const { layer, controls } = couple();
    show(layer);
    const sheet = await openAddSheet();
    const amount = within(sheet).getByRole('textbox', { name: 'Amount' });
    amount.focus();
    fireEvent.change(amount, { target: { value: '3' } });
    const composing = fireEvent.keyDown(amount, { key: 'Enter', keyCode: 229 });
    expect(composing).toBe(false);
    expect(document.activeElement).toBe(amount);
    await settle(layer);
    expect(controls.tables.expenses).toHaveLength(0);
  });
});

describe('Q-U2 SET-2: "Did it go through?" survives the app being closed', () => {
  it('Q-U2 SET-2: asked, then the app is closed (sessionStorage gone): the question is asked again on opening', async () => {
    await monzo.savePending(SAMS_20);
    sessionStorage.clear();
    expect(await monzo.loadPending()).toEqual(SAMS_20);
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    expect(asked.textContent).toContain('Sam’s £20.00 to Jae');
  });

  it('Q-U2 SET-2: the question is not kept in sessionStorage', async () => {
    await monzo.savePending(SAMS_20);
    expect(sessionStorage.getItem('smsm-monzo-pending')).toBeNull();
    expect(await monzo.loadPending()).toEqual(SAMS_20);
    await monzo.savePending(null);
    expect(await monzo.loadPending()).toBeNull();
  });

  it('Q-U2 SET-2: after "Not yet" a quiet Home banner stays, through a restart, until Yes records it', async () => {
    await monzo.savePending(SAMS_20);
    const first = couple({ as: 'sam', expenses: [storedExpense()] });
    const view = show(first.layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    fireEvent.click(within(asked).getByRole('button', { name: 'Not yet' }));
    const banner = bannerAround(await screen.findByText(BANNER));
    expect(within(banner).getByRole('button', { name: 'Yes', hidden: true })).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Not yet', hidden: true })).toBeTruthy();
    expect(first.controls.tables.settlements).toHaveLength(0);
    expect(await monzo.loadPending()).not.toBeNull();

    await closeApp(view.unmount);
    const second = couple({ as: 'sam', expenses: [storedExpense()] });
    show(second.layer);
    const again = bannerAround(await screen.findByText(BANNER));
    fireEvent.click(within(again).getByRole('button', { name: 'Yes', hidden: true }));
    await settle(second.layer);
    expect(second.controls.tables.settlements).toMatchObject([{ from_user: SAM_ID, to_user: JAE_ID, amount_pence: 2000, method: 'monzo' }]);
    await waitFor(() => { expect(screen.queryByText(BANNER)).toBeNull(); });
    expect(await monzo.loadPending()).toBeNull();
  });

  it('Q-U2 SET-2: "Forget it" on the banner forgets the question and records nothing', async () => {
    await monzo.savePending(SAMS_20);
    const { layer, controls } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Did it go through?' })).getByRole('button', { name: 'Not yet' }));
    const banner = bannerAround(await screen.findByText(BANNER));
    fireEvent.click(within(banner).getByRole('button', { name: 'Forget it', hidden: true }));
    await waitFor(() => { expect(screen.queryByText(BANNER)).toBeNull(); });
    await settle(layer);
    expect(controls.tables.settlements).toHaveLength(0);
    expect(await monzo.loadPending()).toBeNull();
  });
});

describe('Q-U3 ADD-1: quick add says what it needs, reads "42,50", and its key says send', () => {
  it('Q-U3: Enter with no readable amount says "Start with an amount, like 12.50"', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'tesco' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(await screen.findByText(/^Start with an amount, like 12\.50\.?$/)).toBeTruthy();
    await settle(layer);
    expect(controls.tables.expenses).toHaveLength(0);
  });

  it('Q-U3 ADD-1: "42,50 tesco" and Enter saves £42.50', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42,50 tesco' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await settle(layer);
    expect(controls.tables.expenses.map((e) => [e.description, e.amount_pence])).toEqual([['Tesco', 4250]]); // S2 polish Q-U6: saved tidy (was 'tesco')
  });

  it('Q-U3: the Quick add box\'s Enter key says "send"', async () => {
    const { layer } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    expect(box.getAttribute('enterkeyhint')).toBe('send');
  });
});
