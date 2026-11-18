/**
 * S6b screens (docs/slices/S6b.md "Decisions made here", "Interfaces"; docs/AI.md §3.4, §3.5, §4): Insights' "Ask
 * smsm" box and its answer, the recap headline worded by the AI (or the template), and opening the app from outside it
 * (app-icon shortcuts `/?do=add|scan|settle` and the share sheet `/?do=shared`), on the real screens over the
 * in-memory Api with a fake AI service and photo store (tests/fixtures/smart.ts; never the network). Written before
 * the build (ENGINEERING §5, tests first by someone else). The layout half (320/390 px, both themes, axe) and the
 * manifest are tests/e2e/smart-s6b.spec.ts.
 *
 * What these tests read (the brief's Interfaces):
 *   Insights: region "Ask smsm" (only with smart features on and online) with textbox "Ask smsm" and button "Ask".
 *     The answer, inside that region: a status line with the sentence (src/core/ask.ts answer()); a list "Filters" of
 *     buttons "Remove ⟨chip⟩" (removing one re-runs at once, on the phone, without asking again); a list "Matching
 *     entries" (newest first, at most 50, then "See all in Activity"). Unsupported or any failure: the line
 *     "I can answer totals, counts, averages and the biggest, by category, chapter, country, who paid and dates."
 *   Recap: region "Headline" holds the AI headline (and aside) when kept or freshly asked and guarded
 *     (src/data recapWording), else the template sentence.
 *   URL: opening at `/?do=add` → dialog "Add expense"; `/?do=scan` → the same with its file input opened (a file
 *     input's click()) — or, where the browser allows no picker without a tap, its "Scan receipt" ("Add photo" when
 *     smart features are off) button focused; `/?do=settle` → dialog "Settle up"; `/?do=shared` → dialog "Add expense"
 *     with what takeShared() hands over: a photo (image "Receipt photo", read as Scan receipt reads when smart features
 *     are on and online) or text (quick add's grammar first, else the text as the Description). Each opens once and
 *     the parameter is taken out of the address; nothing saves until Save.
 *   The service worker's keeping place for shared things is src/data/smart-s6b.test.ts's: idb-keyval store
 *   'smsm-shared'/'shared', key 'latest' = { photo: 'shared/<uuid>' | null, text: string | null }, the photo in the
 *   photo store under that key.
 *
 * The household on Sat 14 Nov 2026 (TODAY), every entry split 50/50:
 *   Oct: Rent & bills "Rent" £1,000.00 (Jae, 1 Oct), Groceries "Weekly shop" £240.50 (Sam, 10 Oct), Eating out
 *        "Dishoom" £125.00 (Sam, 12 Oct) → £1,365.50; no usual yet → template "October cost £1,365.50 together."
 *   Nov: Travel "Rail pass" £720.00 (Jae, 2 Nov, Japan, JP); Eating out "Ramen" £24.40 (Sam, 4 Nov, Japan, JP);
 *        Eating out "Sushi" £88.00 (Jae, 6 Nov, Japan, JP); Eating out "Dinner" £210.00 (Sam, 8 Nov, UK).
 *   Eating out in Japan: £112.40 (Sushi, Ramen). Eating out anywhere: £447.40 (Dinner, Sushi, Ramen, Dishoom).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, type RecapRow } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, recorded, type AiResult } from '../../tests/fixtures/smart';
import * as dataModule from '../data';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = dataModule as unknown as { setSmartFeatures(on: boolean): void };

let open: DataLayer | null = null;
const clicked: HTMLInputElement[] = [];
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
  idbData.clear();
  clicked.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:smsm-test/photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  // A file input opened by the app (its picker) is recorded, not opened.
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type === 'file') clicked.push(this);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await open?.dispose();
  open = null;
});

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
/** Opens the app at an address, as the launcher or the share sheet does. */
function launchAt(path: string, layer: DataLayer) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
  return show(layer);
}
function at(path: string) {
  history.replaceState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  resetHistoryForTests();
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
const sentence = (s: string | RegExp, scope: HTMLElement = document.body) =>
  within(scope).queryAllByText((_, el) => (el ? (typeof s === 'string' ? text(el) === s : s.test(text(el))) : false))[0] ?? null;
const ok = (d: unknown): AiResult => ({ ok: true, data: d });
const fails = (reason: 'off' | 'limit' | 'timeout' | 'invalid' | 'error'): AiResult => ({ ok: false, reason });
const CAN_ANSWER = 'I can answer totals, counts, averages and the biggest, by category, chapter, country, who paid and dates.';

// ───────── the household ─────────
const JAPAN = storedChapter();
let n = 0;
function spent(description: string, amount: number, category: string, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  n += 1;
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: `00000000-0000-4000-8000-0000000e${n.toString(16).padStart(4, '0')}`, description, amount_pence: amount, date, category_id: categoryId(category),
    paid: { [payer]: amount }, shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, ...over,
  });
}
function seed(): ExpenseRow[] {
  return [
    spent('Rent', 100000, 'Rent & bills', JAE_ID, '2026-10-01'),
    spent('Weekly shop', 24050, 'Groceries', SAM_ID, '2026-10-10'),
    spent('Dishoom', 12500, 'Eating out', SAM_ID, '2026-10-12'),
    spent('Rail pass', 72000, 'Travel', JAE_ID, '2026-11-02', { chapter_id: JAPAN.id, country: 'JP' }),
    spent('Ramen', 2440, 'Eating out', SAM_ID, '2026-11-04', { chapter_id: JAPAN.id, country: 'JP' }),
    spent('Sushi', 8800, 'Eating out', JAE_ID, '2026-11-06', { chapter_id: JAPAN.id, country: 'JP' }),
    spent('Dinner', 21000, 'Eating out', SAM_ID, '2026-11-08'),
  ];
}
/** A household with the fakes; smart features on unless `smart: false`. */
function household(opts: Parameters<typeof couple>[0] & { smart?: boolean } = {}) {
  const { smart = true, ...rest } = opts;
  if (smart) data.setSmartFeatures(true);
  return couple({ photos: memoryPhotos(), downscale: fakeDownscale(), chapters: [JAPAN], expenses: seed(), ...rest });
}

async function goInsights() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Insights' }));
  return screen.findByRole('heading', { level: 1, name: 'Insights' });
}
async function askBox() {
  await goInsights();
  return screen.findByRole('region', { name: 'Ask smsm' });
}
function ask(region: HTMLElement, question: string) {
  fireEvent.change(within(region).getByRole('textbox', { name: 'Ask smsm' }), { target: { value: question } });
  fireEvent.click(within(region).getByRole('button', { name: 'Ask' }));
}
async function statusSays(region: HTMLElement, s: string) {
  await waitFor(() => { expect(within(region).queryAllByRole('status').map(text)).toContain(s); });
}
const rows = (region: HTMLElement) => within(within(region).getByRole('list', { name: 'Matching entries' })).getAllByRole('listitem').map(text);
const hasChip = (region: HTMLElement, name: string) => within(within(region).getByRole('list', { name: 'Filters' })).queryByRole('button', { name }) !== null;
const EATING_IN_JAPAN = { measure: 'total', filters: { categories: ['Eating out'], countries: ['JP'] } };

// ─────────────────────────────── INS-9: Ask smsm ───────────────────────────────

describe('Insights → "Ask smsm" (INS-9; AI.md §3.5, §4)', () => {
  it('INS-9: with smart features on and a connection, a box "Ask smsm" with a button "Ask"', async () => {
    const { layer } = household({ ai: fakeAi() });
    show(layer);
    const region = await askBox();
    expect(within(region).getByRole('textbox', { name: 'Ask smsm' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Ask' })).toBeTruthy();
  });

  it('INS-9: smart features off: no box', async () => {
    const { layer } = household({ smart: false, ai: fakeAi() });
    show(layer);
    await goInsights();
    await settle(layer);
    expect(screen.queryByRole('region', { name: 'Ask smsm' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Ask smsm' })).toBeNull();
  });

  it('INS-9: offline: no box', async () => {
    const { layer } = household({ ai: fakeAi(), online: false });
    show(layer);
    await goInsights();
    await settle(layer);
    expect(screen.queryByRole('region', { name: 'Ask smsm' })).toBeNull();
  });

  it('INS-9: the figure as a sentence, the filter as chips and the matching entries, newest first', async () => {
    const ai = fakeAi({ ask: ok(EATING_IN_JAPAN) });
    const c = household({ ai });
    show(c.layer);
    const region = await askBox();
    ask(region, 'how much did we spend on eating out in japan?');
    await statusSays(region, '£112.40 on Eating out in Japan, all time');
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(ai.ask.mock.calls[0]?.[0]).toBe('how much did we spend on eating out in japan?');
    expect(hasChip(region, 'Remove Eating out')).toBe(true);
    expect(hasChip(region, 'Remove Japan')).toBe(true);
    const list = rows(region);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('Sushi');
    expect(list[1]).toContain('Ramen');
    // Asking never writes anything.
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(7);
  });

  it('INS-9: removing a chip re-runs it at once, on the phone, without asking again', async () => {
    const ai = fakeAi({ ask: ok(EATING_IN_JAPAN) });
    const { layer } = household({ ai });
    show(layer);
    const region = await askBox();
    ask(region, 'how much did we spend on eating out in japan?');
    await statusSays(region, '£112.40 on Eating out in Japan, all time');
    fireEvent.click(within(within(region).getByRole('list', { name: 'Filters' })).getByRole('button', { name: 'Remove Japan' }));
    await statusSays(region, '£447.40 on Eating out, all time');
    expect(hasChip(region, 'Remove Japan')).toBe(false);
    expect(hasChip(region, 'Remove Eating out')).toBe(true);
    const list = rows(region);
    expect(list).toHaveLength(4);
    expect(list.map((r) => ['Dinner', 'Sushi', 'Ramen', 'Dishoom'].find((d) => r.includes(d)))).toEqual(['Dinner', 'Sushi', 'Ramen', 'Dishoom']);
    expect(ai.ask).toHaveBeenCalledTimes(1);
  });

  it('INS-9: names never leave the phone: the question goes with A and B', async () => {
    const ai = fakeAi({ ask: ok({ measure: 'total', filters: { payer: 'B' } }) });
    const { layer } = household({ ai });
    show(layer);
    const region = await askBox();
    ask(region, 'how much has Sam paid?');
    await waitFor(() => { expect(ai.ask).toHaveBeenCalled(); });
    expect(ai.ask.mock.calls[0]?.[0]).toBe('how much has B paid?');
    await waitFor(() => { expect(hasChip(region, 'Remove Paid by Sam')).toBe(true); });
  });

  it('INS-9: a question it can’t express says what it can answer', async () => {
    const { layer } = household({ ai: fakeAi({ ask: ok({ unsupported: true }) }) });
    show(layer);
    const region = await askBox();
    ask(region, 'are we saving enough?');
    await waitFor(() => { expect(sentence(CAN_ANSWER, region)).toBeTruthy(); });
    expect(within(region).queryByRole('list', { name: 'Matching entries' })).toBeNull();
  });

  for (const reason of ['limit', 'timeout', 'invalid', 'error'] as const) {
    it(`INS-9: the service failing ("${reason}") gives the same line, no figure`, async () => {
      const { layer } = household({ ai: fakeAi({ ask: fails(reason) }) });
      show(layer);
      const region = await askBox();
      ask(region, 'how much on eating out?');
      await waitFor(() => { expect(sentence(CAN_ANSWER, region)).toBeTruthy(); });
      expect(sentence(/£\d/, region)).toBeNull();
    });
  }

  it('INS-9: at most 50 matching entries, then "See all in Activity"', async () => {
    const many = Array.from({ length: 55 }, (_, i) => spent(`Coffee ${String(i + 1)}`, 300, 'Eating out', JAE_ID, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`));
    const { layer } = household({ ai: fakeAi({ ask: ok({ measure: 'count', filters: { categories: ['Eating out'] } }) }), expenses: many });
    show(layer);
    const region = await askBox();
    ask(region, 'how many coffees?');
    await waitFor(() => { expect(within(region).queryAllByRole('status').map(text).some((t) => t.startsWith('55 '))).toBe(true); });
    expect(rows(region)).toHaveLength(50);
    const seeAll = within(region).queryByRole('link', { name: 'See all in Activity' }) ?? within(region).queryByRole('button', { name: 'See all in Activity' });
    expect(seeAll).not.toBeNull();
  });
});

// ─────────────────────────────── INS-2: the recap's wording ───────────────────────────────

const TEMPLATE = 'October cost £1,365.50 together.';
const WORDING = { headline: 'October came to £1,365.50 together.', aside: 'Person A paid £1,000.00 of it.' };
// Kept with the figures it was written for, as save_recap_prose always keeps it (builder's correction after the fresh
// review: kept wording is shown only while the month's figures are the same).
const kept = (prose: unknown): RecapRow => ({ household_id: HID, period: '2026-10', stats: { total: '£1,365.50' }, prose: JSON.stringify(prose), created_at: '2026-11-01T08:00:00.000Z' });
async function headline(layer: DataLayer) {
  await screen.findByRole('region', { name: 'Balance' });
  at('/recap/2026-10');
  await screen.findByRole('heading', { level: 1, name: 'October 2026' });
  await settle(layer);
  return screen.findByRole('region', { name: 'Headline' });
}

describe('the recap headline (INS-2; AI.md §3.4)', () => {
  it('INS-2: kept wording is shown, with the names', async () => {
    const ai = fakeAi();
    const { layer } = household({ ai, recaps: [kept(WORDING)] });
    show(layer);
    const region = await headline(layer);
    await waitFor(() => { expect(sentence('October came to £1,365.50 together.', region)).toBeTruthy(); });
    expect(sentence('Jae paid £1,000.00 of it.', region)).toBeTruthy();
    expect(sentence(TEMPLATE, region)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });

  it('INS-2: nothing kept: asked once, guarded, shown, and kept for the partner', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai });
    show(c.layer);
    const region = await headline(c.layer);
    await waitFor(() => { expect(sentence('Jae paid £1,000.00 of it.', region)).toBeTruthy(); });
    expect(ai.recap).toHaveBeenCalledTimes(1);
    await settle(c.layer);
    expect(c.controls.calls.filter((call) => call.name === 'saveRecapProse')).toHaveLength(1);
  });

  it('INS-2: wording with a number that isn’t the month’s: the template', async () => {
    const { layer } = household({ ai: fakeAi({ recap: ok({ headline: 'October came to £1,400 together.', aside: null }) }) });
    show(layer);
    const region = await headline(layer);
    await waitFor(() => { expect(sentence(TEMPLATE, region)).toBeTruthy(); });
    expect(sentence(/£1,400/, region)).toBeNull();
  });

  it('INS-2: the service failing: the template', async () => {
    const { layer } = household({ ai: fakeAi({ recap: fails('limit') }) });
    show(layer);
    const region = await headline(layer);
    await waitFor(() => { expect(sentence(TEMPLATE, region)).toBeTruthy(); });
  });

  it('INS-2: smart features off: the template, and nothing is asked', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const { layer } = household({ smart: false, ai, recaps: [kept(WORDING)] });
    show(layer);
    const region = await headline(layer);
    await waitFor(() => { expect(sentence(TEMPLATE, region)).toBeTruthy(); });
    expect(ai.recap).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── ADD-8: from outside the app ───────────────────────────────

async function sheetClosed(name: string) {
  await waitFor(() => { expect(screen.queryByRole('dialog', { name })).toBeNull(); });
}
const field = (sheet: HTMLElement, name: 'Amount' | 'Description') => within(sheet).getByRole<HTMLInputElement>('textbox', { name });
/** The picker was opened, or (where a browser allows none without a tap) its button holds the focus. */
function pickerOffered(sheet: HTMLElement, button: 'Scan receipt' | 'Add photo') {
  if (clicked.length > 0) {
    expect(clicked[0]?.accept).toMatch(/image/);
    return;
  }
  expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: button }));
}

describe('app-icon shortcuts (ADD-8, NOT-3)', () => {
  it('ADD-8 NOT-3: /?do=add opens "Add expense" once, and the address loses the parameter', async () => {
    const { layer } = household({ smart: false });
    launchAt('/?do=add', layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(location.search).not.toContain('do='); });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await sheetClosed('Add expense');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle(layer);
    expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull();
  });

  it('ADD-8 NOT-3: /?do=scan opens "Add expense" with the camera: its file input, for "Scan receipt"', async () => {
    const { layer } = household({ ai: fakeAi() });
    launchAt('/?do=scan', layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { pickerOffered(sheet, 'Scan receipt'); });
    expect(location.search).not.toContain('do=');
  });

  it('ADD-8 NOT-3: /?do=scan with smart features off opens it for "Add photo" (no reading)', async () => {
    const { layer } = household({ smart: false, ai: fakeAi() });
    launchAt('/?do=scan', layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(within(sheet).queryByRole('button', { name: 'Scan receipt' })).toBeNull();
    await waitFor(() => { pickerOffered(sheet, 'Add photo'); });
  });

  it('ADD-8 NOT-3: /?do=settle opens "Settle up"', async () => {
    const { layer } = household({ smart: false });
    launchAt('/?do=settle', layer);
    expect(await screen.findByRole('dialog', { name: 'Settle up' })).toBeTruthy();
    await waitFor(() => { expect(location.search).not.toContain('do='); });
  });

  it('ADD-8: an unknown ?do opens nothing', async () => {
    const { layer } = household({ smart: false });
    launchAt('/?do=banana', layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(layer);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

const SHARED_PHOTO = 'shared/0f8c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
function keepShared(record: { photo: string | null; text: string | null }) {
  idbData.set('smsm-shared/shared', new Map<IDBValidKey, unknown>([['latest', record]]));
}

describe('the share sheet (ADD-8, NOT-3; SPEC 5.3)', () => {
  it('ADD-8: a shared photo opens "Add expense" with it attached; with smart features off nothing is read or sent', async () => {
    const photos = memoryPhotos();
    photos.map.set(SHARED_PHOTO, receiptPhoto('screenshot.png'));
    keepShared({ photo: SHARED_PHOTO, text: null });
    const ai = fakeAi({ scan: ok(recorded('scan-good')) });
    const c = household({ smart: false, ai, photos });
    launchAt('/?do=shared', c.layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    expect(await within(sheet).findByRole('img', { name: 'Receipt photo' })).toBeTruthy();
    await waitFor(() => { expect(location.search).not.toContain('do='); });
    expect(ai.scan).not.toHaveBeenCalled();
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(7);
  });

  it('ADD-8 SCAN-1: with smart features on, a shared photo is read like a scanned receipt; nothing saves until Save', async () => {
    const photos = memoryPhotos();
    photos.map.set(SHARED_PHOTO, receiptPhoto('screenshot.png'));
    keepShared({ photo: SHARED_PHOTO, text: null });
    const ai = fakeAi({ scan: ok(recorded('scan-good')) });
    const c = household({ ai, photos });
    launchAt('/?do=shared', c.layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('Tesco Express'); });
    expect(field(sheet, 'Amount').value).toBe('13.99');
    expect(ai.scan).toHaveBeenCalledTimes(1);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(7);
  });

  it('ADD-8: shared text the grammar can’t read goes in the Description', async () => {
    keepShared({ photo: null, text: 'Order confirmed: Le Creuset casserole' });
    const { layer } = household({ smart: false });
    launchAt('/?do=shared', layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(sheet, 'Description').value).toBe('Order confirmed: Le Creuset casserole'); });
  });

  it('ADD-8: shared text the grammar reads fills the form, and still waits for Save', async () => {
    keepShared({ photo: null, text: 'Dishoom 42.50' });
    const c = household({ smart: false });
    launchAt('/?do=shared', c.layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => { expect(field(sheet, 'Amount').value).toBe('42.50'); });
    expect(field(sheet, 'Description').value).toBe('Dishoom');
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(7);
  });

  it('ADD-8: what was shared is taken once: closing the sheet and coming back opens nothing', async () => {
    keepShared({ photo: null, text: 'Order confirmed: Le Creuset casserole' });
    const { layer } = household({ smart: false });
    launchAt('/?do=shared', layer);
    const sheet = await screen.findByRole('dialog', { name: 'Add expense' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await sheetClosed('Add expense');
    expect(idbData.get('smsm-shared/shared')?.get('latest')).toBeUndefined();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settle(layer);
    expect(screen.queryByRole('dialog', { name: 'Add expense' })).toBeNull();
  });
});
