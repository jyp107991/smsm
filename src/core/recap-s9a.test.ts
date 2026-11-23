/**
 * S9a core (docs/slices/S9a.md fixes 1 and 6; SPEC INS-2 BAL-1 CHP-5): a recap's "Between you" balance is the month's
 * end, from the one balance function; the headline's total and its "more/less than usual" are worked out on the same
 * entries. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * What these tests expect of src/core/recap.ts recapOf (signature unchanged):
 *   balance   For a finished month M: the balance from every live entry and settle-up dated on or before M's last day
 *             (deleted rows excluded, as live); the same figure as the month's statement closing balance
 *             (core/statement, netPositions). For the current month's recap (so far): today's, i.e. up to today.
 *   headline  The total it names is the one its comparison is about: the month's everyday spending (CHP-5: usual is
 *             everyday); chapters are not folded into it (they stay a separate line on the screen).
 */
import { describe, expect, it } from 'vitest';
import { balanceState } from './balance';
import type { IsoDate } from './dates';
import type { InsightEntry, InsightSettlement } from './insights';
import { formatPence, pence } from './money';
import { recapOf } from './recap';
import { statement } from './statement';
import type { PenceMap } from './split';

const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const OPTS = { today: '2026-11-14', names: { [JAE]: 'Jae', [SAM]: 'Sam' }, categories: [{ id: 'c-groceries', name: 'Groceries' }, { id: 'c-travel', name: 'Travel' }] };
const map = (m: Record<string, number>): PenceMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)]));

let seq = 0;
function e(amount: number, date: IsoDate, over: Partial<InsightEntry> = {}): InsightEntry {
  seq += 1;
  const half = Math.floor(amount / 2);
  return {
    id: `r${String(seq)}`, kind: 'expense', description: 'Shop', amount: pence(amount), paid: map({ [JAE]: amount }),
    shares: map({ [JAE]: amount - half, [SAM]: half }), splitMode: 'ratio', date, categoryId: 'c-groceries', chapterId: null, country: 'GB',
    recurringId: null, deleted: false, ...over,
  };
}
const settle = (from: string, to: string, amount: number, date: IsoDate, deleted = false): InsightSettlement & { id: string } => ({
  id: `s${date}${from}`, from, to, amount: pence(amount), date, deleted,
});

/**
 * October: Jae pays £100.00 (Sam owes £50.00); Sam pays Jae £10.00 on 20 Oct (Sam owes £40.00 at the month's end); a
 * deleted £500.00 entry. November: Jae pays £40.00 (+£20.00) and Sam pays Jae £5.00 (today Sam owes £55.00).
 */
const entries = [
  e(10000, '2026-10-05'),
  e(50000, '2026-10-12', { deleted: true }),
  e(4000, '2026-11-03'),
];
const settlements = [settle(SAM, JAE, 1000, '2026-10-20'), settle(SAM, JAE, 700, '2026-10-21', true), settle(SAM, JAE, 500, '2026-11-05')];

describe('recapOf: "Between you" is the month’s end (fix 1, INS-2)', () => {
  it('INS-2: October’s recap says Sam owed Jae £40.00 at the end of October, not today’s £55.00', () => {
    expect(recapOf(entries, settlements, PEOPLE, '2026-10', OPTS).balance).toEqual({ debtor: SAM, creditor: JAE, amount: 4000 });
  });

  it('INS-2 BAL-1: it is the same figure as October’s statement closing balance (one balance function)', () => {
    const closing = statement(entries, settlements, PEOPLE, '2026-10').closing;
    const state = balanceState(closing, PEOPLE);
    const r = recapOf(entries, settlements, PEOPLE, '2026-10', OPTS);
    expect(state.kind === 'owes' ? { debtor: state.debtor, creditor: state.creditor, amount: state.amount } : null).toEqual(r.balance);
  });

  it('INS-2: a month that ended square is square, whatever happened since', () => {
    const square = [e(2000, '2026-09-04'), e(9000, '2026-11-02')];
    const r = recapOf(square, [settle(SAM, JAE, 1000, '2026-09-30')], PEOPLE, '2026-09', OPTS);
    expect(r.balance).toBeNull();
  });

  it('INS-2: the current month’s recap (from settle day) uses today', () => {
    const r = recapOf(entries, settlements, PEOPLE, '2026-11', OPTS);
    expect(r.soFar).toBe(true);
    expect(r.balance).toEqual({ debtor: SAM, creditor: JAE, amount: 5500 });
  });
});

describe('recapOf: the headline on one basis (fix 6, INS-2, CHP-5)', () => {
  /** June: the first entry. July to September: £120.00 everyday each (usual £120.00). October: £100.00 everyday and a £300.00 weekend away (a chapter). */
  const history = [
    e(500, '2026-06-15'),
    e(12000, '2026-07-10'), e(12000, '2026-08-10'), e(12000, '2026-09-10'),
    e(10000, '2026-10-05'),
    e(30000, '2026-10-20', { chapterId: 'ch-bath', categoryId: 'c-travel' }),
  ];

  it('INS-2: the figure in the headline is the one compared with usual: everyday £100.00, about £20 less than usual', () => {
    const r = recapOf(history, [], PEOPLE, '2026-10', OPTS);
    expect(r.everyday).toBe(10000);
    expect(r.usual).toBe(12000);
    expect(r.comparison).toEqual({ direction: 'less', amount: 2000 });
    expect(r.headline).toContain(formatPence(r.everyday));
    expect(r.headline).toMatch(/about £20 less than usual/);
  });

  it('CHP-5 INS-2: the chapter’s £300.00 is not folded into that sentence', () => {
    const r = recapOf(history, [], PEOPLE, '2026-10', OPTS);
    expect(r.total).toBe(40000);
    expect(r.headline).not.toContain(formatPence(r.total));
  });

  it('INS-2: with no chapters the headline is as before', () => {
    const r = recapOf(history.filter((x) => x.chapterId === null), [], PEOPLE, '2026-10', OPTS);
    expect(r.headline).toBe('October cost £100.00 together, about £20 less than usual.');
  });
});
