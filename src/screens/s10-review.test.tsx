/**
 * S10 fresh review (screens). Written before the fix. On Sat 14 Nov 2026, Jae and Sam share rent and a big shop; Jae has
 * her own gym (£35.00 on the 2nd: three posted) and Duolingo (£7.99 on the 9th: two posted); Sam his own Audible.
 *   Finding 2: Activity, Whose on its default ("Shared and own"), with a search: the line counts the shared entries
 *     ("1 shared entry · £60.00") and then each person's own ("· Jae’s own: 2 · £15.98"); only own rows on screen:
 *     "0 shared entries · £0.00 · Jae’s own: 3 · £105.00", never "0 entries · £0.00".
 *   Finding 3: a row cached or queued before S10 has no owner_id at all: it reads as shared (Edit and Delete there).
 *   Finding 6: the history line for a change of whose also says what else the same save changed.
 *   Finding 7: the own sections' lines name the person ("No subscriptions in Jae’s own regular payments.",
 *     "Jae’s own regular payments, never in the figures above.").
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring, type RecurringRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import type { ExpenseRow } from '../data/api';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';
import { historyLine } from './shared/words';

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
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, ' ').trim();

const R = (n: number) => `00000000-0000-4000-8000-00000000d${n.toString().padStart(3, '0')}`;
const RENT = storedRecurring({ id: R(1), paid: { [JAE_ID]: 145000, [SAM_ID]: 0 }, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 } });
const mineOf = (owner: string, amount: number): Partial<RecurringRow> => ({ paid: { [owner]: amount }, shares: { [owner]: amount }, split_mode: 'treat', split_params: null, owner_id: owner });
const GYM = storedRecurring({ id: R(2), description: 'Gym', amount_pence: 3500, category_id: categoryId('Health'), start_date: '2026-09-02', posted_count: 3, ...mineOf(JAE_ID, 3500) });
const DUO = storedRecurring({ id: R(3), description: 'Duolingo', amount_pence: 799, category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-10-09', posted_count: 2, ...mineOf(JAE_ID, 799) });
const AUDIBLE = storedRecurring({ id: R(4), description: 'Audible', amount_pence: 899, category_id: categoryId('Subscriptions'), is_subscription: true, start_date: '2026-11-05', posted_count: 1, ...mineOf(SAM_ID, 899) });

function posted(n: number, t: RecurringRow, date: string): ExpenseRow {
  return storedExpense({
    id: `00000000-0000-4000-8000-00000000e${n.toString().padStart(3, '0')}`, description: t.description, amount_pence: t.amount_pence, date,
    category_id: t.category_id, paid: t.paid, shares: t.shares, split_mode: t.split_mode, split_params: t.split_params, source: 'recurring',
    recurring_id: t.id, occurrence_date: date, owner_id: t.owner_id, created_at: `${date}T00:05:00.000Z`, updated_at: `${date}T00:05:00.000Z`,
  });
}
const SHOP = storedExpense({ id: '00000000-0000-4000-8000-00000000e100', description: 'Big shop', amount_pence: 6000, date: '2026-11-12', category_id: categoryId('Groceries'), paid: { [JAE_ID]: 6000 }, shares: { [JAE_ID]: 3000, [SAM_ID]: 3000 } });
const ENTRIES = [
  posted(101, RENT, '2026-11-01'),
  posted(102, GYM, '2026-09-02'), posted(103, GYM, '2026-10-02'), posted(104, GYM, '2026-11-02'),
  posted(105, DUO, '2026-10-09'), posted(106, DUO, '2026-11-09'),
  posted(107, AUDIBLE, '2026-11-05'),
  SHOP,
];

/** An entry as a phone cached or queued it before S10: no owner_id key at all. */
function legacyLamp(): ExpenseRow {
  const row: Partial<ExpenseRow> = storedExpense({ description: 'Lamp' });
  delete row.owner_id;
  return row as ExpenseRow;
}

async function goTab(name: 'Bills' | 'Activity' | 'Insights') {
  fireEvent.click(await screen.findByRole('tab', { name }));
  return screen.findByRole('heading', { level: 1, name });
}
function search(main: HTMLElement, words: string) {
  fireEvent.change(within(main).getByRole('searchbox', { name: /search/i }), { target: { value: words } });
}

describe('S10 review 2: Activity’s line with Whose on its default', () => {
  it('REC-12: a search showing shared and own rows: the shared count and total, then each person’s own', async () => {
    const c = couple({ recurring: [RENT, GYM, DUO, AUDIBLE], expenses: ENTRIES });
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    await waitFor(() => { expect(within(main).getAllByRole('link', { name: /^Big shop/ }).length).toBeGreaterThan(0); });
    // "o": Big shop (shared), Duolingo twice (Jae's own); never Audible, Rent or the gym.
    search(main, 'o');
    await waitFor(() => { expect(text(main)).toContain('1 shared entry · £60.00 · Jae’s own: 2 · £15.98'); });
  });

  it('REC-12: a search showing only own rows never reads "0 entries · £0.00"', async () => {
    const c = couple({ recurring: [RENT, GYM, DUO, AUDIBLE], expenses: ENTRIES });
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    await waitFor(() => { expect(within(main).getAllByRole('link', { name: /^Gym/ }).length).toBeGreaterThan(0); });
    search(main, 'gym');
    await waitFor(() => { expect(text(main)).toContain('0 shared entries · £0.00 · Jae’s own: 3 · £105.00'); });
    expect(text(main)).not.toMatch(/(^|[^d] )0 entries · £0\.00/);
  });

  it('REC-12: a search with no own rows reads as before ("1 entry · £60.00")', async () => {
    const c = couple({ recurring: [RENT, GYM, DUO, AUDIBLE], expenses: ENTRIES });
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    await waitFor(() => { expect(within(main).getAllByRole('link', { name: /^Big shop/ }).length).toBeGreaterThan(0); });
    search(main, 'big shop');
    await waitFor(() => { expect(text(main)).toContain('1 entry · £60.00'); });
    expect(text(main)).not.toContain('’s own:');
  });
});

describe('S10 review 3: a row from before S10 (no owner_id at all) is shared', () => {
  it('REC-9: Jae opens a cached Lamp with no owner_id: Edit and Delete are there, and it never says whose own it is', async () => {
    const c = couple({ expenses: [legacyLamp()] });
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    fireEvent.click((await within(main).findAllByRole('link', { name: /^Lamp, £40\.00/ }))[0] as HTMLElement);
    await screen.findByRole('heading', { level: 1, name: 'Lamp' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(text(screen.getByRole('main'))).not.toContain('’s own');
  });

  it('INS-10: Insights has no own section for rows with no owner_id', async () => {
    const c = couple({ expenses: [legacyLamp()] });
    show(c.layer);
    await goTab('Insights');
    await waitFor(() => { expect(text(screen.getByRole('main'))).toContain('£40.00'); });
    expect(text(screen.getByRole('main'))).not.toContain('’s own');
  });
});

describe('S10 review 6: the history of a change of whose says what else changed', () => {
  const people = [{ id: JAE_ID, name: 'Jae', animal: 'cat' as const }, { id: SAM_ID, name: 'Sam', animal: 'dog' as const }];
  const at = '2026-11-14T10:00:00.000Z';
  it('REC-11: "Jae made it Jae’s own and changed £10.00 to £12.00"; its money following is not "the split"', () => {
    const own = { actor: JAE_ID, action: 'edited', at, summary: {
      owner_id: { before: null, after: JAE_ID }, amount_pence: { before: 1000, after: 1200 }, split_mode: { before: 'ratio', after: 'treat' },
      split_params: { before: { [JAE_ID]: 50, [SAM_ID]: 50 }, after: null }, shares: { before: { [JAE_ID]: 500, [SAM_ID]: 500 }, after: { [JAE_ID]: 1200 } },
      paid: { before: { [JAE_ID]: 1000 }, after: { [JAE_ID]: 1200 } }, posted_count: { before: 3, after: 4 },
    } };
    expect(historyLine(own, people, '2026-11-14', 'Europe/London')).toBe('Jae made it Jae’s own and changed £10.00 to £12.00, today 10:00');
  });
  it('REC-11: "Jae made it shared and changed the description and the category"', () => {
    const back = { actor: JAE_ID, action: 'edited', at, summary: {
      owner_id: { before: JAE_ID, after: null }, description: { before: 'Gym', after: 'Gym, both' }, category_id: { before: 'a', after: 'b' },
      split_mode: { before: 'treat', after: 'ratio' },
    } };
    expect(historyLine(back, people, '2026-11-14', 'Europe/London')).toBe('Jae made it shared and changed the description and the category, today 10:00');
  });
});

describe('S10 review 7: the own sections name the person', () => {
  it('REC-10: Bills: "No subscriptions in Jae’s own regular payments." in Jae’s own section (hers, no subscription)', async () => {
    const c = couple({ recurring: [RENT, GYM], expenses: [posted(101, RENT, '2026-11-01'), posted(104, GYM, '2026-11-02')] });
    show(c.layer);
    await goTab('Bills');
    const jae = screen.getByRole('region', { name: 'Jae’s own' });
    expect(text(jae)).toContain('No subscriptions in Jae’s own regular payments.');
    expect(text(jae)).not.toContain('of their own');
  });

  it('INS-10: Insights: "Jae’s own regular payments, never in the figures above." and "Sam’s own …" for Sam', async () => {
    const c = couple({ recurring: [RENT, GYM, DUO, AUDIBLE], expenses: ENTRIES });
    show(c.layer);
    await goTab('Insights');
    await waitFor(() => { expect(screen.getByRole('region', { name: 'Jae’s own' })).toBeTruthy(); });
    expect(text(screen.getByRole('region', { name: 'Jae’s own' }))).toContain('Jae’s own regular payments, never in the figures above.');
    expect(text(screen.getByRole('region', { name: 'Sam’s own' }))).toContain('Sam’s own regular payments, never in the figures above.');
    expect(text(screen.getByRole('main'))).not.toContain('Their own regular payments');
  });
});

