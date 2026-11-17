/**
 * Sign-ups closed (owner, 17 Nov: both people have joined). Supabase then answers a code request for an email
 * it doesn't know with "Signups not allowed for otp" (HTTP 422). The sign-in screen says so in plain words,
 * not "check the connection", which would send the person hunting for a network problem.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMemoryApi } from '../data/memoryApi';
import { manualNetwork } from '../data/network';
import { createDataLayer, type DataLayer } from '../data/queryClient';
import type { SessionKeeper } from '../data/session';
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
afterEach(async () => {
  await open?.dispose();
  open = null;
});

it('PPL-1: with sign-ups closed, an unknown email is told plainly that smsm is for the two of you', async () => {
  const { api, controls } = createMemoryApi({}, { user: null });
  controls.refuse = (name) => (name === 'auth.sendCode' ? 'Signups not allowed for otp' : null);
  const out = { status: 'signed-out' } as const;
  const session: SessionKeeper = { ready: Promise.resolve(), state: () => out, subscribe: () => () => undefined, dispose: () => undefined };
  open = createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session, today: () => '2026-11-17' });
  render(<DataProvider layer={open}><Root /></DataProvider>);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'stranger@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('This email isn’t one of the two in this household. smsm is just for the two of you.');
  expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull();
});
