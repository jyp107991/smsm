/**
 * BAL-3: the plank tilts with the balance (DESIGN §4.1): level when square, toward whoever is owed,
 * proportional, capped at 8° (reached at £200).
 * Convention (S0 brief): positive degrees when the left animal is owed (left end up, CSS rotate clockwise).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PLANK_FULL_TILT_PENCE, PLANK_MAX_DEG, plankTilt } from './plank';

const safeInt = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
const belowCap = fc.integer({ min: -19999, max: 19999 });

describe('BAL-3 plank tilt', () => {
  it('BAL-3: the cap is 8 degrees, reached at £200 (20000 pence)', () => {
    expect(PLANK_MAX_DEG).toBe(8);
    expect(PLANK_FULL_TILT_PENCE).toBe(20000);
  });

  it('BAL-3: level when square (exactly +0, never -0)', () => {
    expect(Object.is(plankTilt(0), 0)).toBe(true);
    expect(Object.is(plankTilt(-0), 0)).toBe(true);
  });

  it('BAL-3: tilts toward whoever is owed: positive when the left animal is owed, negative when the right is', () => {
    expect(plankTilt(1)).toBeGreaterThan(0);
    expect(plankTilt(2450)).toBeGreaterThan(0);
    expect(plankTilt(-1)).toBeLessThan(0);
    expect(plankTilt(-2450)).toBeLessThan(0);
    fc.assert(
      fc.property(safeInt, (n) => {
        expect(Math.sign(plankTilt(n))).toBe(Math.sign(n));
      }),
    );
  });

  it('BAL-3: proportional below the cap', () => {
    expect(plankTilt(10000)).toBeCloseTo(4, 10);
    expect(plankTilt(-10000)).toBeCloseTo(-4, 10);
    expect(plankTilt(5000)).toBeCloseTo(2, 10);
    expect(plankTilt(2450)).toBeCloseTo(0.98, 10);
    expect(plankTilt(19999)).toBeCloseTo((8 * 19999) / 20000, 10);
    expect(plankTilt(19999)).toBeLessThan(8);
    fc.assert(
      fc.property(belowCap, (n) => {
        expect(plankTilt(n)).toBeCloseTo((8 * n) / 20000, 10);
      }),
    );
  });

  it('BAL-3: exactly 8 degrees at £200 and beyond, either way', () => {
    expect(plankTilt(20000)).toBe(8);
    expect(plankTilt(-20000)).toBe(-8);
    expect(plankTilt(20001)).toBe(8);
    expect(plankTilt(1_000_000)).toBe(8);
    expect(plankTilt(Number.MAX_SAFE_INTEGER)).toBe(8);
    expect(plankTilt(Number.MIN_SAFE_INTEGER)).toBe(-8);
    fc.assert(
      fc.property(fc.integer({ min: 20000, max: Number.MAX_SAFE_INTEGER }), (n) => {
        expect(plankTilt(n)).toBe(8);
        expect(plankTilt(-n)).toBe(-8);
      }),
    );
  });

  it('BAL-3: symmetric: swapping who is owed mirrors the tilt', () => {
    fc.assert(
      fc.property(safeInt, (n) => {
        expect(plankTilt(-n) + plankTilt(n)).toBe(0);
      }),
    );
  });

  it('BAL-3: never steeper as the balance shrinks (monotonic)', () => {
    fc.assert(
      fc.property(safeInt, safeInt, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(plankTilt(lo)).toBeLessThanOrEqual(plankTilt(hi));
      }),
    );
  });

  it('BAL-3: always a finite angle within ±8, never NaN or -0, for any safe integer', () => {
    fc.assert(
      fc.property(safeInt, (n) => {
        const t = plankTilt(n);
        expect(Number.isFinite(t)).toBe(true);
        expect(Number.isNaN(t)).toBe(false);
        expect(Object.is(t, -0)).toBe(false);
        expect(Math.abs(t)).toBeLessThanOrEqual(8);
      }),
      { numRuns: 1000 },
    );
  });
});
