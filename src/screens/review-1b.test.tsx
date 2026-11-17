/**
 * S2 polish 1b, fresh review: findings on the real screens over the in-memory Api, each reproduced before it
 * was fixed (ENGINEERING §5 "Bugs"). The toast findings are in src/ui/primitives/toast-review.test.tsx, the
 * ones that need a browser in tests/e2e/review-1b.spec.ts.
 * 3 A code corrected while the first one was still being checked was dropped, and the first one's "didn't
 *   work" then showed under the corrected digits; "Send a new code" during a check ended the check's busy.
 * 5 Waiting for the partner, the sentence wasn't the focus fallback, so focus fell to the page.
 * 6 Pinch-zoom shrinks the visual viewport too: it read as a keyboard and hid the tab bar.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple } from '../../tests/fixtures/couple';
import { createMemoryApi, type MemoryControls } from '../data/memoryApi';
import { manualNetwork } from '../data/network';
import { createDataLayer, type DataLayer } from '../data/queryClient';
import type { SessionKeeper } from '../data/session';
import { memoryStorage } from '../data/storage';
import { DataProvider } from '../data';
import { returnFocus } from '../ui/focus';
import { resetHistoryForTests } from '../ui/history';
import { BottomTabs, MAIN_TABS, TabPanel } from '../ui/primitives';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
const realMatchMedia = window.matchMedia.bind(window);
beforeEach(() => {
  history.replaceState(null, '', '/');
  resetHistoryForTests();
});
afterEach(async () => {
  await open?.dispose();
  open = null;
  window.matchMedia = realMatchMedia;
  Reflect.deleteProperty(window, 'visualViewport');
});

function show(layer: DataLayer) {
  open = layer;
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}

function signedOut(): { layer: DataLayer; controls: MemoryControls } {
  const { api, controls } = createMemoryApi({}, { user: null });
  const out = { status: 'signed-out' } as const;
  const session: SessionKeeper = { ready: Promise.resolve(), state: () => out, subscribe: () => () => undefined, dispose: () => undefined };
  const layer = createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session, today: () => '2026-11-14' });
  return { layer, controls };
}

const calls = (controls: MemoryControls, name: string) => controls.calls.filter((c) => c.name === name);
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function toCodeStep(controls: MemoryControls): Promise<HTMLInputElement> {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'jae@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  const code = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Code' });
  await waitFor(() => { expect(calls(controls, 'auth.sendCode')).toHaveLength(1); });
  return code;
}

describe('review 3: the code step while a check is running', () => {
  it('a code corrected during a check is checked next; the old check\'s answer is not shown', async () => {
    const { layer, controls } = signedOut();
    controls.delay = (name, arg) => (name === 'auth.verifyCode' && (arg as { code: string }).code === '000000' ? 200 : 0);
    show(layer);
    const code = await toCodeStep(controls);
    fireEvent.change(code, { target: { value: '000000' } });
    await wait(30);
    fireEvent.change(code, { target: { value: '123456' } });
    await wait(400);
    expect(calls(controls, 'auth.verifyCode').map((c) => (c.arg as { code: string }).code)).toEqual(['000000', '123456']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Send a new code" does nothing while a code is being checked, and doesn\'t end the check\'s busy state', async () => {
    const { layer, controls } = signedOut();
    controls.delay = (name) => (name === 'auth.verifyCode' ? 300 : 0);
    show(layer);
    const code = await toCodeStep(controls);
    fireEvent.change(code, { target: { value: '000000' } });
    await wait(30);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await wait(50);
    expect(calls(controls, 'auth.sendCode')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Sign in|Working/ }).getAttribute('aria-busy')).toBe('true');
    expect((await screen.findByRole('alert')).textContent).toContain('That code didn’t work');
  });
});

describe('review 5: waiting for the partner, focus falls back to the sentence', () => {
  it('a sheet whose opener has gone hands focus to "Waiting for your partner…", not the page', async () => {
    const { layer } = couple({ partnerJoined: false });
    show(layer);
    const balance = await screen.findByRole('region', { name: 'Balance' });
    await waitFor(() => { expect(balance.textContent).toContain('Waiting for your partner'); });
    act(() => { returnFocus(null); });
    expect(document.activeElement?.textContent).toBe('Waiting for your partner…');
  });
});

describe('review 6: pinch-zoom is not a keyboard', () => {
  function viewport(height: number, scale: number): EventTarget & { height: number; scale: number } {
    const vv = window.visualViewport as unknown as (EventTarget & { height: number; scale: number }) | undefined;
    if (vv) {
      vv.height = height;
      vv.scale = scale;
      return vv;
    }
    const made = Object.assign(new EventTarget(), { height, scale, width: 390, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: made });
    return made;
  }

  it('a field focused and the view zoomed in keeps the tab bar; a real keyboard still hides it', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'), media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const vv = viewport(844, 1);
    render(
      <BottomTabs items={MAIN_TABS} value="home" onValueChange={() => undefined}>
        <TabPanel value="home"><input aria-label="Field" /></TabPanel>
      </BottomTabs>,
    );
    await wait(30);
    act(() => { screen.getByRole('textbox', { name: 'Field' }).focus(); });
    await wait(30);
    const nav = () => document.querySelector('nav') as HTMLElement;
    expect(nav().hidden).toBe(false);

    // Pinch-zoom to 2×: the visual viewport is half as tall, but nothing covers the page.
    viewport(422, 2);
    act(() => { vv.dispatchEvent(new Event('resize')); });
    await wait(50);
    expect(nav().hidden, 'zooming in hid the tab bar').toBe(false);

    // The keyboard: shorter at the same zoom.
    viewport(500, 1);
    act(() => { vv.dispatchEvent(new Event('resize')); });
    await wait(50);
    expect(nav().hidden).toBe(true);
  });
});
