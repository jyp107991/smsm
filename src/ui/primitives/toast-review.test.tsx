/**
 * S2 polish 1b, fresh review (toasts), each reproduced before it was fixed:
 * 2 The placing loop ran every animation frame for as long as any toast showed, the update prompt included
 *   (it can stay for hours). It now measures when something changes, and briefly after.
 * 4 iPhone's keyboard doesn't shrink the page (Safari ignores interactive-widget), only the visual viewport:
 *   a toast placed against window.innerHeight sat behind the keyboard.
 * 7 The update prompt came back after each passing toast as a new node in the live region, so it was read
 *   out again every time.
 */
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastApi } from './Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const grabbed: { api: ToastApi | null } = { api: null };
function Grab() {
  const api = useToast();
  useEffect(() => { grabbed.api = api; }, [api]);
  return null;
}
const region = () => screen.getByRole('status', { name: 'Notifications' });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'visualViewport');
});

describe('toast review', () => {
  it('2: no animation frames run while only the update prompt shows and nothing changes', async () => {
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'A new version is ready', action: { label: 'Refresh', onAction: () => undefined }, duration: 0, sticky: true }); });
    await wait(1500);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    await wait(500);
    expect(raf).not.toHaveBeenCalled();
    expect(region().textContent).toContain('A new version is ready');
  });

  it('4: with the keyboard up (a visual viewport shorter than the page), the toast sits above the keyboard', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 0, offsetLeft: 0, width: 390, scale: 1, pageTop: 0, pageLeft: 0, onresize: null, onscroll: null });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'Saved' }); });
    await wait(50);
    const bottom = /bottom:\s*max\((\d+)px/.exec(region().getAttribute('style') ?? '')?.[1];
    // 844 − 500 = 344 px of keyboard, then the usual 16 px.
    expect(Number(bottom)).toBeGreaterThanOrEqual(344 + 16);
  });

  it('7: the update prompt is announced once; when a passing toast leaves, it comes back without being read again', async () => {
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'A new version is ready', action: { label: 'Refresh', onAction: () => undefined }, duration: 0, sticky: true }); });
    await wait(20);
    let saved = 0;
    act(() => { saved = grabbed.api?.show({ message: 'Saved' }) ?? 0; });
    await wait(20);
    // The passing toast is new: it is read.
    const live = (text: string) => screen.getByText(text).closest('[aria-live]')?.getAttribute('aria-live') ?? 'polite';
    expect(live('Saved')).not.toBe('off');
    act(() => { grabbed.api?.dismiss(saved); });
    await wait(400);
    expect(region().textContent).toContain('A new version is ready');
    expect(live('A new version is ready'), 'the returning prompt is quiet').toBe('off');
  });
});
