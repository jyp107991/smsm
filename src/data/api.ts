/**
 * The one seam between the app and the backend (ENGINEERING §3: src/data is the only place that does I/O).
 * Everything the data layer needs from Supabase is behind this small interface, implemented over the real
 * client here and in memory in `memoryApi.ts` (demo mode and tests), so the queue, rollback and session
 * logic can be tested without a network.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types';

type Tables = Database['public']['Tables'];
export type HouseholdRow = Tables['households']['Row'];
export type MemberRow = Tables['members']['Row'];
export type CategoryRow = Tables['categories']['Row'];
export type ExpenseRow = Tables['expenses']['Row'];
export type SettlementRow = Tables['settlements']['Row'];
export type ChangeRequestRow = Tables['change_requests']['Row'];
export type ActivityRow = Tables['activity']['Row'];
export type CategoryMemoryRow = Tables['category_memory']['Row'];
export type RecurringRow = Tables['recurring']['Row'];
export type InboxItemRow = Tables['inbox_items']['Row'];
export type ChapterRow = Tables['chapters']['Row'];
export type CommentRow = Tables['comments']['Row'];
/** The columns the phone owns on a comment (ACT-4). */
export type CommentWrite = Pick<CommentRow, 'id' | 'household_id' | 'expense_id' | 'author' | 'body' | 'deleted_at'>;
export type CommentColumn = 'body' | 'deleted_at';
/** What the phone writes to `category_memory` (CAT-3, CAT-4); the server stamps `updated_at`. */
export type CategoryMemoryWrite = Pick<CategoryMemoryRow, 'household_id' | 'key' | 'category_id' | 'split_mode' | 'split_params' | 'uses' | 'source'>;

/** The columns the phone owns on an expense; an upsert sends only these, so a replay can't clobber server stamps. */
export const EXPENSE_WRITE_COLUMNS = [
  'id', 'household_id', 'kind', 'description', 'amount_pence', 'date', 'category_id', 'chapter_id', 'paid', 'paid_via',
  'split_mode', 'split_params', 'shares', 'notes', 'tags', 'country', 'refund_of', 'source', 'recurring_id', 'occurrence_date',
  'place', 'lat', 'lng', 'original_amount', 'original_currency', 'fx_rate',
] as const satisfies readonly (keyof ExpenseRow)[];
export type ExpenseWrite = Pick<ExpenseRow, (typeof EXPENSE_WRITE_COLUMNS)[number]>;

export const SETTLEMENT_WRITE_COLUMNS = [
  'id', 'household_id', 'from_user', 'to_user', 'amount_pence', 'date', 'note', 'method',
] as const satisfies readonly (keyof SettlementRow)[];
export type SettlementWrite = Pick<SettlementRow, (typeof SETTLEMENT_WRITE_COLUMNS)[number]>;

export interface SoftDeletePatch { deleted_at: string | null }

/** The columns the phone owns on a regular payment (S3); the server owns posted_count and the stamps (REC-6). */
export const RECURRING_WRITE_COLUMNS = [
  'id', 'household_id', 'description', 'amount_pence', 'amount_varies', 'category_id', 'paid', 'paid_via', 'split_mode',
  'split_params', 'shares', 'is_subscription', 'frequency', 'every', 'start_date', 'end_date', 'active', 'notes',
] as const satisfies readonly (keyof RecurringRow)[];
export type RecurringWrite = Pick<RecurringRow, (typeof RECURRING_WRITE_COLUMNS)[number]>;
export type RecurringColumn = Exclude<(typeof RECURRING_WRITE_COLUMNS)[number], 'id' | 'household_id'>;

/** An Inbox decision (INB-2): kept (with the entry it became) or dismissed. */
export interface InboxPatch { status: 'kept' | 'dismissed'; expense_id: string | null }

/** The columns the phone owns on a category (CAT-1). */
/** The columns the phone owns on a chapter (CHP-1; S4a). */
export type ChapterWrite = Pick<ChapterRow, 'id' | 'household_id' | 'name' | 'emoji' | 'kind' | 'country' | 'start_date' | 'end_date' | 'closed'>;
export type ChapterColumn = Exclude<keyof ChapterWrite, 'id' | 'household_id'>;

export type CategoryWrite = Pick<CategoryRow, 'id' | 'household_id' | 'name' | 'emoji' | 'colour' | 'archived' | 'sort' | 'default_ratio'>;

export interface AuthUser { userId: string; email: string | null }

/** Tables whose changes the partner's phone needs to hear about (DATA_MODEL §6). */
export type WatchedTable = 'households' | 'members' | 'categories' | 'expenses' | 'settlements' | 'change_requests' | 'recurring' | 'inbox_items' | 'chapters' | 'comments';
export type ChannelStatus = 'subscribed' | 'error' | 'closed';

/**
 * Reads name the household explicitly (row-level security limits them to it anyway), so the layer never
 * relies on the server to filter; who is signed in is followed by the session keeper (session.ts).
 */
export interface Api {
  auth: {
    sendCode(email: string): Promise<void>;
    verifyCode(email: string, code: string): Promise<AuthUser>;
    signOut(): Promise<void>;
  };
  /** This person's own member row, or null when they aren't in a household yet. */
  membership(userId: string): Promise<MemberRow | null>;
  household(householdId: string): Promise<HouseholdRow | null>;
  members(householdId: string): Promise<MemberRow[]>;
  categories(householdId: string): Promise<CategoryRow[]>;
  expenses(householdId: string): Promise<ExpenseRow[]>;
  settlements(householdId: string): Promise<SettlementRow[]>;
  changeRequests(householdId: string): Promise<ChangeRequestRow[]>;
  activity(householdId: string, entityId: string): Promise<ActivityRow[]>;
  /** What the household has taught the app: description → category and usual split (CAT-3, CAT-4). */
  categoryMemory(householdId: string): Promise<CategoryMemoryRow[]>;
  /** Insert or update by (household, key). Returns the stored row. */
  upsertCategoryMemory(row: CategoryMemoryWrite): Promise<CategoryMemoryRow>;
  /** Insert or update by id (OFF-7: a replay can't duplicate). Returns the stored row. */
  upsertExpense(row: ExpenseWrite): Promise<ExpenseRow>;
  patchExpense(id: string, patch: SoftDeletePatch): Promise<ExpenseRow>;
  upsertSettlement(row: SettlementWrite): Promise<SettlementRow>;
  patchSettlement(id: string, patch: SoftDeletePatch): Promise<SettlementRow>;
  createHousehold(): Promise<string>;
  /** Null when no household has that code. */
  joinHousehold(code: string): Promise<string | null>;
  setIdentity(name: string, animal: 'cat' | 'dog'): Promise<void>;
  setMonzoMe(username: string | null): Promise<void>;
  requestChange(kind: 'identity' | 'default_ratio', payload: Json): Promise<string>;
  decideChange(id: string, approve: boolean): Promise<void>;
  postDueRecurring(): Promise<number>;
  /** S3: regular payments, the Inbox and categories. */
  recurring(householdId: string): Promise<RecurringRow[]>;
  inboxItems(householdId: string): Promise<InboxItemRow[]>;
  /** With `columns`, an existing template's other columns are left as the server has them (a partner's edit stays). */
  upsertRecurring(row: RecurringWrite, columns?: readonly RecurringColumn[]): Promise<RecurringRow>;
  patchInboxItem(id: string, patch: InboxPatch): Promise<InboxItemRow>;
  upsertCategory(row: CategoryWrite): Promise<CategoryRow>;
  /** S4a: the household's chapters (open and closed). */
  chapters(householdId: string): Promise<ChapterRow[]>;
  /** With `columns`, an existing chapter's other columns stay as the server has them (a partner's edit stays). */
  upsertChapter(row: ChapterWrite, columns?: readonly ChapterColumn[]): Promise<ChapterRow>;
  /** S5b (ACT-4): the household's comments; a new one is inserted, an edit or delete updates only its columns. */
  comments(householdId: string): Promise<CommentRow[]>;
  upsertComment(row: CommentWrite, columns?: readonly CommentColumn[]): Promise<CommentRow>;
  /** SET-4: the household's settle day (1–28) or null. */
  setSettleDay(day: number | null): Promise<void>;
  /** One channel per household; calls `onChange` with the table that changed. Returns an unsubscribe function. */
  watchHousehold(householdId: string, onChange: (table: WatchedTable) => void, onStatus: (s: ChannelStatus) => void): () => void;
}

/**
 * Why a call failed. `network`, `auth` (an expired token being refreshed) and `server` (5xx) are transient:
 * the write stays queued and is retried. `refused` means the server looked at it and said no: the entry is
 * kept for the person to fix (OFF-5) and never retried as it is.
 */
export type ApiErrorKind = 'network' | 'auth' | 'server' | 'refused' | 'stale' | 'waiting';

export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string, public readonly status = 0, public readonly code = '') {
    super(message);
    this.name = 'ApiError';
  }
}

export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && err.kind !== 'refused';
}

export function classifyStatus(status: number): ApiErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'server';
  return 'refused';
}

interface PgResult { data: unknown; error: { message: string; code?: string } | null; status: number }
/** The row type of a response, read from the response itself (inference through the union is unreliable). */
type DataOf<R extends PgResult> = NonNullable<R['data']>;

function unwrap<R extends PgResult>(res: R): DataOf<R> | null {
  if (res.error) throw new ApiError(classifyStatus(res.status), res.error.message, res.status, res.error.code ?? '');
  return (res.data ?? null);
}

function must<R extends PgResult>(res: R, what: string): DataOf<R> {
  const data = unwrap(res);
  if (data === null) throw new ApiError('refused', `${what}: no row came back`, res.status);
  return data;
}

/** Reads every row of a table in pages (PostgREST returns at most 1,000 rows per request by default). */
const PAGE = 1000;
async function allRows<T>(page: (from: number, to: number) => PromiseLike<PgResult & { data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await page(from, from + PAGE - 1);
    const rows = unwrap(res) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function authUser(session: Session | null): AuthUser | null {
  return session ? { userId: session.user.id, email: session.user.email ?? null } : null;
}

function authError(err: { message: string; status?: number | undefined; name?: string }): ApiError {
  if (err.name === 'AuthRetryableFetchError') return new ApiError('network', err.message, err.status ?? 0);
  return new ApiError(classifyStatus(err.status ?? 400), err.message, err.status ?? 400);
}

const TABLE_FILTER: Record<WatchedTable, string> = {
  households: 'id', members: 'household_id', categories: 'household_id', expenses: 'household_id',
  settlements: 'household_id', change_requests: 'household_id', recurring: 'household_id', inbox_items: 'household_id', chapters: 'household_id', comments: 'household_id',
};

/** The Api over the real Supabase client. Row-level security limits every read to the person's household. */
export function supabaseApi(db: SupabaseClient<Database>): Api {
  return {
    auth: {
      async sendCode(email) {
        const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) throw authError(error);
      },
      async verifyCode(email, code) {
        const { data, error } = await db.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw authError(error);
        const user = authUser(data.session);
        if (!user) throw new ApiError('refused', 'no session after verifying the code');
        return user;
      },
      async signOut() {
        const { error } = await db.auth.signOut({ scope: 'local' });
        if (error) throw authError(error);
      },
    },
    membership: async (userId) => unwrap(await db.from('members').select('*').eq('user_id', userId).maybeSingle()),
    household: async (hid) => unwrap(await db.from('households').select('*').eq('id', hid).maybeSingle()),
    members: async (hid) => unwrap(await db.from('members').select('*').eq('household_id', hid).order('joined_at')) ?? [],
    categories: async (hid) => unwrap(await db.from('categories').select('*').eq('household_id', hid).order('sort')) ?? [],
    expenses: (hid) => allRows((from, to) => db.from('expenses').select('*').eq('household_id', hid).order('id').range(from, to)),
    settlements: (hid) => allRows((from, to) => db.from('settlements').select('*').eq('household_id', hid).order('id').range(from, to)),
    changeRequests: async (hid) => unwrap(await db.from('change_requests').select('*').eq('household_id', hid).order('created_at')) ?? [],
    activity: async (hid, entityId) =>
      unwrap(await db.from('activity').select('*').eq('household_id', hid).eq('entity_id', entityId).order('at', { ascending: false })) ?? [],
    categoryMemory: (hid) =>
      allRows((from, to) => db.from('category_memory').select('*').eq('household_id', hid).order('key').range(from, to)),
    upsertCategoryMemory: async (row) =>
      must(await db.from('category_memory').upsert(row, { onConflict: 'household_id,key' }).select().single(), 'category memory'),
    upsertExpense: async (row) => must(await db.from('expenses').upsert(row, { onConflict: 'id' }).select().single(), 'expense'),
    patchExpense: async (id, patch) => must(await db.from('expenses').update(patch).eq('id', id).select().single(), 'expense'),
    upsertSettlement: async (row) => must(await db.from('settlements').upsert(row, { onConflict: 'id' }).select().single(), 'settle-up'),
    patchSettlement: async (id, patch) => must(await db.from('settlements').update(patch).eq('id', id).select().single(), 'settle-up'),
    createHousehold: async () => must(await db.rpc('create_household'), 'create_household'),
    // The generated type says string, but the function returns null for a wrong code (migration 3).
    joinHousehold: async (code) => unwrap(await db.rpc('join_household', { p_code: code })),
    setIdentity: async (name, animal) => { unwrap(await db.rpc('set_identity', { p_name: name, p_animal: animal })); },
    // The SQL function accepts null (clears the name); the generated type doesn't say so.
    setMonzoMe: async (username) => { unwrap(await db.rpc('set_monzo_me', { p_username: username as string })); },
    requestChange: async (kind, payload) => must(await db.rpc('request_change', { p_kind: kind, p_payload: payload }), 'request_change'),
    decideChange: async (id, approve) => { unwrap(await db.rpc('decide_change', { p_id: id, p_approve: approve })); },
    postDueRecurring: async () => unwrap(await db.rpc('post_due_recurring', {})) ?? 0,
    recurring: async (hid) => unwrap(await db.from('recurring').select('*').eq('household_id', hid).order('start_date')) ?? [],
    inboxItems: async (hid) => unwrap(await db.from('inbox_items').select('*').eq('household_id', hid).order('created_at')) ?? [],
    upsertRecurring: async (row, columns) => {
      if (columns) {
        // Only these columns: a stale phone pausing or editing never writes back the partner's other changes.
        const patch = Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<RecurringWrite>;
        const updated = await db.from('recurring').update(patch).eq('id', row.id).select().maybeSingle();
        if (updated.error || updated.data) return must(updated, 'regular payment');
      }
      return must(await db.from('recurring').upsert(row, { onConflict: 'id' }).select().single(), 'regular payment');
    },
    patchInboxItem: async (id, patch) => must(await db.from('inbox_items').update(patch).eq('id', id).select().single(), 'inbox item'),
    upsertCategory: async (row) => must(await db.from('categories').upsert(row, { onConflict: 'id' }).select().single(), 'category'),
    comments: async (hid) => allRows<CommentRow>((from, to) => db.from('comments').select('*').eq('household_id', hid).order('created_at').range(from, to)),
    upsertComment: async (row, columns) => {
      if (columns) {
        const patch = Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<CommentWrite>;
        const updated = await db.from('comments').update(patch).eq('id', row.id).select().maybeSingle();
        if (updated.error || updated.data) return must(updated, 'comment');
      }
      return must(await db.from('comments').upsert(row, { onConflict: 'id' }).select().single(), 'comment');
    },
    setSettleDay: async (day) => { unwrap(await db.rpc('set_settle_day', { p_day: day as number })); },
    chapters: async (hid) => unwrap(await db.from('chapters').select('*').eq('household_id', hid).order('created_at')) ?? [],
    upsertChapter: async (row, columns) => {
      if (columns) {
        const patch = Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<ChapterWrite>;
        const updated = await db.from('chapters').update(patch).eq('id', row.id).select().maybeSingle();
        if (updated.error || updated.data) return must(updated, 'chapter');
      }
      return must(await db.from('chapters').upsert(row, { onConflict: 'id' }).select().single(), 'chapter');
    },
    watchHousehold(householdId, onChange, onStatus) {
      // A topic of its own each time: supabase-js hands back an existing channel with the same topic, so a
      // follow right after a stop (whose removal is still in flight) would get the closing one.
      // `wait`: "subscribed" only once the server is really listening for row changes, not merely joined
      // (realtime-js docs: SUBSCRIBED can otherwise come before the replication stream is live).
      const channel = db.channel(`household:${householdId}:${crypto.randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      });
      for (const table of Object.keys(TABLE_FILTER) as WatchedTable[]) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `${TABLE_FILTER[table]}=eq.${householdId}` }, () => {
          onChange(table);
        });
      }
      channel.subscribe((status) => {
        const s: string = status;
        onStatus(s === 'SUBSCRIBED' ? 'subscribed' : s === 'CLOSED' ? 'closed' : 'error');
      });
      return () => { void db.removeChannel(channel); };
    },
  };
}
