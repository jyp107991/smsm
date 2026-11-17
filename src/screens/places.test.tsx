/**
 * S4b screens (docs/slices/S4b.md "Screens", "Interfaces"): Settings → "Where you are", the Add sheet's place chip
 * and "Paid in JPY", Home's trip suggestion and "Welcome home", the entry page's country, place and original
 * amount, and Activity's Country and Place filters, on the real screens over the in-memory Api with fake
 * location and rate services (never the network). Written before the build (ENGINEERING §5, tests first by
 * someone else); each test names its SPEC ids and fails because the screens aren't there yet. The layout half
 * (320 px, both themes, axe) is tests/e2e/places.spec.ts.
 *
 * Fakes: the phone is in Kyoto (35.011636, 135.768029 → JP, "Kyoto") unless a test says London (GB); the day's
 * JPY rate is 0.0047475 (published 13 Nov), so ¥1,200 = £5.70 (5.697 rounded half up).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedChapter, storedExpense, TODAY, type ChapterRow } from '../../tests/fixtures/couple';
import * as dataModule from '../data';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import type { MemoryTables } from '../data/memoryApi';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// S4b's data functions, typed so this file compiles before they exist.
const data = dataModule as unknown as { setUseLocation(on: boolean): void; setCurrentCountry(code: string): void };

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(async () => { await open?.dispose(); open = null; });

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

type S4Tables = MemoryTables & { chapters: ChapterRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S4Tables;
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el instanceof HTMLInputElement && el.checked);
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();
/** A sentence whole, wherever its parts are their own elements. */
const sentence = (s: string | RegExp) => screen.getAllByText((_, el) => (el ? (typeof s === 'string' ? text(el) === s : s.test(text(el))) : false))[0];
const findSentence = (s: string | RegExp) => waitFor(() => { expect(sentence(s)).toBeTruthy(); }, { timeout: 3000 });

// ───────── fake services ─────────
const KYOTO = { lat: 35.011636, lng: 135.768029, countryCode: 'JP', city: 'Kyoto' };
const LONDON = { lat: 51.50072, lng: -0.12763, countryCode: 'GB', city: 'London' };
function geoAt(where: typeof KYOTO) {
  return {
    position: vi.fn(() => Promise.resolve({ lat: where.lat, lng: where.lng })),
    reverse: vi.fn(() => Promise.resolve({ countryCode: where.countryCode, city: where.city, locality: where.city })),
  };
}
function rates() {
  return {
    rate: vi.fn((...args: [from: string, date?: string]) => {
      const table: Record<string, number> = { JPY: 0.0047475, EUR: 0.8712 };
      const rate = table[args[0]];
      return rate === undefined ? Promise.reject(new Error('404')) : Promise.resolve({ date: '2026-11-13', base: args[0], quote: 'GBP', rate });
    }),
  };
}

// ───────── the household ─────────
const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;
const JAPAN = storedChapter();
function spent(n: number, description: string, amount: number, category: string, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  return storedExpense({
    id: E(n), description, amount_pence: amount, date, category_id: categoryId(category), paid: { [payer]: amount },
    shares: { [JAE_ID]: amount / 2, [SAM_ID]: amount / 2 }, ...over,
  });
}
const RAMEN = spent(601, 'Ramen', 570, 'Eating out', JAE_ID, '2026-11-04', {
  chapter_id: JAPAN.id, country: 'JP', place: 'Kyoto', lat: 35.012, lng: 135.768, original_amount: 1200, original_currency: 'JPY', fx_rate: 0.0047475,
});
const JAPAN_ENTRIES: ExpenseRow[] = [
  spent(602, 'Supermarket', 12000, 'Groceries', JAE_ID, '2026-11-02', { chapter_id: JAPAN.id, country: 'JP', place: 'Osaka' }),
  spent(603, 'Kaiseki dinner', 100000, 'Eating out', SAM_ID, '2026-11-04', { chapter_id: JAPAN.id, country: 'JP', place: 'Kyoto' }),
  spent(604, 'Rail pass', 72000, 'Travel', JAE_ID, '2026-11-01', { chapter_id: JAPAN.id, country: 'JP' }),
];
const LAMP = storedExpense({ id: E(605) });

// ───────── getting around ─────────
async function goSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { level: 1, name: 'Settings' });
}
async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}
async function choose(box: HTMLElement, option: string) {
  if (box instanceof HTMLSelectElement) {
    const opt = within(box).getByRole<HTMLOptionElement>('option', { name: option });
    fireEvent.change(box, { target: { value: opt.value } });
    return;
  }
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function chosen(box: HTMLElement): string {
  if (box instanceof HTMLSelectElement) return box.selectedOptions[0]?.textContent.trim() ?? '';
  return (box as HTMLInputElement).value || text(box);
}
const switchOrBox = (within_: HTMLElement, name: string) =>
  within(within_).queryByRole('switch', { name }) ?? within(within_).getByRole('checkbox', { name });

// ─────────────────────────────── PLC-3 PLC-2: Settings → Where you are ───────────────────────────────

describe('Settings → "Where you are" (PLC-3, PLC-2)', () => {
  it('PLC-3: "Current country" lists countries by English name, United Kingdom by default; choosing Japan keeps it on this phone', async () => {
    const { layer } = couple();
    show(layer);
    await goSettings();
    expect(screen.getByRole('heading', { name: 'Where you are' })).toBeTruthy();
    const box = screen.getByRole('combobox', { name: 'Current country' });
    expect(chosen(box)).toBe('United Kingdom');
    await choose(box, 'Japan');
    await waitFor(() => { expect(chosen(screen.getByRole('combobox', { name: 'Current country' }))).toBe('Japan'); });
    expect(localStorage.getItem('smsm-current-country')).toContain('JP');
  });

  it('PLC-2: "Use location" is off until asked, and says why first', async () => {
    const { layer } = couple({ geo: geoAt(KYOTO) });
    show(layer);
    await goSettings();
    const toggle = switchOrBox(document.body, 'Use location');
    expect(isChecked(toggle)).toBe(false);
    expect(toggle.getAttribute('aria-describedby')).toBeTruthy();
    const described = (toggle.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toMatch(/So new entries get the town, and smsm can notice a trip/);
    fireEvent.click(toggle);
    await waitFor(() => { expect(isChecked(switchOrBox(document.body, 'Use location'))).toBe(true); });
  });
});

// ─────────────────────────────── PLC-3 PLC-2: the Add sheet ───────────────────────────────

describe('the Add sheet abroad (PLC-3, PLC-2, PLC-1)', () => {
  it('PLC-3 PLC-1: a new entry takes this phone’s current country', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '18' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Card dinner' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Card dinner')).toMatchObject({
      amount_pence: 1800, country: 'JP', original_amount: null, original_currency: null, fx_rate: null,
    });
  });

  it('PLC-2: with location on, a place chip "Kyoto" shows; saving keeps the town and the rounded position', async () => {
    data.setUseLocation(true);
    const c = couple({ geo: geoAt(KYOTO), rates: rates() });
    show(c.layer);
    const sheet = await openAddSheet();
    const chip = await within(sheet).findByRole('button', { name: 'Kyoto' });
    expect(within(within(sheet).getByRole('group', { name: 'Place' })).getByRole('button', { name: 'Kyoto' })).toBe(chip);
    expect(within(sheet).getByRole('button', { name: 'Remove place' })).toBeTruthy();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '18' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Tea' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Tea');
    expect(row).toMatchObject({ country: 'JP', place: 'Kyoto' });
    expect(Number(row?.lat)).toBeCloseTo(35.012, 10);
    expect(Number(row?.lng)).toBeCloseTo(135.768, 10);
  });

  it('PLC-2: "Remove place" removes the chip; the entry is saved with no place and no position', async () => {
    data.setUseLocation(true);
    const c = couple({ geo: geoAt(KYOTO), rates: rates() });
    show(c.layer);
    const sheet = await openAddSheet();
    await within(sheet).findByRole('button', { name: 'Kyoto' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove place' }));
    await waitFor(() => { expect(within(sheet).queryByRole('button', { name: 'Kyoto' })).toBeNull(); });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '18' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Tea' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Tea')).toMatchObject({ place: null, lat: null, lng: null });
  });

  it('PLC-2: More details has a "Place" box; a typed place is saved with no position', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
    fireEvent.change(await within(sheet).findByRole('textbox', { name: 'Place' }), { target: { value: 'Brighton' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '9' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Chips' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Chips')).toMatchObject({ country: 'GB', place: 'Brighton', lat: null, lng: null });
  });

  it('PLC-2: without location the sheet has no place chip and nothing is asked', async () => {
    const geo = geoAt(KYOTO);
    const { layer } = couple({ geo });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('button', { name: 'Remove place' })).toBeNull();
    expect(geo.position).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── PLC-6: Paid in JPY ───────────────────────────────

describe('"Paid in JPY" (PLC-6)', () => {
  it('PLC-6: at home there is no "Paid in" choice', async () => {
    const { layer } = couple({ rates: rates() });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('checkbox', { name: /^Paid in/ })).toBeNull();
    expect(within(sheet).queryByRole('switch', { name: /^Paid in/ })).toBeNull();
  });

  it('PLC-6: in Japan, "Paid in JPY" (off: card payments in pounds) takes yen, fills the day’s rate, shows "¥1,200 = £5.70" and stores pounds with the original', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    const sheet = await openAddSheet();
    const paidIn = switchOrBox(sheet, 'Paid in JPY');
    expect(isChecked(paidIn)).toBe(false);
    fireEvent.click(paidIn);
    const rate = await within(sheet).findByRole<HTMLInputElement>('textbox', { name: 'Rate' });
    await waitFor(() => { expect(rate.value).toBe('0.0047475'); });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1200' } });
    await waitFor(() => { expect(within(sheet).getAllByText((_, el) => el?.textContent === '¥1,200 = £5.70')[0]).toBeTruthy(); });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Ramen' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Ramen');
    expect(row).toMatchObject({ amount_pence: 570, country: 'JP', original_currency: 'JPY' });
    expect(String(row?.original_amount)).toBe('1200');
    expect(String(row?.fx_rate)).toBe('0.0047475');
  });

  it('PLC-6 OFF-4: the rate is editable, and the pounds follow it exactly', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates() });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.click(switchOrBox(sheet, 'Paid in JPY'));
    const rate = await within(sheet).findByRole<HTMLInputElement>('textbox', { name: 'Rate' });
    await waitFor(() => { expect(rate.value).toBe('0.0047475'); });
    fireEvent.change(rate, { target: { value: '0.005' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1500' } });
    await waitFor(() => { expect(within(sheet).getAllByText((_, el) => el?.textContent === '¥1,500 = £7.50')[0]).toBeTruthy(); });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Taxi' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.description === 'Taxi');
    expect(row?.amount_pence).toBe(750);
    expect(String(row?.fx_rate)).toBe('0.005');
  });

  it('OFF-4: offline with no rate known, the Rate box is empty to type; nothing blocks the form', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ rates: rates(), online: false });
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.click(switchOrBox(sheet, 'Paid in JPY'));
    const rate = await within(sheet).findByRole<HTMLInputElement>('textbox', { name: 'Rate' });
    expect(rate.value).toBe('');
    fireEvent.change(rate, { target: { value: '0.0047475' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '1200' } });
    await waitFor(() => { expect(within(sheet).getAllByText((_, el) => el?.textContent === '¥1,200 = £5.70')[0]).toBeTruthy(); });
  });
});

// ─────────────────────────────── PLC-4: trips suggest themselves ───────────────────────────────

describe('Home’s trip suggestion and welcome home (PLC-4)', () => {
  const suggestion = /^Looks like you(’|')re in Japan\. Start a trip\?$/;

  it('PLC-4: abroad with no open trip there: "Start a trip" creates the trip, makes it current and sets the country', async () => {
    data.setUseLocation(true);
    const c = couple({ geo: geoAt(KYOTO), rates: rates() });
    show(c.layer);
    await findSentence(suggestion);
    fireEvent.click(screen.getByRole('button', { name: 'Start a trip' }));
    await settle(c.layer);
    const trips = tablesOf(c).chapters;
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ name: 'Japan', emoji: '🧳', kind: 'trip', country: 'JP', start_date: TODAY, closed: false });
    expect(localStorage.getItem('smsm-current-chapter')).toContain(trips[0]?.id ?? '-');
    expect(localStorage.getItem('smsm-current-country')).toContain('JP');
    expect(await screen.findByRole('button', { name: /^Adding to Japan/ })).toBeTruthy();
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Start a trip' })).toBeNull(); });
  });

  it('PLC-4: "No" hides it, and nothing is created', async () => {
    data.setUseLocation(true);
    const c = couple({ geo: geoAt(KYOTO), rates: rates() });
    show(c.layer);
    await findSentence(suggestion);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Start a trip' })).toBeNull(); });
    await settle(c.layer);
    expect(tablesOf(c).chapters).toEqual([]);
  });

  it('PLC-4: with location off nothing is suggested and the phone is never asked', async () => {
    const geo = geoAt(KYOTO);
    const { layer } = couple({ geo });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(layer);
    expect(screen.queryByRole('button', { name: 'Start a trip' })).toBeNull();
    expect(geo.position).not.toHaveBeenCalled();
  });

  it('PLC-4: an open trip for that country already: no suggestion', async () => {
    data.setUseLocation(true);
    const { layer } = couple({ geo: geoAt(KYOTO), chapters: [JAPAN] });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    await settle(layer);
    expect(screen.queryByRole('button', { name: 'Start a trip' })).toBeNull();
  });

  it('PLC-4: home again with the trip current: "Welcome home. Close Japan? 9 days, £1,840.00." — "Close Japan" closes it and sets the country home', async () => {
    data.setUseLocation(true);
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    localStorage.setItem('smsm-current-country', 'JP');
    const c = couple({ geo: geoAt(LONDON), chapters: [JAPAN], expenses: JAPAN_ENTRIES });
    show(c.layer);
    await findSentence('Welcome home. Close Japan? 9 days, £1,840.00.');
    expect(screen.getByRole('button', { name: 'Not yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Japan' }));
    await settle(c.layer);
    expect(tablesOf(c).chapters[0]?.closed).toBe(true);
    expect(localStorage.getItem('smsm-current-country') ?? 'GB').toContain('GB');
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Close Japan' })).toBeNull(); });
  });

  it('PLC-4: "Not yet" hides it and keeps the trip open', async () => {
    data.setUseLocation(true);
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const c = couple({ geo: geoAt(LONDON), chapters: [JAPAN], expenses: JAPAN_ENTRIES });
    show(c.layer);
    await findSentence('Welcome home. Close Japan? 9 days, £1,840.00.');
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Close Japan' })).toBeNull(); });
    await settle(c.layer);
    expect(tablesOf(c).chapters[0]?.closed).toBe(false);
  });
});

// ─────────────────────────────── PLC-1 PLC-6: the entry page ───────────────────────────────

describe('the entry page (PLC-1, PLC-6)', () => {
  it('PLC-1 PLC-6: an entry abroad shows its Country, Place and "Paid ¥1,200 at 1 JPY = £0.0047475"', async () => {
    const { layer } = couple({ chapters: [JAPAN], expenses: [RAMEN, LAMP] });
    at(`/entry/${RAMEN.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Ramen' });
    expect(screen.getByText('Country')).toBeTruthy();
    expect(screen.getAllByText('Japan').length).toBeGreaterThan(0);
    expect(screen.getByText('Place')).toBeTruthy();
    expect(screen.getAllByText('Kyoto').length).toBeGreaterThan(0);
    expect(sentence('Paid ¥1,200 at 1 JPY = £0.0047475')).toBeTruthy();
  });

  it('PLC-1: an entry at home has no Country detail and no original amount', async () => {
    const { layer } = couple({ expenses: [LAMP] });
    at(`/entry/${LAMP.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    expect(screen.queryByText('Country')).toBeNull();
    expect(screen.queryByText(/^Paid .* at 1 /)).toBeNull();
  });
});

// ─────────────────────────────── PLC-7 CHP-6: Activity filters ───────────────────────────────

describe('Activity’s Country and Place filters (PLC-7, CHP-6)', () => {
  const filters = () => screen.getByRole('group', { name: 'Filters', hidden: true });
  const optionsIn = (picker: HTMLElement, name: string) =>
    within(picker).queryAllByRole('radio', { name }).concat(within(picker).queryAllByRole('checkbox', { name }), within(picker).queryAllByRole('button', { name }));

  async function openPicker(filter: 'Country' | 'Place') {
    fireEvent.click(within(filters()).getByRole('button', { name: filter, hidden: true }));
    return screen.findByRole('dialog', { name: filter });
  }

  it('PLC-7 CHP-6: "Country" offers the countries that occur; Japan shows the entries in Japan only', async () => {
    const { layer } = couple({ chapters: [JAPAN], expenses: [RAMEN, ...JAPAN_ENTRIES, LAMP] });
    at('/activity');
    show(layer);
    await screen.findByRole('link', { name: 'Lamp, £40.00, Jae paid' });
    const picker = await openPicker('Country');
    // Options are checked before one is picked (picking closes the picker).
    expect(optionsIn(picker, 'Japan')).not.toHaveLength(0);
    expect(optionsIn(picker, 'United Kingdom')).not.toHaveLength(0);
    expect(optionsIn(picker, 'France')).toHaveLength(0);
    const japan = optionsIn(picker, 'Japan')[0];
    if (!japan) throw new Error('no Japan');
    fireEvent.click(japan);
    await waitFor(() => { expect(screen.queryByRole('link', { name: 'Lamp, £40.00, Jae paid', hidden: true })).toBeNull(); });
    expect(screen.getByRole('link', { name: 'Ramen, £5.70, Jae paid', hidden: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rail pass, £720.00, Jae paid', hidden: true })).toBeTruthy();
  });

  it('PLC-7: "Place" offers the places that occur; Kyoto shows the entries there only', async () => {
    const { layer } = couple({ chapters: [JAPAN], expenses: [RAMEN, ...JAPAN_ENTRIES, LAMP] });
    at('/activity');
    show(layer);
    await screen.findByRole('link', { name: 'Lamp, £40.00, Jae paid' });
    const picker = await openPicker('Place');
    expect(optionsIn(picker, 'Kyoto')).not.toHaveLength(0);
    expect(optionsIn(picker, 'Osaka')).not.toHaveLength(0);
    const kyoto = optionsIn(picker, 'Kyoto')[0];
    if (!kyoto) throw new Error('no Kyoto');
    fireEvent.click(kyoto);
    await waitFor(() => { expect(screen.queryByRole('link', { name: /^Supermarket,/, hidden: true })).toBeNull(); });
    expect(screen.getByRole('link', { name: 'Ramen, £5.70, Jae paid', hidden: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kaiseki dinner, £1,000.00, Sam paid', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Rail pass,/, hidden: true })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Lamp, £40.00, Jae paid', hidden: true })).toBeNull();
  });
});
