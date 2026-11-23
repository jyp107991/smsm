/**
 * S9a core (docs/slices/S9a.md fixes 7, 8, 15; SPEC MB-2 MB-3 SET-1 BAL-1; DATA_MODEL §3): money back that belongs to
 * a deleted original never counts; what an original still has to come back; whether an entry moves the balance at
 * all; and the settle-up limit. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/balance.ts (pure; integer pence):
 *
 *   interface LedgerEntry { kind; paid; shares; deleted; id?: string; refundOf?: string | null }   // two new, optional
 *   netPositions(members, entries, settlements)
 *     As before, except: a money_back whose `refundOf` names an entry in `entries` that is deleted is left out
 *     (MB-3: "a money back whose original is deleted never counts"). The two nets still sum to zero.
 *
 *   interface RefundRow { id: string; kind: 'expense' | 'money_back'; amount: Pence; refundOf: string | null; deleted: boolean }
 *   unrefunded(original: { id: string; amount: Pence }, entries: readonly RefundRow[], exceptId?: string): Pence
 *     MB-2: the original's amount less its live linked money back (rows with refundOf = original.id, not deleted),
 *     never below zero. `exceptId` leaves one money back out (editing that refund: its own amount is not "already back").
 *
 *   affectsBalance(entry: { paid: PenceMap; shares: PenceMap }): boolean
 *     Fix 8: false when nobody's paid − share is non-zero ("Sam paid for Sam, so this won't change the balance").
 *
 *   settleProblem(amount: Pence, state: BalanceState, from: UserId): { kind: 'moreThanOwed'; owed: Pence } | null
 *     SET-1 (fix 15): `from` paying more than `from` owes is refused, naming what is owed; up to it is fine.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { affectsBalance, balanceState, netPositions, settleProblem, unrefunded, type LedgerEntry } from './balance';
import { pence } from './money';
import type { PenceMap } from './split';

const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const map = (m: Record<string, number>): PenceMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)]));

type Row = LedgerEntry & { id: string; refundOf: string | null };
const lamp = (deleted: boolean): Row => ({ id: 'lamp', kind: 'expense', paid: map({ [JAE]: 4000 }), shares: map({ [JAE]: 2000, [SAM]: 2000 }), deleted, refundOf: null });
const back = (id: string, amount: number, over: Partial<Row> = {}): Row => ({
  id, kind: 'money_back', paid: map({ [JAE]: amount }), shares: map({ [JAE]: Math.ceil(amount / 2), [SAM]: Math.floor(amount / 2) }), deleted: false, refundOf: 'lamp', ...over,
});

describe('netPositions: money back whose original is deleted (MB-3)', () => {
  it('MB-3 BAL-1: a live original and its £10.00 back: Sam owes Jae £15.00', () => {
    expect(netPositions(PEOPLE, [lamp(false), back('b1', 1000)], [])).toEqual({ [JAE]: 1500, [SAM]: -1500 });
  });

  it('MB-3: the original deleted, its money back still live: neither counts, all square', () => {
    expect(netPositions(PEOPLE, [lamp(true), back('b1', 1000)], [])).toEqual({ [JAE]: 0, [SAM]: 0 });
  });

  it('MB-3: only money back linked to the deleted original is left out; unlinked money back still counts', () => {
    const sofa = back('b2', 600, { refundOf: null });
    expect(netPositions(PEOPLE, [lamp(true), back('b1', 1000), sofa], [])).toEqual({ [JAE]: -300, [SAM]: 300 });
  });

  it('BAL-1 MB-3: whatever is deleted, the two nets sum to zero (property)', () => {
    fc.assert(fc.property(fc.boolean(), fc.integer({ min: 1, max: 4000 }), fc.boolean(), (lampGone, amount, backGone) => {
      const nets = netPositions(PEOPLE, [lamp(lampGone), back('b1', amount, { deleted: backGone })], []);
      expect((nets[JAE] ?? 0) + (nets[SAM] ?? 0)).toBe(0);
      if (lampGone) expect(nets[JAE]).toBe(0);
    }));
  });
});

describe('unrefunded: what an original still has to come back (MB-2)', () => {
  const rows = [
    lamp(false),
    back('b1', 1000),
    back('b2', 500),
    back('b3', 2000, { deleted: true }),
    back('b4', 700, { refundOf: 'other' }),
  ].map((r) => ({ id: r.id, kind: r.kind, amount: pence(Object.values(r.paid).reduce((t, v) => t + v, 0)), refundOf: r.refundOf, deleted: r.deleted }));

  it('MB-2: £40.00 less the live £10.00 and £5.00 back is £25.00 (deleted and other originals’ money back aside)', () => {
    expect(unrefunded({ id: 'lamp', amount: pence(4000) }, rows)).toBe(2500);
  });

  it('MB-2: editing a refund leaves its own amount out', () => {
    expect(unrefunded({ id: 'lamp', amount: pence(4000) }, rows, 'b2')).toBe(3000);
  });

  it('MB-2: nothing back yet: the whole amount; never below £0.00', () => {
    expect(unrefunded({ id: 'lamp', amount: pence(4000) }, [])).toBe(4000);
    const tooMuch = [{ id: 'x', kind: 'money_back' as const, amount: pence(5000), refundOf: 'lamp', deleted: false }];
    expect(unrefunded({ id: 'lamp', amount: pence(4000) }, tooMuch)).toBe(0);
  });
});

describe('affectsBalance (fix 8)', () => {
  it('Sam paid for Sam: no change to the balance', () => {
    expect(affectsBalance({ paid: map({ [SAM]: 4000 }), shares: map({ [JAE]: 0, [SAM]: 4000 }) })).toBe(false);
  });
  it('Jae paid for Sam, or 50/50: it does', () => {
    expect(affectsBalance({ paid: map({ [JAE]: 4000 }), shares: map({ [JAE]: 0, [SAM]: 4000 }) })).toBe(true);
    expect(affectsBalance({ paid: map({ [JAE]: 4001 }), shares: map({ [JAE]: 2001, [SAM]: 2000 }) })).toBe(true);
  });
});

describe('settleProblem: the settle-up limit (SET-1, fix 15)', () => {
  const owes = (debtor: string, amount: number) => balanceState(
    debtor === SAM ? { [JAE]: pence(amount), [SAM]: pence(-amount) } : { [JAE]: pence(-amount), [SAM]: pence(amount) },
    PEOPLE,
  );

  it('SET-1: Sam owes £761.71; paying £2,000.00 is refused, naming the £761.71', () => {
    expect(settleProblem(pence(200000), owes(SAM, 76171), SAM)).toEqual({ kind: 'moreThanOwed', owed: 76171 });
  });

  it('SET-1: one penny over is refused; the whole balance or a part payment is fine', () => {
    expect(settleProblem(pence(76172), owes(SAM, 76171), SAM)).toEqual({ kind: 'moreThanOwed', owed: 76171 });
    expect(settleProblem(pence(76171), owes(SAM, 76171), SAM)).toBeNull();
    expect(settleProblem(pence(100), owes(SAM, 76171), SAM)).toBeNull();
  });

  it('SET-1: the same when Jae is the one who owes', () => {
    expect(settleProblem(pence(5001), owes(JAE, 5000), JAE)).toEqual({ kind: 'moreThanOwed', owed: 5000 });
    expect(settleProblem(pence(5000), owes(JAE, 5000), JAE)).toBeNull();
  });

  it('SET-1: never lets a settle-up turn the debt round (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1, max: 10_000_000 }), (owed, paid) => {
      const problem = settleProblem(pence(paid), owes(SAM, owed), SAM);
      expect(problem === null).toBe(paid <= owed);
    }));
  });
});
