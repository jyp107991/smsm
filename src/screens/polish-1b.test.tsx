/**
 * S2 polish, wave 1b (docs/slices/S2-polish.md), the parts the demo e2e can't reach or that need no layout:
 * sign-in (the demo's session is fixed, so its sign-in screen never shows), setup's taken card, the approval
 * banner and the offline pill. The rest of the wave is in tests/e2e/polish-1b.spec.ts.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, HID, JAE_ID, SAM_ID } from '../../tests/fixtures/couple';
import { createMemoryApi, type MemoryControls } from '../data/memoryApi';
import { manualNetwork } from '../data/network';
import { createDataLayer, type DataLayer } from '../data/queryClient';
import { fixedSession, type SessionKeeper } from '../data/session';
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

/** Nobody signed in on this phone: the app shows sign-in. The in-memory server accepts the code 123456. */
function signedOut(): { layer: DataLayer; controls: MemoryControls } {
  const { api, controls } = createMemoryApi({}, { user: null });
  const out = { status: 'signed-out' } as const; // one object: the session hook compares snapshots by identity
  const session: SessionKeeper = {
    ready: Promise.resolve(),
    state: () => out,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
  const layer = createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session, today: () => '2026-11-14' });
  return { layer, controls };
}

const verifyCalls = (controls: MemoryControls) => controls.calls.filter((c) => c.name === 'auth.verifyCode');

async function toCodeStep(controls: MemoryControls): Promise<HTMLInputElement> {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'jae@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  const code = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Code' });
  expect(controls.calls.some((c) => c.name === 'auth.sendCode')).toBe(true);
  return code;
}

describe('Q-L5 PPL-1: sign-in carries the brand; the code step finishes itself', () => {
  it('Q-L5: the level plank with both animals above "smsm"; no "you@example.com" placeholder', async () => {
    const { layer } = signedOut();
    const { container } = show(layer);
    const email = await screen.findByRole('textbox', { name: 'Email' });
    const plank = screen.getByRole('img', { name: /plank is level/i });
    expect(plank.querySelectorAll('svg.rig-cat')).toHaveLength(1);
    expect(plank.querySelectorAll('svg.rig-dog')).toHaveLength(1);
    const word = screen.getByRole('heading', { name: 'smsm' });
    // Above: the plank comes before the wordmark in the page.
    expect(plank.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email.getAttribute('placeholder') ?? '').not.toMatch(/example/i);
    expect(container.textContent).not.toContain('you@example.com');
  });

  it('Q-L5: an empty email says "Type your email first" (and sends nothing)', async () => {
    const { layer, controls } = signedOut();
    show(layer);
    await screen.findByRole('textbox', { name: 'Email' });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Type your email first');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Type your email first');
    expect(controls.calls.filter((c) => c.name === 'auth.sendCode')).toEqual([]);
  });

  it('Q-L5: after Send code the Code field has focus and the dog is curious', async () => {
    const { layer, controls } = signedOut();
    const { container } = show(layer);
    const code = await toCodeStep(controls);
    await waitFor(() => { expect(document.activeElement).toBe(code); });
    expect(container.querySelectorAll('svg.rig-dog[data-mood="curious"]')).toHaveLength(1);
  });

  it('Q-L5: the sixth digit signs in by itself (no tap on Sign in); five digits wait', async () => {
    const { layer, controls } = signedOut();
    show(layer);
    const code = await toCodeStep(controls);
    fireEvent.change(code, { target: { value: '12345' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(verifyCalls(controls)).toEqual([]);
    fireEvent.change(code, { target: { value: '123456' } });
    await waitFor(() => { expect(verifyCalls(controls)).toHaveLength(1); });
    expect(verifyCalls(controls)[0]?.arg).toEqual({ email: 'jae@example.com', code: '123456' });
  });

  it('Q-L5: a pasted code signs in by itself', async () => {
    const { layer, controls } = signedOut();
    show(layer);
    const code = await toCodeStep(controls);
    fireEvent.paste(code, { clipboardData: { getData: () => 'Your code: 123 456' } });
    await waitFor(() => { expect(verifyCalls(controls)).toHaveLength(1); });
    expect(verifyCalls(controls)[0]?.arg).toEqual({ email: 'jae@example.com', code: '123456' });
  });

  it('Q-L5: a wrong sixth digit is checked at once and says so in plain words', async () => {
    const { layer, controls } = signedOut();
    show(layer);
    const code = await toCodeStep(controls);
    fireEvent.change(code, { target: { value: '000000' } });
    expect((await screen.findByRole('alert')).textContent).toContain('That code didn’t work');
    expect(verifyCalls(controls)).toHaveLength(1);
  });
});

describe('Q-L6 PPL-3: the taken animal card', () => {
  it('Q-L6: the taken card is dimmed, disabled and says whose it is, on the card itself', async () => {
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
    show(createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session: fixedSession(me), today: () => '2026-11-14' }));
    const animals = await screen.findByRole('radiogroup', { name: 'Your animal' });
    const cat = within(animals).getByRole<HTMLInputElement>('radio', { name: /Cat/ });
    const dog = within(animals).getByRole<HTMLInputElement>('radio', { name: /Dog/ });
    expect(cat.disabled).toBe(true);
    const takenCard = cat.closest('label');
    const freeCard = dog.closest('label');
    expect(takenCard?.textContent).toContain('Jae is the cat');
    expect(freeCard?.textContent).not.toContain('is the');
    // Dimmed: an opacity class only on the taken card.
    expect(/\bopacity-/.test(takenCard?.className ?? '')).toBe(true);
    expect(/\bopacity-/.test(freeCard?.className ?? '')).toBe(false);
  });
});

describe('Q-L9 PPL-5: the approval banner', () => {
  it('Q-L9: names the split ("Sam would like new entries split Jae 60 · Sam 40"); Approve is primary, Decline quiet', async () => {
    const { layer } = couple({
      changeRequests: [{
        id: '00000000-0000-4000-8000-00000000c0d1', household_id: HID, requested_by: SAM_ID, kind: 'default_ratio',
        payload: { ratio: { [JAE_ID]: 60, [SAM_ID]: 40 } }, status: 'pending', decided_by: null,
        created_at: '2026-11-13T12:00:00.000Z', decided_at: null,
      }],
    });
    show(layer);
    await screen.findByText('Sam would like new entries split Jae 60 · Sam 40');
    const approve = screen.getByRole('button', { name: 'Approve' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    // Button variants (src/ui/primitives/Button.tsx): primary is the forest fill; quiet is text only.
    expect(approve.className).toMatch(/\bbg-forest\b/);
    expect(decline.className).not.toMatch(/\bbg-forest\b/);
    expect(decline.className).not.toMatch(/\bbg-sunk\b/);
    expect(decline.className).toMatch(/\bbg-transparent\b/);
  });
});

describe('Q-L10 BAL-5 OFF-5: offline and waiting changes in one pill under the plank', () => {
  it('Q-L10: "Offline", then "Offline · 1 waiting to sync" after adding offline, with a cloud-off icon, inside the balance region', async () => {
    const { layer, network } = couple();
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await within(balance).findByText('All square');
    act(() => { network.set(false); });
    const pill = await within(balance).findByText((_, el) => el?.getAttribute('role') === 'status' && el.textContent.trim() === 'Offline');
    expect(pill.querySelector('svg'), 'the cloud-off icon').not.toBeNull();

    const box = screen.getByRole('textbox', { name: 'Quick add' });
    fireEvent.change(box, { target: { value: '9 bread' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await within(balance).findByText((_, el) => el?.getAttribute('role') === 'status' && el.textContent.trim() === 'Offline · 1 waiting to sync');
    // One place says it: no second "1 change waiting to sync" line elsewhere on Home.
    const sayings = screen.getAllByRole('status').filter((s) => /waiting to sync/.test(s.textContent));
    expect(sayings).toHaveLength(1);
  });
});
