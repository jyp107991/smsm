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
import { ToastProvider, useToast, type ToastApi } from './Toast';

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
