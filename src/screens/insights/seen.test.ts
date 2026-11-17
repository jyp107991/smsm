/** S5b fresh review: what this phone has opened only moves forward. */
import { beforeEach, describe, expect, it } from 'vitest';
import { markRecapSeen, markYearSeen, recapSeen, settleSeen, yearSeen } from './seen';

describe('recap and year banners (S5b review)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('opening the month so far on settle day does not hide that month’s finished recap later', () => {
    markRecapSeen('2026-11', true);
    expect(settleSeen('2026-11')).toBe(true);
    expect(recapSeen('2026-11')).toBe(false);
  });

  it('opening an older recap never brings a newer banner back', () => {
    markRecapSeen('2026-10', false);
    markRecapSeen('2026-09', false);
    expect(recapSeen('2026-10')).toBe(true);
  });

  it('the year in review only moves forward too', () => {
    markYearSeen(2026);
    markYearSeen(2025);
    expect(yearSeen('2026')).toBe(true);
  });
});
