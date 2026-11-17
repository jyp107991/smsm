/** The in-app date grid (S2 polish Q-L13): days as buttons, today marked, later days disabled, and the keyboard. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthGrid } from './MonthGrid';

const TODAY = '2026-11-14';

function grid(focus = TODAY) {
  const picked = vi.fn();
  render(<MonthGrid today={TODAY} focus={focus} mark={(d) => (d === focus ? 'chosen' : null)} onPick={picked} />);
  return picked;
}

describe('MonthGrid (Q-L13)', () => {
  it('Q-L13 Q-F2 DAT-2: named days, today marked, days after today disabled, one tab stop', () => {
    const picked = grid();
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sat 14 Nov' }).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sun 15 Nov' }).disabled).toBe(true);
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.getAttribute('aria-label'))).toEqual(['Sat 14 Nov']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next month' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tue 10 Nov' }));
    expect(picked).toHaveBeenCalledWith('2026-11-10');
  });

  it('Q-L13: arrow keys move a day or a week, never past today; Page Up goes to the month before', async () => {
    grid('2026-11-10');
    const day = (name: string) => screen.getByRole('button', { name });
    act(() => { day('Tue 10 Nov').focus(); });
    fireEvent.keyDown(day('Tue 10 Nov'), { key: 'ArrowRight' });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(day('Wed 11 Nov'));
    fireEvent.keyDown(day('Wed 11 Nov'), { key: 'ArrowDown' });
    await act(async () => { await Promise.resolve(); });
    // A week on would be 18 Nov, after today: it stops at today.
    expect(document.activeElement).toBe(day('Sat 14 Nov'));
    fireEvent.keyDown(day('Sat 14 Nov'), { key: 'PageUp' });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(day('Wed 14 Oct'));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });
});
