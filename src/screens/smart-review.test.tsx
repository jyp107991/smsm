/**
 * S6a fresh review: regressions. Save or Sort it later tapped while the photo is still being shrunk (it froze);
 * a receipt in another currency at home; Remove photo takes the receipt's lines with it; a person's own "Other" is
 * never guessed over; quick add sends loose words once; a scanned receipt sorted later can be saved abroad.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, storedInboxItem } from '../../tests/fixtures/couple';
import { deferred, fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, recorded, type AiResult } from '../../tests/fixtures/smart';
import { DataProvider, setSmartFeatures, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  localStorage.clear();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:smsm-test/photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await open?.dispose();
  open = null;
});

const PATH = new RegExp(`^${HID}/[0-9a-f-]{36}\\.jpg$`);
const ok = (d: unknown): AiResult => ({ ok: true, data: d });
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();

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
function pickPhoto(sheet: HTMLElement, button: 'Scan receipt' | 'Add photo') {
  const opened: HTMLInputElement[] = [];
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type === 'file') opened.push(this);
  });
  if (!within(sheet).queryByRole('button', { name: button })) fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
  fireEvent.click(within(sheet).getByRole('button', { name: button }));
  spy.mockRestore();
  const input = opened[0] ?? sheet.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  fireEvent.change(input, { target: { files: [receiptPhoto()] } });
}
const field = (sheet: HTMLElement, name: 'Amount' | 'Description') => within(sheet).getByRole<HTMLInputElement>('textbox', { name });

/** A shrinker the test releases when it wants (a phone shrinking a big photo). */
function heldDownscale() {
  const held = deferred<Blob>();
  return { held, downscale: vi.fn(() => held.promise) };
}

describe('the photo is still being kept (review 1, 2)', () => {
  it('SCAN-1: Save tapped while the photo is being shrunk saves once it is kept, with the photo, and never hangs', async () => {
    const { held, downscale } = heldDownscale();
    const c = couple({ photos: memoryPhotos(), downscale });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '4.20' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Bakery' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await act(async () => { held.resolve(new Blob(['small'], { type: 'image/jpeg' })); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    const rows = c.controls.tables.expenses.filter((e) => e.description === 'Bakery');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.receipt_path).toMatch(PATH);
  });

  it('SCAN-4: Sort it later tapped while the photo is being shrunk goes to the Inbox once, and never hangs', async () => {
    const { held, downscale } = heldDownscale();
    const c = couple({ photos: memoryPhotos(), downscale });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Add photo');
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Sort it later' }));
    await act(async () => { held.resolve(new Blob(['small'], { type: 'image/jpeg' })); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.inboxItems.filter((i) => i.source === 'scan')).toHaveLength(1);
    expect(c.controls.tables.expenses).toEqual([]);
  });
});

describe('the reading (review 3, 5, 7, 8)', () => {
  it('SCAN-1 PLC-6: a receipt in euros scanned at home fills no pounds; its lines show in euros', async () => {
    setSmartFeatures(true);
    const euro = { ...recorded('scan-good'), currency: 'eur' };
    const c = couple({ photos: memoryPhotos(), downscale: fakeDownscale(), ai: fakeAi({ scan: ok(euro) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('Tesco Express'); });
    expect(field(sheet, 'Amount').value).toBe('');
    fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
    const group = await within(sheet).findByRole('group', { name: 'Itemise' });
    expect(within(group).getByRole('checkbox', { name: 'Milk €1.20' })).toBeTruthy();
  });

  it('SCAN-2: Remove photo takes the receipt’s lines and total with it', async () => {
    setSmartFeatures(true);
    const c = couple({ photos: memoryPhotos(), downscale: fakeDownscale(), ai: fakeAi({ scan: ok(recorded('scan-good')) }) });
    show(c.layer);
    const sheet = await openAddSheet();
    pickPhoto(sheet, 'Scan receipt');
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('13.99'); });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove photo' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
    expect(within(sheet).queryByRole('group', { name: 'Itemise' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Tesco Express')).toMatchObject({ receipt_path: null, items: null, bill_total_pence: null });
  });

  it('CAT-2: a person who chose Other is never guessed over', async () => {
    setSmartFeatures(true);
    const ai = fakeAi({ categorise: ok({ category: 'Household' }) });
    const c = couple({ ai });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.change(field(sheet, 'Amount'), { target: { value: '18' } });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Zzyzx Emporium' } });
    fireEvent.click(within(within(sheet).getByRole('group', { name: 'Category' })).getByRole('button', { name: /Other/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
    expect(c.controls.tables.expenses.find((e) => e.description === 'Zzyzx Emporium')?.category_id).toBe(categoryId('Other'));
  });

  it('SCAN-4 PLC-6: a receipt sorted later and read abroad can take a rate and be saved', async () => {
    setSmartFeatures(true);
    localStorage.setItem('smsm-current-country', 'JP');
    const path = `${HID}/00000000-0000-4000-8000-0000000000f2.jpg`;
    const photos = memoryPhotos();
    await photos.put(path, new Blob(['x'], { type: 'image/jpeg' }));
    const item = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0d2', source: 'scan', recurring_id: null, occurrence_date: null, receipt_path: path, payload: {} });
    const rates = { rate: vi.fn(() => Promise.resolve({ date: '2026-11-13', base: 'JPY', quote: 'GBP', rate: 0.0047475 })) };
    const c = couple({ photos, downscale: fakeDownscale(), inboxItems: [item], rates, ai: fakeAi({ scan: ok(recorded('scan-japanese')) }) });
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Inbox\W+\d+/ }));
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Keep' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('648'); });
    await waitFor(() => { expect(within(sheet).getByRole('textbox', { name: 'Rate' })).toBeTruthy(); });
    await waitFor(() => { expect(within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Rate' }).value).not.toBe(''); });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.receipt_path === path)).toMatchObject({ amount_pence: 308, original_currency: 'JPY', country: 'JP' });
  });
});

describe('quick add with loose words (review 9)', () => {
  it('ADD-9: Enter twice while it reads sends the words once, and says it is reading', async () => {
    setSmartFeatures(true);
    const answer = deferred<AiResult>();
    const ai = fakeAi({ parse: () => answer.promise });
    const c = couple({ ai });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'dinner at dishoom forty two quid' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(await screen.findByText('Reading that…')).toBeTruthy();
    expect(ai.parse).toHaveBeenCalledTimes(1);
    answer.resolve({ ok: false, reason: 'timeout' });
    expect(await screen.findByText(/^Start with an amount/)).toBeTruthy();
  });

  it('ADD-9: a reading that arrives after the words changed is let go', async () => {
    setSmartFeatures(true);
    const answer = deferred<AiResult>();
    const c = couple({ ai: fakeAi({ parse: () => answer.promise }) });
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: 'dinner at dishoom forty two quid' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    fireEvent.change(box, { target: { value: 'something else' } });
    await act(async () => { answer.resolve(ok({ amount_pence: 4200, description: 'Dishoom', category: null, payer: 'A', split: null, date: null, tags: [], chapter: null })); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull();
    expect((box as HTMLInputElement).value).toBe('something else');
  });
});

describe('the Inbox (review 13)', () => {
  it('SCAN-4 INB-2: "Not ours" on a receipt to sort says what it cleared', async () => {
    const item = storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0d3', source: 'scan', recurring_id: null, occurrence_date: null, receipt_path: `${HID}/x.jpg`, payload: {} });
    const c = couple({ inboxItems: [item] });
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Inbox\W+\d+/ }));
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /Not ours/ }));
    await waitFor(() => { expect(screen.getAllByText((_, el) => el !== null && text(el) === 'Receipt to sort cleared').length).toBeGreaterThan(0); });
  });
});
