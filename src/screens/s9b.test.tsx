/**
 * S9b screens (docs/slices/S9b.md "Fixes" 12, 14, 17–20; docs/qa/S9-acceptance.md findings 12, 14, 17–20): tags in
 * the add/edit sheet, on the entry page and as an Activity filter; the toast never covering an open sheet; the recap's
 * animals and labelled bar; past recaps as month cards; the "Include chapters" caption; the chapter page's places,
 * photos and entries by day; the empty Inbox's animal; Settings' home country, regular payments and "Report a
 * problem"; a Bills calendar day listing its bills. On the real screens over the in-memory Api. Written before the
 * build (ENGINEERING §5, tests first by someone else). The layout half (44 px targets, 320 × 640, larger screens, axe,
 * the phone layout unchanged) is tests/e2e/s9b.spec.ts.
 *
 * What these tests read (choices made here where the brief leaves a name open; the builder matches these):
 *   Add/edit sheet: under "More details", a textbox "Add a tag"; Enter adds what was typed as a tag (a leading "#" is
 *     not part of the tag); each tag shows as a chip with a button "Remove <tag>"; the tags are saved with the entry.
 *   Entry page: a "Tags" line (as "Category", "Date": a term "Tags" with the tags beside it).
 *   Activity: a filter chip "Tag" in the group "Filters", shown when any entry has a tag; it opens a dialog "Tag"
 *     with "Any tag" and one radio per tag; picking one shows only entries with that tag; the chip then reads
 *     "Tag: <tag>" (as the other filters do).
 *   Toast: while a sheet is open, the toast's box is wholly above the sheet's top edge, or the toast has gone. The
 *     test reads where the toast layer is placed from its inline style (`top: Npx`, or `bottom: max(Npx, …)` as
 *     src/ui/primitives/Toast.tsx places it today), with the sheet's box faked (jsdom has no layout); if the builder
 *     places it another way, keep one of those two forms on the layer.
 *   Recap: both animals drawn by the rig (svg.rig-cat and svg.rig-dog); in "Where it went" each category's name and
 *     amount sit in the same item as its colour (an element whose inline style uses var(--cat-<colour>)).
 *   Insights: "Recaps" lists each month as a card (a link to the recap) showing the month, its total and one line.
 *     The "Include chapters" switch's description (aria-describedby) says what the current state does.
 *   Chapter page: a region "Places" (the places as a line of names), a region "Photos" (only when an entry in it has a
 *     receipt photo; images named "Receipt photo"), and in "Entries" the entries under day headings ("Wed 4 Nov"),
 *     newest day first, as Activity groups them.
 *   Inbox: with nothing in it, an animal from the rig (svg.rig).
 *   Settings: "Home country" with the household's home country (United Kingdom); a link to Bills (href "/bills",
 *     named for regular payments or bills); a button or link "Report a problem" (a button opens a dialog whose name
 *     says "problem").
 *   Bills: tapping a day of the calendar (the gridcell, or a button in it, named "Sun 1 Nov…") shows a region named
 *     by that day ("Sun 1 Nov") listing that day's bills with their amounts.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryId, couple, JAE_ID, SAM_ID, storedChapter, storedExpense, storedRecurring, TODAY, type RecurringRow,
} from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
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
afterEach(async () => {
  vi.restoreAllMocks();
  await open?.dispose();
  open = null;
});

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
function launchAt(path: string, layer: DataLayer) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
  return show(layer);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();

// ───────── the household ─────────
const E = (n: number) => `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`;
function spent(n: number, description: string, amount: number, category: string, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  return storedExpense({
    id: E(n), description, amount_pence: amount, date, category_id: categoryId(category), paid: { [payer]: amount },
    shares: { [JAE_ID]: amount / 2, [SAM_ID]: amount / 2 }, created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, ...over,
  });
}

// ───────── getting around ─────────
async function openAddSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
  return screen.findByRole('dialog', { name: 'Add expense' });
}
/** "More details" opened (once), and the tag box in it. */
async function tagBox(sheet: HTMLElement): Promise<HTMLElement> {
  if (!within(sheet).queryByRole('textbox', { name: 'Add a tag' })) fireEvent.click(within(sheet).getByRole('button', { name: 'More details' }));
  return within(sheet).findByRole('textbox', { name: 'Add a tag' });
}
function addTag(box: HTMLElement, tag: string) {
  fireEvent.change(box, { target: { value: tag } });
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
}
async function goActivity() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
  return screen.findByRole('heading', { level: 1, name: 'Activity' });
}
const rowNamed = (description: string) => within(screen.getByRole('main')).queryAllByRole('link', { name: new RegExp(`^${description},`) });

// ─────────────────────────────── 12: tags (ADD-4, ACT-1) ───────────────────────────────

describe('12 Tags (ADD-4, ACT-1)', () => {
  it('ADD-4: the Add sheet has "Add a tag" under More details; Enter adds a chip, "Remove …" takes one off; the tags are saved', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openAddSheet();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '30' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Flowers' } });
    const box = await tagBox(sheet);
    addTag(box, 'wedding');
    expect(await within(sheet).findByRole('button', { name: 'Remove wedding' })).toBeTruthy();
    // The box is ready for the next one; a leading # is not part of the tag.
    expect((box as HTMLInputElement).value).toBe('');
    addTag(box, '#gift');
    expect(await within(sheet).findByRole('button', { name: 'Remove gift' })).toBeTruthy();
    // Enter in the tag box adds a tag; it does not save the sheet.
    expect(screen.getByRole('dialog', { name: 'Add expense' })).toBeTruthy();
    expect(c.controls.tables.expenses.find((e) => e.description === 'Flowers')).toBeUndefined();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove gift' }));
    await waitFor(() => { expect(within(sheet).queryByRole('button', { name: 'Remove gift' })).toBeNull(); });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Flowers')?.tags).toEqual(['wedding']);
  });

  it('ADD-4: editing an entry shows its tags as chips; removing one and saving keeps the rest', async () => {
    const c = couple({ expenses: [spent(1, 'Cake', 2400, 'Gifts', JAE_ID, '2026-11-12', { tags: ['wedding', 'gift'] })] });
    launchAt(`/entry/${E(1)}`, c.layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog');
    await tagBox(sheet);
    expect(within(sheet).getByRole('button', { name: 'Remove wedding' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove gift' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === E(1))?.tags).toEqual(['wedding']);
  });

  it('ADD-4: the entry page shows its tags', async () => {
    const c = couple({ expenses: [spent(1, 'Cake', 2400, 'Gifts', JAE_ID, '2026-11-12', { tags: ['wedding', 'gift'] })] });
    launchAt(`/entry/${E(1)}`, c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Cake' });
    const label = screen.getAllByText((_, el) => (el ? text(el) === 'Tags' : false)).at(-1);
    expect(label, 'a "Tags" line').toBeTruthy();
    // The line holding the label holds the tags.
    let line: HTMLElement | null = label as HTMLElement;
    while (line && !(/wedding/.test(text(line)) && /gift/.test(text(line)))) line = line.parentElement;
    expect(line, 'the tags beside "Tags"').not.toBeNull();
    expect(line === screen.getByRole('main') || line?.tagName === 'ARTICLE', 'the tags are on the "Tags" line, not elsewhere on the page').toBe(false);
  });

  it('ACT-1: Activity has a Tag filter: picking a tag shows only entries with it, and the chip says which', async () => {
    const c = couple({
      expenses: [
        spent(1, 'Lamp', 4000, 'Household', JAE_ID, '2026-11-10', { tags: ['wedding'] }),
        spent(2, 'Tea', 500, 'Groceries', SAM_ID, '2026-11-11'),
        spent(3, 'Cake', 2400, 'Gifts', JAE_ID, '2026-11-12', { tags: ['wedding', 'gift'] }),
      ],
    });
    show(c.layer);
    await goActivity();
    await waitFor(() => { expect(rowNamed('Tea')).toHaveLength(1); });
    const filters = screen.getByRole('group', { name: 'Filters' });
    fireEvent.click(within(filters).getByRole('button', { name: 'Tag' }));
    const picker = await screen.findByRole('dialog', { name: 'Tag' });
    expect(within(picker).getByRole('radio', { name: 'Any tag' })).toBeTruthy();
    expect(within(picker).getByRole('radio', { name: 'gift' })).toBeTruthy();
    fireEvent.click(within(picker).getByRole('radio', { name: 'wedding' }));
    await waitFor(() => { expect(rowNamed('Tea')).toHaveLength(0); });
    expect(rowNamed('Lamp')).toHaveLength(1);
    expect(rowNamed('Cake')).toHaveLength(1);
    expect(within(filters).getByRole('button', { name: 'Tag: wedding' })).toBeTruthy();
  });

  it('ADD-4 ACT-1: quick add’s #tag still saves the tag, and search still finds it', async () => {
    const c = couple();
    show(c.layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '5 tea #picnic' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => /tea/i.test(e.description))?.tags).toEqual(['picnic']);
    await goActivity();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'picnic' } });
    await waitFor(() => { expect(within(screen.getByRole('main')).queryAllByRole('link', { name: /^tea,/i })).toHaveLength(1); });
  });
});

// ─────────────────────────────── 14: the toast and an open sheet (ADD-6) ───────────────────────────────

describe('14 Toast never covers a sheet (ADD-6)', () => {
  const SHEET_TOP = 200;
  const TOAST_HEIGHT = 56;
  /** Where the toast layer puts the toast, from its inline style (jsdom draws nothing). */
  function toastBox(layer: HTMLElement): { top: number; bottom: number } {
    const style = layer.getAttribute('style') ?? '';
    const top = /(?:^|;)\s*top:\s*(-?[\d.]+)px/.exec(style)?.[1];
    if (top !== undefined) return { top: Number(top), bottom: Number(top) + TOAST_HEIGHT };
    const bottom = /bottom:\s*(?:max\()?\s*(-?[\d.]+)px/.exec(style)?.[1];
    if (bottom === undefined) throw new Error(`the toast layer's place can't be read from its style: "${style}"`);
    const b = window.innerHeight - Number(bottom);
    return { top: b - TOAST_HEIGHT, bottom: b };
  }

  it('ADD-6: a toast showing when a sheet opens sits wholly above the sheet’s top edge (or goes); its Undo still works', async () => {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')?.value as (this: Element) => DOMRect;
    const H = window.innerHeight;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const rect = (top: number, bottom: number, left = 0, right = 390) => ({ top, bottom, left, right, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
      const status = this.closest('[role="status"]');
      if (status && status.getAttribute('aria-label') === 'Notifications' && status !== this) {
        const b = toastBox(status as HTMLElement);
        return rect(b.top, b.bottom, 16, 374);
      }
      if (this.matches('[role="dialog"]')) return rect(SHEET_TOP, H);
      const inSheet = this.closest('[role="dialog"]');
      if (inSheet && this.hasAttribute('data-toast-avoid')) return rect(H - 76, H);
      if (this.matches('nav')) return rect(H - 68, H);
      return real.call(this);
    });

    const c = couple();
    show(c.layer);
    const quick = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(quick, { target: { value: '12 tea' } });
    fireEvent.submit(quick.closest('form') as HTMLFormElement);
    const region = screen.getByRole('status', { name: 'Notifications' });
    await waitFor(() => { expect(text(region)).toMatch(/Saved/); });

    await openAddSheet();
    await wait(150);
    if (/Saved/.test(text(region))) {
      const b = toastBox(region);
      expect(b.bottom, `the toast (${String(b.top)}–${String(b.bottom)}) is above the sheet's top (${String(SHEET_TOP)})`).toBeLessThanOrEqual(SHEET_TOP);
      expect(b.top).toBeGreaterThanOrEqual(0);
      // Still the person's to use.
      const undo = within(region).getByRole('button', { name: 'Undo' });
      expect(undo.closest('[inert]')).toBeNull();
      expect(undo.closest('[aria-hidden="true"]')).toBeNull();
      fireEvent.click(undo);
      await settle(c.layer);
      expect(c.controls.tables.expenses.filter((e) => /tea/i.test(e.description) && e.deleted_at === null)).toHaveLength(0);
    }
  });
});

// ─────────────────────────────── 17, 18: recap and Insights (INS-2, INS-4) ───────────────────────────────

/** Six months of the same spending (insights.test.tsx's household, shorter): May–Oct, £1,365.00 a month. */
function monthsOfSpending(): ExpenseRow[] {
  const out: ExpenseRow[] = [];
  let n = 100;
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    out.push(
      spent(n++, 'Rent', 100000, 'Rent & bills', JAE_ID, `${m}-10`),
      spent(n++, 'Dinner', 12500, 'Eating out', SAM_ID, `${m}-10`),
      spent(n++, 'Weekly shop', 24000, 'Groceries', SAM_ID, `${m}-10`),
    );
  }
  out.push(spent(n, 'Weekly shop', 24000, 'Groceries', JAE_ID, '2026-11-03'));
  return out;
}

describe('17 Recap and Insights charts (INS-2, INS-4)', () => {
  it('INS-2: the recap shows the two animals (DESIGN §4.7)', async () => {
    const c = couple({ expenses: monthsOfSpending() });
    const view = launchAt('/recap/2026-10', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    await waitFor(() => { expect(view.container.querySelector('main svg.rig-cat')).not.toBeNull(); });
    expect(view.container.querySelector('main svg.rig-dog')).not.toBeNull();
  });

  it('INS-2: the recap’s bar is labelled directly: each category’s name and amount sit with its colour', async () => {
    const c = couple({ expenses: monthsOfSpending() });
    launchAt('/recap/2026-10', c.layer);
    const part = await screen.findByRole('region', { name: 'Where it went' });
    const expected = [['Rent & bills', '£1,000.00', 'walnut'], ['Groceries', '£240.00', 'moss'], ['Eating out', '£125.00', 'amber']] as const;
    const names = expected.map(([name]) => name);
    for (const [name, amount, colour] of expected) {
      const marks = Array.from(part.querySelectorAll<HTMLElement>('[style]')).filter((el) => (el.getAttribute('style') ?? '').includes(`--cat-${colour}`));
      expect(marks.length, `${name}: something in its colour`).toBeGreaterThan(0);
      // The smallest element holding the mark and the words holds this category's words only.
      const labelled = marks.some((mark) => {
        let el: HTMLElement | null = mark;
        while (el && el !== part && !(text(el).includes(name) && text(el).includes(amount))) el = el.parentElement;
        return el !== null && el !== part && names.filter((other) => other !== name).every((other) => !text(el).includes(other));
      });
      expect(labelled, `${name} ${amount} is labelled on (or right beside) its own colour, not in a separate key`).toBe(true);
    }
  });

  it('INS-4: past recaps are month cards: each shows its month, its total and a line', async () => {
    const c = couple({ expenses: monthsOfSpending() });
    launchAt('/insights', c.layer);
    const recaps = await screen.findByRole('region', { name: 'Recaps' });
    for (const month of ['October 2026', 'September 2026', 'May 2026']) {
      const card = within(recaps).getByRole('link', { name: new RegExp(month) });
      const words = text(card);
      expect(words, `${month}: its total`).toContain('£1,365.00');
      const rest = words.replace(month, '').replace('£1,365.00', '').replace(/[\s·,.:–-]/g, '');
      expect(rest.length, `${month}: one line besides the month and the total ("${words}")`).toBeGreaterThanOrEqual(3);
    }
  });

  it('INS-4: "Include chapters" says what the switch does in the state it is in', async () => {
    const c = couple({ expenses: monthsOfSpending(), chapters: [storedChapter()] });
    launchAt('/insights', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Insights' });
    const toggle = screen.getByRole('switch', { name: 'Include chapters' });
    const caption = () => {
      const ids = (toggle.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    };
    const isOn = () => (toggle as HTMLInputElement).checked || toggle.getAttribute('aria-checked') === 'true';
    const said: Record<'on' | 'off', string> = { on: '', off: '' };
    for (let i = 0; i < 2; i += 1) {
      const state = isOn() ? 'on' : 'off';
      said[state] = caption();
      expect(said[state], `a caption while ${state}`).not.toBe('');
      if (state === 'on') {
        expect(said.on, 'on: the caption doesn’t describe the off state').not.toMatch(/^off\b/i);
        expect(said.on).not.toMatch(/\bwithout\b|\bonly\b/i);
      } else {
        expect(said.off, 'off: the caption doesn’t describe the on state').not.toMatch(/^on\b/i);
        expect(said.off).toMatch(/\bwithout\b|\bonly\b|\bleft out\b|\bnot\b/i);
      }
      fireEvent.click(toggle);
      await wait(20);
    }
    expect(said.on).not.toBe(said.off);
  });
});

// ─────────────────────────────── 19: the chapter page (CHP-3) ───────────────────────────────

describe('19 Chapter page (CHP-3)', () => {
  const JAPAN = storedChapter();
  const japanEntries = (): ExpenseRow[] => [
    spent(601, 'Ramen', 570, 'Eating out', JAE_ID, '2026-11-04', { chapter_id: JAPAN.id, country: 'JP', place: 'Kyoto', receipt_path: '00000000-0000-4000-8000-0000000000c1/ramen.jpg' }),
    spent(602, 'Supermarket', 12000, 'Groceries', JAE_ID, '2026-11-02', { chapter_id: JAPAN.id, country: 'JP', place: 'Osaka' }),
    spent(603, 'Kaiseki dinner', 100000, 'Eating out', SAM_ID, '2026-11-04', { chapter_id: JAPAN.id, country: 'JP', place: 'Kyoto' }),
    spent(604, 'Rail pass', 72000, 'Travel', JAE_ID, '2026-11-01', { chapter_id: JAPAN.id, country: 'JP' }),
    spent(605, 'Lamp', 4000, 'Household', JAE_ID, '2026-11-04'),
  ];

  it('CHP-3: the chapter page lists its places, once each, as a line of names', async () => {
    const c = couple({ chapters: [JAPAN], expenses: japanEntries() });
    launchAt(`/chapter/${JAPAN.id}`, c.layer);
    const places = await screen.findByRole('region', { name: 'Places' });
    const words = text(places);
    expect(words.match(/Kyoto/g)).toHaveLength(1);
    expect(words.match(/Osaka/g)).toHaveLength(1);
  });

  it('CHP-3: its photos show as a strip when an entry in it has one; no Photos part when none has', async () => {
    const withPhoto = couple({ chapters: [JAPAN], expenses: japanEntries() });
    const view = launchAt(`/chapter/${JAPAN.id}`, withPhoto.layer);
    const photos = await screen.findByRole('region', { name: 'Photos' });
    expect(within(photos).getAllByRole('img', { name: 'Receipt photo' })).toHaveLength(1);
    view.unmount();
    await open?.dispose();
    open = null;

    const none = couple({ chapters: [JAPAN], expenses: japanEntries().map((e) => ({ ...e, receipt_path: null })) });
    launchAt(`/chapter/${JAPAN.id}`, none.layer);
    await screen.findByRole('region', { name: 'Places' });
    expect(screen.queryByRole('region', { name: 'Photos' })).toBeNull();
  });

  it('CHP-3: its entries are grouped by day under the day’s date, newest first, as in Activity', async () => {
    const c = couple({ chapters: [JAPAN], expenses: japanEntries() });
    launchAt(`/chapter/${JAPAN.id}`, c.layer);
    const entries = await screen.findByRole('region', { name: 'Entries' });
    const days = within(entries).getAllByRole('heading').map((h) => text(h)).filter((t) => /\d/.test(t));
    expect(days).toEqual(['Wed 4 Nov', 'Mon 2 Nov', 'Sun 1 Nov']);
    // Each entry comes after its day's heading and before the next day's.
    const order = Array.from(entries.querySelectorAll('h2, h3, h4, a')).map((el) => (el.tagName === 'A' ? `row:${(el.getAttribute('aria-label') ?? text(el)).split(',')[0] ?? ''}` : text(el)));
    const at = (s: string) => order.indexOf(s);
    expect(at('Wed 4 Nov')).toBeLessThan(at('row:Ramen'));
    expect(at('Wed 4 Nov')).toBeLessThan(at('row:Kaiseki dinner'));
    expect(at('row:Ramen')).toBeLessThan(at('Mon 2 Nov'));
    expect(at('Mon 2 Nov')).toBeLessThan(at('row:Supermarket'));
    expect(at('row:Supermarket')).toBeLessThan(at('Sun 1 Nov'));
    expect(at('Sun 1 Nov')).toBeLessThan(at('row:Rail pass'));
    // An everyday entry of the same day is not in the chapter.
    expect(order).not.toContain('row:Lamp');
  });
});

// ─────────────────────────────── 20: gaps ───────────────────────────────

describe('20 Gaps: Inbox, Settings, Bills (INB-2, REC-7)', () => {
  it('INB-2: the empty Inbox has an animal', async () => {
    const c = couple();
    const view = launchAt('/inbox', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await waitFor(() => { expect(view.container.querySelector('main svg.rig')).not.toBeNull(); });
  });

  it('Settings shows the home country', async () => {
    const c = couple();
    launchAt('/settings', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const box = screen.queryByRole('combobox', { name: 'Home country' });
    if (box instanceof HTMLSelectElement) {
      expect(box.selectedOptions[0]?.textContent).toBe('United Kingdom');
      return;
    }
    const label = screen.getAllByText((_, el) => (el ? text(el) === 'Home country' : false)).at(-1);
    expect(label, '"Home country"').toBeTruthy();
    let line: HTMLElement | null = label as HTMLElement;
    for (let i = 0; i < 3 && line && !text(line).includes('United Kingdom'); i += 1) line = line.parentElement;
    expect(line && text(line), 'United Kingdom beside "Home country"').toContain('United Kingdom');
  });

  it('REC-7: Settings links to the regular payments (Bills)', async () => {
    const c = couple();
    launchAt('/settings', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const link = within(screen.getByRole('main')).getAllByRole('link').find((a) => a.getAttribute('href') === '/bills');
    expect(link, 'a link to /bills').toBeTruthy();
    expect(text(link as HTMLElement)).toMatch(/regular|recurring|bills/i);
    fireEvent.click(link as HTMLElement);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bills' })).toBeTruthy();
  });

  it('Settings has "Report a problem", which opens the problem report', async () => {
    const c = couple();
    launchAt('/settings', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const control = screen.queryByRole('button', { name: 'Report a problem' }) ?? screen.queryByRole('link', { name: 'Report a problem' });
    expect(control, '"Report a problem"').not.toBeNull();
    if (control?.tagName === 'A') {
      expect(control.getAttribute('href')).toBeTruthy();
    } else if (control) {
      fireEvent.click(control);
      expect(await screen.findByRole('dialog', { name: /problem/i })).toBeTruthy();
    }
  });

  it('REC-7: tapping a day of the Bills calendar lists that day’s bills', async () => {
    const rent = storedRecurring();
    const netflix: RecurringRow = storedRecurring({
      id: '00000000-0000-4000-8000-00000000d002', description: 'Netflix', amount_pence: 1099, paid: { [JAE_ID]: 1099 },
      shares: { [JAE_ID]: 550, [SAM_ID]: 549 }, category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-01-20', posted_count: 10,
    });
    const rentPosted = storedExpense({
      id: E(401), description: 'Rent', amount_pence: 145000, date: '2026-11-01', category_id: rent.category_id, paid: rent.paid, shares: rent.shares,
      source: 'recurring', recurring_id: rent.id, occurrence_date: '2026-11-01', created_at: '2026-11-01T00:05:00.000Z', updated_at: '2026-11-01T00:05:00.000Z',
    });
    const c = couple({ recurring: [rent, netflix], expenses: [rentPosted] });
    launchAt('/bills', c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Bills' });
    const grid = await screen.findByRole('grid');
    const dayCell = (name: RegExp) => {
      const found = within(grid).queryAllByRole('button', { name }).concat(within(grid).queryAllByRole('gridcell', { name }));
      if (!found[0]) throw new Error(`no day ${String(name)}`);
      return found[0];
    };
    expect(TODAY).toBe('2026-11-14');

    fireEvent.click(dayCell(/^Sun 1 Nov/));
    const first = await screen.findByRole('region', { name: 'Sun 1 Nov' });
    expect(text(first)).toContain('Rent');
    expect(text(first)).toContain('£1,450.00');
    expect(text(first)).not.toContain('Netflix');

    fireEvent.click(dayCell(/^Fri 20 Nov/));
    const later = await screen.findByRole('region', { name: 'Fri 20 Nov' });
    expect(text(later)).toContain('Netflix');
    expect(text(later)).toContain('£10.99');
    expect(screen.queryByRole('region', { name: 'Sun 1 Nov' })).toBeNull();
  });
});
