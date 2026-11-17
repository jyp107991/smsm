/**
 * The one history coordinator (DESIGN §6; the S0/S1 review's Sheet finding): back closes the sheet first,
 * a sheet closed any other way removes its own entry, and navigating while a sheet is open never leaves
 * the sheet's entry behind between the two pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeLayer, currentPath, installHistory, navigate, openLayer, resetHistoryForTests, subscribeRoute } from './history';

const settled = () => new Promise<void>((r) => { setTimeout(r, 30); });

beforeEach(() => {
  history.replaceState(null, '', '/');
  installHistory();
  resetHistoryForTests();
});
afterEach(async () => { await settled(); });

describe('history coordinator', () => {
  it('back with a sheet open closes the sheet and stays on the page', async () => {
    const onBack = vi.fn();
    const routes: string[] = [];
    const off = subscribeRoute((p) => routes.push(p));
    navigate('/activity');
    openLayer('a', { onBack, onLeave: vi.fn() });
    const length = history.length;
    history.back();
    await settled();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/activity');
    expect(currentPath()).toBe('/activity');
    expect(history.length).toBe(length);
    off();
  });

  it('a sheet closed by itself takes its entry with it: back then leaves the page', async () => {
    navigate('/activity');
    const onBack = vi.fn();
    openLayer('a', { onBack, onLeave: vi.fn() });
    closeLayer('a');
    await settled();
    history.back();
    await settled();
    expect(onBack).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/');
    expect(currentPath()).toBe('/');
  });

  it('navigating with a sheet open removes its entry before the new page: back goes to the old page', async () => {
    navigate('/activity');
    const onLeave = vi.fn();
    openLayer('a', { onBack: vi.fn(), onLeave });
    navigate('/entry/1');
    closeLayer('a'); // the sheet's own cleanup after the handler: a no-op now
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe('/entry/1');
    await settled();
    expect(location.pathname).toBe('/entry/1');
    history.back();
    await settled();
    expect(location.pathname).toBe('/activity');
    expect(currentPath()).toBe('/activity');
  });

  it('a sheet opened while a back is still in flight is pushed after it lands', async () => {
    navigate('/activity');
    openLayer('a', { onBack: vi.fn(), onLeave: vi.fn() });
    closeLayer('a');
    const onBack = vi.fn();
    openLayer('b', { onBack, onLeave: vi.fn() });
    await settled();
    history.back();
    await settled();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/activity');
  });
});
