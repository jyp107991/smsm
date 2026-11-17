/**
 * S5b screens (docs/slices/S5b.md "Decisions made here", "Interfaces"; DESIGN §4.7): the month's recap page, where
 * recaps and years are offered (Insights, Home), settle day (Home banner, Settings), the year in review, "on this day"
 * and an entry's comments, on the real screens over the in-memory Api. Written before the build (ENGINEERING §5, tests
 * first by someone else); each test names its SPEC ids and fails because the screens aren't there yet. The layout
 * half (320/390 px, both themes, axe) is tests/e2e/recap.spec.ts. Figures follow src/core/recap.test.ts.
 *
 * The household on Sat 14 Nov 2026 (TODAY) is src/screens/insights.test.tsx's; every entry is split 50/50:
 *   10 Apr        Groceries "First shop" £100.00 (Jae)
 *   10 May–10 Oct Rent & bills "Rent" £1,000.00 (Jae), Eating out "Dinner" £125.00 (Sam), Groceries "Weekly shop"
 *                 £240.00 (Sam): £1,365.00 a month; 28 May–28 Oct Sam pays Jae £300.00
 *   2 Nov         Travel "Rail pass" £720.00 (Jae), Japan trip; 3 Nov Groceries "Weekly shop" £240.00 (Jae);
 *   8 Nov         Eating out "Dinner" £210.00 (Sam)
 *
 * Worked by hand:
 *   October: £1,365.00; usual (May–Sep) £1,365.00 → "October cost £1,365.00 together, about the same as usual."
 *     Where it went: Rent & bills £1,000.00, Groceries £240.00, Eating out £125.00. Jae paid £1,000.00, Sam £365.00.
 *     The moment (no comments): "Rent, £1,000.00, 10 Oct".
 *   Today's balance: Oct end £155.00 to Jae, then Nov +£360.00 +£120.00 −£105.00 → "Sam owes Jae £530.00".
 *   November so far (settle day 14): "November so far cost £1,170.00 together."
 *   2026: £100.00 + 6 × £1,365.00 + £1,170.00 = £9,460.00; Japan £720.00.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedChapter, storedComment, storedExpense, storedSettlement, type CommentRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow, HouseholdRow, SettlementRow } from '../data/api';
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

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

/** Navigate as the browser would, after the app is showing. */
function at(path: string) {
  history.replaceState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  resetHistoryForTests();
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

type S5bTables = MemoryTables & { comments: CommentRow[]; households: (HouseholdRow & { settle_day?: number | null })[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S5bTables;
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();
const region = (name: string) => screen.getByRole('region', { name });
/** Whether a sentence is shown whole somewhere in `scope` (amounts may be their own elements). */
const shows = (scope: HTMLElement, sentence: string | RegExp) => within(scope).queryAllByText((_, el) => {
  const t = el?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return typeof sentence === 'string' ? t === sentence : sentence.test(t);
}).length > 0;

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

function recapHousehold(opts: Parameters<typeof couple>[0] = {}) {
  return couple({ chapters: [JAPAN], ...seed(), ...opts });
}

const HEADLINE = 'October cost £1,365.00 together, about the same as usual.';
const RECAP_READY = 'The recap for October is ready';

async function home() {
  return screen.findByRole('region', { name: 'Balance' });
}
async function goInsights() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Insights' }));
  return screen.findByRole('heading', { level: 1, name: 'Insights' });
}
async function goSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { level: 1, name: 'Settings' });
}

/** The "Settle day" combobox (native or not): picks the option named `name`. */
async function chooseSettleDay(name: string) {
  const box = await screen.findByRole('combobox', { name: 'Settle day' });
  if (box instanceof HTMLSelectElement) {
    const opt = within(box).getAllByRole<HTMLOptionElement>('option').find((o) => o.textContent.trim() === name);
    if (!opt) throw new Error(`no option ${name}`);
    fireEvent.change(box, { target: { value: opt.value } });
    return;
  }
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole('option', { name }));
}

// ─────────────────────────────── INS-2: the recap page ───────────────────────────────

describe('the recap page (INS-2)', () => {
  it('INS-2: /recap/2026-10 has the heading "October 2026" and the headline sentence', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    at('/recap/2026-10');
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    await waitFor(() => { expect(shows(region('Headline'), HEADLINE)).toBe(true); });
  });

  it('INS-2: Where it went: a list, largest first, each labelled with its amount', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    at('/recap/2026-10');
    await waitFor(() => { expect(text(region('Where it went'))).toMatch(/Rent & bills\s*£1,000\.00/); });
    const items = within(region('Where it went')).getAllByRole('listitem').map(text);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Rent & bills.*£1,000\.00/);
    expect(items[1]).toMatch(/Groceries.*£240\.00/);
    expect(items[2]).toMatch(/Eating out.*£125\.00/);
  });

  it('INS-2: more than four categories → five parts, the last "Everything else"', async () => {
    const extra = [
      spent('Taxi', 2000, 'Transport', JAE_ID, '2026-10-12'), spent('Cinema', 1500, 'Going out', SAM_ID, '2026-10-13'),
      spent('Plaster', 500, 'Health', JAE_ID, '2026-10-14'),
    ];
    const { layer } = recapHousehold({ expenses: [...seed().expenses, ...extra] });
    show(layer);
    await home();
    at('/recap/2026-10');
    await waitFor(() => { expect(within(region('Where it went')).getAllByRole('listitem')).toHaveLength(5); });
    const items = within(region('Where it went')).getAllByRole('listitem').map(text);
    expect(items[3]).toMatch(/Transport.*£20\.00/);
    expect(items[4]).toMatch(/Everything else.*£20\.00/);
  });

  it('INS-2 INS-3: Notes holds at most three', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    at('/recap/2026-10');
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    const notes = await screen.findByRole('region', { name: 'Notes' });
    expect(within(notes).queryAllByRole('listitem').length).toBeLessThanOrEqual(3);
  });

  it('INS-2: Between you: what each paid in October, today\'s balance, Settle up', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    at('/recap/2026-10');
    await waitFor(() => { expect(text(region('Between you'))).toMatch(/Jae\D*£1,000\.00/); });
    const between = region('Between you');
    expect(text(between)).toMatch(/Sam\D*£365\.00/);
    expect(shows(between, 'Sam owes Jae £530.00')).toBe(true);
    expect(within(between).getByRole('button', { name: 'Settle up' })).toBeTruthy();
  });

  it('INS-2: square → no Settle up on the recap', async () => {
    const square = paidBack(53000, '2026-11-10');
    const { layer } = recapHousehold({ settlements: [...seed().settlements, square] });
    show(layer);
    await home();
    at('/recap/2026-10');
    await waitFor(() => { expect(text(region('Between you'))).toMatch(/Jae\D*£1,000\.00/); });
    expect(within(region('Between you')).queryByRole('button', { name: 'Settle up' })).toBeNull();
  });

  it('INS-2: One moment: the biggest expense, as a link to it', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    at('/recap/2026-10');
    const link = await waitFor(() => within(region('One moment')).getByRole('link', { name: 'Rent, £1,000.00, 10 Oct' }));
    fireEvent.click(link);
    await waitFor(() => { expect(location.pathname).toMatch(/^\/entry\//); });
  });

  it('INS-2 ACT-4: One moment: the most-commented entry wins over the biggest', async () => {
    const s = seed();
    const dinner = s.expenses.find((x) => x.description === 'Dinner' && x.date === '2026-10-10');
    if (!dinner) throw new Error('no October dinner');
    const comments = [
      storedComment({ id: '00000000-0000-4000-8000-00000000cc11', expense_id: dinner.id, body: 'Lovely' }),
      storedComment({ id: '00000000-0000-4000-8000-00000000cc12', expense_id: dinner.id, author: JAE_ID, body: 'It was' }),
    ];
    const { layer } = recapHousehold({ ...s, comments });
    show(layer);
    await home();
    at('/recap/2026-10');
    await waitFor(() => { expect(within(region('One moment')).getByRole('link', { name: 'Dinner, £125.00, 10 Oct' })).toBeTruthy(); });
  });
});

// ─────────────────────────────── INS-2 INS-4: where recaps appear ───────────────────────────────

describe('where recaps appear (INS-2, INS-4, INS-7)', () => {
  it('INS-2 INS-4: Insights has "Recaps": the last 12 finished months, newest first, each a link', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await goInsights();
    const recaps = await screen.findByRole('region', { name: 'Recaps' });
    const names = within(recaps).getAllByRole('link').map((l) => l.getAttribute('aria-label') ?? text(l));
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('October 2026');
    expect(names[1]).toBe('September 2026');
    expect(names[11]).toBe('November 2025');
    expect(names).not.toContain('November 2026');
    fireEvent.click(within(recaps).getByRole('link', { name: 'October 2026' }));
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    expect(location.pathname).toBe('/recap/2026-10');
  });

  it('INS-7 INS-4: Insights has "Years": a link for every year with entries', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await goInsights();
    const years = await screen.findByRole('region', { name: 'Years' });
    expect(within(years).getAllByRole('link').map((l) => l.getAttribute('aria-label') ?? text(l))).toEqual(['2026 in review']);
    fireEvent.click(within(years).getByRole('link', { name: '2026 in review' }));
    await screen.findByRole('heading', { level: 1, name: '2026 in review' });
    expect(location.pathname).toBe('/year/2026');
  });

  it('INS-2: Home shows "The recap for October is ready" until it is opened on this phone', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    fireEvent.click(await screen.findByRole('link', { name: RECAP_READY }));
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    expect(location.pathname).toBe('/recap/2026-10');
    expect(localStorage.getItem('smsm-recap-seen')).toBe('2026-10');
    fireEvent.click(await screen.findByRole('tab', { name: 'Home' }));
    await home();
    await waitFor(() => { expect(screen.queryByRole('link', { name: RECAP_READY })).toBeNull(); });
  });

  it('INS-2: already opened on this phone (smsm-recap-seen) → no reminder', async () => {
    localStorage.setItem('smsm-recap-seen', '2026-10');
    const { layer } = recapHousehold();
    show(layer);
    await home();
    await screen.findByRole('region', { name: 'This month' });
    expect(screen.queryByRole('link', { name: RECAP_READY })).toBeNull();
  });

  it('INS-2: a household with nothing in October has no October recap to offer', async () => {
    const { layer } = couple({ expenses: [spent('Shop', 4000, 'Groceries', JAE_ID, '2026-11-03')] });
    show(layer);
    await home();
    await screen.findByRole('link', { name: 'Shop, £40.00, Jae paid' });
    expect(screen.queryByRole('link', { name: RECAP_READY })).toBeNull();
  });
});

// ─────────────────────────────── SET-4: settle day ───────────────────────────────

describe('settle day (SET-4)', () => {
  it('SET-4: Settings has "Settle day": Off, then 1st to 28th; choosing one stores it for the household', async () => {
    const c = recapHousehold();
    show(c.layer);
    await goSettings();
    const box = await screen.findByRole('combobox', { name: 'Settle day' });
    if (box instanceof HTMLSelectElement) {
      const opts = within(box).getAllByRole('option').map((o) => o.textContent.trim());
      expect(opts).toHaveLength(29);
      expect(opts.slice(0, 5)).toEqual(['Off', '1st', '2nd', '3rd', '4th']);
      expect(opts).toContain('21st');
      expect(opts).toContain('22nd');
      expect(opts).toContain('23rd');
      expect(opts[28]).toBe('28th');
    }
    await chooseSettleDay('15th');
    await settle(c.layer);
    await waitFor(() => { expect(tablesOf(c).households[0]?.settle_day).toBe(15); });
  });

  it('SET-4: Off turns it off', async () => {
    const c = recapHousehold({ settleDay: 15 });
    show(c.layer);
    await goSettings();
    await chooseSettleDay('Off');
    await settle(c.layer);
    await waitFor(() => { expect(tablesOf(c).households[0]?.settle_day).toBeNull(); });
  });

  it('SET-4 INS-2: on settle day Home says so, with the recap of the month so far and Settle up', async () => {
    const { layer } = recapHousehold({ settleDay: 14 });
    show(layer);
    await home();
    const banner = await screen.findByRole('link', { name: /^It[’']s settle day: the recap for November so far$/ });
    expect(screen.getAllByRole('button', { name: 'Settle up' }).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(banner);
    await screen.findByRole('heading', { level: 1, name: 'November 2026' });
    expect(location.pathname).toBe('/recap/2026-11');
    await waitFor(() => { expect(shows(region('Headline'), 'November so far cost £1,170.00 together.')).toBe(true); });
  });

  it('SET-4: not settle day (the 20th) → no settle-day banner', async () => {
    const { layer } = recapHousehold({ settleDay: 20 });
    show(layer);
    await home();
    await screen.findByRole('region', { name: 'This month' });
    expect(screen.queryByText(/settle day/i)).toBeNull();
  });
});

// ─────────────────────────────── INS-7: year in review ───────────────────────────────

describe('year in review (INS-7)', () => {
  it('INS-7: through January, Home offers "Your 2026 in review"; it opens /year/2026', async () => {
    const { layer } = recapHousehold({ today: '2027-01-10' });
    show(layer);
    await home();
    fireEvent.click(await screen.findByRole('link', { name: 'Your 2026 in review' }));
    await screen.findByRole('heading', { level: 1, name: '2026 in review' });
    expect(location.pathname).toBe('/year/2026');
    const main = screen.getByRole('main');
    await waitFor(() => { expect(text(main)).toContain('£9,460.00'); });
    expect(text(main)).toMatch(/Japan\D*£720\.00/);
    expect(text(main)).toMatch(/Rent & bills/);
  });

  it('INS-7: once opened, January\'s offer goes', async () => {
    const { layer } = recapHousehold({ today: '2027-01-10' });
    show(layer);
    await home();
    fireEvent.click(await screen.findByRole('link', { name: 'Your 2026 in review' }));
    await screen.findByRole('heading', { level: 1, name: '2026 in review' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Home' }));
    await home();
    await waitFor(() => { expect(screen.queryByRole('link', { name: 'Your 2026 in review' })).toBeNull(); });
  });

  it('INS-7: outside January there is no offer on Home', async () => {
    const { layer } = recapHousehold();
    show(layer);
    await home();
    await screen.findByRole('region', { name: 'This month' });
    expect(screen.queryByRole('link', { name: /in review$/ })).toBeNull();
  });
});

// ─────────────────────────────── INS-8: on this day ───────────────────────────────

describe('on this day (INS-8)', () => {
  const dishoom = spent('Dishoom', 8600, 'Eating out', SAM_ID, '2025-11-14', { place: 'London' });
  const remark = storedComment({ id: '00000000-0000-4000-8000-00000000cc21', expense_id: dishoom.id, body: 'Best naan', created_at: '2025-11-14T21:00:00.000Z' });

  it('INS-8: an entry from exactly a year ago with a comment: "A year ago: Dishoom, £86.00, in London"', async () => {
    const { layer } = recapHousehold({ expenses: [...seed().expenses, dishoom], comments: [remark] });
    show(layer);
    await home();
    const card = await screen.findByRole('region', { name: 'On this day' });
    expect(shows(card, 'A year ago: Dishoom, £86.00, in London')).toBe(true);
  });

  it('INS-8: no place → the chapter ("in Japan")', async () => {
    const lastYear = storedChapter({ id: '00000000-0000-4000-8000-00000000c409', name: 'Japan', start_date: '2025-11-10', end_date: '2025-11-20' });
    const ramen = spent('Ramen', 1800, 'Eating out', JAE_ID, '2025-11-14', { chapter_id: lastYear.id, country: 'JP' });
    const { layer } = recapHousehold({ chapters: [JAPAN, lastYear], expenses: [...seed().expenses, ramen] });
    show(layer);
    await home();
    const card = await screen.findByRole('region', { name: 'On this day' });
    expect(shows(card, 'A year ago: Ramen, £18.00, in Japan')).toBe(true);
  });

  it('INS-8: "Not now" hides it for the day', async () => {
    const { layer } = recapHousehold({ expenses: [...seed().expenses, dishoom], comments: [remark] });
    show(layer);
    await home();
    const card = await screen.findByRole('region', { name: 'On this day' });
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'On this day' })).toBeNull(); });
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Home' }));
    await home();
    expect(screen.queryByRole('region', { name: 'On this day' })).toBeNull();
  });

  it('INS-8: an entry from a year ago with neither comment nor chapter → no card', async () => {
    const { layer } = recapHousehold({ expenses: [...seed().expenses, dishoom] });
    show(layer);
    await home();
    await screen.findByRole('region', { name: 'This month' });
    expect(screen.queryByRole('region', { name: 'On this day' })).toBeNull();
  });
});

// ─────────────────────────────── ACT-4: comments ───────────────────────────────

describe('comments on an entry (ACT-4)', () => {
  const LAMP = storedExpense();
  const SAMS = storedComment();

  async function entryPage(opts: Parameters<typeof couple>[0] = {}) {
    const c = couple({ expenses: [LAMP], comments: [SAMS], ...opts });
    show(c.layer);
    await home();
    at(`/entry/${LAMP.id}`);
    const comments = await screen.findByRole('region', { name: 'Comments' });
    return { c, comments };
  }

  it('ACT-4: the entry page has "Comments": the thread with who wrote what', async () => {
    const { comments } = await entryPage();
    await waitFor(() => { expect(text(comments)).toMatch(/Sam\s*:?\s*Was this the big shop\?/); });
    expect(within(comments).getByRole('textbox', { name: 'Add a comment' })).toBeTruthy();
    expect(within(comments).getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('ACT-4: none of the partner\'s comments can be edited or deleted here', async () => {
    const { comments } = await entryPage();
    await waitFor(() => { expect(text(comments)).toContain('Was this the big shop?'); });
    expect(within(comments).queryByRole('button', { name: 'Edit comment' })).toBeNull();
    expect(within(comments).queryByRole('button', { name: 'Delete comment' })).toBeNull();
  });

  it('ACT-4: Send adds my comment to the thread, saved for the household; the box empties', async () => {
    const { c, comments } = await entryPage();
    const box = within(comments).getByRole('textbox', { name: 'Add a comment' });
    fireEvent.change(box, { target: { value: 'Yes, the big one' } });
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(text(region('Comments'))).toMatch(/Jae\s*:?\s*Yes, the big one/); });
    expect(within(region('Comments')).getByRole<HTMLInputElement>('textbox', { name: 'Add a comment' }).value).toBe('');
    await settle(c.layer);
    expect(tablesOf(c).comments.some((r) => r.body === 'Yes, the big one' && r.author === JAE_ID && r.expense_id === LAMP.id)).toBe(true);
    // Mine, so mine alone can be changed.
    expect(within(region('Comments')).getAllByRole('button', { name: 'Edit comment' })).toHaveLength(1);
    expect(within(region('Comments')).getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1);
  });

  it('ACT-4: a blank comment is not sent', async () => {
    const { c, comments } = await entryPage();
    fireEvent.change(within(comments).getByRole('textbox', { name: 'Add a comment' }), { target: { value: '   ' } });
    const send = within(comments).getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    await settle(c.layer);
    expect(tablesOf(c).comments).toHaveLength(1);
  });

  it('ACT-4: works offline: the comment shows at once and syncs later', async () => {
    const { c, comments } = await entryPage();
    c.network.set(false);
    fireEvent.change(within(comments).getByRole('textbox', { name: 'Add a comment' }), { target: { value: 'Offline thought' } });
    fireEvent.click(within(comments).getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(text(region('Comments'))).toContain('Offline thought'); });
    expect(tablesOf(c).comments).toHaveLength(1);
    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(tablesOf(c).comments.some((r) => r.body === 'Offline thought')).toBe(true); });
  });

  it('ACT-4: I edit my own comment', async () => {
    const mine = storedComment({ id: '00000000-0000-4000-8000-00000000cc04', author: JAE_ID, body: 'Big shop', created_at: '2026-11-13T09:00:00.000Z' });
    const { c, comments } = await entryPage({ comments: [SAMS, mine] });
    fireEvent.click(await within(comments).findByRole('button', { name: 'Edit comment' }));
    const editor = await waitFor(() => {
      const found = within(region('Comments')).getAllByRole('textbox').find((t) => (t as HTMLInputElement).value === 'Big shop');
      if (!found) throw new Error('no editor');
      return found;
    });
    fireEvent.change(editor, { target: { value: 'The big shop, yes' } });
    fireEvent.click(within(region('Comments')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(text(region('Comments'))).toContain('The big shop, yes'); });
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === mine.id)?.body).toBe('The big shop, yes');
  });

  it('ACT-4: I delete my own comment: it shows as "Deleted", kept in the database', async () => {
    const mine = storedComment({ id: '00000000-0000-4000-8000-00000000cc04', author: JAE_ID, body: 'Big shop', created_at: '2026-11-13T09:00:00.000Z' });
    const { c, comments } = await entryPage({ comments: [SAMS, mine] });
    fireEvent.click(await within(comments).findByRole('button', { name: 'Delete comment' }));
    // A confirmation, if there is one.
    const confirm = screen.queryAllByRole('button', { name: 'Delete' })[0];
    if (confirm) fireEvent.click(confirm);
    await waitFor(() => { expect(text(region('Comments'))).toContain('Deleted'); });
    expect(text(region('Comments'))).not.toContain('Big shop');
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === mine.id)?.deleted_at).toBeTruthy();
  });

  it('ACT-4: the comment count is in the entry row\'s name', async () => {
    const second = storedComment({ id: '00000000-0000-4000-8000-00000000cc05', author: JAE_ID, body: 'Yes' });
    const c = couple({ expenses: [LAMP], comments: [SAMS, second] });
    show(c.layer);
    await home();
    expect(await screen.findByRole('link', { name: /^Lamp, £40\.00, Jae paid\b.*\b2 comments$/ })).toBeTruthy();
  });

  it('ACT-4: one comment → "1 comment"; a deleted one isn\'t counted', async () => {
    const gone = storedComment({ id: '00000000-0000-4000-8000-00000000cc05', author: JAE_ID, body: 'Oops', deleted_at: '2026-11-13T10:00:00.000Z' });
    const c = couple({ expenses: [LAMP], comments: [SAMS, gone] });
    show(c.layer);
    await home();
    expect(await screen.findByRole('link', { name: /^Lamp, £40\.00, Jae paid\b.*\b1 comment$/ })).toBeTruthy();
  });
});
