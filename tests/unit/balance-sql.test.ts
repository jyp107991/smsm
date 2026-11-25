/// <reference types="node" />
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
  /** S9a (MB-3): money back that may be linked to an earlier entry (made into refundOf when the database allows it). */
  link?: number;
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
      link: fc.option(fc.nat({ max: 29 }), { nil: undefined }),
    })
    .map(({ amount, kind, mode, payer, joint, dropZero, deleted, x, y, link }): DbEntry => {
      const other = payer === a ? b : a;
      const single: PenceMap = dropZero ? { [payer]: pence(amount) } : { [payer]: pence(amount), [other]: pence(0) };
      const jointPaid = split(amount, dropZero, Math.floor(x * amount));
      const anyShares = split(amount, dropZero, Math.floor(y * amount));
      const base = { kind, deleted, mode, amount: pence(amount), ...(kind === 'money_back' && link !== undefined ? { link } : {}) };
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

/**
 * S9a (MB-2, MB-3): ids for every row, and money back linked to an earlier expense where the database allows it (no
 * more than the original still has to come back). Originals are often deleted while their money back is live (rows
 * inserted deleted cascade nothing; the live refund goes in as a restored backup row), so the households hold orphaned
 * money back, which neither side may count.
 */
function linked(h: Household, i: number): Household {
  const entries = h.entries.map((e, j) => ({ ...e, id: `00000000-0000-4000-9000-${(i * 1000 + j).toString(16).padStart(12, '0')}`, refundOf: null as string | null }));
  entries.forEach((e, j) => {
    if (e.kind !== 'money_back' || e.link === undefined || j === 0) return;
    const original = entries[e.link % j];
    if (!original || original.kind !== 'expense') return;
    const back = entries.filter((x) => x.kind === 'money_back' && !x.deleted && x.refundOf === original.id).reduce((t, x) => t + x.amount, 0);
    if (e.deleted || e.amount <= original.amount - back) e.refundOf = original.id;
  });
  return { ...h, entries };
}

function householdSql(h: Household, i: number): string {
  const lines = [
    `-- household ${i}`,
    `set request.jwt.claim.sub = '${h.a}';`,
    `select create_household() as hid \\gset`,
    `select join_code as code from households where id = :'hid' \\gset`,
    `set request.jwt.claim.sub = '${h.b}';`,
    `select join_household(:'code') as joined \\gset`,
  ];
  // Money back for an original that is already deleted is refused from the app (S9a review); such orphans only arise
  // from a backup restored as it was, so those rows go in the way restore_backup writes them (smsm.restoring).
  const deletedIds = new Set(h.entries.filter((e) => e.deleted && e.id).map((e) => e.id));
  h.entries.forEach((e, j) => {
    const orphan = e.kind === 'money_back' && !e.deleted && e.refundOf != null && deletedIds.has(e.refundOf);
    lines.push(`set request.jwt.claim.sub = '${j % 2 === 0 ? h.a : h.b}';`);
    if (orphan) lines.push(`set smsm.restoring = 'on';`);
    lines.push(
      `insert into expenses(${e.id ? 'id, ' : ''}household_id, kind, description, amount_pence, paid, split_mode, shares, refund_of, deleted_at) values ` +
        `(${e.id ? `'${e.id}', ` : ''}:'hid', '${e.kind}', 'Row ${j}', ${e.amount}, ${jsonb(e.paid)}, '${e.mode}', ${jsonb(e.shares)}, ` +
        `${e.refundOf ? `'${e.refundOf}'` : 'null'}, ${e.deleted ? 'now()' : 'null'});`,
    );
    if (orphan) lines.push(`reset smsm.restoring;`);
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
      households.push(linked({ a, b, ...h }, i));
    }
    // S9a: the property covers orphaned money back (a live refund whose original is deleted).
    const orphans = households.flatMap((h) => h.entries.filter((e) => e.kind === 'money_back' && !e.deleted && e.refundOf != null
      && h.entries.some((o) => o.id === e.refundOf && o.deleted)));
    expect(orphans.length).toBeGreaterThan(0);

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

  /**
   * S10 (REC-12, BAL-1): core and SQL agree that one person's own entries are left out of the balance. Each household
   * has random shared rows, its members' own entries as the posting writes them (all the owner's, through row-level
   * security and check_personal), and own entries shaped to move the balance if they were counted (written by the
   * database owner with the checks off), so only "whose it is" can keep them out.
   */
  it('REC-12 BAL-1 netPositions and member_net (and member_net_on) both leave out personal entries', () => {
    const households: (Household & { own: DbEntry[]; stray: DbEntry[] })[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = uid(5000 + 2 * i);
      const b = uid(5001 + 2 * i);
      const [h] = fc.sample(
        fc.record({
          entries: fc.array(entryArb(a, b), { maxLength: 15 }),
          settlements: fc.array(settlementArb(a, b), { maxLength: 3 }),
          own: fc.array(fc.record({ amount: fc.integer({ min: 1, max: 900_000 }), owner: fc.constantFrom(a, b), deleted: fc.boolean() }), { minLength: 1, maxLength: 6 }),
          stray: fc.array(fc.record({ amount: fc.integer({ min: 1, max: 900_000 }), owner: fc.constantFrom(a, b) }), { minLength: 1, maxLength: 3 }),
        }),
        { numRuns: 1, seed: 20261125 + i },
      );
      if (!h) throw new Error('no sample');
      const shared = h.entries.filter((e) => e.kind === 'expense');
      households.push({
        a, b, entries: shared, settlements: h.settlements,
        own: h.own.map((o) => ({ kind: 'expense', mode: 'treat', amount: pence(o.amount), paid: { [o.owner]: pence(o.amount) }, shares: { [o.owner]: pence(o.amount) }, deleted: o.deleted, ownerId: o.owner })),
        stray: h.stray.map((o) => ({ kind: 'expense', mode: 'for_other', amount: pence(o.amount), paid: { [o.owner]: pence(o.amount) }, shares: { [o.owner === a ? b : a]: pence(o.amount) }, deleted: false, ownerId: o.owner })),
      });
    }
    const users = households.flatMap((h) => [h.a, h.b]);
    const lines: string[] = [`insert into auth.users(id) values ${users.map((u) => `('${u}')`).join(', ')} on conflict do nothing;`];
    for (const [i, h] of households.entries()) {
      lines.push('set role authenticated;', householdSql({ a: h.a, b: h.b, entries: h.entries, settlements: h.settlements }, 900 + i));
      // As the posting of their own regular payment writes them (S10 review: a phone never inserts an own entry, the
      // posting does, under smsm.posting), still through row-level security and check_personal as the owner.
      lines.push("select set_config('smsm.posting', 'on', false);");
      for (const o of h.own) {
        lines.push(`set request.jwt.claim.sub = '${o.ownerId ?? ''}';`,
          `insert into expenses(household_id, kind, description, amount_pence, paid, split_mode, shares, owner_id, deleted_at) values ` +
          `(:'hid', 'expense', 'Own', ${o.amount}, ${jsonb(o.paid)}, 'treat', ${jsonb(o.shares)}, '${o.ownerId ?? ''}', ${o.deleted ? 'now()' : 'null'});`);
      }
      lines.push("select set_config('smsm.posting', 'off', false);", 'reset role;', 'alter table expenses disable trigger user;');
      for (const o of h.stray) {
        lines.push(`insert into expenses(household_id, kind, description, amount_pence, paid, split_mode, shares, owner_id) values ` +
          `(:'hid', 'expense', 'Stray own', ${o.amount}, ${jsonb(o.paid)}, 'for_other', ${jsonb(o.shares)}, '${o.ownerId ?? ''}');`);
      }
      lines.push('alter table expenses enable trigger user;');
    }
    lines.push(`select m.user_id, m.net_pence, member_net_on(m.household_id, m.user_id, (now() at time zone 'Europe/London')::date) from member_net m order by m.user_id;`);
    const out = psql(DB, ['-f', '-'], lines.join('\n'));
    const dbNet = new Map<string, [number, number]>();
    for (const line of out.trim().split('\n')) {
      const [user, net, on] = line.split('|');
      if (user && net !== undefined && on !== undefined) dbNet.set(user, [Number(net), Number(on)]);
    }
    let strays = 0;
    for (const h of households) {
      strays += h.stray.length;
      const all = [...h.entries, ...h.own, ...h.stray];
      const nets = netPositions([h.a, h.b], all, h.settlements);
      const sharedOnly = netPositions([h.a, h.b], h.entries, h.settlements);
      expect(nets).toEqual(sharedOnly);
      for (const p of [h.a, h.b]) {
        expect(dbNet.get(p)).toEqual([norm(nets[p] ?? Number.NaN), norm(nets[p] ?? Number.NaN)]);
      }
      // Counted, the strays would have moved it (so the agreement is about whose they are).
      const counted = netPositions([h.a, h.b], all.map((e) => ({ ...e, ownerId: null })), h.settlements);
      expect(counted).not.toEqual(sharedOnly);
    }
    expect(strays).toBeGreaterThan(0);
  }, 120_000);
});
