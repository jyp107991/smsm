/**
 * The two small money helpers the S2 screens rely on: the plain amount a field starts from (and a monzo.me
 * link carries, SET-1, SET-2), and the live remainder under Exact amounts (SPL-1, SPL-5).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatPlainPounds, parseAmount, pence } from './money';
import { exactRemainder } from './split';

describe('formatPlainPounds', () => {
  it('SET-1 SET-2: pounds and pence with no sign or grouping', () => {
    expect(formatPlainPounds(pence(2125))).toBe('21.25');
    expect(formatPlainPounds(pence(1000))).toBe('10.00');
    expect(formatPlainPounds(pence(5))).toBe('0.05');
    expect(formatPlainPounds(pence(0))).toBe('0.00');
    expect(formatPlainPounds(pence(120000))).toBe('1200.00');
  });

  it('refuses negatives and fractions of a penny', () => {
    expect(() => formatPlainPounds(pence(-1))).toThrow(RangeError);
    expect(() => formatPlainPounds(1.5 as never)).toThrow(RangeError);
  });

  it('SET-1: what it writes reads back as the same pence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (n) => {
        expect(parseAmount(formatPlainPounds(pence(n)))).toBe(n);
      }),
    );
  });
});

describe('exactRemainder', () => {
  it('SPL-1 SPL-5: zero when the parts add up, positive when some is left, negative when too much', () => {
    expect(exactRemainder(pence(3000), [pence(1000), pence(2000)])).toBe(0);
    expect(exactRemainder(pence(3000), [pence(1000), pence(1500)])).toBe(500);
    expect(exactRemainder(pence(3000), [pence(2000), pence(1500)])).toBe(-500);
    expect(exactRemainder(pence(3000), [])).toBe(3000);
  });
});
