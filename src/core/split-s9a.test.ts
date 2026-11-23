/**
 * S9a core (docs/slices/S9a.md fix 8; SPEC SPL-1 BAL-1): changing who paid never changes the split silently. On an
 * entry "For Sam", changing the payer keeps each person's share as it was. Written before the build (ENGINEERING §5,
 * tests first by someone else).
 *
 * Interface these tests expect, in src/core/split.ts (pure):
 *
 *   splitForNewPayer(input: { amount: Pence; split: SplitParams; from: UserId; to: UserId; members: readonly [UserId, UserId] }): SplitParams
 *     The split to save once the payer changes from `from` to `to`, such that computeEntry with the new payer gives
 *     the same shares as computeEntry with the old one did, for "for_other", "treat" and "exact" (which mode it
 *     returns is the builder's: "treat" and "exact" both keep "Sam paid for Sam" as Sam's own). A ratio stays the
 *     same ratio (the same percentages; SPL-3 may move a leftover penny to the new payer). from === to: unchanged.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { affectsBalance } from './balance';
import { pence, type Pence } from './money';
import { computeEntry, splitForNewPayer, type SplitParams } from './split';

const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;

function sharesWith(amount: Pence, payer: string, split: SplitParams) {
  return computeEntry({ amount, payer, members: PEOPLE, split }).shares;
}
function moved(amount: Pence, split: SplitParams, from: string, to: string) {
  const next = splitForNewPayer({ amount, split, from, to, members: PEOPLE });
  return { next, before: sharesWith(amount, from, split), after: sharesWith(amount, to, next) };
}

describe('splitForNewPayer (fix 8)', () => {
  it('"For Sam" paid by Jae, then Sam is chosen as payer: still all Sam’s (not "For Jae"), so the balance doesn’t move', () => {
    const { before, after } = moved(pence(4000), { mode: 'for_other' }, JAE, SAM);
    expect(before).toEqual({ [JAE]: 0, [SAM]: 4000 });
    expect(after).toEqual({ [JAE]: 0, [SAM]: 4000 });
    expect(affectsBalance({ paid: { [SAM]: pence(4000), [JAE]: pence(0) }, shares: after })).toBe(false);
  });

  it('"For Jae" paid by Sam, then Jae pays: still all Jae’s', () => {
    const { after } = moved(pence(1250), { mode: 'for_other' }, SAM, JAE);
    expect(after).toEqual({ [JAE]: 1250, [SAM]: 0 });
  });

  it('Jae’s treat, then Sam pays: still all Jae’s share (Sam paid for Jae)', () => {
    const { after } = moved(pence(6000), { mode: 'treat' }, JAE, SAM);
    expect(after).toEqual({ [JAE]: 6000, [SAM]: 0 });
  });

  it('exact amounts stay as they were', () => {
    const split: SplitParams = { mode: 'exact', amounts: { [JAE]: pence(300), [SAM]: pence(700) } };
    const { after } = moved(pence(1000), split, JAE, SAM);
    expect(after).toEqual({ [JAE]: 300, [SAM]: 700 });
  });

  it('a ratio stays the same ratio', () => {
    const split: SplitParams = { mode: 'ratio', ratio: { [JAE]: 60, [SAM]: 40 } };
    const { next } = moved(pence(4000), split, JAE, SAM);
    expect(next.mode).toBe('ratio');
    if (next.mode === 'ratio') expect({ jae: next.ratio[JAE], sam: next.ratio[SAM] }).toEqual({ jae: 60, sam: 40 });
  });

  it('the same payer again changes nothing', () => {
    const split: SplitParams = { mode: 'for_other' };
    expect(splitForNewPayer({ amount: pence(4000), split, from: JAE, to: JAE, members: PEOPLE })).toEqual(split);
  });

  it('SPL-1 BAL-1: for any amount, "for_other", "treat" and "exact" keep every share through a payer change (property)', () => {
    const splitArb = fc.integer({ min: 1, max: 10_000_000 }).chain((amount) =>
      fc.tuple(
        fc.constant(amount),
        fc.oneof(
          fc.constant<SplitParams>({ mode: 'for_other' }),
          fc.constant<SplitParams>({ mode: 'treat' }),
          fc.integer({ min: 0, max: amount }).map((j): SplitParams => ({ mode: 'exact', amounts: { [JAE]: pence(j), [SAM]: pence(amount - j) } })),
        ),
        fc.boolean(),
      ));
    fc.assert(fc.property(splitArb, ([amount, split, jaeFirst]) => {
      const [from, to] = jaeFirst ? [JAE, SAM] : [SAM, JAE];
      const { before, after } = moved(pence(amount), split, from, to);
      expect(after).toEqual(before);
    }));
  });
});
