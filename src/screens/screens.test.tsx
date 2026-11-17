/**
 * The screens over a real data layer (the in-memory Api): Home's sentence and quick add, Enter held while
 * composing, the one toast live region, setup's taken animal. The two-user end-to-end suite checks the same
 * names against the real database; this catches screen logic in seconds.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, HID, JAE_ID } from '../../tests/fixtures/couple';
import { createMemoryApi } from '../data/memoryApi';
import { manualNetwork } from '../data/network';
import { createDataLayer, type DataLayer } from '../data/queryClient';
import { fixedSession } from '../data/session';
import { memoryStorage } from '../data/storage';
import { DataProvider } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(() => {
  history.replaceState(null, '', '/');
  resetHistoryForTests();
});
afterEach(async () => { await open?.dispose(); open = null; });

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

describe('Home', () => {
  it('BAL-2 BAL-3 BAL-4 ADD-1 ADD-2 ADD-6: the sentence, then quick add reads as you type and Enter saves with Undo', async () => {
    const { layer, controls } = couple();
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await within(balance).findByText('All square');
    expect(balance.querySelectorAll('[data-tilt]')).toHaveLength(1);
    expect(within(balance).queryByRole('button', { name: 'Settle up' })).toBeNull();

    const box = screen.getByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '42.50 Tesco' } });
    expect(screen.getByRole('button', { name: '£42.50 · Tesco · Groceries · Jae paid · 50/50' })).toBeTruthy();
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await within(balance).findByText((_, el) => el?.textContent === 'Sam owes Jae £21.25');
    expect((box as HTMLInputElement).value).toBe('');
    // One persistent live region for toasts; "Saved" with Undo inside it.
    const statuses = screen.getAllByRole('status').filter((s) => /^Saved/.test(s.textContent));
    expect(statuses).toHaveLength(1);
    expect(within(statuses[0] as HTMLElement).getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Today' })).getByText('Tesco')).toBeTruthy();
    await layer.idle();
    expect(controls.tables.expenses.map((e) => [e.description, e.amount_pence])).toEqual([['Tesco', 4250]]);
    // BAL-4: £10 or more: whose turn it is.
    expect(within(balance).getByText('Next one’s on Sam')).toBeTruthy();
  });

  it('TXT-2: Enter while composing (isComposing or keyCode 229) never saves quick add', async () => {
    const { layer, controls } = couple();
    show(layer);
    const box = await screen.findByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '12 이마' } });
    const composing = fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(composing).toBe(false); // default prevented: no implicit submission
    const flagged = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    act(() => { box.dispatchEvent(flagged); });
    expect(flagged.defaultPrevented).toBe(true);
    const plain = fireEvent.keyDown(box, { key: 'Enter', keyCode: 13 });
    expect(plain).toBe(true);
    await layer.idle();
    expect(controls.tables.expenses).toHaveLength(0);
  });

  it('BAL-6: before the partner joins: waiting, with Share invite; adding still works', async () => {
    const { layer } = couple({ partnerJoined: false });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await within(balance).findByText('Waiting for your partner…');
    expect(within(balance).getByRole('button', { name: 'Share invite' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '9 bread' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await waitFor(() => { expect(within(screen.getByRole('list', { name: 'Today' })).getByText('Bread')).toBeTruthy(); }); // Q-U6: saved with a capital first letter (was 'bread')
  });
});

describe('setup', () => {
  it('PPL-3: the partner\'s animal is taken and says whose it is; a blank name is refused', async () => {
    const stamp = '2026-11-01T12:00:00.000Z';
    const me = '00000000-0000-4000-8000-0000000000b9';
    const { api } = createMemoryApi(
      {
        households: [{ id: HID, join_code: 'AB12CD', home_country: 'GB', default_ratio: null, joint_enabled: false, joint_ratio: null, created_at: stamp }],
        members: [
          { household_id: HID, user_id: JAE_ID, display_name: 'Jae', animal: 'cat', locked_at: stamp, monzo_me: null, joined_at: stamp },
          { household_id: HID, user_id: me, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: '2026-11-02T12:00:00.000Z' },
        ],
      },
      { user: { userId: me, email: null } },
    );
    const layer = createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session: fixedSession(me), today: () => '2026-11-14' });
    show(layer);
    const animals = await screen.findByRole('radiogroup', { name: 'Your animal' });
    const cat = within(animals).getByRole('radio', { name: /Cat/ });
    expect((cat as HTMLInputElement).disabled).toBe(true);
    expect(animals.textContent).toContain('Jae is the cat');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('Write a name of 1 to 24 characters.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: '샘' } });
    fireEvent.click(within(animals).getByRole('radio', { name: /Dog/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('region', { name: 'Balance' });
  });
});
