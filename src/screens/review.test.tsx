/**
 * The third S2 review's findings, each reproduced on the real screens over the in-memory Api before it was
 * fixed (ENGINEERING §5 "Bugs"): duplicating money back, Pay with Monzo for the person who owes, Undo of an
 * edit, swipes on deleted rows, plain words for every error, and sign-out forgetting a Monzo question.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { pence } from '../core/money';
import { addExpense, DataProvider, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { strings } from '../ui/strings';
import { Root } from './AppRoot';
import * as monzoModule from './settle/monzo';
import type { PendingMonzo } from './settle/monzo';

// S2 polish Q-U2: the "Did it go through?" question is kept in IndexedDB (idb-keyval), which jsdom lacks.
vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
/** Q-U2: the question's store is asynchronous (IndexedDB); see src/screens/polish1a.test.tsx. */
const monzo = monzoModule as unknown as {
  savePending(p: PendingMonzo | null): Promise<void>;
  loadPending(): Promise<PendingMonzo | null>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  // A sheet the last test left closing takes its history entry back a moment later (a deferred step, then
  // an asynchronous history.go): let that land first, or its popstate would move this test's page.
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  idbData.clear();
});
afterEach(async () => { await open?.dispose(); open = null; });

function at(path: string) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
}

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const balanceText = () => screen.findByRole('region', { name: 'Balance' });

describe('money back', () => {
  it('ADD-7 MB-1 MB-3: Duplicate on money back saves money back for the same original, moving the balance as the refund did', async () => {
    const { layer, controls } = couple();
    await layer.ready;
    const lamp = addExpense({ description: 'Lamp', amount: pence(4000), date: TODAY, categoryId: categoryId('Household'), payer: JAE_ID, split: even }, layer);
    const back = addExpense(
      { kind: 'money_back', description: 'Lamp refund', amount: pence(1000), date: TODAY, categoryId: categoryId('Household'), payer: JAE_ID, split: even, refundOf: lamp },
      layer,
    );
    await layer.idle();
    // £20.00 owed for the lamp, less £5.00 back.
    expect(layer.balance()[JAE_ID]).toBe(1500);
    at(`/entry/${back}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp refund' });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await settle(layer);
    const copies = controls.tables.expenses.filter((e) => e.description === 'Lamp refund');
    expect(copies).toHaveLength(2);
    for (const c of copies) {
      expect(c).toMatchObject({ kind: 'money_back', refund_of: lamp, amount_pence: 1000, paid: { [JAE_ID]: 1000 }, shares: { [JAE_ID]: 500, [SAM_ID]: 500 }, date: TODAY });
    }
    // The copy moves the balance the same way again: £5.00 less owed, never £5.00 more.
    expect(layer.balance()[JAE_ID]).toBe(1000);
  });

  it('MB-2: Refund this starts from today, not from the original\'s date', async () => {
    const { layer } = couple({ expenses: [storedExpense({ date: '2026-11-02' })] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Refund this' }));
    const sheet = await screen.findByRole('dialog', { name: 'Money back' });
    expect(within(sheet).getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('settling up', () => {
  it('SET-2: Pay with Monzo is offered to the person who owes, never to the person owed', async () => {
    // Jae (owed) has a monzo.me name; Sam owes Jae £20.00.
    const owed = couple({ expenses: [storedExpense()] });
    show(owed.layer);
    fireEvent.click(await within(await balanceText()).findByRole('button', { name: 'Settle up' }));
    const jaeSheet = await screen.findByRole('dialog', { name: 'Settle up' });
    expect(within(jaeSheet).queryByRole('button', { name: 'Pay with Monzo' })).toBeNull();
    // S2 polish Q-U11: for the person owed the button names whose payment it records (was "Record it").
    expect(within(jaeSheet).getByRole('button', { name: 'Record Sam’s payment' })).toBeTruthy();
  });

  it('SET-2: the person who owes gets Pay with Monzo; SET-1: an amount over what is owed gets a quiet line', async () => {
    const owes = couple({ as: 'sam', expenses: [storedExpense()] });
    show(owes.layer);
    fireEvent.click(await within(await balanceText()).findByRole('button', { name: 'Settle up' }));
    const samSheet = await screen.findByRole('dialog', { name: 'Settle up' });
    expect(within(samSheet).getByRole('button', { name: 'Pay with Monzo' })).toBeTruthy();
    const amount = within(samSheet).getByRole('textbox', { name: 'Amount' });
    expect(within(samSheet).queryByText(/more than/)).toBeNull();
    fireEvent.change(amount, { target: { value: '30' } });
    expect(within(samSheet).getByText('That’s more than the £20.00 Sam owes Jae.')).toBeTruthy();
    // A quiet line, not a block: it is no alert, and the amount can still be recorded.
    expect(within(samSheet).queryByRole('alert')).toBeNull();
    fireEvent.click(within(samSheet).getByRole('button', { name: 'Record it' }));
    await settle(owes.layer);
    expect(owes.controls.tables.settlements).toMatchObject([{ from_user: SAM_ID, to_user: JAE_ID, amount_pence: 3000 }]);
  });

  it('SET-2: "Did it go through?" says what Yes will do, without claiming it is already recorded', async () => {
    await monzo.savePending({ from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null });
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    expect(asked.textContent).not.toMatch(/it’s recorded here/);
    expect(asked.textContent).toContain('Sam’s £20.00 to Jae');
  });
});

describe('edits and Activity', () => {
  it('ACT-5: Undo of a rename sends no split, so a joint-account entry keeps its money and its name comes back', async () => {
    const joint = storedExpense({
      description: 'Sofa', amount_pence: 10000, paid: { [JAE_ID]: 5000, [SAM_ID]: 5000 }, paid_via: 'joint', split_params: { [JAE_ID]: 70, [SAM_ID]: 30 },
      shares: { [JAE_ID]: 7000, [SAM_ID]: 3000 },
    });
    const { layer, controls } = couple({ expenses: [joint] });
    at(`/entry/${joint.id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Sofa' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit expense' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Description' }), { target: { value: 'Sofa (ours)' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await settle(layer);
    expect(controls.tables.expenses[0]?.description).toBe('Sofa (ours)');
    // The toast's Undo (the page behind may still be hidden from the accessibility tree while the sheet leaves).
    fireEvent.click(await screen.findByRole('button', { name: 'Undo', hidden: true }));
    await settle(layer);
    expect(controls.tables.expenses[0]).toMatchObject({
      description: 'Sofa', amount_pence: 10000, paid: { [JAE_ID]: 5000, [SAM_ID]: 5000 }, paid_via: 'joint', shares: { [JAE_ID]: 7000, [SAM_ID]: 3000 },
    });
  });

  it('ACT-3: a deleted entry in Activity is not swipeable (Restore is on its page)', async () => {
    const { layer } = couple({ expenses: [storedExpense({ deleted_at: '2026-11-12T12:00:00.000Z' }), storedExpense({ id: '00000000-0000-4000-8000-00000000e002', description: 'Bread' })] });
    at('/activity');
    show(layer);
    const main = await screen.findByRole('main');
    await within(main).findByText('Bread');
    // A live row carries the swipe actions.
    expect(within(main).getAllByText(strings.activity.swipeDuplicate)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Deleted' }));
    await within(main).findByText('Lamp');
    expect(within(main).queryByText('Bread')).toBeNull();
    expect(within(main).queryByText(strings.activity.swipeDuplicate)).toBeNull();
    expect(within(main).queryByText(strings.activity.swipeDelete)).toBeNull();
  });
});

describe('plain words for every error (DESIGN §5, TXT-7)', () => {
  const RAW = 'new row violates row-level security policy for table "members" (42501)';
  const rawShown = () => document.body.textContent.includes('violates') || document.body.textContent.includes('42501');

  it('the monzo.me name: a server refusal is said in plain words', async () => {
    const { layer, controls } = couple();
    controls.refuse = (name) => (name === 'setMonzoMe' ? RAW : null);
    at('/settings');
    show(layer);
    const field = await screen.findByRole('textbox', { name: 'monzo.me name' });
    fireEvent.change(field, { target: { value: 'jae2' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await screen.findByText(strings.errors.didntWork);
    expect(rawShown()).toBe(false);
  });

  it('the monzo.me name the phone refuses is worded by the screens, not the data layer', async () => {
    const { layer } = couple();
    at('/settings');
    show(layer);
    const field = await screen.findByRole('textbox', { name: 'monzo.me name' });
    fireEvent.change(field, { target: { value: 'not a name!' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await screen.findByText(strings.invalid.monzoName);
  });

  it('Request a change and the usual split: a server refusal is said in plain words', async () => {
    const { layer, controls } = couple();
    controls.refuse = (name) => (name === 'requestChange' ? RAW : null);
    at('/settings');
    show(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Request a change' }));
    const sheet = await screen.findByRole('dialog', { name: 'Request a change' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Your name' }), { target: { value: 'Jay' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send request' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(strings.errors.didntWork);
    expect(rawShown()).toBe(false);
  });

  it('the usual split: a server refusal is said in plain words', async () => {
    const { layer, controls } = couple();
    controls.refuse = (name) => (name === 'requestChange' ? RAW : null);
    at('/settings');
    show(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to change it' }));
    const sheet = await screen.findByRole('dialog', { name: 'The usual split' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send request' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe(strings.errors.didntWork);
    expect(rawShown()).toBe(false);
  });

  it('Approve: a server refusal is said in plain words', async () => {
    const { layer, controls } = couple({
      changeRequests: [{
        id: '00000000-0000-4000-8000-00000000c0de', household_id: HID, requested_by: SAM_ID, kind: 'identity',
        payload: { user_id: SAM_ID, display_name: 'Sammy', animal: 'dog' }, status: 'pending', decided_by: null,
        created_at: '2026-11-13T12:00:00.000Z', decided_at: null,
      }],
    });
    controls.refuse = (name) => (name === 'decideChange' ? RAW : null);
    show(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText(strings.errors.didntWork);
    expect(rawShown()).toBe(false);
  });

  it('Sign out: a server refusal is said in plain words', async () => {
    const { layer, controls } = couple();
    controls.refuse = (name) => (name === 'auth.signOut' ? 'AuthApiError: session_not_found (500)' : null);
    at('/settings');
    show(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByText(strings.errors.didntWork);
    expect(document.body.textContent).not.toContain('session_not_found');
  });
});

describe('signing out', () => {
  it('SET-2 Q-U2: signing out forgets a "Did it go through?" question waiting on this phone', async () => {
    const { layer } = couple({ expenses: [storedExpense()] });
    at('/settings');
    show(layer);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // Asked in this tab (it was on its way to Monzo), then the person signs out instead.
    await monzo.savePending({ from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null });
    fireEvent.click(signOut);
    // Q-U2: kept in IndexedDB now (it survives the app being closed), and still forgotten on sign out.
    await waitFor(async () => { expect(await monzo.loadPending()).toBeNull(); });
  });
});
