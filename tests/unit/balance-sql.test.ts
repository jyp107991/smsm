/**
 * BAL-1: one pure function (src/core/balance.ts) and the member_net view must agree. This builds a scratch
 * database from tests/sql/auth_stub.sql and every supabase/migrations/*.sql in order, creates random households
 * through the RPCs as signed-in people (as tests/sql/schema_test.sql does), inserts random valid expenses,
 * money back and settle-ups (some soft-deleted), and compares netPositions with member_net for every person.
 * Runs only when a PostgreSQL is reachable (PGHOST set; always in CI).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pence, type Pence } from '../../src/core/money';
import type { PenceMap, SplitMode, UserId } from '../../src/core/split';
import { netPositions, type LedgerEntry, type LedgerSettlement } from '../../src/core/balance';
import vectorsJson from '../vectors/balance.json';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DB = `smsm_t_${process.pid}`;

function psql(database: string, args: string[], input?: string): string {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface DbEntry extends LedgerEntry {
  mode: SplitMode;
  amount: Pence;
}
interface Household {
  a: UserId;
  b: UserId;
  entries: DbEntry[];
  settlements: LedgerSettlement[];
}

const uid = (n: number): UserId => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A row the database's check_money accepts. Zero sides are sometimes left out of the maps, as the database allows. */
function entryArb(a: UserId, b: UserId): fc.Arbitrary<DbEntry> {
  const split = (amount: number, dropZero: boolean, x: number): PenceMap => {
    const m: Record<UserId, Pence> = {};
    if (x > 0 || !dropZero) m[a] = pence(x);
    if (amount - x > 0 || !dropZero) m[b] = pence(amount - x);
    return m;
  };
  return fc
    .record({
      amount: fc.integer({ min: 1, max: 5_000_000 }),
      kind: fc.constantFrom<LedgerEntry['kind']>('expense', 'expense', 'money_back'),
      mode: fc.constantFrom<SplitMode>('ratio', 'exact', 'for_other', 'treat'),
      payer: fc.constantFrom(a, b),
      joint: fc.boolean(),
      dropZero: fc.boolean(),
      deleted: fc.boolean(),
      x: fc.double({ min: 0, max: 1, noNaN: true }),
      y: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ amount, kind, mode, payer, joint, dropZero, deleted, x, y }): DbEntry => {
      const other = payer === a ? b : a;
      const single: PenceMap = dropZero ? { [payer]: pence(amount) } : { [payer]: pence(amount), [other]: pence(0) };
      const jointPaid = split(amount, dropZero, Math.floor(x * amount));
      const anyShares = split(amount, dropZero, Math.floor(y * amount));
      const base = { kind, deleted, mode, amount: pence(amount) };
      switch (mode) {
        case 'for_other':
          return { ...base, paid: single, shares: dropZero ? { [other]: pence(amount) } : { [payer]: pence(0), [other]: pence(amount) } };
        case 'treat': {
          const paid = joint ? jointPaid : single;
          return { ...base, paid, shares: { ...paid } };
        }
        case 'ratio':
        case 'exact':
          return { ...base, paid: joint ? jointPaid : single, shares: anyShares };
      }
    });
}

function settlementArb(a: UserId, b: UserId): fc.Arbitrary<LedgerSettlement> {
  return fc
    .record({ from: fc.constantFrom(a, b), amount: fc.integer({ min: 1, max: 5_000_000 }), deleted: fc.boolean() })
    .map(({ from, amount, deleted }) => ({ from, to: from === a ? b : a, amount: pence(amount), deleted }));
}

const jsonb = (m: PenceMap): string => `'${JSON.stringify(m)}'::jsonb`;

function householdSql(h: Household, i: number): string {
  const lines = [
    `-- household ${i}`,
    `set request.jwt.claim.sub = '${h.a}';`,
    `select create_household() as hid \\gset`,
    `select join_code as code from households where id = :'hid' \\gset`,
    `set request.jwt.claim.sub = '${h.b}';`,
    `select join_household(:'code') as joined \\gset`,
  ];
  h.entries.forEach((e, j) => {
    lines.push(`set request.jwt.claim.sub = '${j % 2 === 0 ? h.a : h.b}';`);
    lines.push(
      `insert into expenses(household_id, kind, description, amount_pence, paid, split_mode, shares, deleted_at) values ` +
        `(:'hid', '${e.kind}', 'Row ${j}', ${e.amount}, ${jsonb(e.paid)}, '${e.mode}', ${jsonb(e.shares)}, ${e.deleted ? 'now()' : 'null'});`,
    );
  });
  h.settlements.forEach((s) => {
    lines.push(
      `insert into settlements(household_id, from_user, to_user, amount_pence, deleted_at) values ` +
        `(:'hid', '${s.from}', '${s.to}', ${s.amount}, ${s.deleted ? 'now()' : 'null'});`,
    );
  });
  return lines.join('\n');
}

/** The DATA_MODEL §3 worked example (tests/vectors/balance.json), as the first household. */
interface RawEntry {
  kind: 'expense' | 'money_back';
  mode: SplitMode;
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
const worked = (vectorsJson as unknown as { workedExample: { steps: { entry?: RawEntry; settlement?: RawSettlement }[] } }).workedExample;
function workedHousehold(a: UserId, b: UserId): Household {
  const rename = (u: string): UserId => (u === 'jae' ? a : u === 'sam' ? b : u);
  const map = (m: Record<string, number>): PenceMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [rename(k), pence(v)]));
  const entries: DbEntry[] = [];
  const settlements: LedgerSettlement[] = [];
  for (const step of worked.steps) {
    if (step.entry) {
      const e = step.entry;
      const amount = pence(Object.values(e.paid).reduce((x, y) => x + y, 0));
      const paid = map(e.paid);
      const shares = map(e.shares);
      entries.push({ kind: e.kind, paid, shares, deleted: e.deleted, mode: e.mode, amount });
    }
    if (step.settlement) {
      const s = step.settlement;
      settlements.push({ from: rename(s.from), to: rename(s.to), amount: pence(s.amount), deleted: s.deleted });
    }
  }
  return { a, b, entries, settlements };
}

const norm = (n: number): number => (n === 0 ? 0 : n);

describe.skipIf(!process.env.PGHOST)('netPositions against the member_net view', () => {
  beforeAll(() => {
    psql('postgres', ['-c', `drop database if exists ${DB}`]);
    psql('postgres', ['-c', `create database ${DB}`]);
    psql(DB, ['-f', join(ROOT, 'tests/sql/auth_stub.sql')]);
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const f of migrations) psql(DB, ['-f', join(ROOT, 'supabase/migrations', f)]);
  }, 120_000);

  afterAll(() => {
    psql('postgres', ['-c', `drop database if exists ${DB} with (force)`]);
  }, 60_000);

  it('BAL-1 netPositions equals member_net for the worked example and for random households', () => {
    const N = 25;
    const households: Household[] = [workedHousehold(uid(1), uid(2))];
    households.push({ a: uid(3), b: uid(4), entries: [], settlements: [] }); // nothing recorded yet
    for (let i = households.length; i < N; i += 1) {
      const a = uid(2 * i + 1);
      const b = uid(2 * i + 2);
      const [h] = fc.sample(
        fc.record({ entries: fc.array(entryArb(a, b), { maxLength: 30 }), settlements: fc.array(settlementArb(a, b), { maxLength: 6 }) }),
        { numRuns: 1, seed: 20261117 + i },
      );
      if (!h) throw new Error('no sample');
      households.push({ a, b, ...h });
    }

    const users = households.flatMap((h) => [h.a, h.b]);
    const script = [
      `insert into auth.users(id) values ${users.map((u) => `('${u}')`).join(', ')} on conflict do nothing;`,
      'set role authenticated;',
      ...households.map(householdSql),
      'reset role;',
      'select user_id, net_pence from member_net order by user_id;',
    ].join('\n');
    const out = psql(DB, ['-f', '-'], script);

    const dbNet = new Map<string, number>();
    for (const line of out.trim().split('\n')) {
      const [user, net] = line.split('|');
      if (user && net !== undefined) dbNet.set(user, Number(net));
    }
    expect(dbNet.size).toBe(users.length);

    // The worked example ends all square in both.
    expect(dbNet.get(uid(1))).toBe(0);
    expect(dbNet.get(uid(2))).toBe(0);

    for (const h of households) {
      const nets = netPositions([h.a, h.b], h.entries, h.settlements);
      expect({ [h.a]: norm(nets[h.a] ?? Number.NaN), [h.b]: norm(nets[h.b] ?? Number.NaN) }).toEqual({
        [h.a]: dbNet.get(h.a),
        [h.b]: dbNet.get(h.b),
      });
    }
  }, 120_000);
});
