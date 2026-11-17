/**
 * S5a screens (docs/slices/S5.md "Screens", "Interfaces"; DESIGN §4.1, §4.6): the fourth tab, Insights, and Home's
 * month-so-far line, on the real screens over the in-memory Api. Written before the build (ENGINEERING §5, tests
 * first by someone else); each test names its SPEC ids and fails because the screens aren't there yet. The layout
 * half (320/390 px, both themes, axe) is tests/e2e/insights.spec.ts. Figures follow src/core/insights.test.ts.
 *
 * The household on Sat 14 Nov 2026 (TODAY); every entry is split 50/50, in the UK unless said:
 *   10 Apr        Groceries "First shop" £100.00 (Jae)                                   ← the first month (not full)
 *   10 May–10 Oct Rent & bills "Rent" £1,000.00 (Jae), Eating out "Dinner" £125.00 (Sam), Groceries "Weekly shop"
 *                 £240.00 (Sam): £1,365.00 a month; 28 May–28 Oct Sam pays Jae £300.00
 *   2 Nov         Travel "Rail pass" £720.00 (Jae), in the Japan trip (1–9 Nov), JP
 *   3 Nov         Groceries "Weekly shop" £240.00 (Jae)
 *   8 Nov         Eating out "Dinner" £210.00 (Sam)
 *
 * Worked by hand:
 *   This month: £1,170.00 (everyday only £450.00). Where it went: Travel £720.00, Groceries £240.00, Eating out £210.00.
 *   Who paid: Jae £960.00, Sam £210.00. By country: Japan £720.00, UK £450.00.
 *   Last 3 months (1 Sep–14 Nov): 136500 × 2 + 117000 = £3,900.00; the 3 months before (1 Jun–14 Aug) £4,095.00
 *     → "£3,900.00, £195.00 less than the 3 months before".
 *   Trend: Dec 2025–Mar 2026 £0.00, Apr £100.00, May–Oct £1,365.00, Nov 2026 £1,170.00.
 *   Fairness: 3 months Jae 296000 / 390000 → 76%, Sam 24%; 12 months Jae 706000 / 946000 → 75%, Sam 25%; split 50/50.
 *   Usual (May–Oct, everyday) £1,365.00; on 14 Nov the usual pace is £637.00; £450.00 so far is £187 under → "£190".
 *   Notes: "Eating out is £85 over its usual (£210 so far, usually £125)".
 *   Month ends (Jae owed): Aug £120.00, Sep £137.50, Oct £155.00 → mean £137.50 → "about £130".
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedChapter, storedExpense, storedSettlement } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow, SettlementRow } from '../data/api';
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

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

// A boolean either way (an unchecked Radix radio has aria-checked="false" and no `checked` property).
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el instanceof HTMLInputElement && el.checked);
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

// ───────── the household ─────────
const JAPAN = storedChapter();
let n = 0;
const nextId = () => `00000000-0000-4000-8000-00000000e${(++n).toString(16).padStart(3, '0')}`;

function spent(description: string, amount: number, category: string, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  return storedExpense({
    id: nextId(), description, amount_pence: amount, date, category_id: categoryId(category), paid: { [payer]: amount },
    shares: { [JAE_ID]: amount / 2, [SAM_ID]: amount / 2 }, created_at: `${date}T12:00:00.000Z`, updated_at: `${date}T12:00:00.000Z`, ...over,
  });
}
function paidBack(amount: number, date: string): SettlementRow {
  return storedSettlement({ id: nextId().replace(/e(...)$/, 'f$1'), from_user: SAM_ID, to_user: JAE_ID, amount_pence: amount, date });
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
function seed(): { expenses: ExpenseRow[]; settlements: SettlementRow[] } {
  const expenses: ExpenseRow[] = [spent('First shop', 10000, 'Groceries', JAE_ID, '2026-04-10')];
  const settlements: SettlementRow[] = [];
  for (const m of MONTHS) {
    expenses.push(
      spent('Rent', 100000, 'Rent & bills', JAE_ID, `${m}-10`),
      spent('Dinner', 12500, 'Eating out', SAM_ID, `${m}-10`),
      spent('Weekly shop', 24000, 'Groceries', SAM_ID, `${m}-10`),
    );
    settlements.push(paidBack(30000, `${m}-28`));
  }
  expenses.push(
    spent('Rail pass', 72000, 'Travel', JAE_ID, '2026-11-02', { chapter_id: JAPAN.id, country: 'JP' }),
    spent('Weekly shop', 24000, 'Groceries', JAE_ID, '2026-11-03'),
    spent('Dinner', 21000, 'Eating out', SAM_ID, '2026-11-08'),
  );
  return { expenses, settlements };
}

function insightsHousehold(opts: Parameters<typeof couple>[0] = {}) {
  return couple({ chapters: [JAPAN], ...seed(), ...opts });
}

/** A household that started last month: no usual yet. */
function newHousehold() {
  return couple({ expenses: [spent('Shop', 5000, 'Groceries', JAE_ID, '2026-10-10'), spent('Shop', 4000, 'Groceries', JAE_ID, '2026-11-03')] });
}

const EATING_NOTE = 'Eating out is £85 over its usual (£210 so far, usually £125)';
const STANDING_ORDER = 'Sam has owed Jae at the end of each of the last 3 months, about £130 on average. A standing order of £130 a month would keep you about square.';

// ───────── getting around ─────────
async function goInsights() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Insights' }));
  return screen.findByRole('heading', { level: 1, name: 'Insights' });
}

const region = (name: string) => screen.getByRole('region', { name });
const period = (name: string) => within(screen.getByRole('radiogroup', { name: 'Period' })).getByRole('radio', { name });

/** Picks a toggle (a switch or a checkbox) by name. */
function toggle(name: string): HTMLElement {
  const found = screen.queryAllByRole('switch', { name }).concat(screen.queryAllByRole('checkbox', { name }));
  if (!found[0]) throw new Error(`no switch or checkbox "${name}"`);
  return found[0];
}

/** Whether a sentence is shown whole somewhere in `scope` (amounts may be their own elements). */
const shows = (scope: HTMLElement, sentence: string) => within(scope).queryAllByText((_, el) => el?.textContent.replace(/\s+/g, ' ').trim() === sentence).length > 0;

/** The Trend's columns: buttons or list items named "Nov 2026: £1,170.00". */
function columns(): string[] {
  const trend = region('Trend');
  const marks = within(trend).queryAllByRole('button').concat(within(trend).queryAllByRole('listitem'));
  const names = marks.map((m) => m.getAttribute('aria-label') ?? text(m)).filter((s) => /^[A-Z][a-z]{2} \d{4}: £[\d,]+\.\d\d$/.test(s));
  return [...new Set(names)];
}

/** The "Chapter" period: a combobox (native or not) or a button that opens a list; picks `name`. */
async function chooseChapter(name: RegExp) {
  const box = screen.queryAllByRole('combobox', { name: 'Chapter' })[0];
  if (box instanceof HTMLSelectElement) {
    const opt = within(box).getAllByRole<HTMLOptionElement>('option').find((o) => name.test(o.textContent));
    if (!opt) throw new Error('no such chapter option');
    fireEvent.change(box, { target: { value: opt.value } });
    return;
  }
  fireEvent.click(box ?? screen.getByRole('button', { name: /^Chapter/ }));
  const option = await waitFor(() => {
    const found = screen.queryAllByRole('option', { name }).concat(screen.queryAllByRole('menuitemradio', { name }), screen.queryAllByRole('menuitem', { name }), screen.queryAllByRole('radio', { name }), screen.queryAllByRole('button', { name }));
    if (!found[0]) throw new Error('chapter list not open');
    return found[0];
  });
  fireEvent.click(option);
}

// ─────────────────────────────── INS-4: the tab ───────────────────────────────

describe('the Insights tab (INS-4)', () => {
  it('INS-4: the fourth tab is "Insights"; it opens /insights with the heading "Insights"', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent.trim());
    expect(tabs).toEqual(['Home', 'Activity', 'Bills', 'Insights']);
    await goInsights();
    expect(location.pathname).toBe('/insights');
  });

  it('INS-4: the Period radios: This month (chosen), Last 3 months, Last 12 months, This year, and a Chapter choice when there are chapters', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    const radios = within(screen.getByRole('radiogroup', { name: 'Period' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? text(r));
    expect(radios.slice(0, 4)).toEqual(['This month', 'Last 3 months', 'Last 12 months', 'This year']);
    expect(isChecked(period('This month'))).toBe(true);
    expect(screen.queryAllByRole('combobox', { name: 'Chapter' }).length + screen.queryAllByRole('button', { name: /^Chapter/ }).length).toBeGreaterThan(0);
  });

  it('INS-4: no chapters → no Chapter choice', async () => {
    const { layer } = insightsHousehold({ chapters: [], expenses: seed().expenses.map((x) => ({ ...x, chapter_id: null })) });
    show(layer);
    await goInsights();
    expect(screen.queryAllByRole('combobox', { name: 'Chapter' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Chapter/ })).toHaveLength(0);
  });
});

// ─────────────────────────────── INS-4: the figures ───────────────────────────────

describe('Insights figures, This month (INS-4, CHP-5, PLC-7)', () => {
  it('INS-4: Total: "£1,170.00" this month, chapters included', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Total'))).toContain('£1,170.00'); });
  });

  it('INS-4: Where it went: by category, largest first, labelled with the amount', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Where it went'))).toMatch(/Travel\s*£720\.00/); });
    const t = text(region('Where it went'));
    expect(t).toMatch(/Groceries\s*£240\.00/);
    expect(t).toMatch(/Eating out\s*£210\.00/);
    expect(t.indexOf('Travel')).toBeLessThan(t.indexOf('Groceries'));
    expect(t.indexOf('Groceries')).toBeLessThan(t.indexOf('Eating out'));
    expect(t).not.toContain('Rent');
  });

  it('INS-4: Trend: 12 named columns, Dec 2025 to Nov 2026', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(columns()).toHaveLength(12); });
    const names = columns();
    expect(names).toContain('Nov 2026: £1,170.00');
    expect(names).toContain('Oct 2026: £1,365.00');
    expect(names).toContain('Apr 2026: £100.00');
    expect(names).toContain('Dec 2025: £0.00');
    expect(names.some((x) => x.startsWith('Nov 2025'))).toBe(false);
  });

  it('INS-4 MB-1: Who paid: "Jae £960.00", "Sam £210.00"', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Who paid'))).toMatch(/Jae\s*£960\.00/); });
    expect(text(region('Who paid'))).toMatch(/Sam\s*£210\.00/);
  });

  it('INS-5: Fairness over 3 and 12 months, beside the split, in plain words', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Fairness'))).toContain('Jae paid 76%, Sam 24%'); });
    const t = text(region('Fairness'));
    expect(t).toContain('Jae paid 75%, Sam 25%');
    expect(t).toContain('your split is 50/50');
    expect(t).not.toMatch(/\b(unfair|fair share|should|owes? more)\b/i);
  });

  it('PLC-7: By country, only when there is more than one: Japan £720.00 and the UK £450.00', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('By country'))).toContain('£720.00'); });
    expect(text(region('By country'))).toContain('£450.00');
  });

  it('PLC-7: one country → no By country', async () => {
    const { layer } = insightsHousehold({ expenses: seed().expenses.map((x) => ({ ...x, country: 'GB' })) });
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Total'))).toContain('£1,170.00'); });
    expect(screen.queryByRole('region', { name: 'By country' })).toBeNull();
  });

  it('INS-3 INS-6: Notes lists each note in words, and the standing-order hint', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(shows(region('Notes'), EATING_NOTE)).toBe(true); });
    expect(within(region('Notes')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(1);
    expect(shows(region('Notes'), STANDING_ORDER)).toBe(true);
  });

  it('INS-6: no standing-order hint when they settle up to square each month', async () => {
    const { expenses } = seed();
    const settlements = MONTHS.map((m, i) => paidBack(i === 0 ? 36750 : 31750, `${m}-28`)); // square at every month end
    const { layer } = insightsHousehold({ expenses, settlements });
    show(layer);
    await goInsights();
    await waitFor(() => { expect(shows(region('Notes'), EATING_NOTE)).toBe(true); });
    expect(text(screen.getByRole('main'))).not.toContain('standing order');
  });
});

describe('Include chapters (CHP-5, PLC-7)', () => {
  it('CHP-5: "Include chapters" is on; off shows everyday spending only (total, where it went, by country)', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    const sw = toggle('Include chapters');
    expect(isChecked(sw)).toBe(true);
    await waitFor(() => { expect(text(region('Total'))).toContain('£1,170.00'); });
    fireEvent.click(sw);
    await waitFor(() => { expect(isChecked(toggle('Include chapters'))).toBe(false); });
    await waitFor(() => { expect(text(region('Total'))).toContain('£450.00'); });
    expect(text(region('Where it went'))).not.toContain('Travel');
    expect(screen.queryByRole('region', { name: 'By country' })).toBeNull();
    expect(columns()).toContain('Nov 2026: £450.00');
  });
});

describe('Periods and the comparison (INS-4)', () => {
  it('INS-4: Last 3 months: "£3,900.00, £195.00 less than the 3 months before"', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    fireEvent.click(period('Last 3 months'));
    await waitFor(() => { expect(isChecked(period('Last 3 months'))).toBe(true); });
    await waitFor(() => { expect(shows(region('Total'), '£3,900.00, £195.00 less than the 3 months before')).toBe(true); });
    expect(text(region('Who paid'))).toMatch(/Jae\s*£2,960\.00/);
    expect(text(region('Who paid'))).toMatch(/Sam\s*£940\.00/);
  });

  it('INS-4: Last 12 months and This year', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    fireEvent.click(period('Last 12 months'));
    // 10000 + 6 × 136500 + 117000 = 946000.
    await waitFor(() => { expect(text(region('Total'))).toContain('£9,460.00'); });
    fireEvent.click(period('This year'));
    await waitFor(() => { expect(isChecked(period('This year'))).toBe(true); });
    expect(text(region('Total'))).toContain('£9,460.00');
    expect(text(region('Where it went'))).toMatch(/Rent & bills\s*£6,000\.00/);
  });

  it('INS-4 CHP-3: a chapter as the period: Japan → £720.00', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await chooseChapter(/Japan/);
    await waitFor(() => { expect(text(region('Total'))).toContain('£720.00'); });
    expect(text(region('Total'))).not.toContain('£1,170.00');
    expect(text(region('Where it went'))).toMatch(/Travel\s*£720\.00/);
    expect(text(region('Where it went'))).not.toContain('Groceries');
  });
});

describe('"What\'s this?" (INS-4, DATA_MODEL §5)', () => {
  it('INS-4: every figure has a "What\'s this?" that opens its one-line definition in a small sheet', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await goInsights();
    await waitFor(() => { expect(text(region('Total'))).toContain('£1,170.00'); });
    for (const name of ['Total', 'Where it went', 'Trend', 'Who paid', 'Fairness']) {
      expect(within(region(name)).getAllByRole('button', { name: "What's this?" }).length, name).toBeGreaterThan(0);
    }
    fireEvent.click(within(region('Total')).getAllByRole('button', { name: "What's this?" })[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    expect(sheet.getAttribute('aria-label') ?? sheet.getAttribute('aria-labelledby')).toBeTruthy();
    expect(text(sheet).length).toBeGreaterThan(20);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });
});

// ─────────────────────────────── INS-1: Home ───────────────────────────────

describe('Home: the month so far (INS-1, CHP-5)', () => {
  it('INS-1: "This month": "£450.00 so far · about £190 under your usual pace" (everyday only)', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await settle(layer);
    await waitFor(() => { expect(text(region('This month'))).toContain('£450.00 so far'); });
    expect(text(region('This month'))).toContain('· about £190 under your usual pace');
  });

  it('INS-1: over the usual pace says "over"', async () => {
    const { expenses, settlements } = seed();
    // £1,000.00 more groceries on 12 Nov: £1,450.00 so far, £813 over → "£810".
    const { layer } = insightsHousehold({ expenses: [...expenses, spent('Big shop', 100000, 'Groceries', JAE_ID, '2026-11-12')], settlements });
    show(layer);
    await waitFor(() => { expect(text(region('This month'))).toContain('£1,450.00 so far'); });
    expect(text(region('This month'))).toContain('· about £810 over your usual pace');
  });

  it('INS-1 INS-3: Home shows at most one note', async () => {
    const { layer } = insightsHousehold();
    show(layer);
    await waitFor(() => { expect(text(region('This month'))).toContain('£450.00 so far'); });
    const main = screen.getByRole('main');
    const shown = [EATING_NOTE, STANDING_ORDER].filter((s) => shows(main, s));
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(1);
  });

  it('INS-1 INS-3: with fewer than 3 full months there is no usual: Home has the amount only, Insights says nothing of a usual', async () => {
    const { layer } = newHousehold();
    show(layer);
    await waitFor(() => { expect(text(region('This month'))).toContain('£40.00 so far'); });
    expect(text(region('This month'))).not.toContain('usual');
    await goInsights();
    await waitFor(() => { expect(text(region('Total'))).toContain('£40.00'); });
    expect(text(screen.getByRole('main'))).not.toMatch(/usual/i);
  });
});
