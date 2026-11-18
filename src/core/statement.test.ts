/**
 * S7 core (docs/slices/S7.md "Decisions made here → PDF statement", "Data → Core", "Tests → Core"; SPEC EXP-1): the
 * monthly statement's figures, built on netPositions so the end balance is the app's balance for that date. Written
 * before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/statement.ts (pure; integer pence):
 *
 *   statement(entries: readonly InsightEntry[], settlements: readonly StatementSettlement[], members: readonly [UserId, UserId],
 *             month: 'YYYY-MM') → { opening; closing; rows; paidBy; sharedBy }
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - StatementSettlement = InsightSettlement (src/core/insights.ts) & { id: string }.
 *   - opening = netPositions(members, everything live dated before the month's first day);
 *     closing = netPositions(members, everything live dated up to and including the month's last day).
 *     Both are Record<UserId, Pence> as netPositions returns.
 *   - rows: the month's live entries and settle-ups (deleted ones are not on a statement), in date order, each
 *     { id, kind: 'expense' | 'money_back' | 'settlement', date, description, amount, paid, shares } — for a settle-up,
 *     description and the two maps are the builder's to choose; only id, kind, date and amount are checked.
 *   - paidBy / sharedBy: Record<UserId, Pence>, over the month's live entries only (settle-ups are not spending):
 *     Σ expenses paid[P] − Σ money back paid[P], and the same for shares. So
 *     closing[P] − opening[P] = paidBy[P] − sharedBy[P] + settle-ups P paid − settle-ups P received (in the month),
 *     and the two people's paidBy and sharedBy totals are equal (shares sum to what was paid).
 *
 * Until src/core/statement.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { netPositions } from './balance';
import { addDays, type IsoDate } from './dates';
import type { InsightEntry, InsightSettlement } from './insights';
import { pence, type Pence } from './money';
import { ratioShares, type PenceMap, type UserId } from './split';

type StatementSettlement = InsightSettlement & { id: string };
interface StatementRow { id: string; kind: 'expense' | 'money_back' | 'settlement'; date: IsoDate; description: string; amount: Pence; paid: PenceMap; shares: PenceMap }
interface Statement {
  opening: Record<UserId, Pence>; closing: Record<UserId, Pence>; rows: StatementRow[];
  paidBy: Record<UserId, Pence>; sharedBy: Record<UserId, Pence>;
}
interface StatementCore {
  statement(entries: readonly InsightEntry[], settlements: readonly StatementSettlement[], members: readonly [UserId, UserId], month: string): Statement;
}

const STATEMENT = './statement';
const loaded = (await import(/* @vite-ignore */ STATEMENT).catch(() => null)) as Partial<StatementCore> | null;
function core(): StatementCore {
  if (typeof loaded?.statement !== 'function') throw new Error('src/core/statement.ts does not export statement yet (S7)');
  return loaded as StatementCore;
}

const JAE: UserId = '00000000-0000-4000-8000-0000000000a1';
const SAM: UserId = '00000000-0000-4000-8000-0000000000b1';
const MEMBERS = [JAE, SAM] as const;

let seq = 0;
/** Jae paying, split 50/50, unless told otherwise. */
function entry(description: string, amount: number, date: IsoDate, over: Partial<InsightEntry> & { by?: UserId } = {}): InsightEntry {
  const { by = JAE, ...rest } = over;
  seq += 1;
  return {
    id: `e${String(seq)}`, kind: 'expense', description, amount: pence(amount), paid: { [by]: pence(amount) },
    shares: ratioShares(pence(amount), { [JAE]: 50, [SAM]: 50 }, by), splitMode: 'ratio', date, categoryId: null, chapterId: null,
    country: 'GB', recurringId: null, deleted: false, ...rest,
  };
}
function settleUp(amount: number, date: IsoDate, from: UserId = SAM, deleted = false): StatementSettlement {
  seq += 1;
  return { id: `s${String(seq)}`, from, to: from === JAE ? SAM : JAE, amount: pence(amount), date, deleted };
}

/**
 * Worked by hand (October 2026):
 *   Before: Sofa delivery £50.00 (Jae, 20 Sep, 50/50) → opening: Jae is owed £25.00.
 *   October: Rent £1,000.00 (Jae) +500.00; Weekly shop £240.50 (Sam) −120.25; Sam pays Jae £100.00 −100.00;
 *            Dishoom £125.00 (Sam) −62.50; Refund £20.00 to Jae (money back, 50/50) −10.00; Pizza £30.00 (Jae, deleted).
 *   After:   Lamp £40.00 (Jae, 3 Nov) and a settle-up on 1 Nov — not in October.
 *   Closing: 25.00 + 500.00 − 120.25 − 100.00 − 62.50 − 10.00 = £232.25 owed to Jae.
 *   Paid by:  Jae 1,000.00 − 20.00 = £980.00; Sam 240.50 + 125.00 = £365.50   (total £1,345.50)
 *   Shared by: Jae 500.00 + 120.25 + 62.50 − 10.00 = £672.75; Sam the same £672.75 (total £1,345.50)
 */
const ENTRIES: InsightEntry[] = [
  entry('Sofa delivery', 5000, '2026-09-20'),
  entry('Rent', 100000, '2026-10-01'),
  entry('Weekly shop', 24050, '2026-10-10', { by: SAM }),
  entry('Dishoom', 12500, '2026-10-12', { by: SAM }),
  entry('Refund', 2000, '2026-10-25', { kind: 'money_back' }),
  entry('Pizza', 3000, '2026-10-15', { deleted: true }),
  entry('Lamp', 4000, '2026-11-03'),
];
const SETTLEMENTS: StatementSettlement[] = [settleUp(10000, '2026-10-20'), settleUp(999, '2026-10-22', SAM, true), settleUp(5000, '2026-11-01')];

describe('statement for a month (EXP-1)', () => {
  it('EXP-1: the balance at the start is everything before the month', () => {
    const s = core().statement(ENTRIES, SETTLEMENTS, MEMBERS, '2026-10');
    expect(s.opening).toEqual({ [JAE]: 2500, [SAM]: -2500 });
  });

  it('EXP-1: the balance at the end is everything up to the month’s last day (the app’s balance on that date)', () => {
    const s = core().statement(ENTRIES, SETTLEMENTS, MEMBERS, '2026-10');
    expect(s.closing).toEqual({ [JAE]: 23225, [SAM]: -23225 });
    const upToEnd = netPositions(MEMBERS, ENTRIES.filter((e) => e.date <= '2026-10-31'), SETTLEMENTS.filter((x) => x.date <= '2026-10-31'));
    expect(s.closing).toEqual(upToEnd);
  });

  it('EXP-1: every live entry and settle-up of the month, in date order; deleted ones and other months are not rows', () => {
    const s = core().statement(ENTRIES, SETTLEMENTS, MEMBERS, '2026-10');
    const ids = (d: string) => ENTRIES.find((e) => e.description === d)?.id;
    expect(s.rows.map((r) => r.id).sort()).toEqual([ids('Rent'), ids('Weekly shop'), ids('Dishoom'), ids('Refund'), SETTLEMENTS[0]?.id].sort());
    const dates = s.rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    expect(s.rows.find((r) => r.id === SETTLEMENTS[0]?.id)).toMatchObject({ kind: 'settlement', amount: 10000, date: '2026-10-20' });
    expect(s.rows.find((r) => r.id === ids('Refund'))).toMatchObject({ kind: 'money_back', amount: 2000, description: 'Refund' });
    expect(s.rows.find((r) => r.id === ids('Rent'))).toMatchObject({ kind: 'expense', amount: 100000, description: 'Rent', paid: { [JAE]: 100000 }, shares: { [JAE]: 50000, [SAM]: 50000 } });
  });

  it('EXP-1: totals paid and shared by each person', () => {
    const s = core().statement(ENTRIES, SETTLEMENTS, MEMBERS, '2026-10');
    expect(s.paidBy).toEqual({ [JAE]: 98000, [SAM]: 36550 });
    expect(s.sharedBy).toEqual({ [JAE]: 67275, [SAM]: 67275 });
  });

  it('EXP-1: a month with nothing in it: opening equals closing, no rows, nothing paid', () => {
    const s = core().statement(ENTRIES, SETTLEMENTS, MEMBERS, '2026-08');
    expect(s.rows).toEqual([]);
    expect(s.opening).toEqual(s.closing);
    expect(s.opening).toEqual({ [JAE]: 0, [SAM]: 0 });
    expect(s.paidBy).toEqual({ [JAE]: 0, [SAM]: 0 });
    expect(s.sharedBy).toEqual({ [JAE]: 0, [SAM]: 0 });
  });

  it('EXP-1: the last day of a month counts in it, the first day of the next does not (also over the turn of the year and a leap February)', () => {
    const edge = [entry('NYE', 1000, '2027-12-31'), entry('New year', 3000, '2028-01-01'), entry('Leap day', 500, '2028-02-29')];
    const dec = core().statement(edge, [], MEMBERS, '2027-12');
    expect(dec.rows.map((r) => r.description)).toEqual(['NYE']);
    expect(dec.closing[JAE]).toBe(500);
    const feb = core().statement(edge, [], MEMBERS, '2028-02');
    expect(feb.opening[JAE]).toBe(2000);
    expect(feb.closing[JAE]).toBe(2250);
  });
});

// ─────────────────────────────── properties ───────────────────────────────

const entryArb = fc.record({
  amount: fc.integer({ min: 1, max: 500_000 }),
  pct: fc.integer({ min: 0, max: 100 }),
  byJae: fc.boolean(),
  moneyBack: fc.boolean(),
  deleted: fc.boolean(),
  day: fc.integer({ min: 0, max: 730 }),
}).map((r): InsightEntry => {
  const by = r.byJae ? JAE : SAM;
  return entry('Thing', r.amount, addDays('2026-01-01', r.day), {
    by, kind: r.moneyBack ? 'money_back' : 'expense', deleted: r.deleted,
    shares: ratioShares(pence(r.amount), { [JAE]: r.pct, [SAM]: 100 - r.pct }, by),
  });
});
const settlementArb = fc.record({
  amount: fc.integer({ min: 1, max: 500_000 }), samPays: fc.boolean(), deleted: fc.boolean(), day: fc.integer({ min: 0, max: 730 }),
}).map((r) => settleUp(r.amount, addDays('2026-01-01', r.day), r.samPays ? SAM : JAE, r.deleted));
const monthArb = fc.integer({ min: 0, max: 23 }).map((i) => `${String(2026 + Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, '0')}`);
const ledgerArb = fc.record({ entries: fc.array(entryArb, { maxLength: 40 }), settlements: fc.array(settlementArb, { maxLength: 10 }), month: monthArb });

function monthEnd(month: string): IsoDate {
  return addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
}

describe('statement properties (EXP-1)', () => {
  it('EXP-1: closing equals netPositions up to the month end; opening equals netPositions before the month', () => {
    fc.assert(fc.property(ledgerArb, ({ entries, settlements, month }) => {
      const s = core().statement(entries, settlements, MEMBERS, month);
      const end = monthEnd(month);
      const start = `${month}-01`;
      expect(s.closing).toEqual(netPositions(MEMBERS, entries.filter((e) => e.date <= end), settlements.filter((x) => x.date <= end)));
      expect(s.opening).toEqual(netPositions(MEMBERS, entries.filter((e) => e.date < start), settlements.filter((x) => x.date < start)));
    }), { numRuns: 200 });
  });

  it('EXP-1: opening plus the month equals closing; paid and shared totals agree (shares sum); the rows are the month’s live ones', () => {
    fc.assert(fc.property(ledgerArb, ({ entries, settlements, month }) => {
      const s = core().statement(entries, settlements, MEMBERS, month);
      const inMonth = (d: IsoDate) => d.slice(0, 7) === month;
      for (const p of MEMBERS) {
        let flows = 0;
        for (const x of settlements) {
          if (x.deleted || !inMonth(x.date)) continue;
          if (x.from === p) flows += x.amount;
          if (x.to === p) flows -= x.amount;
        }
        expect(s.closing[p]).toBe((s.opening[p] ?? 0) + (s.paidBy[p] ?? 0) - (s.sharedBy[p] ?? 0) + flows);
      }
      expect((s.paidBy[JAE] ?? 0) + (s.paidBy[SAM] ?? 0)).toBe((s.sharedBy[JAE] ?? 0) + (s.sharedBy[SAM] ?? 0));
      const live = [...entries.filter((e) => !e.deleted && inMonth(e.date)).map((e) => e.id), ...settlements.filter((x) => !x.deleted && inMonth(x.date)).map((x) => x.id)];
      expect(s.rows.map((r) => r.id).sort()).toEqual(live.sort());
      for (const r of s.rows) {
        if (r.kind === 'settlement') continue;
        expect((r.shares[JAE] ?? 0) + (r.shares[SAM] ?? 0)).toBe(r.amount);
        expect((r.paid[JAE] ?? 0) + (r.paid[SAM] ?? 0)).toBe(r.amount);
      }
    }), { numRuns: 200 });
  });
});
