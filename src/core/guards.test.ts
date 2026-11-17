// Guards on impossible input in the money core: refused loudly rather than turned into a wrong figure.
// Written after mutation testing showed these refusals were untested (ENGINEERING §4.3).
import { describe, expect, it } from 'vitest';
import { pence } from './money';
import { computeEntry, ratioShares, validateEntry } from './split';

const A = 'a';
const B = 'b';

describe('SPL-5 the core refuses impossible splits', () => {
  it('a ratio with no people, a zero total or a negative part', () => {
    expect(() => ratioShares(pence(100), {}, A)).toThrow(RangeError);
    expect(() => ratioShares(pence(100), { [A]: 0, [B]: 0 }, A)).toThrow(RangeError);
    expect(() => ratioShares(pence(100), { [A]: 120, [B]: -20 }, A)).toThrow(RangeError);
  });
  it('a payer who is not one of the two people', () => {
    expect(() => computeEntry({ amount: pence(100), payer: 'c', members: [A, B], split: { mode: 'treat' } })).toThrow(RangeError);
  });
  it('an amount of zero or less, or not whole pence', () => {
    const base = { mode: 'ratio' as const, members: [A, B] as const };
    expect(validateEntry({ ...base, amount: pence(0), paid: {}, shares: {} })).not.toEqual([]);
    expect(validateEntry({ ...base, amount: 1.5 as never, paid: { [A]: 1.5 as never }, shares: { [A]: 1.5 as never } })).not.toEqual([]);
    expect(validateEntry({ ...base, amount: pence(100), paid: { [A]: 99.5 as never, [B]: 0.5 as never }, shares: { [A]: pence(50), [B]: pence(50) } })).not.toEqual([]);
  });
  it('a whole-pence entry that sums correctly is accepted', () => {
    expect(validateEntry({ mode: 'ratio', members: [A, B], amount: pence(100), paid: { [A]: pence(100) }, shares: { [A]: pence(50), [B]: pence(50) } })).toEqual([]);
  });
  it('a paid-for-the-other entry with two payers is refused', () => {
    expect(validateEntry({ mode: 'for_other', members: [A, B], amount: pence(100), paid: { [A]: pence(50), [B]: pence(50) }, shares: { [A]: pence(0), [B]: pence(100) } })).not.toEqual([]);
  });
});
