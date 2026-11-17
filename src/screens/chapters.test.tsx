/**
 * S4a screens (docs/slices/S4.md "Screens", "Interfaces"): Settings → Chapters, the chapter sheet, the chapter
 * page, the Add sheet's Chapter chips, Home's "Adding to Japan", quick add into the current chapter, Activity's
 * Chapter filter and the entry page's link, on the real screens over the in-memory Api. Written before the build
 * (ENGINEERING §5, tests first by someone else); each test names its SPEC ids and fails because the screens
 * aren't there yet. The layout half (320 px, both themes, axe) is tests/e2e/chapters.spec.ts.
 *
 * The household on Sat 14 Nov 2026 (TODAY):
 *   Japan 🗾   trip, 1–9 Nov, JP, open: Groceries £120.00 (Jae), Eating out £1,000.00 (Sam), Travel £720.00 (Jae)
 *              → "£1,840.00 over 9 days, £204.44 a day"; Who paid: Jae £840.00, Sam £1,000.00
 *   New sofa 🛋️ project, no dates, open: Sofa £3,200.00 (Jae, Sam £1,600.00 each paid) → "£3,200.00 so far"
 *   Lamp       an everyday entry, £40.00, Jae paid
 * Every entry is split 50/50, so the one balance (CHP-4) is: Jae paid 84000 + 160000 + 4000 = 248000 against
 * shares 92000 + 160000 + 2000 = 254000 → "Jae owes Sam £60.00".
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedChapter, storedExpense, type ChapterRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
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

function at(path: string) {
  history.replaceState(null, '', path);
  // Tell the app's router, as the browser would on a navigation (it may already be showing a page).
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
// A boolean either way (an unchecked Radix radio has aria-checked="false" and no `checked` property).
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el instanceof HTMLInputElement && el.checked);
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

// ───────── the household ─────────
const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;
const JAPAN = storedChapter();
const SOFA = storedChapter({ id: '00000000-0000-4000-8000-00000000c402', name: 'New sofa', emoji: '🛋️', kind: 'project', country: null, start_date: null, end_date: null });

function spent(n: number, description: string, amount: number, category: string, payer: string, date: string, chapter: string | null): ExpenseRow {
  return storedExpense({
    id: E(n), description, amount_pence: amount, date, category_id: categoryId(category), paid: { [payer]: amount },
    shares: { [JAE_ID]: amount / 2, [SAM_ID]: amount / 2 }, chapter_id: chapter,
  });
}

const JAPAN_ENTRIES: ExpenseRow[] = [
  spent(501, 'Supermarket', 12000, 'Groceries', JAE_ID, '2026-11-02', JAPAN.id),
  spent(502, 'Kaiseki dinner', 100000, 'Eating out', SAM_ID, '2026-11-04', JAPAN.id),
  spent(503, 'Rail pass', 72000, 'Travel', JAE_ID, '2026-11-01', JAPAN.id),
];
const SOFA_ENTRY = storedExpense({
  id: E(504), description: 'Sofa', amount_pence: 320000, date: '2026-10-20', category_id: categoryId('Household'),
  paid: { [JAE_ID]: 160000, [SAM_ID]: 160000 }, shares: { [JAE_ID]: 160000, [SAM_ID]: 160000 }, chapter_id: SOFA.id,
});
const LAMP = storedExpense({ id: E(505) });

function chaptersHousehold(opts: Parameters<typeof couple>[0] = {}) {
  return couple({ chapters: [JAPAN, SOFA], expenses: [...JAPAN_ENTRIES, SOFA_ENTRY, LAMP], ...opts });
}

// ───────── getting around ─────────
async function goChapters() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  const link = screen.queryByRole('link', { name: 'Chapters' }) ?? screen.getByRole('button', { name: 'Chapters' });
  fireEvent.click(link);
  return screen.findByRole('heading', { level: 1, name: 'Chapters' });
}

async function chapterPage(chapter: ChapterRow) {
  at(`/chapter/${chapter.id}`);
  return screen.findByRole('heading', { level: 1, name: chapter.name });
}

async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}

const chips = (sheet: HTMLElement) => within(sheet).getByRole('group', { name: 'Chapter' });
const chip = (sheet: HTMLElement, name: string) => within(chips(sheet)).getByRole('button', { name });

const balance = () => screen.getByRole('region', { name: 'Balance' });
/** The balance sentence, whole ("Jae owes Sam £60.00": the amount is its own element). */
const saying = (sentence: string) => within(balance()).getAllByText((_, el) => el?.textContent === sentence)[0];

/** Chooses an option of a combobox: a native select or a list that opens. */
async function choose(box: HTMLElement, option: string) {
  if (box instanceof HTMLSelectElement) {
    const opt = within(box).getByRole<HTMLOptionElement>('option', { name: option });
    fireEvent.change(box, { target: { value: opt.value } });
    return;
  }
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

/** The chosen option's name: a select's selected option, or the combobox's own text or value. */
function chosen(box: HTMLElement): string {
  if (box instanceof HTMLSelectElement) return box.selectedOptions[0]?.textContent.trim() ?? '';
  return (box as HTMLInputElement).value || text(box);
}

/** Picks a day in a "Starts" / "Ends" group through the app's calendar. */
async function pickDay(sheet: HTMLElement, group: string, day: string) {
  fireEvent.click(within(within(sheet).getByRole('group', { name: group })).getByRole('button', { name: 'Pick a date' }));
  const picker = await screen.findByRole('dialog', { name: 'Pick a date' });
  fireEvent.click(within(picker).getByRole('button', { name: day }));
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull(); }, { timeout: 3000 });
}

// ─────────────────────────────── CHP-1: Settings → Chapters ───────────────────────────────

describe('Settings → Chapters (CHP-1, CHP-3)', () => {
  it('CHP-1: Settings has "Chapters"; the page lists open chapters, then "Closed", and offers "Start a chapter"', async () => {
    const OLD = storedChapter({ id: '00000000-0000-4000-8000-00000000c403', name: 'Lisbon', emoji: '🇵🇹', country: 'PT', start_date: '2026-05-01', end_date: '2026-05-06', closed: true });
    const { layer } = chaptersHousehold({ chapters: [JAPAN, SOFA, OLD] });
    show(layer);
    await goChapters();
    expect(location.pathname).toBe('/settings/chapters');
    const openList = screen.getByRole('list', { name: 'Chapters' });
    const links = within(openList).getAllByRole('link').map((l) => l.getAttribute('aria-label') ?? text(l));
    expect(links.some((n) => n.startsWith('Japan'))).toBe(true);
    expect(links.some((n) => n.startsWith('New sofa'))).toBe(true);
    expect(links.some((n) => n.startsWith('Lisbon'))).toBe(false);
    const closed = screen.getByRole('list', { name: 'Closed' });
    expect(within(closed).getByRole('link', { name: /^Lisbon/ })).toBeTruthy();
    // Each card shows its total (DESIGN §4.8).
    expect(text(within(openList).getByRole('link', { name: /^Japan/ }))).toContain('£1,840.00');
    expect(screen.getByRole('button', { name: 'Start a chapter' })).toBeTruthy();
  });

  it('CHP-1: "Closed" only shows when some chapter is closed', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await goChapters();
    expect(screen.queryByRole('list', { name: 'Closed' })).toBeNull();
  });

  it('CHP-1: a card opens its chapter page', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await goChapters();
    fireEvent.click(within(screen.getByRole('list', { name: 'Chapters' })).getByRole('link', { name: /^Japan/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
    expect(location.pathname).toBe(`/chapter/${JAPAN.id}`);
  });
});

// ─────────────────────────────── CHP-1: the chapter sheet ───────────────────────────────

describe('the chapter sheet (CHP-1)', () => {
  it('CHP-1: "New chapter": Name, Emoji, Kind (Project by default), Starts, Ends; Country only for a trip', async () => {
    const { layer } = couple();
    show(layer);
    await goChapters();
    fireEvent.click(screen.getByRole('button', { name: 'Start a chapter' }));
    const sheet = await screen.findByRole('dialog', { name: 'New chapter' });
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(within(sheet).getByRole('textbox', { name: 'Emoji' })).toBeTruthy();
    const kind = within(sheet).getByRole('radiogroup', { name: 'Kind' });
    expect(isChecked(within(kind).getByRole('radio', { name: 'Project' }))).toBe(true);
    expect(isChecked(within(kind).getByRole('radio', { name: 'Trip' }))).toBe(false);
    for (const g of ['Starts', 'Ends']) {
      const group = within(sheet).getByRole('group', { name: g });
      expect(isPressed(within(group).getByRole('button', { name: 'Not set' }))).toBe(true);
      expect(within(group).getByRole('button', { name: 'Pick a date' })).toBeTruthy();
    }
    expect(within(sheet).queryByRole('combobox', { name: 'Country' })).toBeNull();
    fireEvent.click(within(kind).getByRole('radio', { name: 'Trip' }));
    const country = await within(sheet).findByRole('combobox', { name: 'Country' });
    // The home country by default, by name.
    expect(chosen(country)).toBe('United Kingdom');
  });

  it('CHP-1: create a trip with dates and a country; it is stored and listed', async () => {
    const c = couple();
    show(c.layer);
    await goChapters();
    fireEvent.click(screen.getByRole('button', { name: 'Start a chapter' }));
    const sheet = await screen.findByRole('dialog', { name: 'New chapter' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Japan' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Emoji' }), { target: { value: '🗾' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Trip' }));
    await choose(await within(sheet).findByRole('combobox', { name: 'Country' }), 'Japan');
    await pickDay(sheet, 'Starts', 'Sun 1 Nov');
    await pickDay(sheet, 'Ends', 'Mon 9 Nov');
    expect(text(within(sheet).getByRole('group', { name: 'Starts', hidden: true }))).toContain('Sun 1 Nov');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save', hidden: true }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New chapter' })).toBeNull(); });
    await settle(c.layer);
    expect(tablesOf(c).chapters).toHaveLength(1);
    expect(tablesOf(c).chapters[0]).toMatchObject({
      name: 'Japan', emoji: '🗾', kind: 'trip', country: 'JP', start_date: '2026-11-01', end_date: '2026-11-09', closed: false,
    });
    expect(await within(screen.getByRole('list', { name: 'Chapters' })).findByRole('link', { name: /^Japan/ })).toBeTruthy();
  });

  it('CHP-1: a project with no dates saves with just a name', async () => {
    const c = couple();
    show(c.layer);
    await goChapters();
    fireEvent.click(screen.getByRole('button', { name: 'Start a chapter' }));
    const sheet = await screen.findByRole('dialog', { name: 'New chapter' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'New sofa' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(tablesOf(c).chapters[0]).toMatchObject({ name: 'New sofa', kind: 'project', start_date: null, end_date: null, country: null });
  });

  it('CHP-1: "Edit" on the chapter page opens "Edit chapter" filled in; a new name is saved', async () => {
    const c = chaptersHousehold();
    show(c.layer);
    await chapterPage(JAPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit chapter' });
    const name = within(sheet).getByRole<HTMLInputElement>('textbox', { name: 'Name' });
    expect(name.value).toBe('Japan');
    expect(isChecked(within(sheet).getByRole('radio', { name: 'Trip' }))).toBe(true);
    expect(chosen(within(sheet).getByRole('combobox', { name: 'Country' }))).toBe('Japan');
    fireEvent.change(name, { target: { value: 'Japan & Korea' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(tablesOf(c).chapters.find((r) => r.id === JAPAN.id)).toMatchObject({ name: 'Japan & Korea', kind: 'trip', country: 'JP', start_date: '2026-11-01' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Japan & Korea' })).toBeTruthy();
  });
});

// ─────────────────────────────── CHP-3 CHP-4: the chapter page ───────────────────────────────

describe('the chapter page (CHP-3, CHP-4)', () => {
  it('CHP-3: a trip: "£1,840.00 over 9 days, £204.44 a day", by category largest first, who paid, its entries', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await chapterPage(JAPAN);
    expect(text(screen.getByRole('region', { name: 'Summary' }))).toContain('£1,840.00 over 9 days, £204.44 a day');
    const byCategory = within(screen.getByRole('region', { name: 'By category' })).getAllByRole('listitem').map(text);
    // List items read "Groceries £120.00" (an emoji or spacing around them is fine), largest first.
    expect(byCategory).toHaveLength(3);
    expect(byCategory[0]).toMatch(/Eating out\s*£1,000\.00/);
    expect(byCategory[1]).toMatch(/Travel\s*£720\.00/);
    expect(byCategory[2]).toMatch(/Groceries\s*£120\.00/);
    const whoPaid = within(screen.getByRole('region', { name: 'Who paid' })).getAllByRole('listitem').map(text);
    expect(whoPaid.some((r) => r.includes('Jae') && r.includes('£840.00'))).toBe(true);
    expect(whoPaid.some((r) => r.includes('Sam') && r.includes('£1,000.00'))).toBe(true);
    const entries = screen.getByRole('list', { name: 'Entries' });
    expect(within(entries).getByRole('link', { name: 'Kaiseki dinner, £1,000.00, Sam paid' })).toBeTruthy();
    expect(within(entries).getByRole('link', { name: 'Rail pass, £720.00, Jae paid' })).toBeTruthy();
    expect(within(entries).getByRole('link', { name: 'Supermarket, £120.00, Jae paid' })).toBeTruthy();
    expect(within(entries).queryByRole('link', { name: /^Lamp,/ })).toBeNull();
    expect(within(entries).queryByRole('link', { name: /^Sofa,/ })).toBeNull();
  });

  it('CHP-3: a project says "£3,200.00 so far"; closed, "£3,200.00 in all"', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await chapterPage(SOFA);
    expect(text(screen.getByRole('region', { name: 'Summary' }))).toContain('£3,200.00 so far');
    expect(text(screen.getByRole('region', { name: 'Summary' }))).not.toMatch(/a day/);
  });

  it('CHP-3: a closed project says "£3,200.00 in all"', async () => {
    const { layer } = chaptersHousehold({ chapters: [JAPAN, { ...SOFA, closed: true }] });
    show(layer);
    await chapterPage(SOFA);
    expect(text(screen.getByRole('region', { name: 'Summary' }))).toContain('£3,200.00 in all');
  });

  it('CHP-4: one balance: chapter entries count in Home’s balance, and the chapter page shows no debt of its own', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await waitFor(() => { expect(saying('Jae owes Sam £60.00')).toBeTruthy(); });
    await chapterPage(JAPAN);
    expect(text(screen.getByRole('main'))).not.toMatch(/\bowes\b/);
  });

  it('CHP-3: "Close chapter" closes it (stored, kept); "Reopen" brings it back', async () => {
    const c = chaptersHousehold();
    show(c.layer);
    await chapterPage(JAPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Close chapter' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
    await settle(c.layer);
    expect(tablesOf(c).chapters.find((r) => r.id === JAPAN.id)?.closed).toBe(true);
    // A closed chapter can't be added to.
    expect(screen.queryByRole('button', { name: 'Add to this chapter' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByRole('button', { name: 'Close chapter' })).toBeTruthy();
    await settle(c.layer);
    expect(tablesOf(c).chapters.find((r) => r.id === JAPAN.id)?.closed).toBe(false);
    expect(tablesOf(c).chapters).toHaveLength(2);
  });
});

// ─────────────────────────────── CHP-2: adding into a chapter ───────────────────────────────

describe('adding into a chapter (CHP-2)', () => {
  it('CHP-2: "Add to this chapter" makes it current: the button becomes "Stop adding to it" and Home shows "Adding to Japan"', async () => {
    const { layer } = chaptersHousehold();
    show(layer);
    await chapterPage(JAPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Add to this chapter' }));
    expect(await screen.findByRole('button', { name: 'Stop adding to it' })).toBeTruthy();
    expect(localStorage.getItem('smsm-current-chapter')).toContain(JAPAN.id);
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    const chipOnHome = await screen.findByRole('button', { name: /^Adding to Japan/ });
    // Tapping it opens the chapter page.
    fireEvent.click(chipOnHome);
    expect(await screen.findByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
  });

  it('CHP-2: with a current chapter the Add sheet chooses it; Save puts the entry into it', async () => {
    const c = chaptersHousehold();
    show(c.layer);
    await chapterPage(JAPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Add to this chapter' }));
    await screen.findByRole('button', { name: 'Stop adding to it' });
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    const sheet = await openAddSheet();
    expect(isPressed(chip(sheet, 'Japan'))).toBe(true);
    expect(isPressed(chip(sheet, 'Everyday'))).toBe(false);
    expect(within(chips(sheet)).getByRole('button', { name: 'New sofa' })).toBeTruthy();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '18' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Ramen' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Ramen')?.chapter_id).toBe(JAPAN.id);
  });

  it('CHP-2: one tap changes it: "Everyday" saves an entry in no chapter', async () => {
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const c = chaptersHousehold();
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.click(chip(sheet, 'Everyday'));
    expect(isPressed(chip(sheet, 'Everyday'))).toBe(true);
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '3' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Milk' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Milk')?.chapter_id).toBeNull();
  });

  it('CHP-2: with no current chapter "Everyday" is chosen; closed chapters are not offered; no open chapter, no Chapter group', async () => {
    const { layer } = chaptersHousehold({ chapters: [JAPAN, { ...SOFA, closed: true }] });
    show(layer);
    const sheet = await openAddSheet();
    expect(isPressed(chip(sheet, 'Everyday'))).toBe(true);
    expect(isPressed(chip(sheet, 'Japan'))).toBe(false);
    expect(within(chips(sheet)).queryByRole('button', { name: 'New sofa' })).toBeNull();
  });

  it('CHP-2: with no open chapter the Add sheet has no Chapter group', async () => {
    const { layer } = couple({ chapters: [{ ...JAPAN, closed: true }] });
    show(layer);
    const sheet = await openAddSheet();
    expect(within(sheet).queryByRole('group', { name: 'Chapter' })).toBeNull();
  });

  it('CHP-2 ADD-1: quick add puts the entry into the current chapter', async () => {
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const c = chaptersHousehold();
    show(c.layer);
    expect(await screen.findByRole('button', { name: /^Adding to Japan/ })).toBeTruthy();
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42.50 Tesco' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await waitFor(() => { expect((box as HTMLInputElement).value).toBe(''); });
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Tesco')).toMatchObject({ amount_pence: 4250, chapter_id: JAPAN.id });
  });

  it('CHP-2: "Stop adding to it" clears it: no chip on Home, and new entries are everyday', async () => {
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const { layer } = chaptersHousehold();
    show(layer);
    await chapterPage(JAPAN);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop adding to it' }));
    expect(await screen.findByRole('button', { name: 'Add to this chapter' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    await screen.findByRole('region', { name: 'Balance' });
    expect(screen.queryByRole('button', { name: /^Adding to/ })).toBeNull();
    const sheet = await openAddSheet();
    expect(isPressed(chip(sheet, 'Everyday'))).toBe(true);
  });

  it('CHP-2: closing the current chapter stops adding to it', async () => {
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const { layer } = chaptersHousehold();
    show(layer);
    await chapterPage(JAPAN);
    fireEvent.click(screen.getByRole('button', { name: 'Close chapter' }));
    await screen.findByRole('button', { name: 'Reopen' });
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    await screen.findByRole('region', { name: 'Balance' });
    expect(screen.queryByRole('button', { name: /^Adding to/ })).toBeNull();
  });

  it('CHP-2: editing an entry keeps its own chapter, whatever this phone is adding to', async () => {
    localStorage.setItem('smsm-current-chapter', SOFA.id);
    const c = chaptersHousehold();
    at(`/entry/${E(502)}`);
    show(c.layer);
    await screen.findByRole('heading', { name: 'Kaiseki dinner' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog');
    expect(isPressed(chip(sheet, 'Japan'))).toBe(true);
    expect(isPressed(chip(sheet, 'New sofa'))).toBe(false);
  });
});

// ─────────────────────────────── ACT-1 CHP-2: Activity and the entry page ───────────────────────────────

describe('Activity’s Chapter filter and the entry page (ACT-1, CHP-2)', () => {
  const filters = () => screen.getByRole('group', { name: 'Filters', hidden: true });

  async function pickChapter(name: string) {
    fireEvent.click(within(filters()).getByRole('button', { name: 'Chapter', hidden: true }));
    const picker = await screen.findByRole('dialog', { name: 'Chapter' });
    const option = within(picker).queryAllByRole('radio', { name }).concat(within(picker).queryAllByRole('checkbox', { name }), within(picker).queryAllByRole('button', { name }))[0];
    if (!option) throw new Error(`no "${name}" in the Chapter picker`);
    fireEvent.click(option);
    return picker;
  }

  it('ACT-1 CHP-2: the Chapter filter offers Everyday and each chapter; Japan shows Japan’s entries only', async () => {
    const { layer } = chaptersHousehold();
    at('/activity');
    show(layer);
    await screen.findByRole('link', { name: 'Lamp, £40.00, Jae paid' });
    // The options are all there before one is picked (picking closes the picker).
    fireEvent.click(within(filters()).getByRole('button', { name: 'Chapter', hidden: true }));
    const open = await screen.findByRole('dialog', { name: 'Chapter' });
    for (const name of ['Everyday', 'Japan', 'New sofa']) {
      expect(within(open).queryAllByRole('radio', { name }).concat(within(open).queryAllByRole('checkbox', { name }), within(open).queryAllByRole('button', { name }))).not.toHaveLength(0);
    }
    fireEvent.click(within(open).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Chapter' })).toBeNull(); });
    await pickChapter('Japan');
    await waitFor(() => { expect(screen.queryByRole('link', { name: 'Lamp, £40.00, Jae paid', hidden: true })).toBeNull(); });
    expect(screen.getByRole('link', { name: 'Kaiseki dinner, £1,000.00, Sam paid', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Sofa,/, hidden: true })).toBeNull();
  });

  it('ACT-1 CHP-5: "Everyday" shows the entries in no chapter', async () => {
    const { layer } = chaptersHousehold();
    at('/activity');
    show(layer);
    await screen.findByRole('link', { name: 'Lamp, £40.00, Jae paid' });
    await pickChapter('Everyday');
    await waitFor(() => { expect(screen.queryByRole('link', { name: /^Kaiseki dinner,/, hidden: true })).toBeNull(); });
    expect(screen.getByRole('link', { name: 'Lamp, £40.00, Jae paid', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Sofa,/, hidden: true })).toBeNull();
  });

  it('CHP-2: the entry page names its chapter as a link to the chapter page', async () => {
    const { layer } = chaptersHousehold();
    at(`/entry/${E(502)}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Kaiseki dinner' });
    fireEvent.click(screen.getByRole('link', { name: /Japan/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
    expect(location.pathname).toBe(`/chapter/${JAPAN.id}`);
  });

  it('CHP-2: an everyday entry’s page has no chapter link', async () => {
    const { layer } = chaptersHousehold();
    at(`/entry/${LAMP.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    expect(screen.queryByRole('link', { name: /Japan|New sofa/ })).toBeNull();
  });
});

