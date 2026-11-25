/**
 * S10 screens: personal regular payments (owner, 25 Nov; DECISIONS 25 Nov "Personal regular payments"; SPEC REC-9…
 * REC-12, INS-10). On Sat 14 Nov 2026 (TODAY), Jae and Sam share rent; Jae has her own gym (£35.00 on the 2nd) and her
 * own Duolingo subscription (£7.99 on the 9th); Sam has his own Audible subscription (£8.99 on the 5th).
 *   - The regular payment sheet asks "Whose is it?": Shared (the default) or Mine; Mine hides who paid, the split and
 *     "Amount varies" (I pay all of it).
 *   - Bills: shared sections as before; then "Jae's own" and "Sam's own", each with its cost a month and a year and its
 *     own subscriptions. Only the owner can open theirs.
 *   - Activity: own rows are marked "Jae's own"; a Whose filter (Shared and own, Shared, Jae's own, Sam's own); the
 *     filtered shared total never counts them, an own filter totals that person's alone.
 *   - An own entry's page: Sam sees Jae's read-only (no Edit, Delete, Duplicate, Refund or comments).
 *   - Insights: "Jae's own" and "Sam's own", apart from the shared figures, which never include them.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring, type RecurringRow } from '../../tests/fixtures/couple';
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
afterEach(async () => { await open?.dispose(); open = null; });

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
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
function household(as: 'jae' | 'sam' = 'jae') {
  return couple({ as, recurring: [RENT, GYM, DUO, AUDIBLE], expenses: ENTRIES });
}

async function goTab(name: 'Bills' | 'Activity' | 'Insights') {
  fireEvent.click(await screen.findByRole('tab', { name }));
  return screen.findByRole('heading', { level: 1, name });
}
const region = (name: RegExp | string) => screen.getByRole('region', { name });

describe('REC-9: "Whose is it?" on the regular payment sheet', () => {
  it('REC-9: Shared is the default; Mine hides who paid, the split and "Amount varies", and saves it all mine', async () => {
    const c = household();
    show(c.layer);
    await goTab('Bills');
    fireEvent.click(screen.getByRole('button', { name: 'Add a regular payment' }));
    const sheet = await screen.findByRole('dialog', { name: 'Regular payment' });
    const whose = within(sheet).getByRole('radiogroup', { name: 'Whose is it?' });
    expect(within(whose).getByRole('radio', { name: 'Shared' }).getAttribute('aria-checked')).toBe('true');
    expect(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).toBeTruthy();
    expect(within(sheet).getByRole('switch', { name: 'Amount varies' })).toBeTruthy();
    fireEvent.click(within(whose).getByRole('radio', { name: 'Mine' }));
    expect(within(sheet).queryByRole('radiogroup', { name: 'Who paid' })).toBeNull();
    expect(within(sheet).queryByRole('radiogroup', { name: 'How it’s shared' })).toBeNull();
    expect(within(sheet).queryByRole('switch', { name: 'Amount varies' })).toBeNull();
    expect(text(sheet)).toContain('You pay all of it. It’s kept out of everything you share.');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '12.00' } });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Phone' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Regular payment' })).toBeNull(); });
    await settle(c.layer);
    const saved = c.controls.tables.recurring.find((t) => t.description === 'Phone');
    expect(saved).toMatchObject({ owner_id: JAE_ID, split_mode: 'treat', paid: { [JAE_ID]: 1200 }, amount_varies: false });
  });

  it('REC-11: editing my own one shows Mine; switching to Shared says it is from the next payment on', async () => {
    const c = household();
    show(c.layer);
    await goTab('Bills');
    fireEvent.click(within(region('Jae’s own')).getAllByRole('button', { name: /^Gym\b/ })[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'Edit regular payment' });
    const whose = within(sheet).getByRole('radiogroup', { name: 'Whose is it?' });
    expect(within(whose).getByRole('radio', { name: 'Mine' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(whose).getByRole('radio', { name: 'Shared' }));
    expect(text(sheet)).toContain('From the next payment on. Past ones stay as they were.');
    expect(within(sheet).getByRole('radiogroup', { name: 'Who paid' })).toBeTruthy();
    // It starts from the household's usual split, never "My treat".
    const split = within(sheet).getByRole('radiogroup', { name: 'How it’s shared' });
    expect(within(split).getByRole('radio', { name: '50/50' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('REC-10: Bills keeps each person’s own apart', () => {
  it('REC-10 REC-8: "What home costs" is the shared one; "Jae’s own" and "Sam’s own" have their own month and year and subscriptions', async () => {
    const c = household();
    show(c.layer);
    await goTab('Bills');
    expect(text(region('What home costs'))).toContain('£1,450.00 a month to run');
    const jae = region('Jae’s own');
    // Gym £35.00 + Duolingo £7.99 a month; £420.00 + £95.88 a year.
    expect(within(jae).getByText('£42.99 a month')).toBeTruthy();
    expect(within(jae).getByText('£515.88 a year')).toBeTruthy();
    expect(within(jae).getByRole('heading', { name: 'Jae’s subscriptions' })).toBeTruthy();
    expect(text(jae.querySelector('[data-own-subscriptions]') as HTMLElement)).toContain('Duolingo');
    expect(text(jae)).toContain('£95.88 a year altogether');
    const sam = region('Sam’s own');
    expect(within(sam).getAllByText('£8.99 a month').length).toBeGreaterThan(0);
    expect(within(sam).getAllByText('£107.88 a year').length).toBeGreaterThan(0);
    expect(text(sam)).toContain('Only Sam can change these.');
    // Mine open; Sam's are read-only rows (nothing to tap).
    expect(within(jae).getAllByRole('button', { name: /^Gym\b/ }).length).toBeGreaterThan(0);
    expect(within(sam).queryAllByRole('button')).toHaveLength(0);
    // The shared Subscriptions list never has them.
    const main = screen.getByRole('main');
    fireEvent.click(within(main).getAllByRole('radio', { name: 'Subscriptions' })[0] as HTMLElement);
    const shared = await screen.findByRole('list', { name: 'Subscriptions' }).catch(() => null);
    if (shared) {
      expect(text(shared)).not.toContain('Duolingo');
      expect(text(shared)).not.toContain('Audible');
    } else {
      expect(text(main)).toContain('No subscriptions yet');
    }
  });
});

describe('REC-9: Activity marks them and filters by whose', () => {
  it('REC-9 REC-12: rows say "Jae’s own"; Whose → Sam’s own shows his alone with his total; Shared leaves them out of the total', async () => {
    const c = household();
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    await waitFor(() => { expect(within(main).getAllByRole('link', { name: /^Gym, £35\.00, Jae’s own/ }).length).toBeGreaterThan(0); });
    fireEvent.click(within(main).getByRole('button', { name: /^Whose/ }));
    const picker = await screen.findByRole('dialog', { name: 'Whose' });
    fireEvent.click(within(picker).getByRole('radio', { name: /Sam’s own/ }));
    await waitFor(() => { expect(within(main).queryAllByRole('link', { name: /^Gym/ })).toHaveLength(0); });
    expect(within(main).getAllByRole('link', { name: /^Audible/ })).toHaveLength(1);
    expect(text(main)).toContain('Sam’s own: 1 entry · £8.99');
    fireEvent.click(within(main).getByRole('button', { name: /^Whose/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Whose' })).getByRole('radio', { name: /^Shared$/ }));
    await waitFor(() => { expect(within(main).queryAllByRole('link', { name: /^Audible/ })).toHaveLength(0); });
    // Rent £1,450.00 + Big shop £60.00; never the gym, Duolingo or Audible.
    expect(text(main)).toContain('2 entries · £1,510.00');
  });

  it('REC-9: Sam opens Jae’s own entry: it says whose it is and offers nothing to change, and no comments', async () => {
    const c = household('sam');
    show(c.layer);
    await goTab('Activity');
    const main = screen.getByRole('main');
    fireEvent.click((await within(main).findAllByRole('link', { name: /^Gym, £35\.00/ }))[0] as HTMLElement);
    await screen.findByRole('heading', { level: 1, name: 'Gym' });
    expect(text(screen.getByRole('main'))).toContain('Jae’s own regular payment');
    expect(text(screen.getByRole('main'))).toContain('Only Jae can change it.');
    for (const name of ['Edit', 'Delete', 'Duplicate', 'Refund this']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /comment/i })).toBeNull();
  });
});

describe('INS-10: Insights produces each person’s own apart', () => {
  it('INS-10 REC-12: the shared total never has them; "Jae’s own" has her month, its total, her running cost and her categories', async () => {
    const c = household();
    show(c.layer);
    await goTab('Insights');
    // Shared this month: rent and the big shop.
    await waitFor(() => { expect(text(screen.getByRole('main'))).toContain('£1,510.00'); });
    const jae = region('Jae’s own');
    expect(text(jae)).toContain('Gym');
    expect(text(jae)).toContain('Duolingo');
    expect(text(jae)).not.toContain('Audible');
    expect(text(jae)).toContain('£42.99 this month');
    expect(text(jae)).toContain('£42.99 a month to run, £515.88 a year');
    expect(within(jae).getByRole('list', { name: 'Jae’s own: By category' })).toBeTruthy();
    const sam = region('Sam’s own');
    expect(text(sam)).toContain('£8.99 this month');
    expect(text(sam)).not.toContain('Gym');
  });
});

describe('REC-11: the history says whose it became', () => {
  it('REC-11: "Jae made it Jae’s own", then "Jae made it shared" (from the owner_id change the database logs)', async () => {
    const { historyLine } = await import('./shared/words');
    const people = [{ id: JAE_ID, name: 'Jae', animal: 'cat' as const }, { id: SAM_ID, name: 'Sam', animal: 'dog' as const }];
    const at = '2026-11-14T10:00:00.000Z';
    const own = { actor: JAE_ID, action: 'edited', at, summary: { owner_id: { before: null, after: JAE_ID }, split_mode: { before: 'ratio', after: 'treat' } } };
    const back = { actor: JAE_ID, action: 'edited', at, summary: { owner_id: { before: JAE_ID, after: null } } };
    expect(historyLine(own, people, '2026-11-14', 'Europe/London')).toBe('Jae made it Jae’s own, today 10:00');
    expect(historyLine(back, people, '2026-11-14', 'Europe/London')).toBe('Jae made it shared, today 10:00');
  });
});
