/**
 * Owner's reports, 24 Nov (DECISIONS "One meaning for subscription", "Notes on regular payments"), on the regular
 * payment sheet, Bills and the Inbox. On Sat 14 Nov 2026 (TODAY).
 *   1. "subscriptions category duplicates subscription switch when adding bills": the switch is "Show in
 *      Subscriptions", with the hint "Lists it with its monthly and yearly cost under Subscriptions on Bills.".
 *      Picking the household's Subscriptions category (its starting one, found by its key: renamed, it still is;
 *      a person's own "Subscriptions" isn't) turns it on; the person can switch it off; another category turns off
 *      only an automatic "on", never one the person set.
 *   2. "Can't add notes when editing recurring payments": Notes is on the sheet itself, adding and editing; it saves
 *      (logged in the history), and what the payment posts from then on carries it, an Inbox bill included.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedInboxItem, storedRecurring, type RecurringRow } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
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
const SWITCH = 'Show in Subscriptions';
const HINT = 'Lists it with its monthly and yearly cost under Subscriptions on Bills.';

async function goBills() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Bills' }));
  return screen.findByRole('heading', { level: 1, name: 'Bills' });
}
async function openNew() {
  await goBills();
  fireEvent.click(screen.getByRole('button', { name: 'Add a regular payment' }));
  return screen.findByRole('dialog', { name: 'Regular payment' });
}
async function openRent() {
  await goBills();
  const main = screen.getByRole('main');
  const seg = within(main).queryAllByRole('radio', { name: 'Next 30 days' });
  if (seg[0]) fireEvent.click(seg[0]);
  fireEvent.click(within(await screen.findByRole('list', { name: 'Next 30 days' })).getAllByRole('button', { name: /^Rent\b/ })[0] as HTMLElement);
  return screen.findByRole('dialog', { name: 'Edit regular payment' });
}
const subsSwitch = (sheet: HTMLElement) => within(sheet).getByRole<HTMLInputElement>('switch', { name: SWITCH });
const pick = (sheet: HTMLElement, name: RegExp) => {
  fireEvent.click(within(within(sheet).getByRole('group', { name: 'Category' })).getByRole('button', { name }));
};
async function saveNew(c: { layer: DataLayer }, sheet: HTMLElement, description: string) {
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Amount' }), { target: { value: '9.99' } });
  if (description) fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: description } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Regular payment' })).toBeNull(); });
  await settle(c.layer);
}
const R = (n: number) => `00000000-0000-4000-8000-00000000d${n.toString().padStart(3, '0')}`;
const RENT = storedRecurring({ id: R(1), paid: { [JAE_ID]: 145000, [SAM_ID]: 0 }, shares: { [JAE_ID]: 72500, [SAM_ID]: 72500 } });

describe('one meaning for "subscription" (REC-7)', () => {
  it('REC-7: the switch is "Show in Subscriptions" with its hint; picking Subscriptions turns it on, and that is saved', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openNew();
    const sw = subsSwitch(sheet);
    expect(sw.checked).toBe(false);
    expect(sw.getAttribute('aria-describedby')).not.toBeNull();
    expect(text(document.getElementById(sw.getAttribute('aria-describedby') ?? '') as HTMLElement)).toBe(HINT);
    expect(within(sheet).queryByRole('switch', { name: 'Subscription' })).toBeNull();
    pick(sheet, /^Subscriptions\b/);
    expect(subsSwitch(sheet).checked).toBe(true);
    await saveNew(c, sheet, 'Netflix');
    expect(c.controls.tables.recurring).toHaveLength(1);
    expect(c.controls.tables.recurring[0]).toMatchObject({ description: 'Netflix', category_id: categoryId('Subscriptions'), is_subscription: true });
  });

  it('REC-7: the person can switch it off in Subscriptions; it saves off', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openNew();
    pick(sheet, /^Subscriptions\b/);
    fireEvent.click(subsSwitch(sheet));
    expect(subsSwitch(sheet).checked).toBe(false);
    await saveNew(c, sheet, 'Phone insurance');
    expect(c.controls.tables.recurring[0]).toMatchObject({ category_id: categoryId('Subscriptions'), is_subscription: false });
  });

  it('REC-7: another category turns off an automatic "on"', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openNew();
    pick(sheet, /^Subscriptions\b/);
    expect(subsSwitch(sheet).checked).toBe(true);
    pick(sheet, /^Household\b/);
    expect(subsSwitch(sheet).checked).toBe(false);
    await saveNew(c, sheet, 'Window cleaner');
    expect(c.controls.tables.recurring[0]).toMatchObject({ category_id: categoryId('Household'), is_subscription: false });
  });

  it('REC-7: turned on by the person, it stays on when another category is picked (also after a pass through Subscriptions)', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openNew();
    fireEvent.click(subsSwitch(sheet));
    expect(subsSwitch(sheet).checked).toBe(true);
    pick(sheet, /^Subscriptions\b/);
    pick(sheet, /^Health\b/);
    expect(subsSwitch(sheet).checked).toBe(true);
    await saveNew(c, sheet, 'Gym');
    expect(c.controls.tables.recurring[0]).toMatchObject({ category_id: categoryId('Health'), is_subscription: true });
  });

  it('REC-7: the starting Subscriptions category renamed still turns it on; a person’s own "Subscriptions" does not', async () => {
    const c = couple();
    const cats = c.controls.tables.categories;
    const seeded = cats.find((x) => x.id === categoryId('Subscriptions'));
    if (!seeded) throw new Error('no Subscriptions category');
    seeded.name = 'Streaming';
    cats.push({ ...seeded, id: '00000000-0000-4000-8000-000000000a99', name: 'Subscriptions', emoji: '📰', sort: 13, seed_key: null });
    show(c.layer);
    const sheet = await openNew();
    pick(sheet, /^Subscriptions\b/);
    expect(subsSwitch(sheet).checked).toBe(false);
    pick(sheet, /^Streaming\b/);
    expect(subsSwitch(sheet).checked).toBe(true);
  });

  it('REC-7: editing leaves the stored switch as it was until the category changes; one stored on stays on', async () => {
    const c = couple({ recurring: [{ ...RENT, category_id: categoryId('Subscriptions'), is_subscription: true }] });
    show(c.layer);
    const sheet = await openRent();
    expect(subsSwitch(sheet).checked).toBe(true);
    pick(sheet, /^Household\b/);
    expect(subsSwitch(sheet).checked).toBe(true);
  });

  it('REC-7: Subscriptions on Bills, empty, names the switch', async () => {
    const c = couple({ recurring: [RENT] });
    show(c.layer);
    await goBills();
    const seg = within(screen.getByRole('main')).queryAllByRole('radio', { name: 'Subscriptions' });
    if (seg[0]) fireEvent.click(seg[0]);
    await waitFor(() => { expect(text(screen.getByRole('main'))).toContain('No subscriptions yet. Turn on “Show in Subscriptions” on a regular payment to see it here.'); });
  });
});

describe('notes on a regular payment (REC-1, REC-6, REC-3)', () => {
  it('REC-1: Notes is on the new regular payment sheet itself (no "More details"), and it saves', async () => {
    const c = couple();
    show(c.layer);
    const sheet = await openNew();
    expect(within(sheet).queryByRole('button', { name: 'More details' })).toBeNull();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Account 1234' } });
    await saveNew(c, sheet, 'Council tax');
    expect(c.controls.tables.recurring[0]).toMatchObject({ description: 'Council tax', notes: 'Account 1234' });
  });

  it('REC-6: editing shows its notes; a change saves, is in its history, and the entries it posts from then on carry it', async () => {
    const c = couple({ recurring: [{ ...RENT, notes: 'Account 1234' }] });
    show(c.layer);
    let sheet = await openRent();
    const notes = within(sheet).getByRole<HTMLTextAreaElement>('textbox', { name: 'Notes' });
    expect(notes.value).toBe('Account 1234');
    fireEvent.change(notes, { target: { value: 'Account 5678' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit regular payment' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(1))?.notes).toBe('Account 5678');
    sheet = await openRent();
    await waitFor(() => { expect(text(within(sheet).getByRole('region', { name: 'History' }))).toMatch(/the note/); });
  });

  it('REC-6: notes can be added to one that had none', async () => {
    const c = couple({ recurring: [RENT] });
    show(c.layer);
    const sheet = await openRent();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'Landlord: Mr Price' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Edit regular payment' })).toBeNull(); });
    await settle(c.layer);
    expect(c.controls.tables.recurring.find((r) => r.id === R(1))?.notes).toBe('Landlord: Mr Price');
  });

  const energy: RecurringRow = storedRecurring({
    id: '00000000-0000-4000-8000-00000000d0e1', description: 'Energy', amount_pence: 9000, amount_varies: true, category_id: categoryId('Utilities'),
    paid: { [SAM_ID]: 9000 }, shares: { [JAE_ID]: 4500, [SAM_ID]: 4500 }, start_date: '2026-09-03', posted_count: 3, notes: 'Meter 42 (new)',
  });
  const bill = (notes?: string | null) => storedInboxItem({
    payload: { description: 'Energy', estimate_pence: 9000, date: '2026-11-03', category_id: categoryId('Utilities'), ...(notes === undefined ? {} : { notes }) },
  });

  it('REC-3: an "amount varies" bill kept at its usual amount carries the notes it was posted with', async () => {
    const c = couple({ recurring: [energy], inboxItems: [bill('Meter 42')] });
    history.replaceState(null, '', '/inbox');
    resetHistoryForTests();
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Usually £90\.00/ }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Energy')).toMatchObject({ notes: 'Meter 42', recurring_id: energy.id, date: '2026-11-03' });
  });

  it('REC-3: Keep opens the bill with those notes; a bill from before notes were carried takes its regular payment’s', async () => {
    const c = couple({ recurring: [energy], inboxItems: [bill()] });
    history.replaceState(null, '', '/inbox');
    resetHistoryForTests();
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => { expect(within(sheet).getByRole<HTMLTextAreaElement>('textbox', { name: 'Notes', hidden: true }).value).toBe('Meter 42 (new)'); });
  });

  it('REC-3: a bill posted with no notes keeps none, even if its regular payment has some now', async () => {
    const c = couple({ recurring: [energy], inboxItems: [bill(null)] });
    history.replaceState(null, '', '/inbox');
    resetHistoryForTests();
    show(c.layer);
    fireEvent.click(await screen.findByRole('button', { name: /^Usually £90\.00/ }));
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.description === 'Energy')?.notes).toBeNull();
  });
});
