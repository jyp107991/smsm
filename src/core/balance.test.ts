import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pence, type Pence } from './money';
import type { PenceMap, UserId } from './split';
import {
  netPositions,
  balanceState,
  nextOneOn,
  type BalanceState,
  type LedgerEntry,
  type LedgerSettlement,
} from './balance';
import vectorsJson from '../../tests/vectors/balance.json';

interface RawEntry {
  kind: string;
  paid: Record<string, number>;
  shares: Record<string, number>;
  deleted: boolean;
}
interface RawSettlement {
  from: string;
  to: string;
  amount: number;
  deleted: boolean;
}
interface RawState {
  kind: string;
  debtor?: string;
  creditor?: string;
  amount?: number;
}
interface BalanceVectors {
  members: [string, string];
  workedExample: {
    steps: { say: string; entry?: RawEntry; settlement?: RawSettlement; expected: Record<string, number>; state: RawState }[];
  };
  cases: {
    name: string;
    entries: RawEntry[];
    settlements: RawSettlement[];
    expected: Record<string, number>;
    state: RawState;
    nextOneOn: string | null;
  }[];
}
const V = vectorsJson as unknown as BalanceVectors;
const MEMBERS: readonly [UserId, UserId] = V.members;
const [JAE, SAM] = MEMBERS;

function toPenceMap(m: Record<string, number>): PenceMap {
  const out: Record<UserId, Pence> = {};
  for (const [k, v] of Object.entries(m)) out[k] = pence(v);
  return out;
}
function toEntry(e: RawEntry): LedgerEntry {
  if (e.kind !== 'expense' && e.kind !== 'money_back') throw new Error(`bad kind ${e.kind}`);
  return { kind: e.kind, paid: toPenceMap(e.paid), shares: toPenceMap(e.shares), deleted: e.deleted };
}
function toSettlement(s: RawSettlement): LedgerSettlement {
  return { from: s.from, to: s.to, amount: pence(s.amount), deleted: s.deleted };
}
function toState(s: RawState): BalanceState {
  if (s.kind === 'square') return { kind: 'square' };
  if (s.kind === 'owes' && s.debtor && s.creditor && s.amount !== undefined) {
    return { kind: 'owes', debtor: s.debtor, creditor: s.creditor, amount: pence(s.amount) };
  }
  throw new Error('bad state in vectors');
}

/** The DATA_MODEL §3 formula, written out independently for the property tests. */
function referenceNets(entries: readonly LedgerEntry[], settlements: readonly LedgerSettlement[]): Record<UserId, number> {
  const net: Record<UserId, number> = { [JAE]: 0, [SAM]: 0 };
  for (const p of MEMBERS) {
    let n = 0;
    for (const e of entries) {
      if (e.deleted) continue;
      const d = (e.paid[p] ?? 0) - (e.shares[p] ?? 0);
      n += e.kind === 'money_back' ? -d : d;
    }
    for (const s of settlements) {
      if (s.deleted) continue;
      if (s.from === p) n += s.amount;
      if (s.to === p) n -= s.amount;
    }
    net[p] = n;
  }
  return net;
}

// ── generators: valid rows as the database would accept them (paid and shares each sum to the amount) ──
const amountArb = fc.integer({ min: 1, max: 10_000_000 });
/** A map over the two members summing to `amount`; a zero side may be left out, as rows from the database can be. */
const mapArb = (amount: number): fc.Arbitrary<PenceMap> =>
  fc.tuple(fc.integer({ min: 0, max: amount }), fc.boolean()).map(([a, dropZeros]) => {
    const m: Record<UserId, Pence> = {};
    if (a > 0 || !dropZeros) m[JAE] = pence(a);
    if (amount - a > 0 || !dropZeros) m[SAM] = pence(amount - a);
    return m;
  });
const entryArb: fc.Arbitrary<LedgerEntry> = amountArb.chain((amount) =>
  fc.record({
    kind: fc.constantFrom<LedgerEntry['kind']>('expense', 'money_back'),
    paid: fc.oneof(
      fc.constantFrom<PenceMap>({ [JAE]: pence(amount) }, { [SAM]: pence(amount) }),
      mapArb(amount), // joint payer: paid is a map
    ),
    shares: mapArb(amount),
    deleted: fc.boolean(),
  }),
);
const settlementArb: fc.Arbitrary<LedgerSettlement> = fc.record({
  from: fc.constantFrom(JAE, SAM),
  amount: amountArb.map((a) => pence(a)),
  deleted: fc.boolean(),
}).map(({ from, amount, deleted }) => ({ from, to: from === JAE ? SAM : JAE, amount, deleted }));
const ledgerArb = fc.record({
  entries: fc.array(entryArb, { maxLength: 40 }),
  settlements: fc.array(settlementArb, { maxLength: 10 }),
});

/** +0 and −0 are the same amount of money; compare maps without caring which one an implementation produced. */
function norm(m: Readonly<Record<UserId, number>>): Record<UserId, number> {
  const out: Record<UserId, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v === 0 ? 0 : v;
  return out;
}

function swapId(u: UserId): UserId {
  return u === JAE ? SAM : u === SAM ? JAE : u;
}
function swapMap(m: PenceMap): PenceMap {
  const out: Record<UserId, Pence> = {};
  for (const [k, v] of Object.entries(m)) out[swapId(k)] = v;
  return out;
}

describe('netPositions', () => {
  describe('BAL-1 DATA_MODEL §3 worked example, step by step', () => {
    const entries: LedgerEntry[] = [];
    const settlements: LedgerSettlement[] = [];
    for (const step of V.workedExample.steps) {
      if (step.entry) entries.push(toEntry(step.entry));
      if (step.settlement) settlements.push(toSettlement(step.settlement));
      const snapshotE = [...entries];
      const snapshotS = [...settlements];
      it(`BAL-1 ${step.say}`, () => {
        const nets = netPositions(MEMBERS, snapshotE, snapshotS);
        expect(norm(nets)).toEqual(step.expected);
        expect(balanceState(nets, MEMBERS)).toEqual(toState(step.state));
      });
    }
    it('BAL-1 ends all square', () => {
      expect(balanceState(netPositions(MEMBERS, entries, settlements), MEMBERS)).toEqual({ kind: 'square' });
    });
  });

  it.each(V.cases.map((c) => [c.name, c] as const))('BAL-1 %s', (_name, c) => {
    const nets = netPositions(MEMBERS, c.entries.map(toEntry), c.settlements.map(toSettlement));
    expect(norm(nets)).toEqual(c.expected);
    const state = balanceState(nets, MEMBERS);
    expect(state).toEqual(toState(c.state));
    expect(nextOneOn(state)).toBe(c.nextOneOn);
  });

  it('BAL-1 MB-3 money back moves the balance the opposite way to an expense', () => {
    const e: LedgerEntry = { kind: 'expense', paid: { [JAE]: pence(4400) }, shares: { [JAE]: pence(2200), [SAM]: pence(2200) }, deleted: false };
    const mb: LedgerEntry = { ...e, kind: 'money_back' };
    expect(norm(netPositions(MEMBERS, [e], []))).toEqual({ [JAE]: 2200, [SAM]: -2200 });
    expect(norm(netPositions(MEMBERS, [mb], []))).toEqual({ [JAE]: -2200, [SAM]: 2200 });
  });

  it('MB-3 a money-back row with the same maps as an expense undoes it exactly', () => {
    fc.assert(
      fc.property(ledgerArb, entryArb, ({ entries, settlements }, e) => {
        const live = { ...e, kind: 'expense' as const, deleted: false };
        const back = { ...live, kind: 'money_back' as const };
        expect(norm(netPositions(MEMBERS, [...entries, live, back], settlements))).toEqual(norm(netPositions(MEMBERS, entries, settlements)));
      }),
    );
  });

  it('BAL-1 equals the formula for any ledger', () => {
    fc.assert(
      fc.property(ledgerArb, ({ entries, settlements }) => {
        expect(norm(netPositions(MEMBERS, entries, settlements))).toEqual(norm(referenceNets(entries, settlements)));
      }),
    );
  });

  it('BAL-1 the two nets always sum to zero, are whole pence, and name exactly the two members', () => {
    fc.assert(
      fc.property(ledgerArb, ({ entries, settlements }) => {
        const nets = netPositions(MEMBERS, entries, settlements);
        expect(Object.keys(nets).sort()).toEqual([JAE, SAM].sort());
        const a = nets[JAE] ?? Number.NaN;
        const b = nets[SAM] ?? Number.NaN;
        expect(Number.isSafeInteger(a) && Number.isSafeInteger(b)).toBe(true);
        expect(a + b).toBe(0);
      }),
    );
  });

  it('BAL-1 swapping the two people negates the balance', () => {
    fc.assert(
      fc.property(ledgerArb, ({ entries, settlements }) => {
        const nets = netPositions(MEMBERS, entries, settlements);
        const swappedEntries = entries.map((e) => ({ ...e, paid: swapMap(e.paid), shares: swapMap(e.shares) }));
        const swappedSettlements = settlements.map((s) => ({ ...s, from: swapId(s.from), to: swapId(s.to) }));
        const swapped = netPositions(MEMBERS, swappedEntries, swappedSettlements);
        expect(norm(swapped)).toEqual(norm({ [JAE]: -(nets[JAE] ?? Number.NaN), [SAM]: -(nets[SAM] ?? Number.NaN) }));
        const before = balanceState(nets, MEMBERS);
        const after = balanceState(swapped, MEMBERS);
        if (before.kind === 'square') expect(after).toEqual({ kind: 'square' });
        else expect(after).toEqual({ kind: 'owes', debtor: before.creditor, creditor: before.debtor, amount: before.amount });
      }),
    );
  });

  it('BAL-1 adding then soft-deleting an entry leaves the balance unchanged', () => {
    fc.assert(
      fc.property(ledgerArb, entryArb, fc.nat(), ({ entries, settlements }, e, at) => {
        const before = netPositions(MEMBERS, entries, settlements);
        const i = entries.length === 0 ? 0 : at % (entries.length + 1);
        const added = [...entries.slice(0, i), { ...e, deleted: false }, ...entries.slice(i)];
        const deleted = added.map((x, j) => (j === i ? { ...x, deleted: true } : x));
        expect(norm(netPositions(MEMBERS, deleted, settlements))).toEqual(norm(before));
      }),
    );
  });

  it('BAL-1 adding then soft-deleting a settle-up leaves the balance unchanged', () => {
    fc.assert(
      fc.property(ledgerArb, settlementArb, ({ entries, settlements }, s) => {
        const before = netPositions(MEMBERS, entries, settlements);
        expect(norm(netPositions(MEMBERS, entries, [...settlements, { ...s, deleted: true }]))).toEqual(norm(before));
      }),
    );
  });

  it('BAL-1 the order of rows does not matter', () => {
    fc.assert(
      fc.property(ledgerArb, ({ entries, settlements }) => {
        expect(norm(netPositions(MEMBERS, [...entries].reverse(), [...settlements].reverse()))).toEqual(norm(netPositions(MEMBERS, entries, settlements)));
      }),
    );
  });

  it('BAL-1 settling the full balance always makes it square', () => {
    fc.assert(
      fc.property(ledgerArb, ({ entries, settlements }) => {
        const state = balanceState(netPositions(MEMBERS, entries, settlements), MEMBERS);
        if (state.kind === 'square') return;
        const settle: LedgerSettlement = { from: state.debtor, to: state.creditor, amount: state.amount, deleted: false };
        expect(balanceState(netPositions(MEMBERS, entries, [...settlements, settle]), MEMBERS)).toEqual({ kind: 'square' });
      }),
    );
  });
});

describe('balanceState', () => {
  it('BAL-1 square when both nets are zero', () => {
    expect(balanceState({ [JAE]: pence(0), [SAM]: pence(0) }, MEMBERS)).toEqual({ kind: 'square' });
  });

  it('BAL-1 the person with the negative net owes the other that amount', () => {
    expect(balanceState({ [JAE]: pence(2200), [SAM]: pence(-2200) }, MEMBERS)).toEqual({ kind: 'owes', debtor: SAM, creditor: JAE, amount: 2200 });
    expect(balanceState({ [JAE]: pence(-1), [SAM]: pence(1) }, MEMBERS)).toEqual({ kind: 'owes', debtor: JAE, creditor: SAM, amount: 1 });
  });

  it('BAL-1 does not depend on the order the members are listed in', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (n) => {
        const nets = { [JAE]: pence(n), [SAM]: pence(-n) || pence(0) };
        expect(balanceState(nets, [SAM, JAE])).toEqual(balanceState(nets, MEMBERS));
      }),
    );
  });
});

describe('nextOneOn', () => {
  it('BAL-4 names the debtor when £10 or more is owed', () => {
    expect(nextOneOn({ kind: 'owes', debtor: SAM, creditor: JAE, amount: pence(1000) })).toBe(SAM);
    expect(nextOneOn({ kind: 'owes', debtor: JAE, creditor: SAM, amount: pence(1001) })).toBe(JAE);
    expect(nextOneOn({ kind: 'owes', debtor: SAM, creditor: JAE, amount: pence(100_000_000) })).toBe(SAM);
  });

  it('BAL-4 says nothing under £10 or when square', () => {
    expect(nextOneOn({ kind: 'owes', debtor: SAM, creditor: JAE, amount: pence(999) })).toBeNull();
    expect(nextOneOn({ kind: 'owes', debtor: SAM, creditor: JAE, amount: pence(1) })).toBeNull();
    expect(nextOneOn({ kind: 'square' })).toBeNull();
  });

  it('BAL-4 the threshold is exactly 1000 pence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom(JAE, SAM), (amount, debtor) => {
        const creditor = debtor === JAE ? SAM : JAE;
        const got = nextOneOn({ kind: 'owes', debtor, creditor, amount: pence(amount) });
        return got === (amount >= 1000 ? debtor : null);
      }),
    );
  });
});
