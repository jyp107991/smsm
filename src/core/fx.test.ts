/**
 * S4b core (docs/slices/S4b.md "Interfaces → Core", "Decisions made here → Other currency"): the fixed country →
 * currency table, a foreign amount turned into pounds exactly (PLC-6, DATA_MODEL "Other currency":
 * amount_pence = round(original × rate × 100), halves up, decimal strings, never floats), foreign amounts shown
 * the en-GB way, and positions rounded to 3 decimal places, about 100 m (PLC-1). Written before the build
 * (ENGINEERING §5, tests first by someone else): vectors worked by hand plus a property against a BigInt
 * reference written here.
 *
 * Interface these tests expect, in src/core/fx.ts (pure; no I/O, no clock):
 *
 *   currencyOf(country: string): string | null
 *     ISO 3166 alpha-2 → ISO 4217 (GB → GBP, JP → JPY, FR → EUR, US → USD, KR → KRW); unknown → null.
 *   foreignToPence(originalText: string, rateText: string): Pence | null
 *     Both are plain decimal text ("1200", "12.50", "0.0047475"); rate is pounds per one unit. The product × 100,
 *     rounded once, halves up, worked in exact decimals. Anything that isn't a positive decimal number (empty,
 *     letters, negative, zero, exponent form) → null; a result that rounds to 0 pence → null (no £0.00 entry).
 *   formatForeign(amount: string | number, currency: string): string
 *     en-GB, the currency's own narrow symbol and its own decimals: "¥1,200", "€12.50", "$3.99".
 *   roundPosition(n: number): number   (here or in src/core/places.ts)
 *     to 3 decimal places (about 100 m), the nearest, for negative values too.
 *
 * Until the module exists it is loaded by a computed path (so this file type-checks and each test fails on the
 * missing module); once it exists this can become `import * as fx from './fx'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Pence } from './money';

interface FxCore {
  currencyOf(country: string): string | null;
  foreignToPence(originalText: string, rateText: string): Pence | null;
  formatForeign(amount: string | number, currency: string): string;
  roundPosition(n: number): number;
}

const load = async (path: string) => (await import(/* @vite-ignore */ path).catch(() => null)) as Partial<FxCore> | null;
const FX = './fx';
const PLACES = './places';
const fxModule = await load(FX);
const placesModule = await load(PLACES);

function core(): FxCore {
  const roundPosition = fxModule?.roundPosition ?? placesModule?.roundPosition;
  if (!fxModule?.currencyOf || !fxModule.foreignToPence || !fxModule.formatForeign || !roundPosition) {
    throw new Error('src/core/fx.ts (currencyOf, foreignToPence, formatForeign, roundPosition) does not exist yet (S4b)');
  }
  return { currencyOf: fxModule.currencyOf, foreignToPence: fxModule.foreignToPence, formatForeign: fxModule.formatForeign, roundPosition };
}

// ─────────────────────────────── currencyOf ───────────────────────────────

describe('currencyOf (PLC-6): a fixed country → currency table', () => {
  it.each([
    ['GB', 'GBP'], ['JP', 'JPY'], ['FR', 'EUR'], ['DE', 'EUR'], ['IE', 'EUR'], ['ES', 'EUR'], ['IT', 'EUR'],
    ['US', 'USD'], ['KR', 'KRW'], ['CH', 'CHF'], ['AU', 'AUD'], ['CA', 'CAD'],
  ])('PLC-6: %s → %s', (country, currency) => {
    expect(core().currencyOf(country)).toBe(currency);
  });

  it('PLC-6: an unknown or malformed country has no currency (null), so no "Paid in" is offered', () => {
    for (const country of ['XX', 'ZZ', '', 'GBR', '12']) expect(core().currencyOf(country)).toBeNull();
  });
});

// ─────────────────────────────── foreignToPence ───────────────────────────────

describe('foreignToPence (PLC-6): exact decimals, rounded once, halves up', () => {
  it.each([
    // [original, rate, pence]: worked by hand
    ['1200', '0.0047475', 570], // 5.697 pounds → 569.7p → 570
    ['12.50', '0.86', 1075], // 10.75 pounds exactly
    ['3.99', '0.79', 315], // 3.1521 → 315.21p → 315
    ['1', '0.005', 1], // 0.5p: halves up
    ['3', '0.005', 2], // 1.5p: halves up
    ['5', '0.005', 3], // 2.5p: halves up (not to even)
    ['1.005', '1', 101], // 100.5p: a float would say 100.49999…
    ['0.1', '0.2', 2], // 0.02 pounds: 0.1 × 0.2 is 0.020000000000000004 in floats
    ['15000', '0.000548', 822], // KRW: 8.22 pounds
    ['100000', '0.0047475', 47475], // 474.75 pounds exactly
    ['1', '1', 100],
    ['0.01', '1', 1],
  ])('PLC-6: %s × %s → %i pence', (original, rate, expected) => {
    expect(core().foreignToPence(original, rate)).toBe(expected);
  });

  it('PLC-6: zero-decimal currencies need no decimals; trailing zeros change nothing', () => {
    expect(core().foreignToPence('1200', '0.0047475')).toBe(570);
    expect(core().foreignToPence('1200.00', '0.00474750')).toBe(570);
    expect(core().foreignToPence('01200', '0.0047475')).toBe(570);
  });

  it('PLC-6: refuses what isn’t a positive decimal number (null)', () => {
    const bad: [string, string][] = [
      ['', '0.0047475'], ['1200', ''], ['abc', '0.0047475'], ['1200', 'abc'], ['-1200', '0.0047475'], ['1200', '-0.0047475'],
      ['0', '0.0047475'], ['1200', '0'], ['0.00', '1'], ['1e3', '0.0047475'], ['1200', '4.7e-3'], ['12.5.0', '1'], ['.', '1'],
      ['Infinity', '1'], ['NaN', '1'], ['1200', 'Infinity'],
    ];
    for (const [original, rate] of bad) expect(core().foreignToPence(original, rate), `${original} × ${rate}`).toBeNull();
  });

  it('PLC-6: a result that rounds to nothing is refused (no £0.00 entry)', () => {
    expect(core().foreignToPence('1', '0.0047475')).toBeNull(); // 0.47475p → 0 → null
    expect(core().foreignToPence('0.001', '0.0047475')).toBeNull();
  });

  it('SPL-1 PLC-6: the answer is whole pence (a safe integer), even for large amounts', () => {
    const p = core().foreignToPence('123456789.12', '1.23456789');
    expect(p).not.toBeNull();
    expect(Number.isSafeInteger(p)).toBe(true);
    expect(p).toBe(reference('123456789.12', '1.23456789'));
  });

  it('PLC-6 (property): equals an exact BigInt reference for any decimal amount and rate', () => {
    const decimal = (intMax: number, fracMax: number) =>
      fc.tuple(fc.integer({ min: 0, max: intMax }), fc.string({ unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), maxLength: fracMax }))
        .map(([whole, frac]) => (frac === '' ? String(whole) : `${String(whole)}.${frac}`));
    fc.assert(
      fc.property(decimal(10_000_000, 4), decimal(1_000, 8), (original, rate) => {
        expect(core().foreignToPence(original, rate)).toBe(reference(original, rate));
      }),
      { seed: 20261117, numRuns: 500 },
    );
  });
});

/** round(original × rate × 100), halves up, exactly; null when either is zero or the result rounds to 0. */
function reference(original: string, rate: string): number | null {
  const scaled = (s: string): [bigint, bigint] => {
    const [whole = '0', frac = ''] = s.split('.');
    return [BigInt(whole + frac), 10n ** BigInt(frac.length)];
  };
  const [a, da] = scaled(original);
  const [r, dr] = scaled(rate);
  if (a === 0n || r === 0n) return null;
  const num = a * r * 100n;
  const den = da * dr;
  const p = (2n * num + den) / (2n * den);
  return p === 0n ? null : Number(p);
}

// ─────────────────────────────── formatForeign ───────────────────────────────

describe('formatForeign (PLC-6): en-GB, the currency’s own symbol and decimals', () => {
  it.each([
    ['1200', 'JPY', '¥1,200'],
    ['12.5', 'EUR', '€12.50'],
    ['12.50', 'EUR', '€12.50'],
    ['3.99', 'USD', '$3.99'],
    ['15000', 'KRW', '₩15,000'],
    ['1234567.8', 'EUR', '€1,234,567.80'],
  ])('PLC-6: %s %s → %s', (amount, currency, shown) => {
    expect(core().formatForeign(amount, currency)).toBe(shown);
  });

  it('PLC-6: a stored numeric amount reads the same as typed text', () => {
    expect(core().formatForeign(1200, 'JPY')).toBe('¥1,200');
    expect(core().formatForeign(12.5, 'EUR')).toBe('€12.50');
  });
});

// ─────────────────────────────── roundPosition ───────────────────────────────

describe('roundPosition (PLC-1): about 100 m, 3 decimal places', () => {
  it.each([
    [35.01234, 35.012],
    [135.76803, 135.768],
    [51.50072, 51.501],
    [-0.12763, -0.128],
    [-33.86882, -33.869],
    [-0.0001, -0],
    [0, 0],
    [35.012, 35.012],
  ])('PLC-1: %d → %d', (n, rounded) => {
    expect(core().roundPosition(n)).toBeCloseTo(rounded, 10);
  });

  it('PLC-1 (property): within half a step of the input and never more than 3 decimals', () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (n) => {
        const r = core().roundPosition(n);
        expect(Math.abs(r - n)).toBeLessThanOrEqual(0.0005 + 1e-9);
        expect(Math.abs(r * 1000 - Math.round(r * 1000))).toBeLessThan(1e-6);
      }),
      { seed: 20261117, numRuns: 500 },
    );
  });
});
