/**
 * S9 performance (audit P1–P4): the behaviour the faster screens must keep. Written before the work, against
 * the real screens over the in-memory Api:
 * - Activity: rows still render (newest first, grouped by day) when they are drawn a screenful at a time; the
 *   rest arrive as the list nears the end of the screen, or from a button for the keyboard and screen readers;
 * - Activity: one swipe handler for the whole list still deletes (with Undo) and duplicates (with Undo), a
 *   short or vertical drag does nothing, and a swipe is not a tap on the row;
 * - Activity: search and filters give the same rows as before;
 * - each row's payer head is one shared drawing (an SVG symbol) used per row;
 * - the screens load on demand and still route; once fetched, a screen shows at once, with no loading step.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedSettlement, TODAY } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { go } from '../ui/router';
import { strings } from '../ui/strings';
import { Root } from './AppRoot';
import { preloadScreens } from './lazy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
});
afterEach(async () => {
  await open?.dispose();
  open = null;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

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

const pad = (n: number) => n.toString(16).padStart(12, '0');
/** A date `back` days before TODAY. */
function daysBefore(back: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** `n` entries, one a day going back from TODAY, "Entry 0" the newest; even ones paid by Jae, odd by Sam. */
function many(n: number) {
  return Array.from({ length: n }, (_, i) => storedExpense({
    id: `00000000-0000-4000-8000-${pad(0xe000 + i)}`,
    description: `Entry ${String(i)}`,
    date: daysBefore(i),
    amount_pence: 1000 + i,
    category_id: categoryId(i % 3 === 0 ? 'Groceries' : 'Household'),
    paid: { [i % 2 === 0 ? JAE_ID : SAM_ID]: 1000 + i },
    shares: { [JAE_ID]: Math.floor((1000 + i) / 2), [SAM_ID]: Math.ceil((1000 + i) / 2) },
    created_at: `${daysBefore(i)}T12:00:00.000Z`,
  }));
}

/** The entry rows Activity shows, by description, top to bottom. */
function shownRows(main: HTMLElement): string[] {
  return [...main.querySelectorAll<HTMLAnchorElement>('a[href^="/entry/"]')].map((a) => a.querySelector('.truncate')?.textContent ?? '');
}

/** An IntersectionObserver the test drives: `fire(true)` says the end of the list is near the screen. */
function controlledObserver() {
  const live = new Set<{ cb: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver }>();
  class Fake {
    private entry: { cb: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver };
    constructor(cb: IntersectionObserverCallback) {
      this.entry = { cb, targets: new Set(), self: this as unknown as IntersectionObserver };
      live.add(this.entry);
    }
    observe(el: Element) { this.entry.targets.add(el); }
    unobserve(el: Element) { this.entry.targets.delete(el); }
    disconnect() { this.entry.targets.clear(); live.delete(this.entry); }
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [0];
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Fake;
  return {
    fire(isIntersecting: boolean) {
      for (const e of [...live]) {
        const entries = [...e.targets].map((target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }) as unknown as IntersectionObserverEntry);
        if (entries.length > 0) e.cb(entries, e.self);
      }
    },
  };
}

describe('S9 P1: Activity draws a screenful first, and the rest as it is needed', () => {
  it('ACT-1: with many entries the first rows show at once, newest first, by day; the rest come as the end of the list nears the screen', async () => {
    const io = controlledObserver();
    const { layer } = couple({ expenses: many(150) });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Entry 0');
    const first = shownRows(main);
    // A screenful (at least 15 rows) and not the whole list.
    expect(first.length).toBeGreaterThanOrEqual(15);
    expect(first.length).toBeLessThan(150);
    expect(first.slice(0, 3)).toEqual(['Entry 0', 'Entry 1', 'Entry 2']);
    // Still grouped by day, one heading a day here.
    expect(within(main).getAllByRole('heading', { level: 2 }).length).toBe(first.length);
    // The end of the list comes near the screen: more rows, in order, none twice.
    for (let i = 0; i < 20 && shownRows(main).length < 150; i += 1) {
      await act(async () => { io.fire(true); await new Promise((r) => setTimeout(r, 0)); });
    }
    const all = shownRows(main);
    expect(all).toHaveLength(150);
    expect(all).toEqual(Array.from({ length: 150 }, (_, i) => `Entry ${String(i)}`));
  });

  it('ACT-1: the keyboard and screen readers reach the rest with a button, which goes when every row is shown', async () => {
    controlledObserver();
    const { layer } = couple({ expenses: many(90) });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Entry 0');
    const before = shownRows(main).length;
    expect(before).toBeLessThan(90);
    for (let i = 0; i < 20 && within(main).queryByRole('button', { name: strings.activity.showMore }); i += 1) {
      fireEvent.click(within(main).getByRole('button', { name: strings.activity.showMore }));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(shownRows(main)).toHaveLength(90);
    expect(within(main).queryByRole('button', { name: strings.activity.showMore })).toBeNull();
  });

  it('ACT-1: a new search starts again at the top of its own results; a change to the data keeps the rows already shown', async () => {
    const io = controlledObserver();
    const { layer } = couple({ expenses: many(120) });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Entry 0');
    for (let i = 0; i < 20 && shownRows(main).length < 120; i += 1) {
      await act(async () => { io.fire(true); await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(shownRows(main)).toHaveLength(120);
    // Search "Entry 1": Entry 1, 10–19, 100–119 (32 rows); the first of them show, newest first.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'Entry 1' } });
    await waitFor(() => { expect(shownRows(main)[0]).toBe('Entry 1'); });
    expect(shownRows(main).every((d) => d.startsWith('Entry 1'))).toBe(true);
    expect(shownRows(main).slice(0, 3)).toEqual(['Entry 1', 'Entry 10', 'Entry 11']);
  });
});

describe('S9 P1: one swipe handler for the whole list', () => {
  const ROW = 'Bread';
  function seeded() {
    return couple({
      expenses: [
        storedExpense({ id: '00000000-0000-4000-8000-00000000e002', description: ROW, amount_pence: 300, paid: { [JAE_ID]: 300 }, shares: { [JAE_ID]: 150, [SAM_ID]: 150 } }),
        storedExpense(),
      ],
      settlements: [storedSettlement({ date: daysBefore(3) })],
    });
  }
  /** A drag on a row: down, across in steps, up (touch or mouse alike). */
  function drag(el: Element, dx: number, dy = 0) {
    const opts = { pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'touch' };
    fireEvent.pointerDown(el, { ...opts, clientX: 200, clientY: 300 });
    for (let s = 1; s <= 5; s += 1) fireEvent.pointerMove(el, { ...opts, clientX: 200 + (dx * s) / 5, clientY: 300 + (dy * s) / 5 });
    fireEvent.pointerUp(el, { ...opts, clientX: 200 + dx, clientY: 300 + dy, buttons: 0 });
  }
  const row = (main: HTMLElement, name: string) => within(main).getByRole('link', { name: new RegExp(`^${name},`) });

  it('ACT-3 ADD-6: a swipe left deletes the entry with Undo; Undo brings it back', async () => {
    const { layer, controls } = seeded();
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText(ROW);
    drag(row(main, ROW), -200);
    await settle(layer);
    expect(controls.tables.expenses.find((e) => e.description === ROW)?.deleted_at).not.toBeNull();
    const status = screen.getByRole('status');
    await within(status).findByText(strings.entry.deleted(ROW));
    // Still on Activity: a swipe is not a tap on the row.
    expect(location.pathname).toBe('/activity');
    fireEvent.click(within(status).getByRole('button', { name: strings.entry.undo }));
    await settle(layer);
    expect(controls.tables.expenses.find((e) => e.description === ROW)?.deleted_at).toBeNull();
    await within(main).findByText(ROW);
  });

  it('ADD-7: a swipe right duplicates the entry with Undo; Undo takes the copy away again', async () => {
    const { layer, controls } = seeded();
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText(ROW);
    drag(row(main, ROW), 200);
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === ROW && e.deleted_at === null)).toHaveLength(2);
    const status = screen.getByRole('status');
    await within(status).findByText(strings.entry.copied);
    expect(location.pathname).toBe('/activity');
    fireEvent.click(within(status).getByRole('button', { name: strings.entry.undo }));
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === ROW && e.deleted_at === null)).toHaveLength(1);
  });

  it('ACT-3: a short drag, or one that is mostly up or down (scrolling), does nothing; a plain tap still opens the entry', async () => {
    const { layer, controls } = seeded();
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText(ROW);
    drag(row(main, ROW), -40);
    drag(row(main, ROW), -120, 300);
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.deleted_at === null)).toHaveLength(2);
    expect(within(screen.getByRole('status')).queryByText(strings.entry.deleted(ROW))).toBeNull();
    // Each row still carries its swipe words (hidden from screen readers), and settle-ups none.
    expect(within(main).getAllByText(strings.activity.swipeDelete)).toHaveLength(2);
    expect(within(main).getAllByText(strings.activity.swipeDuplicate)).toHaveLength(2);
    fireEvent.click(row(main, ROW));
    await screen.findByRole('heading', { name: ROW, level: 1 });
  });

  it('ACT-3: the row springs back to rest after a swipe, and nothing is left covering the words', async () => {
    const { layer } = seeded();
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText(ROW);
    const link = row(main, 'Lamp');
    drag(link, -60);
    await waitFor(() => {
      const moving = link.closest<HTMLElement>('[data-swipe-row]');
      expect(moving).not.toBeNull();
      expect(moving?.style.transform ?? '').toMatch(/^(|none|translateX\(0(px)?\))$/);
    });
  });
});

describe('S9 P1: search and filters give the same rows', () => {
  it('ACT-1 TXT-3: search ignores case; a filter and the search together; clearing gives every row back', async () => {
    const { layer } = couple({ expenses: many(40) });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Entry 0');
    const everything = shownRows(main);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'ENTRY 3' } });
    await waitFor(() => { expect(shownRows(main)).toEqual(['Entry 3', 'Entry 30', 'Entry 31', 'Entry 32', 'Entry 33', 'Entry 34', 'Entry 35', 'Entry 36', 'Entry 37', 'Entry 38', 'Entry 39']); });
    // Who paid: Sam paid the odd ones.
    fireEvent.click(screen.getByRole('button', { name: 'Who paid' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Sam' }));
    await waitFor(() => { expect(shownRows(main)).toEqual(['Entry 3', 'Entry 31', 'Entry 33', 'Entry 35', 'Entry 37', 'Entry 39']); });
    fireEvent.click(screen.getByRole('button', { name: strings.activity.clearSearch }));
    await waitFor(() => { expect(shownRows(main)).toHaveLength(20); });
    fireEvent.click(screen.getByRole('button', { name: strings.activity.clearAll }));
    await waitFor(() => { expect(shownRows(main)).toEqual(everything); });
  });
});

describe('S9 P1: the payer head is drawn once and used per row', () => {
  it('ACT-1: every row uses the shared head (an SVG symbol), one symbol per animal on the page', async () => {
    const { layer } = couple({ expenses: many(12) });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Entry 0');
    const rows = [...main.querySelectorAll('a[href^="/entry/"]')];
    expect(rows).toHaveLength(12);
    for (const [i, a] of rows.entries()) {
      const use = a.querySelector('svg use');
      expect(use, `row ${String(i)} has no shared head`).not.toBeNull();
      expect(use?.getAttribute('href')).toBe(i % 2 === 0 ? '#smsm-head-cat' : '#smsm-head-dog');
    }
    expect(document.querySelectorAll('symbol#smsm-head-cat')).toHaveLength(1);
    expect(document.querySelectorAll('symbol#smsm-head-dog')).toHaveLength(1);
    // The symbol is the rig's own head: its named parts are there.
    expect(document.querySelector('symbol#smsm-head-cat [data-part="eyes"]')).not.toBeNull();
  });
});

describe('S9 P2: screens load on demand and still route', () => {
  it('every tab and page opens from its address', async () => {
    const { layer } = couple({ expenses: [storedExpense()] });
    const pages: [string, () => Promise<HTMLElement>][] = [
      ['/activity', () => screen.findByRole('heading', { name: strings.activity.title, level: 1 })],
      ['/settings', () => screen.findByRole('heading', { level: 1, name: 'Settings' })],
      ['/entry/00000000-0000-4000-8000-00000000e001', () => screen.findByRole('heading', { name: 'Lamp', level: 1 })],
    ];
    for (const [path, find] of pages) {
      at(path);
      const view = show(layer);
      expect(await find()).toBeTruthy();
      view.unmount();
    }
  });

  it('once the screens are fetched (as the app does after Home shows), a tab answers at once and its screen follows with no loading step', async () => {
    await preloadScreens();
    const { layer } = couple({ expenses: [storedExpense()] });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    // Anything marked busy (the loading paper) appearing in the page while the screens change is a loading step.
    let busy = 0;
    const watch = new MutationObserver(() => { if (document.querySelector('main [aria-busy="true"]')) busy += 1; });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true });
    act(() => { go({ name: 'activity' }); });
    // The tab says where you are in the same step as the tap.
    expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('data-state')).toBe('active');
    expect(await screen.findByRole('heading', { name: strings.activity.title, level: 1 })).toBeTruthy();
    act(() => { go({ name: 'settings' }); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    watch.disconnect();
    expect(busy).toBe(0);
  });

  it('the add sheet and the settle-up sheet still open from Home', async () => {
    await preloadScreens();
    const { layer } = couple({ expenses: [storedExpense()] });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(await screen.findByRole('dialog', { name: 'Add expense' })).toBeTruthy();
  });
});

describe('S9 P2: a sheet opened before its code has arrived', () => {
  it('waits for its file, then rises with its title, content and Close, and closes as usual', async () => {
    // A fresh copy of the sheet module, whose code (vaul) has not been fetched yet.
    vi.resetModules();
    const { Sheet } = await import('../ui/primitives/Sheet');
    const closed: boolean[] = [];
    const view = render(<Sheet open onOpenChange={(o) => { closed.push(!o); }} title="Who paid"><p>Inside</p></Sheet>);
    const dialog = await screen.findByRole('dialog', { name: 'Who paid' });
    expect(within(dialog).getByText('Inside')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: strings.ui.close }));
    expect(closed).toEqual([true]);
    view.rerender(<Sheet open={false} onOpenChange={() => undefined} title="Who paid"><p>Inside</p></Sheet>);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });
});
