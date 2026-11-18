/**
 * The Api in memory: demo mode serves the seeded household from it (writes change the in-memory copy), and
 * tests use it as the fake backend. It refuses what the database refuses (check_money via validateEntry,
 * the RPCs' own checks), and `controls` lets a test go offline, refuse a call, or play the partner.
 * It holds no data of its own: the demo's seed is passed in, so none of it reaches the production bundle.
 */
import { todayIn, type IsoDate } from '../core/dates';
import { pence, type Pence } from '../core/money';
import { occurrence } from '../core/recurring';
import { validateEntry, type EntryIssue, type PenceMap, type SplitMode, type UserId } from '../core/split';
import {
  ApiError,
  type ActivityRow, type Api, type AuthUser, type CategoryMemoryRow, type CategoryRow, type ChangeRequestRow, type ChannelStatus, type ExpenseRow,
  type ChapterRow, type CommentRow, type ExpenseWrite, type HouseholdRow, type ImportIgnoreRow, type ImportRuleRow, type InboxItemRow, type MemberRow, type RecapRow,
  type RecurringRow, type RestoreCounts, type RestoreRows, type RestoreTable, type SettlementRow, type SettlementWrite, type WatchedTable,
  type NotificationPrefsPatch, type NotificationPrefsRow,
} from './api';
import type { Json } from './database.types';

export interface MemoryTables {
  households: HouseholdRow[];
  members: MemberRow[];
  categories: CategoryRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  changeRequests: ChangeRequestRow[];
  activity: ActivityRow[];
  categoryMemory: CategoryMemoryRow[];
  /** S3: regular payments and the Inbox. */
  recurring: RecurringRow[];
  inboxItems: InboxItemRow[];
  /** S4a: chapters (trips and projects). */
  chapters: ChapterRow[];
  /** S5b: comments on entries. */
  comments: CommentRow[];
  /** S6b: a finished month's AI wording, kept once per household. */
  recaps?: RecapRow[];
  /** S6a: receipt photos in the private bucket (what was uploaded, not the bytes). */
  receipts?: { path: string; size: number; type: string }[];
  /** S7 (IMP-3): hashes of bank rows decided "Not ours", and the "always do this" rules. */
  importIgnores?: ImportIgnoreRow[];
  importRules?: ImportRuleRow[];
  /** S8 (NOT-1): push_public_key() (null until the push function has made one), the subscriptions, the switches. */
  pushPublicKey?: string | null;
  pushSubscriptions?: { user_id: string; endpoint: string; p256dh: string; auth: string }[];
  notificationPrefs?: NotificationPrefsRow[];
  minClientVersion: string | null;
}

/** The push services browsers use (save_push_subscription's allowlist, the migration's push_endpoint_ok). */
function pushEndpointOk(endpoint: string): boolean {
  const host = /^https:\/\/([^/:?#\s]+)\//.exec(endpoint)?.[1] ?? '';
  return endpoint.length <= 2048
    && /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)$/.test(host);
}

/** notification_prefs' column defaults (the migration). */
const PREF_SWITCHES = ['entries', 'settle_ups', 'comments', 'bills_today', 'bills_tomorrow', 'recap', 'balance'] as const;
function defaultPrefs(userId: string, at: string): NotificationPrefsRow {
  return {
    user_id: userId, entries: true, settle_ups: true, comments: true, bills_today: true, bills_tomorrow: false, recap: true, balance: false,
    balance_threshold_pence: 10000, updated_at: at,
  };
}

export interface MemoryCall { name: string; arg: unknown }

export interface MemoryControls {
  tables: MemoryTables;
  /** false: every call fails as if there were no connection. */
  online: boolean;
  /** Return a message to refuse a call (as the server would), or null to let it through. */
  refuse: ((name: string, arg: unknown) => string | null) | null;
  /** How long the "server" takes to answer this call, in ms (to test ordering under uneven latency). */
  delay: ((name: string, arg: unknown) => number) | null;
  /** Return true to apply a call on the "server" but lose its response (the connection drops on the way back). */
  dropResponse: ((name: string, arg: unknown) => boolean) | null;
  /** Every call that reached the "server", in order. */
  calls: MemoryCall[];
  /** The code `verifyCode` accepts. */
  code: string;
  /** Tell the app a table changed, as Realtime would. */
  emitChange(table: WatchedTable): void;
  /** Make the channel report a status (e.g. 'subscribed' again after a reconnect). */
  emitStatus(status: ChannelStatus): void;
  /** Resolves when every call made so far has finished. */
  settle(): Promise<void>;
  /** Who the "server" sees as signed in (another account on the same phone, in tests). */
  signInAs(user: AuthUser | null): void;
}

const DEFAULT_CATEGORIES: readonly [string, string, string][] = [
  ['Groceries', '🛒', 'moss'], ['Eating out', '🍜', 'amber'], ['Rent & bills', '🏠', 'walnut'], ['Utilities', '💡', 'honey'],
  ['Transport', '🚆', 'slate'], ['Subscriptions', '📺', 'plum'], ['Household', '🧺', 'oak'], ['Going out', '🍸', 'berry'],
  ['Travel', '✈️', 'lake'], ['Gifts', '🎁', 'clay'], ['Health', '💊', 'fern'], ['Other', '•', 'stone'],
];

/** The palette names a category may use (migration 6, DESIGN §3.1). */
const PALETTE: readonly string[] = ['moss', 'amber', 'walnut', 'honey', 'slate', 'plum', 'oak', 'berry', 'lake', 'clay', 'fern', 'stone'];

/** What the database says for each refusal (supabase/schema.sql check_money and the amount checks). */
const SERVER_WORDS: Record<EntryIssue, string> = {
  amount: 'new row violates check constraint "expenses_amount_pence_check"',
  wholePence: 'amounts must be whole pence',
  sharesSum: 'shares must sum to amount',
  paidSum: 'paid must sum to amount',
  negative: 'amounts must not be negative',
  members: 'paid or shares name a non-member',
  forOther: 'paid-for-the-other: one person pays and owes nothing',
  treat: 'treat: whoever pays covers it',
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

function toPenceMap(j: Json): PenceMap {
  const out: Record<string, Pence> = {};
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    for (const [k, v] of Object.entries(j)) out[k] = pence(typeof v === 'number' ? v : Number.NaN);
  }
  return out;
}

export function createMemoryApi(
  seed: Partial<MemoryTables> = {},
  opts: { user?: AuthUser | null; latencyMs?: number; now?: () => Date; today?: () => IsoDate } = {},
): { api: Api; controls: MemoryControls } {
  const now = opts.now ?? (() => new Date());
  const tables: MemoryTables = {
    households: clone(seed.households ?? []),
    members: clone(seed.members ?? []),
    categories: clone(seed.categories ?? []),
    expenses: clone(seed.expenses ?? []),
    settlements: clone(seed.settlements ?? []),
    changeRequests: clone(seed.changeRequests ?? []),
    activity: clone(seed.activity ?? []),
    categoryMemory: clone(seed.categoryMemory ?? []),
    recurring: clone(seed.recurring ?? []),
    inboxItems: clone(seed.inboxItems ?? []),
    chapters: clone(seed.chapters ?? []),
    comments: clone(seed.comments ?? []),
    recaps: clone(seed.recaps ?? []),
    importIgnores: clone(seed.importIgnores ?? []),
    importRules: clone(seed.importRules ?? []),
    pushPublicKey: seed.pushPublicKey ?? null,
    pushSubscriptions: clone(seed.pushSubscriptions ?? []),
    notificationPrefs: clone(seed.notificationPrefs ?? []),
    minClientVersion: seed.minClientVersion ?? null,
  };
  /** The server's UK date (DAT-2: post_due_recurring posts by London's date). */
  const today = opts.today ?? (() => todayIn(now(), 'Europe/London'));
  let user: AuthUser | null = opts.user ?? null;
  const watchers = new Set<{ householdId: string; onChange: (t: WatchedTable) => void; onStatus: (s: ChannelStatus) => void }>();
  const inflight = new Set<Promise<unknown>>();
  let activityId = 1;

  const controls: MemoryControls = {
    tables,
    online: true,
    refuse: null,
    delay: null,
    dropResponse: null,
    calls: [],
    code: '123456',
    emitChange(table) {
      for (const w of watchers) w.onChange(table);
    },
    emitStatus(status) {
      for (const w of watchers) w.onStatus(status);
    },
    async settle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
    signInAs(u) {
      user = u;
    },
  };

  /** One "server" call: checks the connection and the refusal hook, then runs `fn` on the tables. */
  function call<T>(name: string, arg: unknown, fn: () => T): Promise<T> {
    const p = (async () => {
      const wait = controls.delay?.(name, arg) ?? opts.latencyMs ?? 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      else await Promise.resolve();
      if (!controls.online) throw new ApiError('network', 'TypeError: Failed to fetch', 0);
      controls.calls.push({ name, arg: clone(arg) });
      const refusal = controls.refuse?.(name, arg) ?? null;
      if (refusal !== null) throw new ApiError('refused', refusal, 400, 'P0001');
      const out = clone(fn());
      if (controls.dropResponse?.(name, arg)) throw new ApiError('network', 'TypeError: Failed to fetch', 0);
      return out;
    })();
    inflight.add(p);
    void p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  }

  const me = (): AuthUser => {
    if (!user) throw new ApiError('auth', 'not signed in', 401);
    return user;
  };
  const myMember = () => tables.members.find((m) => m.user_id === me().userId) ?? null;
  const myHousehold = () => myMember()?.household_id ?? null;
  const mine = <R extends { household_id: string }>(rows: R[]) => rows.filter((r) => r.household_id === myHousehold());
  const refuse = (message: string, code = 'P0001'): never => { throw new ApiError('refused', message, 400, code); };

  function log(entity: string, id: string, action: string, summary: Json, householdId: string) {
    tables.activity.push({ id: activityId++, household_id: householdId, actor: user?.userId ?? null, entity, entity_id: id, action, summary: summary ?? {}, at: now().toISOString() });
  }

  /**
   * What the recurring_guard trigger does (migration 8): a new rhythm or start on a template that has posted
   * applies from its next occurrence (posted days never move); a resumed template skips what fell due while it
   * was paused.
   */
  function guardRecurring(old: RecurringRow, next: RecurringRow): RecurringRow {
    const out = { ...next };
    const sched = (r: RecurringRow) => ({ frequency: r.frequency as 'weekly' | 'monthly' | 'yearly', every: r.every, startDate: r.start_date, endDate: null });
    if (old.posted_count > 0 && (out.frequency !== old.frequency || out.every !== old.every || out.start_date !== old.start_date)) {
      const nxt = occurrence(sched(old), old.posted_count);
      out.start_date = out.start_date > nxt ? out.start_date : nxt;
      out.posted_count = 0;
    }
    if (!old.active && out.active) {
      const t = today();
      for (let n = 0; n < 10000 && occurrence(sched(out), out.posted_count) < t; n += 1) out.posted_count += 1;
    }
    return out;
  }

  /** What changed, as the database's log_activity trigger records it: { field: { before, after } }. */
  function diff(before: object, after: object): Json {
    const out: Record<string, Json> = {};
    const o = before as Record<string, Json>;
    const n = after as Record<string, Json>;
    for (const k of Object.keys(n)) {
      if (k === 'updated_at' || k === 'updated_by') continue;
      if (JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null)) out[k] = { before: o[k] ?? null, after: n[k] ?? null };
    }
    return out;
  }

  function checkMoney(row: ExpenseRow) {
    const ids = tables.members.filter((m) => m.household_id === row.household_id).map((m) => m.user_id);
    const [a, b] = ids;
    if (a === undefined || b === undefined) refuse('paid or shares name a non-member');
    const members = [a, b] as readonly [UserId, UserId];
    let paid: PenceMap;
    let shares: PenceMap;
    try {
      paid = toPenceMap(row.paid);
      shares = toPenceMap(row.shares);
    } catch {
      return refuse('amounts must be whole pence');
    }
    const errors = validateEntry({ amount: row.amount_pence as Pence, paid, shares, mode: row.split_mode as SplitMode, members });
    if (errors.length > 0) refuse(errors.map((e) => SERVER_WORDS[e]).join('; '));
  }

  function writeRow<R extends { id: string; household_id: string; updated_at: string; deleted_at: string | null }>(
    list: R[], write: Partial<R> & { id: string; household_id: string }, entity: string, fill: (w: typeof write) => R, check?: (r: R) => void,
  ): R {
    if (write.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
    const i = list.findIndex((r) => r.id === write.id);
    const stamp = now().toISOString();
    const existing = i === -1 ? undefined : list[i];
    if (existing && existing.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
    const next: R = existing ? { ...existing, ...write, updated_at: stamp } : fill(write);
    check?.(next);
    if (existing) list[i] = next;
    else list.push(next);
    log(entity, next.id, existing ? 'edited' : 'created', existing ? diff(existing, next) : { after: next as unknown as Json }, next.household_id);
    return next;
  }

  function patchRow<R extends { id: string; household_id: string; updated_at: string; deleted_at: string | null }>(
    list: R[], id: string, patch: { deleted_at: string | null }, entity: string,
  ): R {
    const i = list.findIndex((r) => r.id === id && r.household_id === myHousehold());
    const existing = list[i];
    if (!existing) return refuse('JSON object requested, multiple (or no) rows returned', 'PGRST116');
    const next: R = { ...existing, ...patch, updated_at: now().toISOString() };
    list[i] = next;
    const action = existing.deleted_at === null && patch.deleted_at !== null ? 'deleted' : existing.deleted_at !== null && patch.deleted_at === null ? 'restored' : 'edited';
    const named = next as unknown as Record<string, Json>;
    log(entity, id, action, action === 'edited' ? diff(existing, next) : { description: named['description'] ?? null, amount_pence: named['amount_pence'] ?? null }, next.household_id);
    return next;
  }

  /** What post_due_recurring() does (migration 6): each due occurrence once, at home, by the UK date. */
  function postDue(): number {
    const hid = myHousehold();
    if (!hid) return 0;
    const home = tables.households.find((h) => h.id === hid)?.home_country ?? 'GB';
    const uk = today();
    let posted = 0;
    for (const r of tables.recurring) {
      if (r.household_id !== hid || !r.active) continue;
      const schedule = { frequency: r.frequency as 'weekly' | 'monthly' | 'yearly', every: r.every, startDate: r.start_date, endDate: r.end_date };
      for (;;) {
        const d = occurrence(schedule, r.posted_count);
        if (d > uk || (r.end_date !== null && d > r.end_date)) break;
        const stamp = now().toISOString();
        if (r.amount_varies) {
          if (!tables.inboxItems.some((x) => x.recurring_id === r.id && x.occurrence_date === d)) {
            tables.inboxItems.push({
              id: crypto.randomUUID(), household_id: hid, source: 'bill', status: 'open', receipt_path: null, recurring_id: r.id,
              occurrence_date: d, external_id: null, expense_id: null, created_by: null, created_at: stamp, updated_at: stamp,
              payload: { description: r.description, estimate_pence: r.amount_pence, date: d, category_id: r.category_id },
            });
          }
        } else if (!tables.expenses.some((e) => e.recurring_id === r.id && e.occurrence_date === d)) {
          const id = crypto.randomUUID();
          tables.expenses.push({
            id, household_id: hid, kind: 'expense', description: r.description, amount_pence: r.amount_pence, date: d,
            category_id: r.category_id, chapter_id: null, paid: r.paid, paid_via: r.paid_via, split_mode: r.split_mode,
            split_params: r.split_params, shares: r.shares, notes: r.notes, tags: [], country: home, refund_of: null, source: 'recurring',
            items: null, bill_total_pence: null, place: null, lat: null, lng: null, original_amount: null, original_currency: null,
            fx_rate: null, receipt_path: null, category_guess: false, external_id: null, merchant: null, external_category: null, account_id: null,
            recurring_id: r.id, occurrence_date: d, created_by: r.created_by, created_at: stamp, updated_by: r.created_by,
            updated_at: stamp, deleted_at: null,
          });
          log('expense', id, 'created', { after: { description: r.description, amount_pence: r.amount_pence } }, hid);
        }
        r.posted_count += 1;
        posted += 1;
      }
    }
    return posted;
  }

  const ignores = () => (tables.importIgnores ??= []);
  const rules = () => (tables.importRules ??= []);
  /** restore_ids: a backup row's id that another household already had, and the id it was given here. */
  const restoreIds = new Map<string, string>();

  /** What restore_backup() does (migration …_import_export.sql): only adds; ids here are left alone. */
  /** restore_backup is one transaction: a refused part undoes the call, and the error names that part. */
  function restore(people: Record<string, string>, rows: RestoreRows): RestoreCounts {
    const lengths = {
      categories: tables.categories.length, chapters: tables.chapters.length, recurring: tables.recurring.length, expenses: tables.expenses.length,
      settlements: tables.settlements.length, comments: tables.comments.length, categoryMemory: tables.categoryMemory.length, importRules: rules().length,
      activity: tables.activity.length,
    };
    const part = { name: '' };
    try {
      return restoreRows(people, rows, part);
    } catch (err) {
      for (const [k, n] of Object.entries(lengths)) (k === 'importRules' ? rules() : (tables[k as keyof typeof lengths & keyof MemoryTables] as unknown[])).length = n;
      if (part.name !== '' && err instanceof ApiError) throw new ApiError(err.kind, `restore ${part.name}: ${err.message}`, err.status, err.code);
      throw err;
    }
  }

  function restoreRows(people: Record<string, string>, rows: RestoreRows, part: { name: string }): RestoreCounts {
    const hid = myHousehold();
    if (!hid) return refuse('not in a household', '42501');
    const memberIds = mine(tables.members).map((m) => m.user_id).sort();
    if (memberIds.length !== 2) refuse('both of you need to have joined before restoring', '22023');
    const mapped = [...new Set(Object.values(people))].sort();
    if (Object.keys(people).length !== 2 || JSON.stringify(mapped) !== JSON.stringify(memberIds)) refuse('map the backup\'s two people to the two of you', '22023');
    const order: RestoreTable[] = ['categories', 'chapters', 'recurring', 'expenses', 'settlements', 'comments', 'category_memory', 'import_rules'];
    let n = 0;
    for (const t of order) n += rows[t]?.length ?? 0;
    if (n > 500) refuse('at most 500 rows a call', '22023');
    const added: Record<RestoreTable, number> = { categories: 0, chapters: 0, recurring: 0, expenses: 0, settlements: 0, comments: 0, category_memory: 0, import_rules: 0 };
    const skipped: Record<RestoreTable, number> = { ...added };
    const remap = (j: Json): Json => {
      if (!j || typeof j !== 'object' || Array.isArray(j)) return j;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [people[k] ?? k, v ?? null]));
    };
    type Listed = { id: string; household_id: string };
    const lists: Record<'categories' | 'chapters' | 'recurring' | 'expenses' | 'settlements' | 'comments', Listed[]> = {
      categories: tables.categories, chapters: tables.chapters, recurring: tables.recurring, expenses: tables.expenses, settlements: tables.settlements, comments: tables.comments,
    };
    /** The id a backup row already has in this household (itself, or the id it was given before), else null. */
    const target = (old: unknown, t: keyof typeof lists): string | null => {
      if (typeof old !== 'string') return null;
      if (lists[t].some((r) => r.id === old && r.household_id === hid)) return old;
      const given = restoreIds.get(`${hid}:${old}`);
      return given !== undefined && lists[t].some((r) => r.id === given && r.household_id === hid) ? given : null;
    };
    const newId = (old: unknown, t: keyof typeof lists): string => {
      if (typeof old !== 'string') return crypto.randomUUID();
      if (!lists[t].some((r) => r.id === old)) return old;
      const fresh = crypto.randomUUID();
      restoreIds.set(`${hid}:${old}`, fresh);
      return fresh;
    };
    const ref = (old: unknown, t: keyof typeof lists) => target(old, t);
    const str = (v: Json | undefined, or = ''): string => (typeof v === 'string' ? v : or);
    const objects = (t: RestoreTable) => (rows[t] ?? []).filter((r): r is Record<string, Json> => !!r && typeof r === 'object' && !Array.isArray(r));
    const stamp = now().toISOString();

    /** A backup person's id as this household's member, or the person restoring (as stamp_author does). */
    const author = (v: Json | undefined): string => {
      const mapped = people[str(v)] ?? str(v);
      return memberIds.includes(mapped) ? mapped : me().userId;
    };
    const checkSplit = (mode: Json | undefined, params: Json) => {
      if (mode !== undefined && mode !== null && !['ratio', 'exact', 'for_other', 'treat'].includes(str(mode))) refuse(`unknown split ${str(mode)}`, '22023');
      if (params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).some((k) => !memberIds.includes(k))) {
        refuse('a split names someone who isn\'t one of you', '22023');
      }
    };
    part.name = 'categories';
    for (const r of objects('categories')) {
      if (target(r['id'], 'categories') !== null) { skipped.categories += 1; continue; }
      const name = str(r['name']).trim().toLowerCase();
      const same = mine(tables.categories).find((c) => c.name.trim().toLowerCase() === name);
      if (same) { if (typeof r['id'] === 'string') restoreIds.set(`${hid}:${r['id']}`, same.id); skipped.categories += 1; continue; }
      const row = { ...(r as unknown as CategoryRow), id: newId(r['id'], 'categories'), household_id: hid, default_ratio: remap(r['default_ratio'] ?? null) };
      if (!PALETTE.includes(row.colour)) refuse('new row violates check constraint "categories_colour_palette"', '23514');
      tables.categories.push(row);
      log('category', row.id, 'created', { after: row as unknown as Json }, hid);
      added.categories += 1;
    }
    part.name = 'chapters';
    for (const r of objects('chapters')) {
      if (target(r['id'], 'chapters') !== null) { skipped.chapters += 1; continue; }
      const row = { ...(r as unknown as ChapterRow), id: newId(r['id'], 'chapters'), household_id: hid, created_by: author(r['created_by']) };
      tables.chapters.push(row);
      log('chapter', row.id, 'created', { after: row as unknown as Json }, hid);
      added.chapters += 1;
    }
    part.name = 'recurring';
    for (const r of objects('recurring')) {
      if (target(r['id'], 'recurring') !== null) { skipped.recurring += 1; continue; }
      const row: RecurringRow = {
        ...(r as unknown as RecurringRow), id: newId(r['id'], 'recurring'), household_id: hid, active: false,
        category_id: ref(r['category_id'], 'categories'), paid: remap(r['paid'] ?? {}) ?? {}, shares: remap(r['shares'] ?? {}) ?? {},
        split_params: remap(r['split_params'] ?? null), created_by: author(r['created_by']),
      };
      checkMoney(row as unknown as ExpenseRow);
      tables.recurring.push(row);
      log('recurring', row.id, 'created', { after: row as unknown as Json }, hid);
      added.recurring += 1;
    }
    part.name = 'expenses';
    const expenses = objects('expenses').sort((x, y) => Number(x['kind'] === 'money_back') - Number(y['kind'] === 'money_back') || str(x['created_at']).localeCompare(str(y['created_at'])));
    for (const r of expenses) {
      if (target(r['id'], 'expenses') !== null) { skipped.expenses += 1; continue; }
      const recurringId = ref(r['recurring_id'], 'recurring');
      const receipt = typeof r['receipt_path'] === 'string' && r['receipt_path'].split('/')[0] === hid ? r['receipt_path'] : null;
      const row: ExpenseRow = {
        ...(r as unknown as ExpenseRow), id: newId(r['id'], 'expenses'), household_id: hid, category_id: ref(r['category_id'], 'categories'),
        chapter_id: ref(r['chapter_id'], 'chapters'), recurring_id: recurringId, refund_of: ref(r['refund_of'], 'expenses'), account_id: null,
        receipt_path: receipt, paid: remap(r['paid'] ?? {}) ?? {}, shares: remap(r['shares'] ?? {}) ?? {}, split_params: remap(r['split_params'] ?? null),
        occurrence_date: recurringId === null ? null : ((r['occurrence_date'] as string | null | undefined) ?? null),
        created_by: author(r['created_by']), updated_by: author(r['updated_by'] ?? r['created_by']),
        // A backup from before S6a has no category_guess (review fix 1): the column's default.
        category_guess: r['category_guess'] === true,
      };
      checkMoney(row);
      const clash = (row.recurring_id !== null && tables.expenses.some((e) => e.recurring_id === row.recurring_id && e.occurrence_date === row.occurrence_date))
        || (row.external_id !== null && tables.expenses.some((e) => e.household_id === hid && e.source === row.source && e.external_id === row.external_id));
      if (clash) { skipped.expenses += 1; continue; } // on conflict do nothing
      tables.expenses.push(row);
      log('expense', row.id, 'created', { after: row as unknown as Json }, hid);
      added.expenses += 1;
    }
    part.name = 'settlements';
    for (const r of objects('settlements')) {
      if (target(r['id'], 'settlements') !== null) { skipped.settlements += 1; continue; }
      const from = people[str(r['from_user'])] ?? str(r['from_user']);
      const to = people[str(r['to_user'])] ?? str(r['to_user']);
      if (!memberIds.includes(from) || !memberIds.includes(to)) refuse('a settle-up names someone who isn\'t one of you', '22023');
      const row: SettlementRow = {
        ...(r as unknown as SettlementRow), id: newId(r['id'], 'settlements'), household_id: hid, from_user: from, to_user: to, created_by: author(r['created_by']),
      };
      if (row.from_user === row.to_user || row.amount_pence <= 0) refuse('new row violates check constraint "settlements_check"', '23514');
      tables.settlements.push(row);
      log('settlement', row.id, 'created', { after: row as unknown as Json }, hid);
      added.settlements += 1;
    }
    part.name = 'comments';
    for (const r of objects('comments')) {
      const expenseId = ref(r['expense_id'], 'expenses');
      if (target(r['id'], 'comments') !== null || expenseId === null) { skipped.comments += 1; continue; }
      const author = people[str(r['author'])] ?? str(r['author']);
      if (!memberIds.includes(author)) refuse('a comment names someone who isn\'t one of you', '22023');
      const row: CommentRow = { ...(r as unknown as CommentRow), id: newId(r['id'], 'comments'), household_id: hid, expense_id: expenseId, author };
      tables.comments.push(row);
      log('comment', row.id, 'created', { after: row as unknown as Json }, hid);
      added.comments += 1;
    }
    part.name = 'category_memory';
    for (const r of objects('category_memory')) {
      checkSplit(r['split_mode'], remap(r['split_params'] ?? null));
      const key = str(r['key']);
      if (tables.categoryMemory.some((m) => m.household_id === hid && m.key === key)) { skipped.category_memory += 1; continue; }
      tables.categoryMemory.push({
        household_id: hid, key, category_id: ref(r['category_id'], 'categories'), split_mode: (r['split_mode'] as string | null | undefined) ?? null,
        split_params: remap(r['split_params'] ?? null), uses: typeof r['uses'] === 'number' ? r['uses'] : 1,
        source: typeof r['source'] === 'string' ? r['source'] : 'user', updated_at: typeof r['updated_at'] === 'string' ? r['updated_at'] : stamp,
      });
      added.category_memory += 1;
    }
    part.name = 'import_rules';
    for (const r of objects('import_rules')) {
      // A skip rule is one person's, kept on their phone: never restored into the shared record.
      if (r['decision'] !== 'keep') { skipped.import_rules += 1; continue; }
      checkSplit(r['split_mode'], remap(r['split_params'] ?? null));
      const match = str(r['match_text']);
      if (rules().some((x) => x.household_id === hid && x.match_text === match)) { skipped.import_rules += 1; continue; }
      rules().push({
        id: crypto.randomUUID(), household_id: hid, match_text: match, decision: 'keep', category_id: ref(r['category_id'], 'categories'),
        split_mode: (r['split_mode'] as string | null | undefined) ?? null, split_params: remap(r['split_params'] ?? null), created_at: stamp,
      });
      added.import_rules += 1;
    }
    part.name = '';
    return { added, skipped };
  }

  const api: Api = {
    auth: {
      sendCode: (email) => call('auth.sendCode', email, () => undefined),
      verifyCode: (email, code) =>
        call('auth.verifyCode', { email, code }, () => {
          if (code !== controls.code) return refuse('Token has expired or is invalid', 'otp_expired');
          const u: AuthUser = { userId: user?.userId ?? crypto.randomUUID(), email };
          user = u;
          return u;
        }),
      signOut: () => call('auth.signOut', null, () => { user = null; }),
    },
    membership: (userId) => call('membership', userId, () => tables.members.find((m) => m.user_id === userId) ?? null),
    household: (hid) => call('household', hid, () => tables.households.find((h) => h.id === hid && h.id === myHousehold()) ?? null),
    members: (hid) => call('members', hid, () => mine(tables.members).sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1))),
    categories: (hid) => call('categories', hid, () => mine(tables.categories).sort((a, b) => a.sort - b.sort)),
    expenses: (hid) => call('expenses', hid, () => mine(tables.expenses)),
    settlements: (hid) => call('settlements', hid, () => mine(tables.settlements)),
    changeRequests: (hid) => call('changeRequests', hid, () => mine(tables.changeRequests)),
    activity: (_hid, entityId) =>
      call('activity', entityId, () => mine(tables.activity).filter((a) => a.entity_id === entityId).reverse()),
    categoryMemory: (hid) => call('categoryMemory', hid, () => mine(tables.categoryMemory)),
    upsertCategoryMemory: (row) =>
      call('upsertCategoryMemory', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        if (row.category_id !== null && !mine(tables.categories).some((c) => c.id === row.category_id)) {
          refuse('insert or update on table "category_memory" violates foreign key constraint', '23503');
        }
        const next: CategoryMemoryRow = { ...row, updated_at: now().toISOString() };
        const i = tables.categoryMemory.findIndex((m) => m.household_id === row.household_id && m.key === row.key);
        if (i === -1) tables.categoryMemory.push(next);
        else tables.categoryMemory[i] = next;
        return next;
      }),
    upsertExpense: (row: ExpenseWrite) =>
      call('upsertExpense', row, () =>
        writeRow(tables.expenses, row, 'expense', (w) => ({
          merchant: null, external_category: null, account_id: null,
          created_by: me().userId, created_at: now().toISOString(), updated_by: me().userId,
          updated_at: now().toISOString(), deleted_at: null, ...(w as ExpenseWrite),
        }), (r) => {
          checkMoney(r);
          // check_entry_chapter (migration 9): an entry's chapter is one of its own household's.
          if (r.chapter_id !== null && !tables.chapters.some((c) => c.id === r.chapter_id && c.household_id === r.household_id)) {
            refuse('that chapter is not one of yours', '23503');
          }
          if (r.recurring_id !== null && tables.expenses.some((e) => e.id !== r.id && e.recurring_id === r.recurring_id && e.occurrence_date === r.occurrence_date)) {
            refuse('duplicate key value violates unique constraint "expenses_occurrence"', '23505');
          }
          // S7 (IMP-3): a bank row is imported once per household and source (deleted entries count).
          if (r.external_id !== null && tables.expenses.some((e) => e.id !== r.id && e.household_id === r.household_id && e.source === r.source && e.external_id === r.external_id)) {
            refuse('duplicate key value violates unique constraint "expenses_external"', '23505');
          }
        })),
    patchExpense: (id, patch) => call('patchExpense', { id, patch }, () => patchRow(tables.expenses, id, patch, 'expense')),
    upsertSettlement: (row: SettlementWrite) =>
      call('upsertSettlement', row, () =>
        writeRow(tables.settlements, row, 'settlement', (w) => ({
          created_by: me().userId, created_at: now().toISOString(), updated_at: now().toISOString(), deleted_at: null, ...(w as SettlementWrite),
        }), (r) => {
          if (r.from_user === r.to_user || r.amount_pence <= 0) refuse('new row violates check constraint "settlements_check"', '23514');
        })),
    patchSettlement: (id, patch) => call('patchSettlement', { id, patch }, () => patchRow(tables.settlements, id, patch, 'settlement')),
    createHousehold: () =>
      call('createHousehold', null, () => {
        if (myMember()) refuse('already in a household');
        const id = crypto.randomUUID();
        const stamp = now().toISOString();
        tables.households.push({
          id, join_code: crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), home_country: 'GB', default_ratio: null,
          joint_enabled: false, joint_ratio: null, settle_day: null, created_at: stamp,
        });
        tables.members.push({ household_id: id, user_id: me().userId, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: stamp });
        DEFAULT_CATEGORIES.forEach(([name, emoji, colour], i) => {
          tables.categories.push({ id: crypto.randomUUID(), household_id: id, name, emoji, colour, default_ratio: null, archived: false, sort: i + 1, updated_at: stamp });
        });
        return id;
      }),
    joinHousehold: (code) =>
      call('joinHousehold', code, () => {
        if (myMember()) refuse('already in a household');
        const h = tables.households.find((x) => x.join_code === code.trim().toUpperCase());
        if (!h) return null;
        if (tables.members.filter((m) => m.household_id === h.id).length >= 2) refuse('this household already has two people');
        tables.members.push({ household_id: h.id, user_id: me().userId, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: now().toISOString() });
        return h.id;
      }),
    setIdentity: (name, animal) =>
      call('setIdentity', { name, animal }, () => {
        const m = myMember();
        if (!m) return refuse('not in a household');
        if (m.locked_at) refuse('already set; request a change instead');
        if (mine(tables.members).some((x) => x.user_id !== m.user_id && x.animal === animal)) refuse(`your partner already picked the ${animal}`);
        Object.assign(m, { display_name: name.trim(), animal, locked_at: now().toISOString() });
      }),
    setMonzoMe: (username) =>
      call('setMonzoMe', username, () => {
        if (username !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(username)) refuse('that does not look like a monzo.me name');
        const m = myMember();
        if (m) m.monzo_me = username;
      }),
    requestChange: (kind, payload) =>
      call('requestChange', { kind, payload }, () => {
        const hid = myHousehold();
        if (!hid) return refuse('not in a household');
        if (mine(tables.members).length < 2) refuse('your partner has not joined yet');
        if (tables.changeRequests.some((c) => c.household_id === hid && c.kind === kind && c.status === 'pending')) {
          refuse('duplicate key value violates unique constraint "change_requests_one_pending"', '23505');
        }
        const id = crypto.randomUUID();
        tables.changeRequests.push({ id, household_id: hid, requested_by: me().userId, kind, payload: payload ?? {}, status: 'pending', decided_by: null, created_at: now().toISOString(), decided_at: null });
        return id;
      }),
    decideChange: (id, approve) =>
      call('decideChange', { id, approve }, () => {
        const cr = tables.changeRequests.find((c) => c.id === id && c.household_id === myHousehold());
        if (!cr || cr.status !== 'pending') return refuse('no pending request');
        const stamp = now().toISOString();
        if (cr.requested_by === me().userId) {
          if (approve) refuse('your partner has to approve this');
          Object.assign(cr, { status: 'cancelled', decided_by: me().userId, decided_at: stamp });
          return;
        }
        if (approve) {
          const p = cr.payload as Record<string, Json>;
          if (cr.kind === 'identity') {
            const target = tables.members.find((m) => m.household_id === cr.household_id && m.user_id === p['user_id']);
            const other = tables.members.find((m) => m.household_id === cr.household_id && m.user_id !== p['user_id']);
            if (target) {
              if (other && typeof p['animal'] === 'string' && other.animal === p['animal']) other.animal = target.animal;
              if (typeof p['display_name'] === 'string') target.display_name = p['display_name'].trim();
              if (typeof p['animal'] === 'string') target.animal = p['animal'];
            }
          } else {
            const h = tables.households.find((x) => x.id === cr.household_id);
            if (h) h.default_ratio = p['ratio'] ?? null;
          }
        }
        Object.assign(cr, { status: approve ? 'approved' : 'declined', decided_by: me().userId, decided_at: stamp });
      }),
    postDueRecurring: () => call('postDueRecurring', null, () => postDue()),
    recurring: (hid) => call('recurring', hid, () => mine(tables.recurring).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))),
    inboxItems: (hid) => call('inboxItems', hid, () => mine(tables.inboxItems).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))),
    upsertRecurring: (row, columns) =>
      call('upsertRecurring', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        const i = tables.recurring.findIndex((r) => r.id === row.id);
        const existing = i === -1 ? undefined : tables.recurring[i];
        if (existing && existing.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        const stamp = now().toISOString();
        // The phone never sends posted_count: the server keeps counting where it was (REC-6).
        // A narrowed write (pause, resume, end, an edit) changes only its columns, as the Supabase update does.
        const sent = existing && columns ? Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<RecurringRow> : row;
        let next: RecurringRow = existing
          ? { ...existing, ...sent, updated_at: stamp }
          : { posted_count: 0, created_by: me().userId, created_at: stamp, updated_at: stamp, ...row };
        if (existing) next = guardRecurring(existing, next);
        if (next.amount_pence <= 0 || next.every < 1 || (next.end_date !== null && next.end_date < next.start_date)) {
          refuse('new row violates check constraint "recurring_check"', '23514');
        }
        checkMoney(next as unknown as ExpenseRow);
        if (existing) tables.recurring[i] = next;
        else tables.recurring.push(next);
        log('recurring', next.id, existing ? 'edited' : 'created', existing ? diff(existing, next) : { after: next as unknown as Json }, next.household_id);
        return next;
      }),
    patchInboxItem: (id, patch) =>
      call('patchInboxItem', { id, patch }, () => {
        const i = tables.inboxItems.findIndex((r) => r.id === id && r.household_id === myHousehold());
        const existing = tables.inboxItems[i];
        if (!existing) return refuse('JSON object requested, multiple (or no) rows returned', 'PGRST116');
        // inbox_items.expense_id references expenses: a Keep whose entry was refused can't mark the item kept.
        if (patch.expense_id !== null && !tables.expenses.some((e) => e.id === patch.expense_id)) {
          return refuse('insert or update on table "inbox_items" violates foreign key constraint "inbox_items_expense_id_fkey"', '23503');
        }
        const next: InboxItemRow = { ...existing, ...patch, updated_at: now().toISOString() };
        tables.inboxItems[i] = next;
        log('inbox_item', id, 'edited', diff(existing, next), next.household_id);
        return next;
      }),
    chapters: (hid) => call('chapters', hid, () => mine(tables.chapters).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))),
    comments: (hid) => call('comments', hid, () => mine(tables.comments).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))),
    upsertComment: (row, columns) =>
      call('upsertComment', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        const i = tables.comments.findIndex((r) => r.id === row.id);
        const existing = i === -1 ? undefined : tables.comments[i];
        // comments_upd: only the author; comments_guard: the author and the entry stay.
        if (existing && existing.author !== me().userId) refuse('new row violates row-level security policy for table "comments"', '42501');
        if (!existing && row.author !== me().userId) refuse('new row violates row-level security policy for table "comments"', '42501');
        if (!existing && !tables.expenses.some((e) => e.id === row.expense_id && e.household_id === row.household_id)) refuse('that entry is not one of yours', '23503');
        const sent = existing && columns ? Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<CommentRow> : row;
        const body = (sent.body ?? existing?.body ?? '').trim();
        if (body.length < 1 || body.length > 500) refuse('new row violates check constraint "comments_body_check"', '23514');
        const next: CommentRow = existing
          ? { ...existing, ...sent, author: existing.author, expense_id: existing.expense_id, household_id: existing.household_id }
          : { created_at: now().toISOString(), ...row };
        if (existing) tables.comments[i] = next;
        else tables.comments.push(next);
        const changes = existing ? diff(existing, next) : null;
        if (!existing) log('comment', next.id, 'created', { after: next as unknown as Json }, next.household_id);
        else if (changes && Object.keys(changes as object).length > 0) {
          log('comment', next.id, existing.deleted_at === null && next.deleted_at !== null ? 'deleted' : 'edited', changes, next.household_id);
        }
        return next;
      }),
    recapProse: (hid, period) =>
      call('recapProse', { period }, () => {
        const row = (tables.recaps ?? []).find((r) => r.household_id === hid && hid === myHousehold() && r.period === period);
        return row ? { prose: row.prose, stats: row.stats } : null;
      }),
    saveRecapProse: (period, stats, prose) =>
      call('saveRecapProse', { period, stats, prose }, () => {
        const hid = myHousehold();
        if (!hid) return refuse('not in a household', 'P0001');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period >= today().slice(0, 7)) return refuse('only a finished month has its wording kept', 'P0001');
        if (prose.trim() === '') return refuse('no wording', 'P0001');
        tables.recaps ??= [];
        const kept = tables.recaps.find((r) => r.household_id === hid && r.period === period);
        if (kept) return kept.prose ?? prose;
        tables.recaps.push({ household_id: hid, period, stats: stats ?? {}, prose, created_at: now().toISOString() });
        return prose;
      }),
    uploadReceipt: (path, photo) =>
      call('uploadReceipt', { path, size: photo.size, type: photo.type }, () => {
        if (!path.startsWith(`${myHousehold() ?? '-'}/`)) refuse('new row violates row-level security policy for table "objects"', '42501');
        tables.receipts ??= [];
        if (!tables.receipts.some((r) => r.path === path)) tables.receipts.push({ path, size: photo.size, type: photo.type });
      }),
    receiptUrl: (path) =>
      call('receiptUrl', { path }, () => {
        if (!(tables.receipts ?? []).some((r) => r.path === path) && !path.startsWith(`${myHousehold() ?? '-'}/`)) refuse('Object not found', '404');
        return `https://storage.example/receipts/${path}?token=memory`;
      }),
    insertInboxItem: (row) =>
      call('insertInboxItem', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy for table "inbox_items"', '42501');
        const existing = tables.inboxItems.find((r) => r.id === row.id);
        if (existing) return existing;
        const stamp = now().toISOString();
        const made: InboxItemRow = {
          recurring_id: null, occurrence_date: null, external_id: null, expense_id: null,
          created_by: me().userId, created_at: stamp, updated_at: stamp, ...row,
        };
        tables.inboxItems.push(made);
        return made;
      }),
    setSettleDay: (day) =>
      call('setSettleDay', day, () => {
        const hid = myHousehold();
        const h = tables.households.find((x) => x.id === hid);
        if (!h) return refuse('not in a household');
        if (day !== null && (!Number.isInteger(day) || day < 1 || day > 28)) refuse('pick a day from 1 to 28');
        const was = (h as { settle_day?: number | null }).settle_day ?? null;
        if (was === day) return undefined;
        Object.assign(h, { settle_day: day });
        log('household', h.id, 'edited', { settle_day: { before: was, after: day } }, h.id);
        return undefined;
      }),
    upsertChapter: (row, columns) =>
      call('upsertChapter', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        const name = row.name.trim();
        if (name.length < 1 || name.length > 40) refuse('new row violates check constraint "chapters_name_check"', '23514');
        if (row.end_date !== null && row.start_date !== null && row.end_date < row.start_date) refuse('new row violates check constraint "chapters_check"', '23514');
        const i = tables.chapters.findIndex((r) => r.id === row.id);
        const existing = i === -1 ? undefined : tables.chapters[i];
        if (existing && existing.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        const stamp = now().toISOString();
        const sent = existing && columns ? Object.fromEntries(columns.map((k) => [k, row[k]])) as Partial<ChapterRow> : row;
        const next: ChapterRow = existing
          ? { ...existing, ...sent, updated_at: stamp }
          : { created_by: me().userId, created_at: stamp, updated_at: stamp, ...row };
        if (existing) tables.chapters[i] = next;
        else tables.chapters.push(next);
        // As log_activity: an edit that changes nothing is not logged.
        const changes = existing ? diff(existing, next) : null;
        if (!existing) log('chapter', next.id, 'created', { after: next as unknown as Json }, next.household_id);
        else if (changes && Object.keys(changes as object).length > 0) log('chapter', next.id, 'edited', changes, next.household_id);
        return next;
      }),
    upsertCategory: (row) =>
      call('upsertCategory', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy', '42501');
        if (!PALETTE.includes(row.colour)) refuse('new row violates check constraint "categories_colour_palette"', '23514');
        const i = tables.categories.findIndex((r) => r.id === row.id);
        const existing = i === -1 ? undefined : tables.categories[i];
        const next: CategoryRow = { ...(existing ?? {}), ...row, updated_at: now().toISOString() };
        if (existing) tables.categories[i] = next;
        else tables.categories.push(next);
        log('category', next.id, existing ? 'edited' : 'created', existing ? diff(existing, next) : { after: next as unknown as Json }, next.household_id);
        return next;
      }),
    importIgnores: (hid) => call('importIgnores', hid, () => mine(ignores())),
    insertImportIgnore: (row) =>
      call('insertImportIgnore', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy for table "import_ignores"', '42501');
        if (!['csv', 'monzo'].includes(row.source)) refuse('new row violates check constraint "import_ignores_source_check"', '23514');
        if (!ignores().some((x) => x.household_id === row.household_id && x.source === row.source && x.id_hash === row.id_hash)) ignores().push({ ...row });
        return row;
      }),
    deleteImportIgnore: (row) =>
      call('deleteImportIgnore', row, () => {
        tables.importIgnores = ignores().filter((x) => !(x.household_id === row.household_id && x.household_id === myHousehold() && x.source === row.source && x.id_hash === row.id_hash));
      }),
    importRules: (hid) => call('importRules', hid, () => mine(rules()).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))),
    upsertImportRule: (row) =>
      call('upsertImportRule', row, () => {
        if (row.household_id !== myHousehold()) refuse('new row violates row-level security policy for table "import_rules"', '42501');
        // Only keep rules are shared (a skip rule stays on the phone that made it).
        if (row.decision !== 'keep') refuse('new row for relation "import_rules" violates check constraint "import_rules_decision_check"', '23514');
        if (row.category_id !== null && !mine(tables.categories).some((c) => c.id === row.category_id)) {
          refuse('insert or update on table "import_rules" violates foreign key constraint "import_rules_category_id_fkey"', '23503');
        }
        const list = rules();
        const i = list.findIndex((x) => x.household_id === row.household_id && x.match_text === row.match_text);
        const next: ImportRuleRow = { created_at: list[i]?.created_at ?? now().toISOString(), ...row };
        if (i === -1) list.push(next);
        else list[i] = next;
        return next;
      }),
    deleteImportRule: (hid, matchText) =>
      call('deleteImportRule', { household_id: hid, match_text: matchText }, () => {
        tables.importRules = rules().filter((x) => !(x.household_id === hid && x.household_id === myHousehold() && x.match_text === matchText));
      }),
    restoreBackup: (people, rows) => call('restoreBackup', { people, rows }, () => restore(people, rows)),
    storageUsed: () =>
      call('storageUsed', null, () => {
        const hid = myHousehold();
        if (!hid) return refuse('not in a household', '42501');
        // A stand-in for pg_database_size: the size of what is stored, and the household's photos.
        const database = new TextEncoder().encode(JSON.stringify(tables)).length;
        const photos = (tables.receipts ?? []).filter((r) => r.path.startsWith(`${hid}/`)).reduce((t, r) => t + r.size, 0);
        return { database_bytes: database, photo_bytes: photos };
      }),
    pushPublicKey: () => call('pushPublicKey', null, () => { me(); return tables.pushPublicKey ?? null; }),
    savePushSubscription: (sub) =>
      call('savePushSubscription', sub, () => {
        const uid = me().userId;
        if (!pushEndpointOk(sub.endpoint)) refuse('that is not a push address');
        if (sub.p256dh === '' || sub.auth === '') refuse('the subscription\u2019s keys are missing');
        tables.pushSubscriptions ??= [];
        const old = tables.pushSubscriptions.find((s) => s.endpoint === sub.endpoint);
        // Another account's endpoint moves only on the same phone handed over within the household (its own keys).
        if (old && old.user_id !== uid) {
          const theirs = tables.members.find((m) => m.user_id === old.user_id)?.household_id ?? null;
          if (theirs === null || theirs !== myHousehold() || old.p256dh !== sub.p256dh || old.auth !== sub.auth) refuse('that push address belongs to someone else');
        }
        tables.pushSubscriptions = tables.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint);
        tables.pushSubscriptions.push({ user_id: uid, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
      }),
    removePushSubscription: (endpoint) =>
      call('removePushSubscription', endpoint, () => {
        const uid = me().userId;
        tables.pushSubscriptions = (tables.pushSubscriptions ?? []).filter((s) => !(s.endpoint === endpoint && s.user_id === uid));
      }),
    notificationPrefs: (userId) =>
      call('notificationPrefs', userId, () => (userId === me().userId ? (tables.notificationPrefs ?? []).find((r) => r.user_id === userId) ?? null : null)),
    setNotificationPrefs: (patch: NotificationPrefsPatch) =>
      call('setNotificationPrefs', patch, () => {
        const uid = me().userId;
        for (const [k, v] of Object.entries(patch)) {
          if ((PREF_SWITCHES as readonly string[]).includes(k)) {
            if (typeof v !== 'boolean') refuse('a switch is on or off');
          } else if (k === 'balance_threshold_pence') {
            if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > 100_000_000) refuse('the amount is a whole number of pence above zero');
          } else refuse(`no such notification setting: ${k}`);
        }
        tables.notificationPrefs ??= [];
        const stamp = now().toISOString();
        const i = tables.notificationPrefs.findIndex((r) => r.user_id === uid);
        const next: NotificationPrefsRow = { ...(tables.notificationPrefs[i] ?? defaultPrefs(uid, stamp)), ...patch, user_id: uid, updated_at: stamp };
        if (i === -1) tables.notificationPrefs.push(next);
        else tables.notificationPrefs[i] = next;
        return next;
      }),
    watchHousehold(householdId, onChange, onStatus) {
      const w = { householdId, onChange, onStatus };
      watchers.add(w);
      queueMicrotask(() => { if (watchers.has(w)) onStatus('subscribed'); });
      return () => { watchers.delete(w); };
    },
  };
  return { api, controls };
}
