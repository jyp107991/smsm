/**
 * "Check for updates" in Settings → About (owner, 17 Nov: "there should be a check for latest version button
 * in line with best practice"). It runs the same check as a launch (src/ui/LaunchUpdate.tsx): newer → the
 * "Updating smsm" screen takes over; otherwise it says plainly what happened.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { couple } from '../../tests/fixtures/couple';
import { DataProvider, type DataLayer } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { registerUpdateCheck } from '../ui/updates';
import type { UpdateResult } from '../ui/launchUpdate';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
let unregister: (() => void) | null = null;
beforeEach(() => {
  history.replaceState(null, '', '/settings');
  resetHistoryForTests();
});
afterEach(async () => {
  unregister?.();
  unregister = null;
  await open?.dispose();
  open = null;
});

async function settingsWith(result: Promise<UpdateResult>) {
  unregister = registerUpdateCheck(() => result);
  const { layer } = couple();
  open = layer;
  render(<DataProvider layer={layer}><Root /></DataProvider>);
  return screen.findByRole('button', { name: 'Check for updates' });
}

it.each([
  ['latest', 'You’re on the latest version.'],
  ['skipped', 'Couldn’t check. Check the connection and try again.'],
  ['failed', 'Couldn’t update just now. Try again in a minute.'],
] as const)('owner: "Check for updates" → %s says "%s"', async (result, words) => {
  const button = await settingsWith(Promise.resolve(result));
  await act(async () => { fireEvent.click(button); await Promise.resolve(); });
  expect((await screen.findByRole('status', { name: 'Update check' })).textContent).toBe(words);
});

it('owner: while it checks, the button says so and can’t be pressed twice', async () => {
  let finish: (r: UpdateResult) => void = () => undefined;
  const button = await settingsWith(new Promise<UpdateResult>((r) => { finish = r; }));
  fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true');
  await act(async () => { finish('latest'); await Promise.resolve(); });
  expect((await screen.findByRole('status', { name: 'Update check' })).textContent).toBe('You’re on the latest version.');
});
