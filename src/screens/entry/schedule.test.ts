/**
 * S10: the line under Starts when a regular payment that has posted takes a new start (core `restart` gives the
 * dates and the day it repeats on; this words them). On Tue 24 Nov 2026.
 */
import { describe, expect, it } from 'vitest';
import type { Schedule } from '../../core/recurring';
import { restartLine } from './schedule';

const TODAY = '2026-11-24';
const s = (frequency: Schedule['frequency'], startDate: string, every = 1, endDate: string | null = null): Schedule => ({ frequency, every, startDate, endDate });

describe('restartLine (S10)', () => {
  it('monthly names the day of the month, then the next date', () => {
    expect(restartLine(s('monthly', '2026-01-15'), TODAY)).toBe('From now on it posts on the 15th. Next: Tue 15 Dec. Past payments stay as they are.');
    expect(restartLine(s('monthly', '2026-01-01'), TODAY)).toBe('From now on it posts on the 1st. Next: Tue 1 Dec. Past payments stay as they are.');
    expect(restartLine(s('monthly', '2026-01-22'), TODAY)).toBe('From now on it posts on the 22nd. Next: Tue 22 Dec. Past payments stay as they are.');
    expect(restartLine(s('monthly', '2026-01-23'), TODAY)).toBe('From now on it posts on the 23rd. Next: Wed 23 Dec. Past payments stay as they are.');
    expect(restartLine(s('monthly', '2026-01-11'), TODAY)).toBe('From now on it posts on the 11th. Next: Fri 11 Dec. Past payments stay as they are.');
  });

  it('from the 29th, 30th or 31st it says what a shorter month does', () => {
    expect(restartLine(s('monthly', '2026-01-31'), TODAY)).toBe('From now on it posts on the 31st, or the last day of a shorter month. Next: Mon 30 Nov. Past payments stay as they are.');
  });

  it('every few months', () => {
    expect(restartLine(s('monthly', '2026-03-15', 3), TODAY)).toBe('From now on it posts every 3 months on the 15th. Next: Tue 15 Dec. Past payments stay as they are.');
  });

  it('weekly names the weekday', () => {
    expect(restartLine(s('weekly', '2026-11-02'), TODAY)).toBe('From now on it posts on Mondays. Next: Mon 30 Nov. Past payments stay as they are.');
    expect(restartLine(s('weekly', '2026-11-22', 2), TODAY)).toBe('From now on it posts every 2 weeks on Sunday. Next: Sun 6 Dec. Past payments stay as they are.');
  });

  it('yearly names the date; a next date in another year has its year', () => {
    expect(restartLine(s('yearly', '2025-03-02'), TODAY)).toBe('From now on it posts on 2 Mar each year. Next: 2 Mar 2027. Past payments stay as they are.');
    expect(restartLine(s('yearly', '2024-02-29'), TODAY)).toBe('From now on it posts on 29 Feb each year, or 28 Feb when there’s no 29th. Next: 28 Feb 2027. Past payments stay as they are.');
    expect(restartLine(s('yearly', '2025-12-15', 2), TODAY)).toBe('From now on it posts every 2 years on 15 Dec. Next: 15 Dec 2027. Past payments stay as they are.');
  });

  it('an end before its next day: nothing more posts', () => {
    expect(restartLine(s('monthly', '2026-01-15', 1, '2026-12-01'), TODAY)).toBe('From now on it posts on the 15th. It ends before its next day, so nothing more posts. Past payments stay as they are.');
  });
});
