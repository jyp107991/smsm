/**
 * Looking behind the screens: the database as it really is. Rows are fetched through the local stack's REST
 * API with the service key (bypasses row-level security); `member_net` and lookups in `auth` are read with
 * psql as the database owner. Neither path shares code with the app, so agreement means something.
 */
import { execFileSync } from 'node:child_process';
import { netPositions } from '../../../src/core/balance';
import type { Pence } from '../../../src/core/money';
import { expenseToLedger, settlementToLedger, type ExpenseRow, type SettlementRow } from '../../../src/data/rows';
import { env } from './env';

function serviceHeaders(): Record<string, string> {
  const key = env.secretKey;
  // New-style secret keys go only in `apikey` (the gateway swaps in a service-role JWT); a legacy JWT goes in both.
  return key.startsWith('sb_secret_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
}

/** GET /rest/v1/<path> with the service key. */
export async function serviceGet<T>(path: string): Promise<T> {
  const res = await fetch(`${env.apiUrl}/rest/v1/${path}`, { headers: { ...serviceHeaders(), accept: 'application/json' } });
  if (!res.ok) throw new Error(`REST ${path.split('?')[0] ?? path}: HTTP ${String(res.status)} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Runs SQL as the database owner and returns the single JSON value it selects. */
export function sqlJson(sql: string): unknown {
  const out = execFileSync('psql', [env.dbUrl, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
  return out === '' ? null : (JSON.parse(out) as unknown);
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface Person { userId: string; email: string; name: string | null; animal: 'cat' | 'dog' | null; locked: boolean; monzoMe: string | null }
export interface Household { id: string; joinCode: string; defaultRatio: Record<string, number> | null; people: Person[] }

/** The household that `email` belongs to, or null. */
export function householdOf(email: string): Household | null {
  return (sqlJson(`
    select json_build_object(
      'id', h.id, 'joinCode', h.join_code, 'defaultRatio', h.default_ratio,
      'people', (select json_agg(json_build_object('userId', m2.user_id, 'email', u2.email, 'name', m2.display_name,
                   'animal', m2.animal, 'locked', m2.locked_at is not null, 'monzoMe', m2.monzo_me) order by m2.joined_at)
                 from members m2 join auth.users u2 on u2.id = m2.user_id where m2.household_id = h.id))
    from auth.users u join members m on m.user_id = u.id join households h on h.id = m.household_id
    where lower(u.email) = lower(${lit(email)})`) as Household | null);
}

export function userIdOf(email: string): string | null {
  return (sqlJson(`select to_json(id) from auth.users where lower(email) = lower(${lit(email)})`) as string | null);
}

export async function expensesOf(householdId: string): Promise<ExpenseRow[]> {
  return serviceGet<ExpenseRow[]>(`expenses?household_id=eq.${householdId}&select=*&order=created_at.asc`);
}

export async function settlementsOf(householdId: string): Promise<SettlementRow[]> {
  return serviceGet<SettlementRow[]>(`settlements?household_id=eq.${householdId}&select=*&order=created_at.asc`);
}

export interface ActivityRow { actor: string | null; entity: string; entity_id: string | null; action: string; summary: Record<string, unknown>; at: string }
export function activityOf(householdId: string): ActivityRow[] {
  return (sqlJson(`select json_agg(a order by a.id) from (select actor, entity, entity_id, action, summary, at
    from activity where household_id = ${lit(householdId)}) a`) as ActivityRow[] | null) ?? [];
}

export function changeRequestsOf(householdId: string): { id: string; kind: string; status: string; payload: Record<string, unknown> }[] {
  return (sqlJson(
    `select json_agg(c order by c.created_at) from (select id, kind, status, payload, created_at from change_requests
     where household_id = ${lit(householdId)}) c`,
  ) as { id: string; kind: string; status: string; payload: Record<string, unknown> }[] | null) ?? [];
}

/** member_net, as the database computes it: user id → pence. */
export function memberNet(householdId: string): Record<string, number> {
  const rows = (sqlJson(
    `select json_agg(json_build_object('user_id', user_id, 'net_pence', net_pence)) from member_net where household_id = ${lit(householdId)}`,
  ) as { user_id: string; net_pence: number }[] | null) ?? [];
  return Object.fromEntries(rows.map((r) => [r.user_id, r.net_pence]));
}

/** core/balance over the rows the database holds (fetched with the service key). */
export async function coreNet(household: Household): Promise<Record<string, Pence>> {
  const [a, b] = household.people;
  if (!a || !b) throw new Error('both people must have joined');
  const [expenses, settlements] = await Promise.all([expensesOf(household.id), settlementsOf(household.id)]);
  return netPositions([a.userId, b.userId], expenses.map(expenseToLedger), settlements.map(settlementToLedger));
}

/**
 * Calls the database as a signed-in person, with the access token the app keeps (to prove that the database
 * itself refuses what the screens don't offer, PPL-4).
 */
export async function asPerson(accessToken: string, path: string, init: { method: string; body?: unknown }): Promise<{ status: number; body: string }> {
  const res = await fetch(`${env.apiUrl}/rest/v1/${path}`, {
    method: init.method,
    headers: { apikey: env.publishableKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.text() };
}

/** Category name → id for a household. */
export function categoriesOf(householdId: string): Record<string, string> {
  return (sqlJson(
    `select json_object_agg(name, id) from categories where household_id = ${lit(householdId)}`,
  ) as Record<string, string> | null) ?? {};
}

/** A pence map without its zero sides (the database accepts both forms). */
export function nonZero(map: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries((map ?? {}) as Record<string, number>)) if (v !== 0) out[k] = v;
  return out;
}
