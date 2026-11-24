/**
 * S10: the line under Starts when a regular payment that has posted takes a new start (core `restart` gives the
 * dates and the day it repeats on; this words them). It names the next payment and, when it differs, the old next day
 * it replaces. On Tue 24 Nov 2026.
 */
import { describe, expect, it } from 'vitest';
import type { Schedule } from '../../core/recurring';
import { restartLine } from './schedule';

const TODAY = '2026-11-24';
const s = (frequency: Schedule['frequency'], startDate: string, every = 1, endDate: string | null = null): Schedule => ({ frequency, every, startDate, endDate });
/** Rent on the 1st, posted to 1 Nov: its next day is Tue 1 Dec. */
const rent = s('monthly', '2026-01-01');

describe('restartLine (S10)', () => {
  it('monthly names the day of the month, the next payment and the day it replaces', () => {
    expect(restartLine(rent, 11, '2026-01-15', TODAY)).toBe('From now on it posts on the 15th. Next: Tue 15 Dec (instead of Tue 1 Dec). Past payments stay as they are.');
    expect(restartLine(rent, 11, '2026-01-22', TODAY)).toBe('From now on it posts on the 22nd. Next: Sun 22 Nov (instead of Tue 1 Dec). Past payments stay as they are.');
    expect(restartLine(rent, 11, '2026-01-23', TODAY)).toBe('From now on it posts on the 23rd. Next: Mon 23 Nov (instead of Tue 1 Dec). Past payments stay as they are.');
    expect(restartLine(rent, 11, '2026-01-11', TODAY)).toBe('From now on it posts on the 11th. Next: Fri 11 Dec (instead of Tue 1 Dec). Past payments stay as they are.');
  });

  it('the same day as before: no "instead"', () => {
    expect(restartLine(rent, 11, '2025-06-01', TODAY)).toBe('From now on it posts on the 1st. Next: Tue 1 Dec. Past payments stay as they are.');
  });

  it('from the 29th, 30th or 31st it says what a shorter month does', () => {
    expect(restartLine(rent, 11, '2026-01-31', TODAY)).toBe('From now on it posts on the 31st, or the last day of a shorter month. Next: Mon 30 Nov (instead of Tue 1 Dec). Past payments stay as they are.');
  });

  it('every few months', () => {
    expect(restartLine(s('monthly', '2026-01-01', 3), 4, '2026-03-20', TODAY)).toBe('From now on it posts every 3 months on the 20th. Next: Sun 20 Dec (instead of 1 Jan 2027). Past payments stay as they are.');
  });

  it('weekly names the weekday', () => {
    expect(restartLine(s('weekly', '2026-11-02'), 4, '2026-11-06', TODAY)).toBe('From now on it posts on Fridays. Next: Fri 27 Nov (instead of Mon 30 Nov). Past payments stay as they are.');
    expect(restartLine(s('weekly', '2026-11-02', 2), 1, '2026-10-26', TODAY)).toBe('From now on it posts every 2 weeks on Monday. Next: Mon 23 Nov (instead of Mon 16 Nov). Past payments stay as they are.');
  });

  it('yearly names the date; a date in another year has its year', () => {
    expect(restartLine(s('yearly', '2025-03-02'), 2, '2024-02-29', TODAY)).toBe('From now on it posts on 29 Feb each year, or 28 Feb when there’s no 29th. Next: 28 Feb 2027 (instead of 2 Mar 2027). Past payments stay as they are.');
    expect(restartLine(s('yearly', '2025-12-15', 2), 1, '2025-12-01', TODAY)).toBe('From now on it posts every 2 years on 1 Dec. Next: 1 Dec 2027 (instead of 15 Dec 2027). Past payments stay as they are.');
  });

  it('an end before its next day: nothing more posts', () => {
    expect(restartLine(s('monthly', '2026-01-01', 1, '2026-12-10'), 11, '2026-01-15', TODAY)).toBe('From now on it posts on the 15th. It ends before its next day, so nothing more posts. Past payments stay as they are.');
  });
});
