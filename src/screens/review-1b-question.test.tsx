/**
 * CI run 44092991657 (6dd1ed6), Q-U2: "Forget it" on the "Did it go through?" banner, then the app closed a few
 * milliseconds later, and on opening the banner was back. Forgetting deleted the question from IndexedDB; that
 * delete is asynchronous, and a page closed before its transaction commits loses it (reproduced in Chromium:
 * 2 of 20 runs closing straight after the tap). Answering must hold even when the store's delete never lands.
 * The lost delete is simulated here by putting the stored question back after the tap.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { DataProvider, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';
import * as monzoModule from './settle/monzo';
import type { PendingMonzo } from './settle/monzo';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const monzo = monzoModule as unknown as {
  savePending(p: PendingMonzo | null): Promise<void>;
  loadPending(): Promise<PendingMonzo | null>;
};

const KEY = 'smsm-monzo-pending';
const stored = () => idbData.get('smsm/cache')?.get(KEY);

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
  idbData.clear();
});
afterEach(async () => { await open?.dispose(); open = null; });

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

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const SAMS_20: PendingMonzo = { from: SAM_ID, to: JAE_ID, amount: 2000, date: TODAY, note: null };
const BANNER = 'Did Sam’s £20.00 to Jae go through?';

function bannerAround(text: HTMLElement): HTMLElement {
  let el: HTMLElement | null = text;
  while (el && !within(el).queryByRole('button', { name: 'Forget it', hidden: true })) el = el.parentElement;
  if (!el) throw new Error('no banner');
  return el;
}

describe('Q-U2: an answered question stays answered even if its delete never reaches the store', () => {
  it('"Forget it", then the app is closed before the delete lands: the next opening asks nothing', async () => {
    await monzo.savePending(SAMS_20);
    const first = couple({ as: 'sam', expenses: [storedExpense()] });
    const view = show(first.layer);
    const asked = await screen.findByRole('dialog', { name: 'Did it go through?' });
    fireEvent.click(within(asked).getByRole('button', { name: 'Not yet' }));
    const banner = bannerAround(await screen.findByText(BANNER));
    await wait(20);
    const kept = stored();
    expect(kept, 'the question is kept, as "Not yet"').toBeDefined();

    fireEvent.click(within(banner).getByRole('button', { name: 'Forget it', hidden: true }));
    // The app closes before the store's delete commits: the question is still there.
    idbData.get('smsm/cache')?.set(KEY, kept);
    await closeApp(view.unmount);

    const second = couple({ as: 'sam', expenses: [storedExpense()] });
    show(second.layer);
    await screen.findByRole('region', { name: 'Balance', hidden: true });
    await wait(200);
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Did it go through?' })).toBeNull();
    expect(second.controls.tables.settlements).toHaveLength(0);
  });

  it('a new question after one was forgotten is still asked', async () => {
    await monzo.savePending(SAMS_20);
    const first = couple({ as: 'sam', expenses: [storedExpense()] });
    const view = show(first.layer);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Did it go through?' })).getByRole('button', { name: 'Not yet' }));
    fireEvent.click(within(bannerAround(await screen.findByText(BANNER))).getByRole('button', { name: 'Forget it', hidden: true }));
    await wait(20);
    await closeApp(view.unmount);

    // Later, Sam pays the same again through Monzo: a new question.
    await monzo.savePending({ ...SAMS_20 });
    expect(await monzo.loadPending()).toMatchObject({ from: SAM_ID, to: JAE_ID, amount: 2000 });
    const second = couple({ as: 'sam', expenses: [storedExpense()] });
    show(second.layer);
    expect(await screen.findByRole('dialog', { name: 'Did it go through?' })).toBeTruthy();
  });
});
