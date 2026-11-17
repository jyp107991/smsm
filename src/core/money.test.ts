import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pence, sumPence, parseAmount, formatPence } from './money';

const MAX = 100_000_000; // £1,000,000 in pence

describe('pence', () => {
  it('accepts safe integers, including zero and negatives', () => {
    expect(pence(4250)).toBe(4250);
    expect(pence(0)).toBe(0);
    expect(pence(-500)).toBe(-500);
    expect(pence(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws on anything that is not a safe integer', () => {
    for (const bad of [0.5, 42.5, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53]) {
      expect(() => pence(bad)).toThrow();
    }
  });

  it('round-trips any safe integer', () => {
    fc.assert(fc.property(fc.maxSafeInteger(), (n) => pence(n) === n));
  });
});

describe('sumPence', () => {
  it('sums integer pence exactly', () => {
    expect(sumPence([])).toBe(0);
    expect(sumPence([pence(1)])).toBe(1);
    expect(sumPence([pence(2126), pence(2125)])).toBe(4251);
    expect(sumPence([pence(1000), pence(-250), pence(1)])).toBe(751);
  });

  it('equals the ordinary sum for any list of amounts', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -MAX, max: MAX }), { maxLength: 50 }), (xs) => {
        const expected = xs.reduce((a, b) => a + b, 0);
        return sumPence(xs.map((x) => pence(x))) === expected;
      }),
    );
  });
});

describe('parseAmount', () => {
  const good: [string, number][] = [
    ['42.5', 4250],
    ['42.50', 4250],
    ['£42.50', 4250],
    ['42', 4200],
    ['£42', 4200],
    ['0.5', 50],
    ['0.05', 5],
    ['£0.01', 1],
    ['1,200', 120000],
    ['£1,200.50', 120050],
    ['12,345', 1234500],
    ['1000000', MAX],
    ['1,000,000.00', MAX],
    ['£1,000,000', MAX],
  ];
  it.each(good)('reads %s as %i pence', (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });

  it('Q-U3 TXT-4: a comma followed by exactly two digits is a decimal comma, in quick add and the form alike', () => {
    expect(parseAmount('4,50')).toBe(450);
    expect(parseAmount('12,34')).toBe(1234);
    expect(parseAmount('£42,50')).toBe(4250);
    expect(parseAmount('４２，５０')).toBe(4250);
    expect(parseAmount('12,50+1')).toBe(1350);
    // A group of three is still thousands.
    expect(parseAmount('1,200')).toBe(120000);
    expect(parseAmount('12,345')).toBe(1234500);
  });

  it('ADD-5 accepts simple sums with + and returns the total', () => {
    expect(parseAmount('12+8.50')).toBe(2050);
    expect(parseAmount('18.50+4+12')).toBe(3450);
    expect(parseAmount('12+8.5')).toBe(2050);
    expect(parseAmount('0.10+0.20')).toBe(30); // exact in pence, not 0.30000000000000004
    expect(parseAmount('1,200+50')).toBe(125000);
    expect(parseAmount('999999+1')).toBe(MAX);
  });

  it('ADD-5 a sum is exact for any terms (no floating-point drift)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 99_999 }), { minLength: 1, maxLength: 8 }), (terms) => {
        const text = terms.map((t) => `${Math.floor(t / 100)}.${String(t % 100).padStart(2, '0')}`).join('+');
        return parseAmount(text) === terms.reduce((a, b) => a + b, 0);
      }),
    );
  });

  it('TXT-4 accepts full-width digits and symbols', () => {
    expect(parseAmount('４２．５')).toBe(4250);
    expect(parseAmount('４２')).toBe(4200);
    expect(parseAmount('１２＋８．５０')).toBe(2050);
    expect(parseAmount('￡４２．５０')).toBe(4250);
  });

  it('ignores whitespace around the amount', () => {
    expect(parseAmount(' 42.50 ')).toBe(4250);
    expect(parseAmount('\t12+8.50\n')).toBe(2050);
  });

  const bad = [
    '',
    ' ',
    '£',
    '0',
    '0.00',
    '£0',
    '0+0',
    '-5',
    '-0.01',
    '£-5',
    '−5',
    '1.234',
    '42.505',
    '12-3',
    '12*3',
    '12/3',
    '12+',
    '+12',
    '12++3',
    '1e3',
    '0x10',
    'Infinity',
    'NaN',
    'abc',
    'tesco',
    '12abc',
    'abc12',
    '42.50.1',
    // '4,50' and '12,34' read as decimal commas since S2 polish Q-U3 (see the test below).
    '1,2',
    '1,234,56',
    '4,5',
    '4,500,0',
    '1,2345',
    '1000000.01',
    '1,000,001',
    '£1,000,000.01',
    '999999+2',
    '60/40',
    '12/11',
    '#12',
    '12 50',
    '9007199254740993',
  ];
  it.each(bad)('returns null for %j', (text) => {
    expect(parseAmount(text)).toBeNull();
  });

  it('reads back what formatPence writes, for every amount up to £1,000,000', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: MAX }), (p) => parseAmount(formatPence(pence(p))) === p));
  });

  it('reads plain pounds-and-pence text exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX }), (p) => {
        const text = `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
        return parseAmount(text) === p;
      }),
    );
  });

  it('never throws, and only ever returns null or a positive safe integer up to £1,000,000', () => {
    const anyText = fc.oneof(
      fc.string({ unit: 'binary' }),
      fc.string({ unit: 'grapheme' }),
      fc.string({ unit: fc.constantFrom('0', '1', '9', '.', ',', '+', '-', '£', '４', '．', '＋', ' ', 'e') }),
    );
    fc.assert(
      fc.property(anyText, (text) => {
        const r = parseAmount(text);
        return r === null || (Number.isSafeInteger(r) && r > 0 && r <= MAX);
      }),
    );
  });
});

describe('formatPence', () => {
  const cases: [number, string][] = [
    [4250, '£42.50'],
    [120000, '£1,200.00'],
    [-500, '−£5.00'],
    [0, '£0.00'],
    [1, '£0.01'],
    [5, '£0.05'],
    [10, '£0.10'],
    [99, '£0.99'],
    [100, '£1.00'],
    [2125, '£21.25'],
    [99999, '£999.99'],
    [100000, '£1,000.00'],
    [123456789, '£1,234,567.89'],
    [MAX, '£1,000,000.00'],
    [-1, '−£0.01'],
    [-123456, '−£1,234.56'],
  ];
  it.each(cases)('formats %i as %s', (p, expected) => {
    expect(formatPence(pence(p))).toBe(expected);
  });

  it('uses the true minus sign (U+2212), never a hyphen', () => {
    const s = formatPence(pence(-500));
    expect(s.codePointAt(0)).toBe(0x2212);
    expect(s).not.toContain('-');
  });

  it('a negative amount reads as the minus sign followed by the positive amount', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: MAX }), (p) => formatPence(pence(-p)) === `−${formatPence(pence(p))}`));
  });
});
