/**
 * ADD-6: Undo belongs to the latest save, and "Saved" says so at once.
 * - CI run 44044915859: a quick add right after an edit replaced the edit's "Saved" toast, but while the old
 *   toast played its exit its Undo was still there to tap, and the tap undid the edit instead of the new entry.
 * - CI run 44051517647: a money-back entry saved 0.8 s after "Restored Tesco" never showed "Saved": the new
 *   toast waited for the old one to finish leaving, and that exit animation never finished (in the test
 *   browser the animation clock had stalled). A new toast must never depend on an old one's animation.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lowestClearFoot, ToastProvider, useToast, type ToastApi } from './Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const grabbed: { api: ToastApi | null } = { api: null };
function Grab() {
  const api = useToast();
  useEffect(() => { grabbed.api = api; }, [api]);
  return null;
}

const region = () => screen.getByRole('status', { name: 'Notifications' });

describe('Toast', () => {
  it('a replaced toast cannot be acted on: Undo undoes the newest save', () => {
    const undoEdit = vi.fn();
    const undoAdd = vi.fn();
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: undoEdit } }); });
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: undoAdd } }); });

    // Only the newest toast's Undo exists at all, hidden or not, and it can be pressed.
    const all = screen.queryAllByRole('button', { name: 'Undo', hidden: true });
    expect(all).toHaveLength(1);
    expect(all[0]?.closest('[inert]')).toBeNull();
    const [undo] = screen.getAllByRole('button', { name: 'Undo' });
    fireEvent.click(undo as HTMLElement);
    expect(undoAdd).toHaveBeenCalledTimes(1);
    expect(undoEdit).not.toHaveBeenCalled();
  });

  it('a new toast shows at once, without waiting for the one it replaces to animate out', () => {
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'Restored Tesco' }); });
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: () => undefined } }); });

    // No animation frame has run: the live region already reads the new message, and only it.
    expect(region().textContent).toMatch(/^Saved/);
    expect(region().textContent).not.toContain('Restored Tesco');
    expect(screen.getByRole('button', { name: 'Undo' }).closest('[inert]')).toBeNull();
  });

  it('a toast shown while the last one is still leaving shows at once', () => {
    render(<ToastProvider><Grab /></ToastProvider>);
    let first = 0;
    act(() => { first = grabbed.api?.show({ message: 'Deleted Tesco', action: { label: 'Undo', onAction: () => undefined } }) ?? 0; });
    act(() => { grabbed.api?.dismiss(first); });
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: () => undefined } }); });

    expect(region().textContent).toMatch(/^Saved/);
    expect(region().textContent).not.toContain('Deleted Tesco');
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.closest('[inert]')).toBeNull();
  });

  it('a toast that is leaving cannot be acted on while it animates out', () => {
    const undo = vi.fn();
    render(<ToastProvider><Grab /></ToastProvider>);
    let id = 0;
    act(() => { id = grabbed.api?.show({ message: 'Deleted Tesco', action: { label: 'Undo', onAction: undo } }) ?? 0; });
    act(() => { grabbed.api?.dismiss(id); });

    // Still on screen for its exit, but inert and hidden from assistive tech.
    expect(screen.queryAllByRole('button', { name: 'Undo' })).toHaveLength(0);
    const leaving = screen.queryAllByRole('button', { name: 'Undo', hidden: true });
    for (const b of leaving) expect(b.closest('[inert]')?.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * Q-L4: where the toast's foot goes, given what it keeps clear of (with the 12 px it keeps from each). Boxes are
 * CI run 45387654645's at 320 × 640: Quick add 511–567, the tab bar 572–640, a 79 px toast, 16 px from each edge.
 */
describe('lowestClearFoot', () => {
  const quickAdd = { top: 511, bottom: 567 };
  const tabBar = { top: 572, bottom: 640 };
  it('with nothing to avoid, the foot of the screen', () => {
    expect(lowestClearFoot([], 79, 624, 16)).toBe(624);
  });
  it('above Quick add and the tab bar, never on either', () => {
    expect(lowestClearFoot([tabBar, quickAdd], 79, 624, 16)).toBe(499);
    expect(lowestClearFoot([quickAdd, tabBar], 79, 624, 16)).toBe(499);
  });
  it('no room above Quick add: into the gap between two marks, or higher, rather than onto either', () => {
    // A mark at 380–440 leaves 452–499 above Quick add: too short for 79 px, so above that mark instead.
    expect(lowestClearFoot([quickAdd, tabBar, { top: 380, bottom: 440 }], 79, 624, 16)).toBe(368);
    // A mark at 300–340 leaves 352–499: room for it there.
    expect(lowestClearFoot([quickAdd, tabBar, { top: 300, bottom: 340 }], 79, 624, 16)).toBe(499);
  });
  it('no gap tall enough anywhere: none (the toast waits, hidden)', () => {
    expect(lowestClearFoot([{ top: 60, bottom: 600 }], 79, 624, 16)).toBeNull();
    expect(lowestClearFoot([], 79, 90, 16)).toBeNull();
  });
});
