/// <reference types="node" />
/**
 * S9 release QA, the data-safety pass (ENGINEERING §9: "export, wipe a test household, restore from the backup,
 * compare"; SPEC EXP-1, EXP-2, BAL-1). One realistic household (tests/fixtures/safety-household.sql, written as the
 * two phones write it) goes through both ways back:
 *
 *  1. The in-app backup, as the app makes and restores it: the phone's data layer reads the household from the database
 *     (as the signed-in person, under row-level security, through the app's own queries and their checks), Settings'
 *     backupJson writes the file; the household is wiped; the two people start a new one; restorePlan and restoreBackup
 *     send it to restore_backup in chunks of at most 500 rows. Every row's money, dates, words, tags, deletion and
 *     authorship come back; member_net is the same to the penny and equals core netPositions on the restored rows.
 *     Restoring again adds nothing. A backup from an app before S9a and S9b (format 2, data the new rules now refuse)
 *     still restores, into a household on new accounts, ids renamed and people mapped.
 *  2. The nightly backup, as .github/workflows/backup.yml makes it (data-only dump of the public and auth schemas,
 *     gzip, gpg AES-256) and scripts/restore-backup.sh restores it into an empty project: every table, the history
 *     included, is identical, and the restored database keeps working.
 *
 * What the in-app file does not carry, by design (docs/DECISIONS.md, 23 Nov, the data-safety pass): the history as it
 * was (each restored row is logged once, as restored by the person restoring), household settings and the people's
 * names (they are the receiving household's own: "Nothing already here changes"), change requests, waiting Inbox items,
 * each person's notification switches and photos. The nightly backup carries all of it.
 * Runs only where a PostgreSQL is reachable (PGHOST; always in CI).
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { netPositions } from '../../src/core/balance';
import type { UserId } from '../../src/core/split';
import { ApiError, readCounts, type Api, type ExpenseRow, type RecurringRow, type RestoreCounts, type SettlementRow } from '../../src/data/api';
import { backupJson } from '../../src/data/backup';
import { defaultPeopleMap, restoreBackup, restorePlan, type RestorePlan } from '../../src/data/imports';
import { createMemoryApi } from '../../src/data/memoryApi';
import { manualNetwork } from '../../src/data/network';
import { createDataLayer, type DataLayer } from '../../src/data/queryClient';
import { expenseToLedger, settlementToLedger } from '../../src/data/rows';
import { fixedSession } from '../../src/data/session';
import { memoryStorage } from '../../src/data/storage';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DB = `smsm_safety_${String(process.pid)}`;
const NIGHTLY = `smsm_safety_nightly_${String(process.pid)}`;
// Jae and Sam; then the same two on new accounts (a new project), who restore an older backup of theirs.
const A = 'd5000000-0000-4000-8000-0000000000a1';
const B = 'd5000000-0000-4000-8000-0000000000b1';
const C = 'd5000000-0000-4000-8000-0000000000c1';
const D = 'd5000000-0000-4000-8000-0000000000d1';
const TODAY = new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;

function run(db: string, sql: string): string {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db], {
    input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
  }).trim();
}
/** As a signed-in person: the role and the auth stub's claim, as PostgREST sets them. */
const asUser = (db: string, user: string, sql: string) => run(db, `set role authenticated;\nset request.jwt.claim.sub = '${user}';\n${sql}`);
const lit = (s: string) => `$smsm$${s}$smsm$`;
const rows = <T = Row>(db: string, sql: string, user?: string): T[] => {
  const q = `select coalesce(json_agg(t), '[]') from (${sql}) t;`;
  return JSON.parse(user ? asUser(db, user, q) : run(db, q)) as T[];
};

/**
 * The app's Api, served by this PostgreSQL as the signed-in person (what PostgREST does for the phone): the same
 * `select *` reads the Supabase Api makes, and restore_backup. Everything else is the in-memory Api's, unused here.
 */
function pgApi(db: string, user: string): Api {
  const { api } = createMemoryApi({}, { user: { userId: user, email: null } });
  const list = <T>(table: string, where: string, order: string) => Promise.resolve(rows<T>(db, `select * from ${table} where ${where} order by ${order}`, user));
  const one = async <T>(table: string, where: string) => (await list<T>(table, where, '1'))[0] ?? null;
  return {
    ...api,
    membership: (uid) => one('members', `user_id = '${uid}'`),
    household: (hid) => one('households', `id = '${hid}'`),
    members: (hid) => list('members', `household_id = '${hid}'`, 'joined_at'),
    categories: (hid) => list('categories', `household_id = '${hid}'`, 'sort'),
    expenses: (hid) => list('expenses', `household_id = '${hid}'`, 'id'),
    settlements: (hid) => list('settlements', `household_id = '${hid}'`, 'id'),
    changeRequests: (hid) => list('change_requests', `household_id = '${hid}'`, 'created_at'),
    activity: (hid, entityId) => list('activity', `household_id = '${hid}' and entity_id = '${entityId}'`, 'at desc'),
    categoryMemory: (hid) => list('category_memory', `household_id = '${hid}'`, 'key'),
    recurring: (hid) => list('recurring', `household_id = '${hid}'`, 'start_date'),
    inboxItems: (hid) => list('inbox_items', `household_id = '${hid}'`, 'created_at'),
    chapters: (hid) => list('chapters', `household_id = '${hid}'`, 'created_at'),
    comments: (hid) => list('comments', `household_id = '${hid}'`, 'created_at'),
    importIgnores: (hid) => list('import_ignores', `household_id = '${hid}'`, 'id_hash'),
    importRules: (hid) => list('import_rules', `household_id = '${hid}'`, 'created_at'),
    notificationPrefs: (uid) => one('notification_prefs', `user_id = '${uid}'`),
    postDueRecurring: () => Promise.resolve(Number(asUser(db, user, 'select post_due_recurring();'))),
    restoreBackup: (people, r): Promise<RestoreCounts> => {
      try {
        return Promise.resolve(readCounts(JSON.parse(asUser(db, user, `select restore_backup(${lit(JSON.stringify(people))}::jsonb, ${lit(JSON.stringify(r))}::jsonb);`))));
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? '';
        return Promise.reject(new ApiError('refused', /ERROR:\s+(.*)/u.exec(stderr)?.[1] ?? stderr, 400));
      }
    },
  };
}

const open: DataLayer[] = [];
/** A phone signed in as this person, with nothing on it yet; resolves once it has read the household. */
async function phone(db: string, user: string): Promise<DataLayer> {
  const layer = createDataLayer({ api: pgApi(db, user), storage: memoryStorage(), network: manualNetwork(true), session: fixedSession(user), today: () => TODAY });
  open.push(layer);
  await layer.ready;
  await layer.refresh();
  await layer.idle();
  return layer;
}

function newDatabase(name: string) {
  run('postgres', `drop database if exists ${name} with (force);\ncreate database ${name};`);
  run(name, `\\i ${join(ROOT, 'tests/sql/auth_stub.sql')}`);
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migrations) run(name, `set client_min_messages = warning;\n\\i ${join(ROOT, 'supabase/migrations', f)}`);
}

/** Starts a household as `first`, `second` joins; both choose their names and animals. Returns its id. */
function startHousehold(db: string, first: string, second: string): string {
  const hid = asUser(db, first, "select create_household();\nselect set_identity('Jae', 'cat');").split('\n')[0] ?? '';
  const code = run(db, `select join_code from households where id = '${hid}';`);
  asUser(db, second, `select join_household('${code}');\nselect set_identity('Sam', 'dog');`);
  return hid;
}

const TABLES = ['expenses', 'settlements', 'categories', 'chapters', 'recurring', 'comments', 'category_memory', 'import_rules', 'change_requests', 'inbox_items', 'activity'] as const;
type Snapshot = Record<(typeof TABLES)[number], Row[]> & { net: Record<string, number>; household: Row; prefs: Row[] };
function snapshot(db: string, hid: string): Snapshot {
  const out: Partial<Snapshot> = {};
  for (const t of TABLES) out[t] = rows(db, `select * from ${t} where household_id = '${hid}' order by ${t === 'category_memory' ? 'key' : t === 'import_rules' ? 'match_text' : 'id'}`);
  out.net = Object.fromEntries(rows<{ user_id: string; net_pence: number }>(db, `select user_id, net_pence from member_net where household_id = '${hid}'`).map((r) => [r.user_id, r.net_pence]));
  out.household = rows(db, `select * from households where id = '${hid}'`)[0] ?? {};
  out.prefs = rows(db, `select p.* from notification_prefs p join members m on m.user_id = p.user_id where m.household_id = '${hid}' order by p.user_id`);
  return out as Snapshot;
}

/** core netPositions over the household's rows as the database holds them. */
function coreNets(s: Pick<Snapshot, 'expenses' | 'settlements'>, members: readonly [UserId, UserId]) {
  return netPositions(members, (s.expenses as unknown as ExpenseRow[]).map(expenseToLedger), (s.settlements as unknown as SettlementRow[]).map(settlementToLedger));
}

const without = (r: Row, ...keys: string[]): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
const byId = (list: readonly Row[]) => [...list].sort((x, y) => String(x['id']).localeCompare(String(y['id'])));
const totalAdded = (c: RestoreCounts) => Object.values(c.added).reduce((t, n) => t + n, 0);

let hid = '';
let hid2 = '';
let file = '';
let before: Snapshot;
let nightlyFile = '';
let nightlyAt: Record<string, string> = {};
const dir = mkdtempSync(join(tmpdir(), 'smsm-safety-'));
const PASS = 'the database password on the night of the backup';

/** Every public table and auth.users, each as one digest of its rows (the nightly drill compares them all). */
function digests(db: string): Record<string, string> {
  const tables = run(db, "select tablename from pg_tables where schemaname = 'public' order by 1;").split('\n');
  const out: Record<string, string> = {};
  for (const t of [...tables, 'auth.users']) {
    const name = t.includes('.') ? t : `public.${t}`;
    out[name] = run(db, `select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(x)::text, E'\\n' order by to_jsonb(x)::text), '')) from ${name} x;`);
  }
  return out;
}

describe.skipIf(!process.env.PGHOST)('S9 data-safety drill: export, wipe, restore, compare', () => {
  beforeAll(async () => {
    newDatabase(DB);
    run(DB, `insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}');`);
    const out = execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `A=${A}`, '-v', `B=${B}`, '-d', DB, '-f', join(ROOT, 'tests/fixtures/safety-household.sql')], { encoding: 'utf8' });
    hid = out.trim().split('\n').at(-1) ?? '';
    before = snapshot(DB, hid);

    // The in-app backup, made on Jae's phone as Settings → Export → "Download a backup" makes it.
    file = backupJson({ appVersion: 'drill' }, await phone(DB, A));

    // The nightly backup, made as .github/workflows/backup.yml makes it, the same night.
    nightlyFile = join(dir, 'smsm-nightly.sql.gz.gpg');
    const pgDump = execSync('test -x /usr/lib/postgresql/16/bin/pg_dump && echo /usr/lib/postgresql/16/bin/pg_dump || echo pg_dump', { encoding: 'utf8' }).trim();
    execSync(
      `${pgDump} -d ${DB} --data-only --schema=public --schema=auth ` +
        '--exclude-table=auth.sessions --exclude-table=auth.refresh_tokens --exclude-table=auth.audit_log_entries --exclude-table=auth.flow_state ' +
        '--exclude-table=auth.one_time_tokens --exclude-table=auth.mfa_challenges --exclude-table=auth.mfa_amr_claims ' +
        `| gzip -9 | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 3 --output ${nightlyFile} 3<<<"$P"`,
      { shell: '/bin/bash', env: { ...process.env, P: PASS }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    nightlyAt = digests(DB);
  }, 180_000);

  afterAll(async () => {
    for (const layer of open) await layer.dispose();
    rmSync(dir, { recursive: true, force: true });
    run('postgres', `drop database if exists ${DB} with (force);\ndrop database if exists ${NIGHTLY} with (force);`);
  }, 60_000);

  it('EXP-1 the household is realistic, and the in-app backup holds every row of it', () => {
    const e = before.expenses as unknown as ExpenseRow[];
    expect(new Set(e.map((x) => x.split_mode))).toEqual(new Set(['ratio', 'exact', 'for_other', 'treat']));
    expect(e.some((x) => x.kind === 'money_back' && x.refund_of !== null && x.deleted_at === null)).toBe(true);
    expect(e.some((x) => x.kind === 'money_back' && x.refund_of === null)).toBe(true);
    expect(e.filter((x) => x.deleted_at !== null).length).toBeGreaterThanOrEqual(3);
    expect(before.activity.some((a) => a['entity'] === 'expense' && a['action'] === 'restored')).toBe(true);
    expect(e.some((x) => x.recurring_id !== null)).toBe(true);
    expect(e.some((x) => x.place !== null && x.original_currency === 'JPY')).toBe(true);
    expect(e.length).toBeGreaterThan(500);
    const rc = before.recurring as unknown as RecurringRow[];
    expect(rc.some((r) => r.active)).toBe(true);
    expect(rc.some((r) => !r.active)).toBe(true);
    expect(rc.some((r) => r.end_date !== null && r.end_date < TODAY)).toBe(true);
    // S10: a deleted regular payment, whose posted entries stay with their recurring_id.
    const gone = rc.find((r) => r.deleted_at !== null);
    expect(gone).toBeDefined();
    expect(e.some((x) => x.recurring_id === gone?.id && x.deleted_at === null)).toBe(true);
    expect(before.inbox_items.length).toBeGreaterThan(0);
    expect(before.change_requests.map((r) => r['status']).sort()).toEqual(['approved', 'declined', 'pending']);
    expect(before.household['settle_day']).toBe(15);
    expect(before.prefs.length).toBe(2);
    expect(before.net[A]).not.toBe(0);

    const b = JSON.parse(file) as Record<string, Row[]>;
    expect(b['format']).toBe('smsm-backup-2');
    for (const t of ['expenses', 'settlements', 'categories', 'chapters', 'recurring', 'comments', 'category_memory', 'import_rules'] as const) {
      expect(b[t]?.length, t).toBe(before[t].length);
    }
    // The phone's copy is the database's, row for row (as JSON, the way PostgREST sends it).
    expect(byId(b['expenses'] ?? [])).toEqual(byId(before.expenses));
  });

  it('EXP-1 BAL-1 wipe the household, restore the in-app backup through restore_backup: every row, the balance to the penny', async () => {
    // The wipe: the household and everything in it is gone (the two accounts remain).
    run(DB, `delete from households where id = '${hid}';`);
    for (const t of TABLES) expect(run(DB, `select count(*) from ${t} where household_id = '${hid}';`), t).toBe('0');
    expect(run(DB, `select count(*) from members where user_id in ('${A}', '${B}');`)).toBe('0');

    // They start again, and Jae restores the file from Settings.
    hid2 = startHousehold(DB, A, B);
    const fresh = snapshot(DB, hid2);
    const jae = await phone(DB, A);
    const plan = restorePlan(file, jae);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.counts).toMatchObject({ entries: before.expenses.length, settleUps: before.settlements.length, chapters: 2, regular: 4, comments: 3, categories: 2, rules: 1 });
    const people = defaultPeopleMap(plan, jae.members().map((m) => ({ id: m.user_id, name: m.display_name ?? '' })));
    expect(people).toEqual({ [A]: A, [B]: B });
    const counts = await restoreBackup(plan, people, jae);
    expect(counts.added).toMatchObject({ expenses: before.expenses.length, settlements: 3, chapters: 2, recurring: 4, comments: 3, categories: 2, category_memory: 1, import_rules: 1 });
    // The twelve starting categories are matched by name, not added twice.
    expect(counts.skipped.categories).toBe(12);
    const after = snapshot(DB, hid2);

    // Categories: the household's own come back as they were (emoji, colour, archived, split); the starting ones are
    // the new household's, matched by name.
    const nameOf = (s: Snapshot) => new Map(s.categories.map((c) => [c['id'], c['name']]));
    const [was, now] = [nameOf(before), nameOf(after)];
    const own = (s: Snapshot) => byId(s.categories.filter((c) => !fresh.categories.some((f) => f['name'] === c['name'])).map((c) => without(c, 'household_id')));
    expect(own(after)).toEqual(own(before));
    expect(own(after).map((c) => [c['name'], c['emoji'], c['archived']])).toEqual(expect.arrayContaining([['Pets', '🐾', false], ['Wedding', '💍', true]]));
    expect([...now.values()].sort()).toEqual([...was.values()].sort());

    // Entries: every column, the money (amount, paid, shares, split, refund_of), dates, words, tags, places, deletion,
    // who made and last changed it, when it was made and changed; the category by name.
    const entry = (map: Map<unknown, unknown>) => (r: Row) => ({ ...without(r, 'household_id', 'category_id'), category: map.get(r['category_id']) ?? null });
    expect(byId(after.expenses).map(entry(now))).toEqual(byId(before.expenses).map(entry(was)));
    expect(byId(after.settlements).map((r) => without(r, 'household_id'))).toEqual(byId(before.settlements).map((r) => without(r, 'household_id')));
    expect(byId(after.chapters).map((r) => without(r, 'household_id'))).toEqual(byId(before.chapters).map((r) => without(r, 'household_id')));
    expect(byId(after.comments).map((r) => without(r, 'household_id'))).toEqual(byId(before.comments).map((r) => without(r, 'household_id')));
    // Regular payments come back paused (nothing posts on its own), otherwise as they were.
    const regular = (map: Map<unknown, unknown>) => (r: Row) => ({ ...without(r, 'household_id', 'category_id', 'active'), category: map.get(r['category_id']) ?? null });
    expect(byId(after.recurring).map(regular(now))).toEqual(byId(before.recurring).map(regular(was)));
    expect((after.recurring as unknown as RecurringRow[]).every((r) => !r.active)).toBe(true);
    // S10: a deleted regular payment comes back deleted (as deleted entries do), still the one its entries point at.
    const goneAfter = (after.recurring as unknown as RecurringRow[]).filter((r) => r.deleted_at !== null);
    expect(goneAfter.map((r) => [r.description, r.deleted_at])).toEqual((before.recurring as unknown as RecurringRow[]).filter((r) => r.deleted_at !== null).map((r) => [r.description, r.deleted_at]));
    expect((after.expenses as unknown as ExpenseRow[]).filter((x) => goneAfter.some((r) => r.id === x.recurring_id)).length).toBeGreaterThan(0);
    expect(after.category_memory.map((r) => ({ ...without(r, 'household_id', 'category_id'), category: now.get(r['category_id']) })))
      .toEqual(before.category_memory.map((r) => ({ ...without(r, 'household_id', 'category_id'), category: was.get(r['category_id']) })));
    const rule = (map: Map<unknown, unknown>) => (r: Row) => [r['match_text'], r['decision'], r['split_mode'], r['split_params'], map.get(r['category_id'])];
    expect(after.import_rules.map(rule(now))).toEqual(before.import_rules.map(rule(was)));

    // The balance: member_net is the same to the penny, and core netPositions on the restored rows agrees.
    expect(after.net).toEqual(before.net);
    expect(coreNets(after, [A, B])).toEqual(after.net);
    expect(coreNets(before, [A, B])).toEqual(before.net);

    // The history: each restored row is logged once, as created by the person who restored it, as it now is; nothing
    // is edited or deleted. (The history as it was is in the nightly backup, below.)
    const logged = after.activity.filter((a) => !fresh.activity.some((f) => f['id'] === a['id']));
    const restoredRows = after.expenses.length + after.settlements.length + after.chapters.length + after.recurring.length + after.comments.length + 2;
    expect(logged.length).toBe(restoredRows);
    expect(logged.every((a) => a['action'] === 'created' && a['actor'] === A)).toBe(true);
    const loggedEntry = new Map(logged.filter((a) => a['entity'] === 'expense').map((a) => [a['entity_id'], (a['summary'] as { after: Row }).after]));
    for (const e of after.expenses) {
      expect(loggedEntry.get(e['id'])).toMatchObject({ amount_pence: e['amount_pence'], paid: e['paid'], shares: e['shares'], deleted_at: e['deleted_at'] });
    }
    // Nothing already here changes: the household's settings are its own; each person's notification switches are
    // theirs, untouched by the wipe and the restore.
    expect(after.household).toEqual(fresh.household);
    expect(after.prefs).toEqual(before.prefs);
    // Nobody is told about a restore.
    expect(run(DB, `select count(*) from notification_outbox where household_id = '${hid2}';`)).toBe('0');

    // EXP-1: restoring the same file again adds nothing, logs nothing and leaves the balance.
    const again = await restoreBackup(plan, people, jae);
    expect(totalAdded(again)).toBe(0);
    const twice = snapshot(DB, hid2);
    for (const t of TABLES) expect(twice[t].length, t).toBe(after[t].length);
    expect(twice.net).toEqual(after.net);

    // The link between an original and its money back survived: restoring the deleted Lamp brings back the refund
    // that was deleted with it (S9a, ACT-3), and the balance still agrees with core.
    const lamp = (after.expenses as unknown as ExpenseRow[]).find((x) => x.description === 'Lamp');
    const lampBack = (after.expenses as unknown as ExpenseRow[]).find((x) => x.description === 'Lamp refund');
    expect(lamp?.deleted_at).not.toBeNull();
    expect(lampBack?.deleted_at).toBe(lamp?.deleted_at);
    asUser(DB, A, `update expenses set deleted_at = null where id = '${lamp?.id ?? ''}';`);
    expect(run(DB, `select deleted_at is null from expenses where id = '${lampBack?.id ?? ''}';`)).toBe('t');
    const undone = snapshot(DB, hid2);
    expect(coreNets(undone, [A, B])).toEqual(undone.net);
  }, 120_000);

  it('EXP-1 BAL-1 a backup from before S9a and S9b still restores, into a household on new accounts, people mapped and ids renamed', async () => {
    // S9a and S9b added no columns and no backup fields: an older file is format 2 with rows the new rules would now
    // refuse. Money back still live after its original was deleted (before S9a it stayed); more back than the original
    // had left; "Other" with the placeholder dot (before S9b); a remembered key with an apostrophe (before S9a folded
    // them); and rows from an app older still, without the S6a fields.
    const old = JSON.parse(file) as Record<string, unknown> & { expenses: Row[]; categories: Row[]; category_memory: Row[] };
    old['app_version'] = '0.9.0';
    const lamp = old.expenses.find((x) => x['description'] === 'Lamp');
    const sofa = old.expenses.find((x) => x['description'] === 'Sofa');
    const lampBack = old.expenses.find((x) => x['description'] === 'Lamp refund');
    if (!lamp || !sofa || !lampBack) throw new Error('the fixture changed');
    lampBack['deleted_at'] = null;
    old.expenses.push({
      ...without(sofa, 'category_guess', 'items', 'bill_total_pence'), id: 'd5e00000-0000-4000-8000-000000000001', kind: 'money_back', description: 'Sofa refund, the rest',
      amount_pence: 9000, paid: { [A]: 9000 }, split_mode: 'exact', split_params: { [A]: 6300, [B]: 2700 }, shares: { [A]: 6300, [B]: 2700 }, refund_of: sofa['id'], chapter_id: null,
    });
    for (const e of old.expenses.slice(0, 100)) for (const k of ['category_guess', 'items', 'bill_total_pence']) Reflect.deleteProperty(e, k);
    const other = old.categories.find((c) => c['name'] === 'Other');
    if (other) other['emoji'] = '•';
    old.category_memory.push({ ...old.category_memory[0], key: 'sainsbury’s', uses: 2 });
    const oldFile = JSON.stringify(old);

    // Two new accounts start a household and choose the backup's names, so the people are matched by name.
    const theirs = snapshot(DB, hid2);
    const hid3 = startHousehold(DB, C, D);
    const fresh = snapshot(DB, hid3);
    const onNewAccount = await phone(DB, C);
    const plan = restorePlan(oldFile, onNewAccount) as RestorePlan;
    expect(plan.format).toBe(2);
    const people = defaultPeopleMap(plan, onNewAccount.members().map((m) => ({ id: m.user_id, name: m.display_name ?? '' })));
    expect(people).toEqual({ [A]: C, [B]: D });
    const counts = await restoreBackup(plan, people, onNewAccount);
    expect(counts.added.expenses).toBe(old.expenses.length);
    const after = snapshot(DB, hid3);
    expect(after.expenses.length).toBe(old.expenses.length);

    // Every id was taken by Jae and Sam's household, so every row has a new one; references follow it.
    const renamed = new Map(rows<{ old_id: string; new_id: string }>(DB, `select old_id, new_id from restore_ids where household_id = '${hid3}'`).map((r) => [r.new_id, r.old_id]));
    const person: Record<string, string> = { [C]: A, [D]: B };
    const back = (v: unknown) => (typeof v === 'string' ? renamed.get(v) ?? person[v] ?? v : v);
    const keysBack = (m: unknown) => (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).map(([k, v]) => [person[k] ?? k, v])) : m);
    // Each restored row, with its ids and people put back as the file names them, is the file's row: every column
    // (an older file's missing columns take their defaults), the household's own id and a photo path aside.
    const unmap = (r: Row): Row => Object.fromEntries(Object.entries(without(r, 'household_id')).map(([k, v]) =>
      [k, v && typeof v === 'object' && !Array.isArray(v) ? keysBack(v) : back(v)]));
    const older = { category_guess: false, items: null, bill_total_pence: null };
    expect(byId(after.expenses.map(unmap))).toEqual(byId(old.expenses.map((r) => ({ ...older, ...without(r, 'household_id') }))));
    const file3 = old as unknown as Record<'settlements' | 'chapters' | 'comments' | 'recurring', Row[]>;
    for (const t of ['settlements', 'chapters', 'comments'] as const) {
      expect(byId(after[t].map(unmap)), t).toEqual(byId(file3[t].map((r) => without(r, 'household_id'))));
    }
    expect(byId(after.recurring.map((r) => without(unmap(r), 'active')))).toEqual(byId(file3.recurring.map((r) => without(r, 'household_id', 'active'))));
    const ownCategories = (list: readonly Row[]) => list.filter((c) => !fresh.categories.some((f) => f['name'] === c['name']));
    expect(byId(ownCategories(after.categories).map(unmap))).toEqual(byId(ownCategories(old.categories).map((r) => without(r, 'household_id'))));
    expect(after.categories.find((c) => c['name'] === 'Wedding')?.['default_ratio']).toEqual({ [C]: 50, [D]: 50 });

    // The balance: what the file's own rows come to (people mapped) is what member_net and core say here, the
    // orphaned money back left out by both.
    const fileNets = coreNets({ expenses: old.expenses, settlements: before.settlements }, [A, B]);
    expect(after.net).toEqual({ [C]: fileNets[A], [D]: fileNets[B] });
    expect(coreNets(after, [C, D])).toEqual(after.net);
    // "Other" is the receiving household's own (with its emoji); the remembered key is kept as it was written.
    expect(after.categories.find((c) => c['name'] === 'Other')?.['emoji']).toBe('📦');
    expect(after.category_memory.some((m) => m['key'] === 'sainsbury’s')).toBe(true);
    // Restoring it again finds every renamed row and adds nothing.
    expect(totalAdded(await restoreBackup(plan, people, onNewAccount))).toBe(0);
    expect(snapshot(DB, hid3).expenses.length).toBe(after.expenses.length);
    // Jae and Sam's household, whose ids the file also holds, is untouched.
    expect(snapshot(DB, hid2)).toEqual(theirs);
  }, 120_000);

  it('EXP-2 BAL-1 the nightly backup restores into an empty project: every table and the whole history identical, and it keeps working', () => {
    newDatabase(NIGHTLY);
    // A new project after `supabase db push`: the migrations' own rows only, and nobody signed up yet.
    run(NIGHTLY, 'delete from app_config;\ndelete from auth.users;');
    const url = `postgresql:///${NIGHTLY}?host=${process.env.PGHOST ?? ''}`;
    execFileSync('bash', [join(ROOT, 'scripts/restore-backup.sh'), nightlyFile, url], { env: { ...process.env, BACKUP_PASSPHRASE: PASS }, stdio: ['pipe', 'pipe', 'pipe'] });
    const restored = digests(NIGHTLY);
    expect(Object.keys(restored).sort()).toEqual(Object.keys(nightlyAt).sort());
    for (const t of Object.keys(nightlyAt)) expect(restored[t], t).toBe(nightlyAt[t]);

    // The same comparison as the in-app drill, row by row: money, dates, words, deletion, authorship, the history.
    const there = snapshot(NIGHTLY, hid);
    for (const t of TABLES) expect(byId(there[t]), t).toEqual(byId(before[t]));
    expect(there.net).toEqual(before.net);
    expect(coreNets(there, [A, B])).toEqual(there.net);
    expect(there.prefs).toEqual(before.prefs);
    expect(there.household).toEqual(before.household);

    // It keeps working: a new entry is written and logged (the history's numbering carried on), and the balance moves.
    asUser(NIGHTLY, A, `insert into expenses(household_id, description, amount_pence, date, paid, split_mode, shares)
      values ('${hid}', 'After the restore', 1000, '${TODAY}', '{"${A}": 1000}', 'ratio', '{"${A}": 500, "${B}": 500}');`);
    const later = snapshot(NIGHTLY, hid);
    expect(later.activity.length).toBe(before.activity.length + 1);
    expect(later.net[A]).toBe((before.net[A] ?? 0) + 500);
    expect(coreNets(later, [A, B])).toEqual(later.net);
  }, 120_000);
});
