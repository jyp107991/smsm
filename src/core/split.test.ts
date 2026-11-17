import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pence, type Pence } from './money';
import {
  ratioShares,
  computeEntry,
  validateEntry,
  resolveDefaultSplit,
  type PenceMap,
  type SplitMode,
  type SplitParams,
  type UserId,
} from './split';
import vectorsJson from '../../tests/vectors/split.json';

interface SplitVectors {
  members: [string, string];
  ratioShares: { name: string; amount: number; ratio: Record<string, number>; payer: string; expected: Record<string, number> }[];
  computeEntry: {
    name: string;
    amount: number;
    payer: string;
    split: { mode: string; ratio?: Record<string, number>; amounts?: Record<string, number> };
    expected: { paid: Record<string, number>; shares: Record<string, number> };
  }[];
  validateEntry: {
    name: string;
    amount: number;
    mode: string;
    paid: Record<string, number>;
    shares: Record<string, number>;
    valid: boolean;
  }[];
}
const V = vectorsJson as unknown as SplitVectors;
const MEMBERS: readonly [UserId, UserId] = V.members;
const [JAE, SAM] = MEMBERS;
const MAX = 100_000_000;

function toPenceMap(m: Record<string, number>): PenceMap {
  const out: Record<UserId, Pence> = {};
  for (const [k, v] of Object.entries(m)) out[k] = pence(v);
  return out;
}

function toMode(s: string): SplitMode {
  if (s === 'ratio' || s === 'exact' || s === 'for_other' || s === 'treat') return s;
  throw new Error(`bad mode in vectors: ${s}`);
}

function toSplit(s: SplitVectors['computeEntry'][number]['split']): SplitParams {
  switch (toMode(s.mode)) {
    case 'ratio':
      if (!s.ratio) throw new Error('ratio vector without ratio');
      return { mode: 'ratio', ratio: s.ratio };
    case 'exact':
      if (!s.amounts) throw new Error('exact vector without amounts');
      return { mode: 'exact', amounts: toPenceMap(s.amounts) };
    case 'for_other':
      return { mode: 'for_other' };
    case 'treat':
      return { mode: 'treat' };
  }
}

/** DATA_MODEL §3 written independently: floor each, then the leftover penny by largest fraction, ties to the payer. */
function referenceShares(amount: number, pctA: number, a: UserId, b: UserId, payer: UserId): Record<UserId, number> {
  const rawA = amount * pctA; // hundredths of a penny, exact integers
  const rawB = amount * (100 - pctA);
  const out: Record<UserId, number> = { [a]: Math.floor(rawA / 100), [b]: Math.floor(rawB / 100) };
  let left = amount - (out[a] ?? 0) - (out[b] ?? 0);
  const fracA = rawA % 100;
  const fracB = rawB % 100;
  const order = fracA > fracB ? [a, b] : fracB > fracA ? [b, a] : payer === a ? [a, b] : [b, a];
  for (const who of order) {
    if (left === 0) break;
    out[who] = (out[who] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

const sum = (m: Readonly<Record<string, number>>): number => Object.values(m).reduce((x, y) => x + y, 0);

const amountArb = fc.integer({ min: 1, max: MAX });
const pctArb = fc.integer({ min: 0, max: 100 });
const payerArb = fc.constantFrom(JAE, SAM);
const splitArb = (amount: number): fc.Arbitrary<SplitParams> =>
  fc.oneof(
    pctArb.map((p): SplitParams => ({ mode: 'ratio', ratio: { [JAE]: p, [SAM]: 100 - p } })),
    fc.integer({ min: 0, max: amount }).map((x): SplitParams => ({ mode: 'exact', amounts: { [JAE]: pence(x), [SAM]: pence(amount - x) } })),
    fc.constant<SplitParams>({ mode: 'for_other' }),
    fc.constant<SplitParams>({ mode: 'treat' }),
  );
const entryInputArb = amountArb.chain((amount) =>
  fc.record({ amount: fc.constant(pence(amount)), payer: payerArb, split: splitArb(amount) }),
);

describe('ratioShares', () => {
  it.each(V.ratioShares.map((v) => [v.name, v] as const))('SPL-3 %s', (_name, v) => {
    expect(ratioShares(pence(v.amount), v.ratio, v.payer)).toEqual(v.expected);
  });

  it('SPL-3 spec example: £42.51 at 50/50 paid by Jae → Jae 2126, Sam 2125', () => {
    expect(ratioShares(pence(4251), { [JAE]: 50, [SAM]: 50 }, JAE)).toEqual({ [JAE]: 2126, [SAM]: 2125 });
  });

  it('SPL-3 leftover pennies go to the payer when the fractions tie', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX / 2 - 1 }), payerArb, (half, payer) => {
        const amount = 2 * half + 1; // odd, so 50/50 always leaves one penny
        const shares = ratioShares(pence(amount), { [JAE]: 50, [SAM]: 50 }, payer);
        const other = payer === JAE ? SAM : JAE;
        return shares[payer] === half + 1 && shares[other] === half;
      }),
    );
  });

  it('SPL-3 SPL-5 matches the largest-remainder rule for any amount, ratio and payer', () => {
    fc.assert(
      fc.property(amountArb, pctArb, payerArb, (amount, p, payer) => {
        const got = ratioShares(pence(amount), { [JAE]: p, [SAM]: 100 - p }, payer);
        expect(got).toEqual(referenceShares(amount, p, JAE, SAM, payer));
      }),
    );
  });

  it('SPL-5 shares sum to the amount, are whole pence, never negative, and within a penny of exact', () => {
    fc.assert(
      fc.property(amountArb, pctArb, payerArb, (amount, p, payer) => {
        const got = ratioShares(pence(amount), { [JAE]: p, [SAM]: 100 - p }, payer);
        expect(Object.keys(got).sort()).toEqual([JAE, SAM].sort());
        expect(sum(got)).toBe(amount);
        for (const [who, pct] of [[JAE, p], [SAM, 100 - p]] as const) {
          const share = got[who] ?? Number.NaN;
          expect(Number.isSafeInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
          expect(Math.abs(share * 100 - amount * pct)).toBeLessThan(100);
        }
      }),
    );
  });

  it('SPL-3 swapping the two people mirrors the result', () => {
    fc.assert(
      fc.property(amountArb, pctArb, payerArb, (amount, p, payer) => {
        const a = ratioShares(pence(amount), { [JAE]: p, [SAM]: 100 - p }, payer);
        const swappedPayer = payer === JAE ? SAM : JAE;
        const b = ratioShares(pence(amount), { [SAM]: p, [JAE]: 100 - p }, swappedPayer);
        return a[JAE] === b[SAM] && a[SAM] === b[JAE];
      }),
    );
  });

  it('SPL-3 does not depend on the order of keys in the ratio', () => {
    fc.assert(
      fc.property(amountArb, pctArb, payerArb, (amount, p, payer) => {
        const a = ratioShares(pence(amount), { [JAE]: p, [SAM]: 100 - p }, payer);
        const b = ratioShares(pence(amount), { [SAM]: 100 - p, [JAE]: p }, payer);
        return a[JAE] === b[JAE] && a[SAM] === b[SAM];
      }),
    );
  });
});

describe('computeEntry', () => {
  it.each(V.computeEntry.map((v) => [v.name, v] as const))('SPL-1 %s', (_name, v) => {
    const got = computeEntry({ amount: pence(v.amount), payer: v.payer, members: MEMBERS, split: toSplit(v.split) });
    expect(got).toEqual(v.expected);
  });

  it('SPL-1 ratio: the payer paid it all; shares follow the ratio with the payer taking a tied penny', () => {
    const got = computeEntry({ amount: pence(4251), payer: SAM, members: MEMBERS, split: { mode: 'ratio', ratio: { [JAE]: 50, [SAM]: 50 } } });
    expect(got).toEqual({ paid: { [JAE]: 0, [SAM]: 4251 }, shares: { [JAE]: 2125, [SAM]: 2126 } });
  });

  it('SPL-1 for_other: the payer owes nothing and the other owes all of it', () => {
    fc.assert(
      fc.property(amountArb, payerArb, (amount, payer) => {
        const other = payer === JAE ? SAM : JAE;
        const got = computeEntry({ amount: pence(amount), payer, members: MEMBERS, split: { mode: 'for_other' } });
        return got.shares[payer] === 0 && got.shares[other] === amount && got.paid[payer] === amount && got.paid[other] === 0;
      }),
    );
  });

  it('SPL-1 treat: shares equal paid, so nobody owes', () => {
    fc.assert(
      fc.property(amountArb, payerArb, (amount, payer) => {
        const got = computeEntry({ amount: pence(amount), payer, members: MEMBERS, split: { mode: 'treat' } });
        expect(got.shares).toEqual(got.paid);
        expect(got.paid[payer]).toBe(amount);
      }),
    );
  });

  it('SPL-5 paid and shares always sum to the amount, are never negative, and name both members only', () => {
    fc.assert(
      fc.property(entryInputArb, ({ amount, payer, split }) => {
        const { paid, shares } = computeEntry({ amount, payer, members: MEMBERS, split });
        for (const m of [paid, shares]) {
          expect(Object.keys(m).sort()).toEqual([JAE, SAM].sort());
          expect(sum(m)).toBe(amount);
          for (const v of Object.values(m)) {
            expect(Number.isSafeInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
        }
        expect(paid[payer]).toBe(amount);
      }),
    );
  });

  it('SPL-5 everything computeEntry produces passes validateEntry', () => {
    fc.assert(
      fc.property(entryInputArb, ({ amount, payer, split }) => {
        const { paid, shares } = computeEntry({ amount, payer, members: MEMBERS, split });
        expect(validateEntry({ amount, paid, shares, mode: split.mode, members: MEMBERS })).toEqual([]);
      }),
    );
  });
});

describe('validateEntry', () => {
  it.each(V.validateEntry.map((v) => [v.name, v] as const))('SPL-5 mirrors check_money: %s', (_name, v) => {
    const errors = validateEntry({
      amount: pence(v.amount),
      paid: toPenceMap(v.paid),
      shares: toPenceMap(v.shares),
      mode: toMode(v.mode),
      members: MEMBERS,
    });
    expect(Array.isArray(errors)).toBe(true);
    if (v.valid) expect(errors).toEqual([]);
    else {
      expect(errors.length).toBeGreaterThan(0);
      for (const e of errors) {
        expect(typeof e).toBe('string');
        expect(e.trim().length).toBeGreaterThan(0); // a reason a person or a log can read
      }
    }
  });

  it('SPL-5 moving one penny anywhere breaks a valid entry', () => {
    fc.assert(
      fc.property(
        entryInputArb,
        fc.constantFrom('paid', 'shares'),
        payerArb,
        fc.constantFrom(1, -1),
        ({ amount, payer, split }, which, who, delta) => {
          const e = computeEntry({ amount, payer, members: MEMBERS, split });
          const broken = { ...e[which], [who]: pence((e[which][who] ?? 0) + delta) };
          const entry = { amount, paid: e.paid, shares: e.shares, mode: split.mode, members: MEMBERS, [which]: broken };
          expect(validateEntry(entry).length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('SPL-5 the amount must match: an entry is invalid against any other amount', () => {
    fc.assert(
      fc.property(entryInputArb, fc.integer({ min: 1, max: 1000 }), ({ amount, payer, split }, d) => {
        const e = computeEntry({ amount, payer, members: MEMBERS, split });
        expect(validateEntry({ amount: pence(amount + d), paid: e.paid, shares: e.shares, mode: split.mode, members: MEMBERS }).length).toBeGreaterThan(0);
      }),
    );
  });
});

describe('resolveDefaultSplit', () => {
  const cat6040 = { [JAE]: 60, [SAM]: 40 };
  const home7030 = { [JAE]: 70, [SAM]: 30 };

  it('SPL-2 the description\'s usual split comes first', () => {
    const remembered: SplitParams = { mode: 'treat' };
    expect(resolveDefaultSplit({ remembered, categoryDefault: cat6040, householdDefault: home7030, members: MEMBERS })).toEqual(remembered);
    const exact: SplitParams = { mode: 'exact', amounts: { [JAE]: pence(100), [SAM]: pence(200) } };
    expect(resolveDefaultSplit({ remembered: exact, categoryDefault: null, householdDefault: null, members: MEMBERS })).toEqual(exact);
  });

  it('SPL-2 then the category default', () => {
    for (const remembered of [null, undefined]) {
      expect(resolveDefaultSplit({ remembered, categoryDefault: cat6040, householdDefault: home7030, members: MEMBERS })).toEqual({
        mode: 'ratio',
        ratio: cat6040,
      });
    }
  });

  it('SPL-2 then the household default', () => {
    expect(resolveDefaultSplit({ remembered: null, categoryDefault: null, householdDefault: home7030, members: MEMBERS })).toEqual({
      mode: 'ratio',
      ratio: home7030,
    });
    expect(resolveDefaultSplit({ householdDefault: home7030, members: MEMBERS })).toEqual({ mode: 'ratio', ratio: home7030 });
  });

  it('SPL-2 with nothing set, 50/50 between the two members', () => {
    expect(resolveDefaultSplit({ members: MEMBERS })).toEqual({ mode: 'ratio', ratio: { [JAE]: 50, [SAM]: 50 } });
    expect(resolveDefaultSplit({ remembered: null, categoryDefault: null, householdDefault: null, members: ['x', 'y'] })).toEqual({
      mode: 'ratio',
      ratio: { x: 50, y: 50 },
    });
  });
});

describe('ratioShares with large weights (S2 polish Q-F5: money back weighted by an exact split\'s pence)', () => {
  /** The same rule in exact integers: floor, then the leftover pennies by largest remainder, ties to the payer, then id. */
  function reference(amount: number, weights: Record<string, number>, payer: string): Record<string, number> {
    const ids = Object.keys(weights).sort();
    const total = ids.reduce((t, id) => t + BigInt(weights[id] ?? 0), 0n);
    const rows = ids.map((id) => {
      const num = BigInt(amount) * BigInt(weights[id] ?? 0);
      return { id, floor: num / total, rem: num % total };
    });
    let left = BigInt(amount) - rows.reduce((t, r) => t + r.floor, 0n);
    const order = [...rows].sort((a, b) => (a.rem !== b.rem ? (b.rem > a.rem ? 1 : -1) : a.id === payer ? -1 : b.id === payer ? 1 : a.id < b.id ? -1 : 1));
    const out: Record<string, number> = {};
    for (const r of rows) out[r.id] = Number(r.floor);
    for (const r of order) {
      if (left === 0n) break;
      out[r.id] = (out[r.id] ?? 0) + 1;
      left -= 1n;
    }
    return out;
  }

  it('SPL-3 MB-1: weights up to £1,000,000 in pence give exactly the integer rule (amount × weight beyond 2^53)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.constantFrom('a', 'b'),
        (amount, a, b, payer) => {
          expect(ratioShares(pence(amount), { a, b }, payer)).toEqual(reference(amount, { a, b }, payer));
        },
      ),
      { numRuns: 2000 },
    );
  });
});
