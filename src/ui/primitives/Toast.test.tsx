/**
 * ADD-6: Undo belongs to the latest save. CI run 44044915859: a quick add right after an edit replaced the
 * edit's "Saved" toast, but while the old toast played its exit its Undo was still there to tap, and the tap
 * undid the edit instead of the new entry.
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

describe('Toast', () => {
  it('a replaced toast cannot be acted on while it leaves: Undo undoes the newest save', async () => {
    const undoEdit = vi.fn();
    const undoAdd = vi.fn();
    render(<ToastProvider><Grab /></ToastProvider>);
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: undoEdit } }); });
    act(() => { grabbed.api?.show({ message: 'Saved', action: { label: 'Undo', onAction: undoAdd } }); });

    // The old toast is still on screen while it leaves (the new one follows it): inert and hidden from
    // assistive tech, so nothing can press its Undo.
    const leaving = screen.queryAllByRole('button', { name: 'Undo', hidden: true });
    expect(leaving).toHaveLength(1);
    expect(leaving[0]?.closest('[inert]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryAllByRole('button', { name: 'Undo' })).toHaveLength(0);

    const [undo] = await screen.findAllByRole('button', { name: 'Undo' });
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    fireEvent.click(undo as HTMLElement);
    expect(undoAdd).toHaveBeenCalledTimes(1);
    expect(undoEdit).not.toHaveBeenCalled();
  });
});
