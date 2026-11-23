/**
 * S9 fresh review, written before the fixes (ENGINEERING §5 "Bugs"): each test reproduces a finding.
 * 1. A file that fails to arrive stays its own screen's or sheet's problem ("Couldn't load this.", Try again that
 *    really tries again); the plank's spring failing leaves the plank still; a failure in the background reloads
 *    the page once per session, unless the person is busy or a screen asked for it.
 * 4. A sheet opened before its code has arrived already behaves as a sheet: back closes it (the page stays),
 *    Escape closes it, focus goes back to what opened it; when its code arrives it keeps the one history entry.
 * 5. A phone that signs out, or shows sign-in, has its next first paint as plain paper.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Component, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, storedExpense } from '../../tests/fixtures/couple';
import { createMemoryApi } from '../data/memoryApi';
import { manualNetwork } from '../data/network';
import { createDataLayer, type DataLayer } from '../data/queryClient';
import type { SessionKeeper } from '../data/session';
import { memoryStorage } from '../data/storage';
import { DataProvider } from '../data';
import { resetHistoryForTests } from '../ui/history';
import { strings } from '../ui/strings';
import { Root } from './AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let open: DataLayer | null = null;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  await open?.dispose();
  open = null;
  vi.doUnmock('../ui/primitives/SheetImpl');
  vi.doUnmock('../ui/rig/PlankBeam');
});

/** Catches what a test's tree throws, so "the whole app went down" is something a test can see. */
class Caught extends Component<{ children: ReactNode }, { error: boolean }> {
  override state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  override render() { return this.state.error ? <p>The whole app went down</p> : this.props.children; }
}

// First: the later tests load fresh copies of modules (vi.resetModules), and the app's own screens must not.
describe('S9 review 5: signed out, the first paint is plain paper', () => {
  function signedOut(): DataLayer {
    const { api } = createMemoryApi({}, { user: null });
    const out = { status: 'signed-out' } as const;
    const session: SessionKeeper = { ready: Promise.resolve(), state: () => out, subscribe: () => () => undefined, dispose: () => undefined };
    return createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session, today: () => '2026-11-14' });
  }
  const saved = () => JSON.parse(localStorage.getItem('smsm-boot') ?? 'null') as { home?: boolean } | null;

  it('the sign-in screen records that this phone does not start on Home', async () => {
    localStorage.setItem('smsm-boot', JSON.stringify({ home: true, above: 0, balance: 343 }));
    open = signedOut();
    render(<DataProvider layer={open}><Root /></DataProvider>);
    await screen.findByRole('textbox', { name: 'Email' });
    await waitFor(() => { expect(saved()).toEqual({ home: false }); });
  });

  it('signing out records it too, before the sign-in screen even shows', async () => {
    const { layer } = couple({ expenses: [storedExpense()] });
    history.replaceState(null, '', '/settings');
    resetHistoryForTests();
    open = layer;
    render(<DataProvider layer={layer}><Root /></DataProvider>);
    localStorage.setItem('smsm-boot', JSON.stringify({ home: true, above: 0, balance: 343 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => { expect(saved()).toEqual({ home: false }); });
  });
});

describe('S9 review 1: a file that does not arrive stays local, and Try again really tries again', () => {
  it('a lazy screen whose file fails shows "Couldn\'t load this." in its place; the rest of the page stays; Try again loads it', async () => {
    const { lazyScreen } = await import('./lazy');
    let failing = true;
    let asked = 0;
    const Screen = lazyScreen(() => {
      asked += 1;
      if (failing) return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
      return Promise.resolve({ Thing: () => <h1>The screen</h1> });
    }, (m) => m.Thing);
    render(<Caught><p>The tab bar</p><Screen /></Caught>);
    expect(await screen.findByText(strings.errors.couldntLoad)).toBeTruthy();
    expect(screen.getByText('The tab bar')).toBeTruthy();
    expect(screen.queryByText('The whole app went down')).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: strings.errors.tryAgain }));
    expect(await screen.findByRole('heading', { name: 'The screen' })).toBeTruthy();
    expect(asked).toBe(2);
  });

  it('a sheet whose code fails offers Try again and Close, over the page, never the whole app\'s error', async () => {
    vi.resetModules();
    vi.doMock('../ui/primitives/SheetImpl', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const { Sheet } = await import('../ui/primitives/Sheet');
    const changes: boolean[] = [];
    render(<Caught><p>The page</p><Sheet open onOpenChange={(o) => { changes.push(o); }} title="Add expense"><p>Inside</p></Sheet></Caught>);
    expect(await screen.findByText(strings.errors.couldntLoad)).toBeTruthy();
    expect(screen.getByText('The page')).toBeTruthy();
    expect(screen.queryByText('The whole app went down')).toBeNull();
    expect(screen.getByRole('button', { name: strings.errors.tryAgain })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: strings.ui.close }));
    expect(changes).toEqual([false]);
  });

  it('the plank stays up, standing still, when its spring\'s file fails', async () => {
    vi.resetModules();
    vi.doMock('../ui/rig/PlankBeam', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const { dismissBoot } = await import('../ui/boot');
    const { Plank } = await import('../ui/rig/Plank');
    const { container } = render(<Caught><Plank left={{ kind: 'cat', mood: 'calm' }} right={{ kind: 'dog', mood: 'calm' }} leftNetPence={2000} /></Caught>);
    act(() => { dismissBoot(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByText('The whole app went down')).toBeNull();
    const beam = container.querySelector<HTMLElement>('[data-tilt]');
    expect(beam).not.toBeNull();
    expect(beam?.style.transform).toMatch(/rotate\(/);
  });

  it('the failed file\'s address is read from the browser\'s message, so a retry can ask for it afresh', async () => {
    const { failedFileOf } = await import('../ui/loadRetry');
    expect(failedFileOf(new TypeError('Failed to fetch dynamically imported module: https://smsm.example/assets/Activity-AbC12.js')))
      .toBe('https://smsm.example/assets/Activity-AbC12.js');
    expect(failedFileOf(new TypeError('error loading dynamically imported module: http://localhost:4173/assets/EntrySheet-x_1.js?retry=1')))
      .toBe('http://localhost:4173/assets/EntrySheet-x_1.js');
    expect(failedFileOf(new TypeError('Importing a module script failed.'))).toBeNull();
  });

  it('a file failing in the background reloads the page once per session; not while a sheet is open or someone is typing', async () => {
    const { installPreloadRecovery } = await import('../ui/loadRetry');
    const reload = vi.fn();
    const stop = installPreloadRecovery(reload);
    const fail = () => { const e = new Event('vite:preloadError', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };

    // Busy: a sheet is open.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(fail()).toBe(false);
    dialog.remove();
    // Busy: typing.
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    expect(fail()).toBe(false);
    input.remove();
    expect(reload).not.toHaveBeenCalled();

    expect(fail()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // Once per session: the next failure is left to the screen that asked for it.
    expect(fail()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});

/** A sheet opened by a button (so focus has somewhere to go back to). */
function Opener({ Sheet, onChange }: { Sheet: (p: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) => ReactNode; onChange: (o: boolean) => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>Open it</button>
      <Sheet open={isOpen} onOpenChange={(o) => { setOpen(o); onChange(o); }} title="Who paid"><p>Inside</p></Sheet>
    </>
  );
}

describe('S9 review 4: a sheet opened before its code has arrived', () => {
  async function pendingSheet(gate?: Promise<void>) {
    vi.resetModules();
    vi.doMock('../ui/primitives/SheetImpl', async () => {
      // Never arrives, or arrives when the test says.
      await (gate ?? new Promise(() => undefined));
      return await vi.importActual('../ui/primitives/SheetImpl');
    });
    const history_ = await import('../ui/history');
    history.replaceState(null, '', '/activity');
    history_.resetHistoryForTests();
    history_.installHistory();
    const { Sheet } = await import('../ui/primitives/Sheet');
    return { Sheet };
  }
  const depth = () => (history.state as { smsmLayers?: number } | null)?.smsmLayers ?? 0;

  it('back closes it and the page stays where it was', async () => {
    const { Sheet } = await pendingSheet();
    const changes: boolean[] = [];
    render(<Opener Sheet={Sheet} onChange={(o) => { changes.push(o); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await waitFor(() => { expect(depth()).toBe(1); });
    act(() => { history.back(); });
    await waitFor(() => { expect(changes).toEqual([false]); });
    expect(location.pathname).toBe('/activity');
    await waitFor(() => { expect(depth()).toBe(0); });
  });

  it('Escape closes it, its history entry goes, and focus returns to what opened it', async () => {
    const { Sheet } = await pendingSheet();
    const changes: boolean[] = [];
    render(<Opener Sheet={Sheet} onChange={(o) => { changes.push(o); }} />);
    const button = screen.getByRole('button', { name: 'Open it' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => { expect(depth()).toBe(1); });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(changes).toEqual([false]);
    await waitFor(() => { expect(document.activeElement).toBe(button); });
    await waitFor(() => { expect(depth()).toBe(0); });
    expect(location.pathname).toBe('/activity');
  });

  it('when its code arrives it rises in the same history entry; back then closes it', async () => {
    let arrive: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { arrive = resolve; });
    const { Sheet } = await pendingSheet(gate);
    const changes: boolean[] = [];
    render(<Opener Sheet={Sheet} onChange={(o) => { changes.push(o); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await waitFor(() => { expect(depth()).toBe(1); });
    const entries = history.length;
    await act(async () => { arrive(); await gate; });
    expect(await screen.findByRole('dialog', { name: 'Who paid' })).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(history.length).toBe(entries);
    expect(depth()).toBe(1);
    act(() => { history.back(); });
    await waitFor(() => { expect(changes).toEqual([false]); });
    expect(location.pathname).toBe('/activity');
  });
});

