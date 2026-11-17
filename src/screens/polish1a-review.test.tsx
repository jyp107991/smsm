/**
 * S2 polish wave 1a, fresh-review findings on the real screens over the in-memory Api (each written to fail
 * before its fix): the "Did it go through?" question records once across the dialog, the banner, restarts
 * and windows (Q-F1, Q-U2, SET-2); a held Enter (Q-U1); a deliberate second Duplicate or quick add (Q-F1).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { fakeIdbKeyval, idbData } from '../../tests/fixtures/fake-idb-keyval';
import { DataProvider, type DataLayer, type SettlementRow } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';
import { loadPending, savePending, type PendingMonzo } from './settle/monzo';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  idbData.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await open?.dispose();
  open = null;
});

function at(path: string) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
}

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

async function closeApp(unmount: () => void) {
  unmount();
  await open?.dispose();
  open = null;
  sessionStorage.clear();
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const QUESTION_ID = '00000000-0000-4000-8000-00000000a501';
const SAMS_20: PendingMonzo = { id: QUESTION_ID, by: SAM_ID, from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null };

describe('Q-F1 Q-U2 SET-2: the Monzo question records once, wherever it is answered', () => {
  it('SET-2: Yes in the dialog, the question not forgotten (IndexedDB failed), the app reopened: nothing more is recorded', async () => {
    await savePending(SAMS_20);
    const first = couple({ as: 'sam', expenses: [storedExpense()] });
    const view = show(first.layer);
    // The removal after Yes fails: the question stays on the phone.
    vi.spyOn(fakeIdbKeyval, 'del').mockRejectedValue(new Error('IndexedDB is unhappy'));
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    fireEvent.click(within(asked).getByRole('button', { name: 'Yes' }));
    await settle(first.layer);
    expect(first.controls.tables.settlements).toHaveLength(1);
    const recorded = first.controls.tables.settlements[0] as SettlementRow;
    expect(recorded.id).toBe(QUESTION_ID);
    expect(await loadPending()).not.toBeNull();
    vi.restoreAllMocks();

    await closeApp(view.unmount);
    const second = couple({ as: 'sam', expenses: [storedExpense()] });
    second.controls.tables.settlements.push(recorded);
    await second.layer.ready;
    await second.layer.refresh();
    show(second.layer);
    await screen.findByRole('region', { name: 'Balance' });
    // Whether or not it is asked, answering it again can't record a second settle-up.
    const again = screen.queryByRole('dialog', { name: 'Did it go through?' });
    if (again) fireEvent.click(within(again).getByRole('button', { name: 'Yes' }));
    await settle(second.layer);
    expect(second.controls.tables.settlements).toHaveLength(1);
  });

  it('SET-2: Yes in the dialog and then Yes on a banner for the same question record one settle-up', async () => {
    await savePending(SAMS_20);
    const { layer, controls } = couple({ as: 'sam', expenses: [storedExpense()] });
    const view = show(layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    fireEvent.click(within(asked).getByRole('button', { name: 'Yes' }));
    await settle(layer);
    expect(controls.tables.settlements).toHaveLength(1);
    await closeApp(view.unmount);
    // The same question shows up again as a banner (another window put it back, or a stale copy was read).
    await savePending({ ...SAMS_20, later: true });
    const second = couple({ as: 'sam', expenses: [storedExpense()] });
    second.controls.tables.settlements.push(...controls.tables.settlements);
    await second.layer.ready;
    await second.layer.refresh();
    show(second.layer);
    const banner = await screen.findByText('Did Sam’s £20.00 to Jae go through?').catch(() => null);
    if (banner) {
      const yes = within(banner.closest('section') as HTMLElement).getByRole('button', { name: 'Yes', hidden: true });
      fireEvent.click(yes);
    }
    await settle(second.layer);
    expect(second.controls.tables.settlements).toHaveLength(1);
  });

  it('SET-2: a question asked by the other person on this phone is not asked, and is forgotten', async () => {
    await savePending({ ...SAMS_20, by: JAE_ID });
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole('dialog', { name: 'Did it go through?' })).toBeNull();
    await waitFor(async () => { expect(await loadPending()).toBeNull(); });
  });

  it('SET-2: a question naming someone outside this household shows no dialog and no banner', async () => {
    await savePending({ ...SAMS_20, to: '00000000-0000-4000-8000-0000000000ff', later: true });
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    await screen.findByRole('region', { name: 'Balance' });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText(/go through\?/)).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Did it go through?' })).toBeNull();
  });

  it('SET-2: a question kept by an earlier version (no id) gets one on opening, kept on the phone', async () => {
    const old: PendingMonzo = { from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null };
    await savePending(old);
    const { layer } = couple({ as: 'sam', expenses: [storedExpense()] });
    show(layer);
    await screen.findByRole('dialog', { name: 'Did it go through?' });
    await waitFor(async () => {
      const kept = await loadPending();
      expect(kept?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(kept?.by).toBe(SAM_ID);
    });
  });
});

describe('Q-U1: a held Enter', () => {
  async function openAdd() {
    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    return screen.findByRole('dialog', { name: 'Add expense' });
  }

  it('Q-U1: a repeated Enter (key held) in Description does nothing', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAdd();
    const description = within(sheet).getByRole('textbox', { name: 'Description' });
    expect(fireEvent.keyDown(description, { key: 'Enter', code: 'Enter', keyCode: 13, repeat: true })).toBe(false);
  });

  it('Q-U1: a repeated Enter in Amount does not move on', async () => {
    const { layer } = couple();
    show(layer);
    const sheet = await openAdd();
    const amount = within(sheet).getByRole('textbox', { name: 'Amount' });
    amount.focus();
    expect(fireEvent.keyDown(amount, { key: 'Enter', code: 'Enter', keyCode: 13, repeat: true })).toBe(false);
    expect(document.activeElement).toBe(amount);
  });
});

describe('Q-F1: a deliberate second action still records', () => {
  it('Q-F1 ADD-7: Duplicate tapped again after a pause makes a second copy', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const { layer, controls } = couple({ expenses: [storedExpense()] });
    at(`/entry/${storedExpense().id}`);
    show(layer);
    await screen.findByRole('heading', { name: 'Lamp' });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    t += 800;
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await settle(layer);
    expect(controls.tables.expenses.filter((e) => e.description === 'Lamp')).toHaveLength(3);
  });

  it('Q-F1 ADD-1: the same quick add typed again later saves again', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    for (let i = 0; i < 2; i += 1) {
      fireEvent.change(box, { target: { value: '3 milk' } });
      fireEvent.submit(box.closest('form') as HTMLFormElement);
      await settle(layer);
    }
    expect(controls.tables.expenses.filter((e) => e.description === 'milk')).toHaveLength(2);
  });
});
