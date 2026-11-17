/**
 * The household's queries, shared by the hooks and the write functions. Every server response is checked
 * at the boundary (ENGINEERING §1: zod at every boundary) for the fields the app relies on; the money maps
 * themselves are checked where they become money, in rows.ts.
 */
import { queryOptions, skipToken } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ApiError,
  type ActivityRow, type Api, type CategoryRow, type ChangeRequestRow, type ExpenseRow, type HouseholdRow, type MemberRow,
  type SettlementRow,
} from './api';
import { keys } from './keys';

const id = z.string().min(1);
const stamp = z.string();
const nullableText = z.string().nullable();

const householdSchema = z.looseObject({ id, join_code: z.string(), home_country: z.string(), default_ratio: z.unknown(), created_at: stamp });
const memberSchema = z.looseObject({
  household_id: id, user_id: id, display_name: nullableText, animal: z.enum(['cat', 'dog']).nullable(), locked_at: stamp.nullable(),
  monzo_me: nullableText, joined_at: stamp,
});
const categorySchema = z.looseObject({ id, household_id: id, name: z.string(), emoji: z.string(), colour: z.string(), archived: z.boolean(), sort: z.number() });
const expenseSchema = z.looseObject({
  id, household_id: id, kind: z.enum(['expense', 'money_back']), description: z.string(), amount_pence: z.number().int(),
  date: z.string(), category_id: id.nullable(), paid: z.unknown(), shares: z.unknown(), split_mode: z.string(),
  tags: z.array(z.string()), created_at: stamp, updated_at: stamp, deleted_at: stamp.nullable(),
});
const settlementSchema = z.looseObject({
  id, household_id: id, from_user: id, to_user: id, amount_pence: z.number().int(), date: z.string(), method: z.string(),
  created_at: stamp, updated_at: stamp, deleted_at: stamp.nullable(),
});
const changeSchema = z.looseObject({ id, household_id: id, requested_by: id, kind: z.string(), payload: z.unknown(), status: z.string() });
const activitySchema = z.looseObject({ id: z.number(), entity: z.string(), action: z.string(), at: stamp, summary: z.unknown() });

/** Validated for the fields the app reads; the rest of the row is passed through as the database sent it. */
function check(schema: z.ZodType, what: string, value: unknown): unknown {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError('refused', `unexpected ${what} from the server: ${parsed.error.issues[0]?.message ?? ''}`);
  return value;
}

export function membershipQuery(api: Api, uid: string | null) {
  return queryOptions({
    queryKey: keys.membership(uid ?? ''),
    queryFn: uid ? async () => check(memberSchema.nullable(), 'membership', await api.membership(uid)) as MemberRow | null : skipToken,
  });
}

type Hid = string | null | undefined;

export function householdQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.household(uid ?? ''),
    queryFn: uid && hid ? async () => check(householdSchema.nullable(), 'household', await api.household(hid)) as HouseholdRow | null : skipToken,
  });
}

export function membersQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.members(uid ?? ''),
    queryFn: uid && hid ? async () => check(z.array(memberSchema), 'members', await api.members(hid)) as MemberRow[] : skipToken,
  });
}

export function categoriesQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.categories(uid ?? ''),
    queryFn: uid && hid ? async () => check(z.array(categorySchema), 'categories', await api.categories(hid)) as CategoryRow[] : skipToken,
  });
}

export function expensesQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.expenses(uid ?? ''),
    queryFn: uid && hid ? async () => check(z.array(expenseSchema), 'expenses', await api.expenses(hid)) as ExpenseRow[] : skipToken,
  });
}

export function settlementsQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.settlements(uid ?? ''),
    queryFn: uid && hid ? async () => check(z.array(settlementSchema), 'settle-ups', await api.settlements(hid)) as SettlementRow[] : skipToken,
  });
}

export function changesQuery(api: Api, uid: string | null, hid: Hid) {
  return queryOptions({
    queryKey: keys.changes(uid ?? ''),
    queryFn: uid && hid ? async () => check(z.array(changeSchema), 'change requests', await api.changeRequests(hid)) as ChangeRequestRow[] : skipToken,
  });
}

export function activityQuery(api: Api, uid: string | null, hid: Hid, entityId: string) {
  return queryOptions({
    queryKey: keys.activity(uid ?? '', entityId),
    queryFn: uid && hid ? async () => check(z.array(activitySchema), 'history', await api.activity(hid, entityId)) as ActivityRow[] : skipToken,
  });
}
