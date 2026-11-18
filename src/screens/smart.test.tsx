/**
 * S6a screens (docs/slices/S6.md "Decisions made here", "Interfaces"; the service changed on 17 Nov to Cloudflare
 * Workers AI, the phone side unchanged): Settings → "Smart features", the Add sheet's "Scan receipt" / "Add photo",
 * reading and filling only untouched fields, Itemise and the mismatch line, "Sort it later" and the Inbox's "Receipt to
 * sort", quick add's loose wording, and the entry page's photo and "(a guess)", on the real screens over the in-memory
 * Api with a fake AI service, photo store and shrinker (tests/fixtures/smart.ts; never the network). Written before
 * the build (ENGINEERING §5, tests first by someone else). The layout half (320/390 px, both themes, axe) is
 * tests/e2e/smart.spec.ts.
 *
 * Choosing a photo: "Scan receipt" / "Add photo" open a file input (accept image/*); the test catches the input the
 * button opens (its .click()) or, failing that, takes the sheet's file input, and gives it a tiny generated image.
 * Replies (tests/ai/replies): scan-good is Tesco Express, 12 Nov, Milk £1.20, Sourdough £2.50, Bananas £0.95,
 * Washing-up liquid £1.35, Red wine £8.99, £1.00 off, total £13.99, Groceries; with the wine unticked the shared amount
 * is £5.60 (src/core/itemise.test.ts). scan-mismatch is The Crown: lines £41.20, total £42.50.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedExpense, storedInboxItem, TODAY } from '../../tests/fixtures/couple';
import { deferred, fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, recorded, type AiResult } from '../../tests/fixtures/smart';
import * as dataModule from '../data';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import type { MemoryTables } from '../data/memoryApi';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// S6a's data function, typed so this file compiles before it exists.
const data = dataModule as unknown as { setSmartFeatures(on: boolean): void };

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
  // jsdom can't make object URLs for its own Blobs; the photo's preview only needs a src.
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:smsm-test/photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await open?.dispose();
  open = null;
});

function at(path: string) {
  history.replaceState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  resetHistoryForTests();
}
function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
/** A household with the fakes; smart features on unless `smart: false`. */
function household(opts: Parameters<typeof couple>[0] & { smart?: boolean } = {}) {
  const { smart = true, ...rest } = opts;
  if (smart) data.setSmartFeatures(true);
  return couple({ photos: memoryPhotos(), downscale: fakeDownscale(), ...rest });
}

type S6Tables = MemoryTables & { receipts?: { path: string; size: number; type: string }[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S6Tables;
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el instanceof HTMLInputElement && el.checked);
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
/** A sentence whole, wherever its parts are their own elements. */
const sentence = (s: string | RegExp, scope: HTMLElement = document.body) =>
  within(scope).queryAllByText((_, el) => (el ? (typeof s === 'string' ? text(el) === s : s.test(text(el))) : false))[0] ?? null;
const PATH = new RegExp(`^${HID}/[0-9a-f-]{36}\\.jpg$`);
const ok = (d: unknown): AiResult => ({ ok: true, data: d });
const fails = (reason: 'off' | 'limit' | 'timeout' | 'invalid' | 'error'): AiResult => ({ ok: false, reason });
const COULDNT = 'Couldn’t read that. Fill it in by hand.';
const ENOUGH = 'That’s enough reading for today. Fill it in by hand.';
const READING = 'Reading the receipt…';

// ───────── getting around ─────────
async function goSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { level: 1, name: 'Settings' });
}
async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}
function openMore(sheet: HTMLElement) {
  const more = within(sheet).getByRole('button', { name: 'More details' });
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
}
/** Taps the button and gives the file input it opens a photo. */
function pickPhoto(sheet: HTMLElement, button: 'Scan receipt' | 'Add photo', file: File = receiptPhoto()) {
  const opened: HTMLInputElement[] = [];
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type === 'file') opened.push(this);
  });
  if (button === 'Add photo' && !within(sheet).queryByRole('button', { name: 'Add photo' })) openMore(sheet);
  fireEvent.click(within(sheet).getByRole('button', { name: button }));
  spy.mockRestore();
  const inputs = [...sheet.querySelectorAll<HTMLInputElement>('input[type="file"]'), ...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  const input: HTMLInputElement | undefined = opened[0] ?? inputs[0];
  if (!input) throw new Error(`no file input opened by "${button}"`);
  expect(input.accept).toMatch(/image/);
  fireEvent.change(input, { target: { files: [file] } });
}
const field = (sheet: HTMLElement, name: 'Amount' | 'Description') => within(sheet).getByRole<HTMLInputElement>('textbox', { name });
const category = (sheet: HTMLElement, name: string) => within(within(sheet).getByRole('group', { name: 'Category' })).getByRole('button', { name: new RegExp(name) });
function save(sheet: HTMLElement) {
  fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
}
async function sheetClosed() {
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
}

// ─────────────────────────────── Settings ───────────────────────────────

describe('Settings → "Smart features" (SCAN-5; S6 "One switch")', () => {
  it('SCAN-5: a switch, off by default, saying what is sent; turning it on keeps it on this phone', async () => {
    const { layer } = household({ smart: false });
    show(layer);
    await goSettings();
    const toggle = screen.getByRole('switch', { name: 'Smart features' });
    expect(isChecked(toggle)).toBe(false);
    const described = (toggle.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toContain('Reads receipts and loose wording with Cloudflare’s AI. Only the photo or the words are sent, never names or balances.');
    fireEvent.click(toggle);
    await waitFor(() => { expect(isChecked(screen.getByRole('switch', { name: 'Smart features' }))).toBe(true); });
    expect(localStorage.getItem('smsm-smart')).not.toBeNull();
  });
});

// ─────────────────────────────── SCAN-1: which button ───────────────────────────────

describe('the Add sheet’s photo buttons (SCAN-1, SCAN-5, AI.md §4 "off", "offline")', () => {
  it('SCAN-1: smart features on and online: "Scan receipt"', async () => {
    const { layer } = household({ ai: fakeAi() });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).getByRole('button', { name: 'Scan receipt' })).toBeTruthy();
  });

  it('SCAN-5: smart features off: no "Scan receipt"; "Add photo" under More details still attaches a photo', async () => {
    const { layer } = household({ smart: false, ai: fakeAi() });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('button', { name: 'Scan receipt' })).toBeNull();
    openMore(sheet);
    expect(within(sheet).getByRole('button', { name: 'Add photo' })).toBeTruthy();
  });

  it('SCAN-5: offline with smart features on: no "Scan receipt", only "Add photo"', async () => {
    const { layer } = household({ ai: fakeAi(), online: false });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('button', { name: 'Scan receipt' })).toBeNull();
    openMore(sheet);
    expect(within(sheet).getByRole('button', { name: 'Add photo' })).toBeTruthy();
  });
});

// ─────────────────────────────── SCAN-1, SCAN-5: reading and filling ───────────────────────────────

describe('scanning a receipt (SCAN-1, SCAN-5)', () => {
  it('SCAN-1 SCAN-5: "Reading the receipt…", then the form fills (place, total, category, date) with the photo kept; nothing saves until Save', async () => {
    const answer = deferred<AiResult>();
    const ai = fakeAi({ scan: () => answer.promise });
    const c = household({ ai });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    expect(await within(sheet).findByRole('img', { name: 'Receipt photo' })).toBeTruthy();
    await waitFor(() => { expect(sentence(READING, sheet)).toBeTruthy(); });
    // The form stays usable while it reads.
    expect(field(sheet, 'Amount').disabled).toBe(false);
    answer.resolve(ok(recorded('scan-good')));
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    expect(field(sheet, 'Description').value).toBe('Tesco Express');
    expect(isPressed(category(sheet, 'Groceries'))).toBe(true);
    expect(sentence(READING, sheet)).toBeNull();
    expect(within(sheet).getByRole('img', { name: 'Receipt photo' })).toBeTruthy();
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);

    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Tesco Express');
    expect(row).toMatchObject({ amount_pence: 1399, date: '2026-11-12', category_id: categoryId('Groceries'), bill_total_pence: 1399 });
    expect(row?.receipt_path).toMatch(PATH);
    expect((tablesOf(c).receipts ?? []).map((r) => r.path)).toEqual([row?.receipt_path]);
  });

  it('SCAN-1: the reading fills only what the person hasn’t touched since', async () => {
    const answer = deferred<AiResult>();
    const c = household({ ai: fakeAi({ scan: () => answer.promise }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(sentence(READING, sheet)).toBeTruthy(); });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Big shop' } });
    fireEvent.click(category(sheet, 'Household'));
    answer.resolve(ok(recorded('scan-good')));
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    expect(field(sheet, 'Description').value).toBe('Big shop');
    expect(isPressed(category(sheet, 'Household'))).toBe(true);
    expect(isPressed(category(sheet, 'Groceries'))).toBe(false);
  });

  it('SCAN-1: an amount typed while it reads is kept', async () => {
    const answer = deferred<AiResult>();
    const c = household({ ai: fakeAi({ scan: () => answer.promise }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(sentence(READING, sheet)).toBeTruthy(); });
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '12' } });
    answer.resolve(ok(recorded('scan-good')));
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('Tesco Express'); });
    expect(field(sheet, 'Amount').value).toBe('12');
  });

  for (const [reason, line] of [['timeout', COULDNT], ['error', COULDNT], ['invalid', COULDNT], ['limit', ENOUGH]] as const) {
    it(`SCAN-5: "${reason}": the photo stays, nothing is filled, one quiet line: "${line}"`, async () => {
      const c = household({ ai: fakeAi({ scan: fails(reason) }) });
      show(c.layer);
      const sheet = await openAddSheet();
      pickPhoto(sheet, 'Scan receipt');
      await waitFor(() => { expect(sentence(line, sheet)).toBeTruthy(); });
      expect(within(sheet).getByRole('img', { name: 'Receipt photo' })).toBeTruthy();
      expect(field(sheet, 'Amount').value).toBe('');
      expect(field(sheet, 'Description').value).toBe('');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // Filled by hand, it saves with its photo.
      fireEvent.change(field(sheet, 'Amount'), { target: { value: '9.50' } });
      fireEvent.change(field(sheet, 'Description'), { target: { value: 'Corner shop' } });
      save(sheet);
      await sheetClosed();
      await settle(c.layer);
      expect(c.controls.tables.expenses.find((e) => e.description === 'Corner shop')?.receipt_path).toMatch(PATH);
    });
  }

  it('SCAN-5: a low-confidence reading fills nothing: "Couldn’t read that. Fill it in by hand."', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-low-confidence')) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(sentence(COULDNT, sheet)).toBeTruthy(); });
    expect(field(sheet, 'Amount').value).toBe('');
    expect(within(sheet).getByRole('img', { name: 'Receipt photo' })).toBeTruthy();
  });

  it('TXT-5 PLC-6: a Japanese receipt on a trip keeps its name as printed and turns on "Paid in JPY" with the yen', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const rates = { rate: vi.fn(() => Promise.resolve({ date: '2026-11-13', base: 'JPY', quote: 'GBP', rate: 0.0047475 })) };
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-japanese')) }), rates });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('ローソン 京都四条店'); });
    const paidIn = within(sheet).queryByRole('switch', { name: 'Paid in JPY' }) ?? within(sheet).getByRole('checkbox', { name: 'Paid in JPY' });
    expect(isChecked(paidIn)).toBe(true);
    expect(field(sheet, 'Amount').value).toBe('648');
    await waitFor(() => { expect(sentence('¥648 = £3.08', sheet)).toBeTruthy(); });
  });
});

// ─────────────────────────────── SCAN-2, SCAN-3: Itemise ───────────────────────────────

describe('Itemise (SCAN-2, SCAN-3)', () => {
  const LINES = ['Milk £1.20', 'Sourdough £2.50', 'Bananas £0.95', 'Washing-up liquid £1.35', 'Red wine £8.99'];

  it('SCAN-2: each line ticked as shared; unticking the wine makes the amount £5.60; saved with its lines and the receipt’s total', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-good')) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    openMore(sheet);
    const group = await within(sheet).findByRole('group', { name: 'Itemise' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(5);
    for (const name of LINES) expect(isChecked(within(group).getByRole('checkbox', { name }))).toBe(true);

    fireEvent.click(within(group).getByRole('checkbox', { name: 'Red wine £8.99' }));
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('5.60'); });
    expect(isChecked(within(group).getByRole('checkbox', { name: 'Red wine £8.99' }))).toBe(false);
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Red wine £8.99' }));
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Red wine £8.99' }));
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('5.60'); });

    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Tesco Express');
    expect(row).toMatchObject({
      amount_pence: 560, bill_total_pence: 1399,
      items: [
        { label: 'Milk', pence: 120, shared: true }, { label: 'Sourdough', pence: 250, shared: true }, { label: 'Bananas', pence: 95, shared: true },
        { label: 'Washing-up liquid', pence: 135, shared: true }, { label: 'Red wine', pence: 899, shared: false },
      ],
    });
    expect(row?.shares).toEqual({ [JAE_ID]: 280, [SAM_ID]: 280 });
  });

  it('SCAN-3: lines that don’t add up: the form says both figures, fills no amount, and the person sets it', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-mismatch')) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('The Crown'); });
    openMore(sheet);
    await waitFor(() => { expect(sentence('The lines add up to £41.20 but the total says £42.50. Set the amount.', sheet)).toBeTruthy(); });
    expect(sentence(/^The lines add up to/, sheet)).toBeTruthy();
    expect(field(sheet, 'Amount').value).toBe('');
    const group = within(sheet).getByRole('group', { name: 'Itemise' });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Two pints £12.75' }));
    expect(isChecked(within(group).getByRole('checkbox', { name: 'Two pints £12.75' }))).toBe(false);
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '28.45' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'The Crown');
    expect(row).toMatchObject({ amount_pence: 2845, bill_total_pence: 4250 });
    expect((row?.items as { shared: boolean }[] | null)?.map((i) => i.shared)).toEqual([true, true, false]);
  });

  it('SCAN-2: a receipt with no lines has no Itemise', async () => {
    const c = household({ ai: fakeAi({ scan: ok({ ...recorded('scan-good'), items: [], discount_pence: 0 }) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    openMore(sheet);
    expect(within(sheet).queryByRole('group', { name: 'Itemise' })).toBeNull();
  });
});

// ─────────────────────────────── photos by hand, Sort it later, the Inbox ───────────────────────────────

describe('a photo by hand, "Sort it later" and the Inbox (SCAN-1, SCAN-4, SCAN-5, INB-1, INB-2)', () => {
  it('SCAN-5: with smart features off a photo attaches and nothing is read', async () => {
    const ai = fakeAi({ scan: ok(recorded('scan-good')) });
    const c = household({ smart: false, ai });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    expect(await within(sheet).findByRole('img', { name: 'Receipt photo' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Remove photo' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Sort it later' })).toBeTruthy();
    expect(sentence(READING, sheet)).toBeNull();
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '4.20' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Bakery' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    expect(ai.scan).not.toHaveBeenCalled();
    expect(c.controls.tables.expenses.find((e) => e.description === 'Bakery')?.receipt_path).toMatch(PATH);
  });

  it('SCAN-1: "Remove photo" takes it off; the entry saves with none', async () => {
    const c = household({ smart: false });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    await within(sheet).findByRole('img', { name: 'Receipt photo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => { expect(within(sheet).queryByRole('img', { name: 'Receipt photo' })).toBeNull(); });
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '4.20' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Bakery' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Bakery')?.receipt_path).toBeNull();
  });

  it('SCAN-4 INB-1: "Sort it later" puts the photo in the Inbox and closes the sheet; no money is saved', async () => {
    const c = household({ smart: false });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    await within(sheet).findByRole('img', { name: 'Receipt photo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sort it later' }));
    await sheetClosed();
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
    const items = c.controls.tables.inboxItems.filter((i) => i.source === 'scan');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'open', expense_id: null });
    expect(items[0]?.receipt_path).toMatch(PATH);
    expect(await screen.findByRole('button', { name: /^Inbox\W+1(\D|$)/ })).toBeTruthy();
  });

  it('SCAN-4 INB-2: in the Inbox it is "Receipt to sort"; Keep opens the Add sheet with the photo, and Save makes it an entry', async () => {
    const path = `${HID}/00000000-0000-4000-8000-0000000000f1.jpg`;
    const scanItem = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0d1', source: 'scan', recurring_id: null, occurrence_date: null, receipt_path: path, payload: {}, created_by: SAM_ID });
    const c = household({ smart: false, inboxItems: [scanItem] });
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Inbox\W+\d+/ }));
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    const main = screen.getByRole('main');
    expect(sentence('Receipt to sort', main)).toBeTruthy();
    fireEvent.click(within(main).getByRole('button', { name: 'Keep' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(await within(sheet).findByRole('img', { name: 'Receipt photo' })).toBeTruthy();
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '23.10' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Market' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Market');
    expect(row).toMatchObject({ amount_pence: 2310, receipt_path: path });
    expect(c.controls.tables.inboxItems.find((i) => i.id === scanItem.id)).toMatchObject({ status: 'kept', expense_id: row?.id });
  });

  it('SCAN-4 OFF-2: sorted later offline, it is read when opened from the Inbox with smart features on and a connection', async () => {
    const ai = fakeAi({ scan: ok(recorded('scan-good')) });
    const c = household({ ai, online: false });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    await within(sheet).findByRole('img', { name: 'Receipt photo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sort it later' }));
    await sheetClosed();
    expect(ai.scan).not.toHaveBeenCalled();
    act(() => { c.network.set(true); });
    await settle(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Inbox\W+1(\D|$)/ }));
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Keep' }));
    const again = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(again, 'Description').value).toBe('Tesco Express'); });
    expect(field(again, 'Amount').value).toBe('13.99');
    expect(ai.scan).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────── ADD-9: loose wording in quick add ───────────────────────────────

describe('quick add with loose wording (ADD-9)', () => {
  const DISHOOM = { amount_pence: 4200, description: 'Dishoom', category: 'Eating out', payer: 'B', split: null, date: '2026-11-13', tags: [], chapter: null };

  it('ADD-9: words the grammar can’t read open the Add sheet prefilled from the reading; nothing saves by itself', async () => {
    const ai = fakeAi({ parse: ok(DISHOOM) });
    const c = household({ ai });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'dinner at dishoom forty two quid, sam paid' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('42.00'); });
    expect(field(sheet, 'Description').value).toBe('Dishoom');
    expect(isPressed(category(sheet, 'Eating out'))).toBe(true);
    expect(isChecked(within(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).getByRole('radio', { name: 'Sam' }))).toBe(true);
    expect(ai.parse).toHaveBeenCalledTimes(1);
    expect(String(ai.parse.mock.calls[0]?.[0])).not.toMatch(/\bsam\b/i);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('ADD-9: the grammar comes first: "42.50 tesco" saves at once and nothing is sent', async () => {
    const ai = fakeAi({ parse: ok(DISHOOM) });
    const c = household({ ai });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42.50 tesco' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await settle(c.layer);
    await waitFor(() => { expect(c.controls.tables.expenses.find((e) => e.description === 'Tesco')?.amount_pence).toBe(4250); });
    expect(ai.parse).not.toHaveBeenCalled();
  });

  it('ADD-9 SCAN-5: with smart features off, loose words get today’s answer and nothing is sent', async () => {
    const ai = fakeAi({ parse: ok(DISHOOM) });
    const c = household({ smart: false, ai });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'dinner at dishoom forty two quid' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(await screen.findByText(/^Start with an amount, like 12\.50\.?$/)).toBeTruthy();
    expect(ai.parse).not.toHaveBeenCalled();
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('ADD-9 SCAN-5: the reading failing keeps today’s answer; nothing saves', async () => {
    const ai = fakeAi({ parse: fails('timeout') });
    const c = household({ ai });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'dinner at dishoom forty two quid' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await waitFor(() => { expect(ai.parse).toHaveBeenCalled(); });
    await waitFor(() => {
      const sheet = screen.queryByRole('dialog', { name: 'Add expense' });
      const hint = screen.queryByText(/^Start with an amount, like 12\.50\.?$/);
      expect(sheet !== null || hint !== null).toBe(true);
    });
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
  });
});

// ─────────────────────────────── the entry page, CAT-2 step 4 ───────────────────────────────

describe('the entry page: photo and guess (SCAN-1, CAT-2)', () => {
  const withPhoto = (over: Partial<ExpenseRow> = {}) => storedExpense({
    id: '00000000-0000-4000-8000-00000000e601', description: 'Tesco Express', amount_pence: 1399, category_id: categoryId('Groceries'),
    paid: { [JAE_ID]: 1399 }, shares: { [JAE_ID]: 700, [SAM_ID]: 699 }, receipt_path: `${HID}/00000000-0000-4000-8000-0000000000f1.jpg`, ...over,
  });

  it('SCAN-1: an entry with a photo shows "Receipt photo"', async () => {
    const c = household({ expenses: [withPhoto()] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    at(`/entry/${withPhoto().id}`);
    expect(await screen.findByRole('img', { name: 'Receipt photo' })).toBeTruthy();
  });

  it('SCAN-1: an entry without one shows no photo', async () => {
    const c = household({ expenses: [withPhoto({ receipt_path: null })] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    at(`/entry/${withPhoto().id}`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('img', { name: 'Receipt photo' })).toBeNull();
  });

  it('CAT-2: a category set by a guess says so: "Groceries (a guess)"; a person’s choice doesn’t', async () => {
    const guessed = Object.assign(withPhoto({ receipt_path: null }), { category_guess: true });
    const c = household({ expenses: [guessed] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    at(`/entry/${guessed.id}`);
    await waitFor(() => { expect(sentence(/Groceries \(a guess\)/)).toBeTruthy(); });
  });

  it('CAT-2: without the guess mark it is just "Groceries"', async () => {
    const chosen = Object.assign(withPhoto({ receipt_path: null }), { category_guess: false });
    const c = household({ expenses: [chosen] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    at(`/entry/${chosen.id}`);
    await waitFor(() => { expect(sentence(/Groceries/)).toBeTruthy(); });
    expect(sentence(/\(a guess\)/)).toBeNull();
  });

  it('CAT-2: saved with no category and nothing known about it, the guess arrives a moment later, marked as a guess', async () => {
    const ai = fakeAi({ categorise: ok({ category: 'Household' }) });
    const c = household({ ai });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '18' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Zzyzx Emporium' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    await waitFor(() => { expect(ai.categorise).toHaveBeenCalledTimes(1); });
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Zzyzx Emporium');
    await waitFor(() => { expect(c.controls.tables.expenses.find((e) => e.id === row?.id)?.category_id).toBe(categoryId('Household')); });
    at(`/entry/${row?.id ?? ''}`);
    await waitFor(() => { expect(sentence(/Household \(a guess\)/)).toBeTruthy(); });
  });

  it('CAT-2 SCAN-5: with smart features off nothing is guessed', async () => {
    const ai = fakeAi({ categorise: ok({ category: 'Household' }) });
    const c = household({ smart: false, ai });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '18' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Zzyzx Emporium' } });
    save(sheet);
    await sheetClosed();
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
    expect(c.controls.tables.expenses.find((e) => e.description === 'Zzyzx Emporium')?.date).toBe(TODAY);
  });
});
