/**
 * A fake Supabase for data-layer tests (src/data/*.test.ts). One FakeServer is "the database"; each phone gets
 * its own client (its own signed-in person, network and Realtime channels) that talks to it.
 *
 * It answers the way supabase-js 2.119 does, so the data layer can be written against the real client:
 * - PostgREST: `from(t).select/insert/upsert/update` with eq/neq/is/in/gt/gte/lt/lte/order/limit/range/match,
 *   single/maybeSingle, and `rpc(name, args)`. A result is `{ data, error, count, status, statusText, success }`.
 *   Delete is refused for money tables, as the database's grants refuse it.
 * - Offline (or a dropped response): `{ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }`,
 *   which is what postgrest-js returns when fetch rejects.
 * - Refusals look like the database's: check_money's P0001 messages, foreign keys 23503.
 * - auth: getSession/getUser/refreshSession/onAuthStateChange/signOut/startAutoRefresh/stopAutoRefresh, with
 *   real AuthRetryableFetchError / AuthApiError objects; when the stored session has expired and the phone
 *   is offline, getSession returns `{ session: null, error: AuthRetryableFetchError }` exactly as auth-js does
 *   (the session is still in its storage).
 * - Realtime: `channel(name).on('postgres_changes', filter, cb).subscribe(cb)`; every write on the server is
 *   broadcast to every subscribed channel whose filter matches.
 * Anything else it is asked to do throws "fake supabase: … not supported", so a gap shows up as a clear failure.
 */
import { AuthApiError, AuthRetryableFetchError, PostgrestError } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
type Filter = { col: string; op: 'eq' | 'neq' | 'is' | 'in' | 'gt' | 'gte' | 'lt' | 'lte'; value: unknown };

export interface LogEntry {
  phone: string;
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc';
  rows: Row[];
  filters: Filter[];
  /** The server applied it (a dropped response still counts as applied). */
  applied: boolean;
}

export interface Result {
  data: unknown;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
  success: boolean;
}

const KEYS: Record<string, string[]> = {
  category_memory: ['household_id', 'key'],
  members: ['household_id', 'user_id'],
  app_config: ['key'],
  recaps: ['household_id', 'period'],
};
const keyOf = (table: string) => KEYS[table] ?? ['id'];
const NO_DELETE = new Set(['expenses', 'settlements', 'members', 'households', 'activity', 'change_requests']);

function networkFailure(): Result {
  return {
    data: null,
    error: new PostgrestError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }),
    count: null,
    status: 0,
    statusText: '',
    success: false,
  };
}

function refusal(code: string, message: string, status = 400): Result {
  return { data: null, error: new PostgrestError({ message, details: '', hint: '', code }), count: null, status, statusText: 'Bad Request', success: false };
}

function ok(data: unknown, status = 200): Result {
  return { data, error: null, count: Array.isArray(data) ? data.length : null, status, statusText: 'OK', success: true };
}

const clone = <T>(v: T): T => structuredClone(v);
const sortKey = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? v.toString().padStart(20, '0') : '');

function matches(row: Row, filters: readonly Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case 'eq':
        return v === f.value;
      case 'neq':
        return v !== f.value;
      case 'is':
        return v === f.value || (f.value === null && v === undefined);
      case 'in':
        return Array.isArray(f.value) && f.value.includes(v);
      case 'gt':
        return String(v) > String(f.value);
      case 'gte':
        return String(v) >= String(f.value);
      case 'lt':
        return String(v) < String(f.value);
      case 'lte':
        return String(v) <= String(f.value);
    }
  });
}

type ChangeListener = (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; schema: string; table: string; new: Row; old: Row; commit_timestamp: string }) => void;

export class FakeChannel {
  private readonly listeners: { table: string | undefined; filter: string | undefined; cb: ChangeListener }[] = [];
  subscribed = false;
  constructor(readonly name: string, private readonly phone: FakePhone) {}

  on(type: string, filter: { event?: string; schema?: string; table?: string; filter?: string }, cb: ChangeListener): this {
    if (type !== 'postgres_changes') return this; // broadcast and presence are accepted and stay silent
    this.listeners.push({ table: filter.table, filter: filter.filter, cb });
    return this;
  }

  subscribe(cb?: (status: string, err?: Error) => void): this {
    this.subscribed = true;
    this.phone.channels.add(this);
    queueMicrotask(() => cb?.(this.phone.network.online ? 'SUBSCRIBED' : 'CHANNEL_ERROR'));
    return this;
  }

  unsubscribe(): Promise<'ok'> {
    this.subscribed = false;
    this.phone.channels.delete(this);
    return Promise.resolve('ok');
  }

  /** Called by the server after each write. */
  deliver(table: string, eventType: 'INSERT' | 'UPDATE', next: Row, old: Row): void {
    if (!this.subscribed || !this.phone.network.online) return;
    for (const l of this.listeners) {
      if (l.table !== undefined && l.table !== '*' && l.table !== table) continue;
      if (l.filter) {
        const m = /^(\w+)=eq\.(.+)$/.exec(l.filter);
        if (m && String(next[m[1] ?? '']) !== m[2]) continue;
      }
      l.cb({ eventType, schema: 'public', table, new: clone(next), old: clone(old), commit_timestamp: new Date(0).toISOString() });
    }
  }
}

/** A phone's network: the test switches it; the data layer reads `online` and subscribes. */
export class FakeNetwork {
  private readonly listeners = new Set<(online: boolean) => void>();
  constructor(private state = true) {}
  get online(): boolean {
    return this.state;
  }
  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Also tells the browser (navigator.onLine and the window events), for code that listens there. */
  set(online: boolean): void {
    if (this.state === online) return;
    this.state = online;
    if (typeof window !== 'undefined') {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
      window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    }
    for (const l of this.listeners) l(online);
  }
}

/** An idb-keyval-shaped async store kept in memory; survives "restarts" when the same object is reused. */
export class FakeStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  setItem(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.map.set(key, value);
    return Promise.resolve();
  }
  removeItem(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

export interface FakeUser {
  id: string;
  email: string;
}

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: 'bearer';
  user: { id: string; email: string; aud: string; role: string; app_metadata: Row; user_metadata: Row; created_at: string };
}

type AuthListener = (event: string, session: StoredSession | null) => void;

/** auth-js as seen by the app, with the outcomes a test controls. */
export class FakeAuth {
  session: StoredSession | null;
  /** Server side: false once the refresh token has been revoked (signed out elsewhere, account removed). */
  refreshTokenValid = true;
  readonly calls: string[] = [];
  private readonly listeners = new Set<AuthListener>();
  private serial = 0;

  constructor(private readonly phone: FakePhone, user: FakeUser | null) {
    this.session = user ? this.issue(user) : null;
  }

  private issue(user: FakeUser): StoredSession {
    this.serial += 1;
    const now = Math.floor(this.phone.server.now() / 1000);
    return {
      access_token: `access-${user.id}-${String(this.serial)}`,
      refresh_token: `refresh-${user.id}-${String(this.serial)}`,
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() },
    };
  }

  /** Makes the stored access token expire (as after a long time offline). */
  expire(): void {
    if (this.session) this.session = { ...this.session, expires_at: Math.floor(this.phone.server.now() / 1000) - 60, expires_in: -60 };
  }

  private emit(event: string): void {
    for (const l of this.listeners) l(event, this.session ? clone(this.session) : null);
  }

  private expired(): boolean {
    return this.session !== null && this.session.expires_at * 1000 <= this.phone.server.now();
  }

  private refresh(): { session: StoredSession | null; error: AuthRetryableFetchError | AuthApiError | null } {
    if (!this.session) return { session: null, error: null };
    if (!this.phone.network.online) return { session: null, error: new AuthRetryableFetchError('Failed to fetch', 0) };
    if (!this.refreshTokenValid) {
      // auth-js removes the session and tells its listeners.
      this.session = null;
      this.emit('SIGNED_OUT');
      return { session: null, error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found') };
    }
    this.session = this.issue({ id: this.session.user.id, email: this.session.user.email });
    this.emit('TOKEN_REFRESHED');
    return { session: clone(this.session), error: null };
  }

  getSession(): Promise<{ data: { session: StoredSession | null }; error: AuthRetryableFetchError | AuthApiError | null }> {
    this.calls.push('getSession');
    if (!this.session) return Promise.resolve({ data: { session: null }, error: null });
    if (!this.expired()) return Promise.resolve({ data: { session: clone(this.session) }, error: null });
    const r = this.refresh();
    return Promise.resolve({ data: { session: r.session }, error: r.error });
  }

  refreshSession(): Promise<{ data: { session: StoredSession | null; user: StoredSession['user'] | null }; error: AuthRetryableFetchError | AuthApiError | null }> {
    this.calls.push('refreshSession');
    const r = this.refresh();
    return Promise.resolve({ data: { session: r.session, user: r.session?.user ?? null }, error: r.error });
  }

  getUser(): Promise<{ data: { user: StoredSession['user'] | null }; error: AuthRetryableFetchError | AuthApiError | null }> {
    this.calls.push('getUser');
    if (!this.session) return Promise.resolve({ data: { user: null }, error: null });
    if (!this.phone.network.online) return Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    return Promise.resolve({ data: { user: clone(this.session.user) }, error: null });
  }

  onAuthStateChange(cb: AuthListener): { data: { subscription: { id: string; callback: AuthListener; unsubscribe: () => void } } } {
    this.calls.push('onAuthStateChange');
    this.listeners.add(cb);
    queueMicrotask(() => {
      cb('INITIAL_SESSION', this.session && !this.expired() ? clone(this.session) : null);
    });
    return { data: { subscription: { id: 'fake', callback: cb, unsubscribe: () => { this.listeners.delete(cb); } } } };
  }

  signOut(): Promise<{ error: null }> {
    this.calls.push('signOut');
    this.session = null;
    this.emit('SIGNED_OUT');
    return Promise.resolve({ error: null });
  }

  startAutoRefresh(): Promise<void> {
    this.calls.push('startAutoRefresh');
    return Promise.resolve();
  }

  stopAutoRefresh(): Promise<void> {
    this.calls.push('stopAutoRefresh');
    return Promise.resolve();
  }

  signInWithOtp(): Promise<never> {
    throw new Error('fake supabase: auth.signInWithOtp not supported in data-layer tests');
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: LogEntry['op'] = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private one: 'single' | 'maybe' | null = null;
  private ordering: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private upsertKey: string[] | null = null;
  private ignoreDuplicates = false;
  private throws = false;

  constructor(private readonly phone: FakePhone, private readonly table: string) {}

  select(): this {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = clone(Array.isArray(rows) ? rows : [rows]);
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = 'upsert';
    this.payload = clone(Array.isArray(rows) ? rows : [rows]);
    this.upsertKey = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null;
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.patch = clone(patch);
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  private f(col: string, op: Filter['op'], value: unknown): this {
    this.filters.push({ col, op, value });
    return this;
  }
  eq(col: string, value: unknown): this {
    return this.f(col, 'eq', value);
  }
  neq(col: string, value: unknown): this {
    return this.f(col, 'neq', value);
  }
  is(col: string, value: unknown): this {
    return this.f(col, 'is', value);
  }
  in(col: string, values: unknown[]): this {
    return this.f(col, 'in', values);
  }
  gt(col: string, value: unknown): this {
    return this.f(col, 'gt', value);
  }
  gte(col: string, value: unknown): this {
    return this.f(col, 'gte', value);
  }
  lt(col: string, value: unknown): this {
    return this.f(col, 'lt', value);
  }
  lte(col: string, value: unknown): this {
    return this.f(col, 'lte', value);
  }
  match(query: Row): this {
    for (const [k, v] of Object.entries(query)) this.f(k, 'eq', v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.ordering.push({ col, asc: opts?.ascending ?? true });
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  range(from: number, to: number): this {
    if (from !== 0) throw new Error('fake supabase: range() with an offset not supported');
    this.lim = to - from + 1;
    return this;
  }
  single(): this {
    this.one = 'single';
    return this;
  }
  maybeSingle(): this {
    this.one = 'maybe';
    return this;
  }
  abortSignal(): this {
    return this;
  }
  returns(): this {
    return this;
  }
  throwOnError(): this {
    this.throws = true;
    return this;
  }
  or(): never {
    throw new Error('fake supabase: or() not supported');
  }
  not(): never {
    throw new Error('fake supabase: not() not supported');
  }
  filter(): never {
    throw new Error('fake supabase: filter() not supported');
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const run = new Promise<Result>((resolve) => {
      // Answer on a later turn, as a network would.
      setTimeout(() => {
        resolve(this.run());
      }, 0);
    }).then((r) => {
      if (this.throws && r.error) throw r.error;
      return r;
    });
    return run.then(onfulfilled, onrejected);
  }

  private shape(rows: Row[]): Result {
    let out = rows;
    for (const o of [...this.ordering].reverse()) {
      out = [...out].sort((a, b) => {
        const x = sortKey(a[o.col]);
        const y = sortKey(b[o.col]);
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.one) {
      if (out.length === 1) return ok(clone(out[0]));
      if (out.length === 0 && this.one === 'maybe') return ok(null);
      return refusal('PGRST116', 'JSON object requested, multiple (or no) rows returned', 406);
    }
    return ok(clone(out));
  }

  private run(): Result {
    const { phone, table } = this;
    const server = phone.server;
    if (!phone.network.online) return networkFailure();
    if (this.op === 'select') {
      server.log.push({ phone: phone.name, table, op: 'select', rows: [], filters: this.filters, applied: true });
      return this.shape(server.rows(table).filter((r) => matches(r, this.filters)));
    }
    if (this.op === 'delete') {
      if (NO_DELETE.has(table)) return refusal('42501', `permission denied for table ${table}`, 403);
      server.log.push({ phone: phone.name, table, op: 'delete', rows: [], filters: this.filters, applied: true });
      server.tables[table] = server.rows(table).filter((r) => !matches(r, this.filters));
      return ok(null, 204);
    }
    const money = table === 'expenses' || table === 'settlements';
    if (money && server.failWrites > 0) {
      server.failWrites -= 1;
      server.log.push({ phone: phone.name, table, op: this.op, rows: this.payload, filters: this.filters, applied: false });
      return networkFailure();
    }
    const touched: Row[] = [];
    let candidate: { next: Row; old: Row | null }[];
    if (this.op === 'update') {
      candidate = server.rows(table).filter((r) => matches(r, this.filters)).map((r) => ({ next: { ...r, ...this.patch }, old: r }));
    } else {
      const key = this.upsertKey ?? keyOf(table);
      candidate = [];
      for (const p of this.payload) {
        const existing = server.rows(table).find((r) => key.every((k) => r[k] === p[k] && p[k] !== undefined)) ?? null;
        if (existing && this.op === 'insert') return refusal('23505', `duplicate key value violates unique constraint "${table}_pkey"`, 409);
        if (existing && this.ignoreDuplicates) continue;
        candidate.push({ next: existing ? { ...existing, ...p } : server.withDefaults(table, p, phone.user?.id ?? null), old: existing });
      }
    }
    for (const c of candidate) {
      const why = server.check(table, c.next, phone);
      if (why) {
        server.log.push({ phone: phone.name, table, op: this.op, rows: this.payload, filters: this.filters, applied: false });
        return why;
      }
    }
    for (const c of candidate) {
      server.write(table, c.next, c.old, phone.user?.id ?? null);
      touched.push(c.next);
    }
    server.log.push({ phone: phone.name, table, op: this.op, rows: this.op === 'update' ? [this.patch] : this.payload, filters: this.filters, applied: true });
    if (money && server.dropResponses > 0) {
      server.dropResponses -= 1;
      return networkFailure();
    }
    return this.returning ? this.shape(touched) : ok(null, 201);
  }
}

export interface PhoneOptions {
  name: string;
  user: FakeUser | null;
  network?: FakeNetwork;
}

export class FakePhone {
  readonly name: string;
  readonly network: FakeNetwork;
  readonly auth: FakeAuth;
  readonly channels = new Set<FakeChannel>();
  readonly user: FakeUser | null;

  constructor(readonly server: FakeServer, opts: PhoneOptions) {
    this.name = opts.name;
    this.user = opts.user;
    this.network = opts.network ?? new FakeNetwork(true);
    this.auth = new FakeAuth(this, opts.user);
    server.phones.add(this);
  }

  /** What the data layer receives in place of a SupabaseClient<Database>. Cast at the call site. */
  get client(): unknown {
    return {
      auth: this.auth,
      from: (table: string) => new FakeQuery(this, table),
      rpc: (name: string) => this.server.rpc(this, name),
      channel: (name: string) => new FakeChannel(name, this),
      removeChannel: (ch: FakeChannel) => ch.unsubscribe(),
      removeAllChannels: () => Promise.all([...this.channels].map((c) => c.unsubscribe())),
      getChannels: () => [...this.channels],
      realtime: { setAuth: () => Promise.resolve() },
    };
  }
}

class RpcCall implements PromiseLike<Result> {
  constructor(private readonly compute: () => Result) {}
  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>((resolve) => {
      setTimeout(() => {
        resolve(this.compute());
      }, 0);
    }).then(onfulfilled, onrejected);
  }
  single(): this {
    return this;
  }
  maybeSingle(): this {
    return this;
  }
  throwOnError(): this {
    return this;
  }
  abortSignal(): this {
    return this;
  }
}

export interface Household {
  id: string;
  members: [FakeUser, FakeUser];
  categories: Record<string, string>;
}

export class FakeServer {
  readonly tables: Record<string, Row[]> = {};
  readonly log: LogEntry[] = [];
  readonly phones = new Set<FakePhone>();
  /** The next N writes to expenses or settlements are applied but their answers are lost (the phone sees a network failure). */
  dropResponses = 0;
  /** The next N writes to expenses or settlements never reach the server (a network failure while the phone thinks it is online). */
  failWrites = 0;
  /** Extra refusals, like a database trigger: return a message to refuse the row. */
  refuse: ((table: string, row: Row) => string | null) | null = null;
  /** Server time runs with the real clock (auth-js compares token expiry with Date.now()), plus any advance. */
  private offset = 0;
  private seq = 0;

  now(): number {
    return Date.now() + this.offset;
  }
  advance(ms: number): void {
    this.offset += ms;
  }
  private get clock(): number {
    return this.now();
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  uuid(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${this.seq.toString(16).padStart(12, '0')}`;
  }

  /** A household with both people set up, the 12 starting categories and app_config. */
  seedHousehold(opts: { minClientVersion?: string } = {}): Household {
    const id = this.uuid();
    const jae: FakeUser = { id: this.uuid(), email: 'jae@example.com' };
    const sam: FakeUser = { id: this.uuid(), email: 'sam@example.com' };
    this.rows('households').push({ id, join_code: 'ABC123', home_country: 'GB', default_ratio: null, joint_enabled: false, joint_ratio: null, created_at: new Date(this.clock).toISOString() });
    const at = new Date(this.clock).toISOString();
    this.rows('members').push(
      { household_id: id, user_id: jae.id, display_name: 'Jae', animal: 'cat', locked_at: at, monzo_me: null, joined_at: at },
      { household_id: id, user_id: sam.id, display_name: 'Sam', animal: 'dog', locked_at: at, monzo_me: null, joined_at: at },
    );
    const categories: Record<string, string> = {};
    ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other'].forEach((name, i) => {
      const cid = this.uuid();
      categories[name] = cid;
      this.rows('categories').push({ id: cid, household_id: id, name, emoji: '•', colour: 'stone', default_ratio: null, archived: false, sort: i + 1, seed_key: name.toLowerCase().replace(' & ', '_').replace(' ', '_'), updated_at: at });
    });
    this.rows('app_config').push({ key: 'min_client_version', value: opts.minClientVersion ?? '0.0.0' });
    return { id, members: [jae, sam], categories };
  }

  phone(name: string, user: FakeUser | null, network?: FakeNetwork): FakePhone {
    return new FakePhone(this, { name, user, ...(network ? { network } : {}) });
  }

  householdOf(userId: string | undefined): string | null {
    return (this.rows('members').find((m) => m.user_id === userId)?.household_id as string | undefined) ?? null;
  }

  withDefaults(table: string, row: Row, actor: string | null): Row {
    const at = new Date(this.clock).toISOString();
    if (table === 'expenses') {
      return {
        kind: 'expense', category_id: null, chapter_id: null, paid_via: 'person', split_mode: 'ratio', split_params: null, items: null, bill_total_pence: null,
        country: 'GB', place: null, lat: null, lng: null, original_amount: null, original_currency: null, fx_rate: null, notes: null, tags: [],
        receipt_path: null, source: 'manual', external_id: null, merchant: null, external_category: null, account_id: null, recurring_id: null,
        occurrence_date: null, refund_of: null, created_by: actor, created_at: at, updated_by: actor, updated_at: at, deleted_at: null,
        ...row,
        // Like migration 5: a signed-in person is always recorded as the creator, whatever was sent.
        ...(actor ? { created_by: actor, updated_by: actor } : {}),
        id: row.id ?? this.uuid(),
      };
    }
    if (table === 'settlements') {
      return { note: null, method: 'other', created_by: actor, created_at: at, updated_at: at, deleted_at: null, ...row, ...(actor ? { created_by: actor } : {}), id: row.id ?? this.uuid() };
    }
    return keyOf(table).includes('id') ? { ...row, id: row.id ?? this.uuid() } : { ...row };
  }

  /** The database's own refusals for the tables the daily loop writes. */
  check(table: string, row: Row, phone: FakePhone): Result | null {
    const hid = this.householdOf(phone.user?.id);
    if (!phone.auth.session) return refusal('42501', 'permission denied', 401);
    if ('household_id' in row && row.household_id !== hid) return refusal('42501', 'new row violates row-level security policy', 403);
    const extra = this.refuse?.(table, row);
    if (extra) return refusal('P0001', extra);
    if (table === 'expenses') {
      const amount = row.amount_pence;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return refusal('23514', 'new row for relation "expenses" violates check constraint "expenses_amount_pence_check"');
      if (typeof row.description !== 'string' || row.description.trim() === '') return refusal('23514', 'new row for relation "expenses" violates check constraint "expenses_description_check"');
      if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return refusal('22007', 'invalid input syntax for type date');
      const members = this.rows('members').filter((m) => m.household_id === hid).map((m) => m.user_id as string);
      for (const what of ['shares', 'paid'] as const) {
        const map = (row[what] ?? {}) as Record<string, unknown>;
        const values = Object.values(map);
        if (values.some((v) => typeof v !== 'number' || !Number.isSafeInteger(v))) return refusal('22P02', `invalid input syntax for type bigint`);
        const sum = (values as number[]).reduce((t, v) => t + v, 0);
        if (sum !== amount) return refusal('P0001', `${what} (${String(sum)}) must sum to amount (${String(amount)})`);
        if ((values as number[]).some((v) => v < 0)) return refusal('P0001', 'amounts must not be negative');
        if (Object.keys(map).some((k) => !members.includes(k))) return refusal('P0001', 'paid or shares name a non-member');
      }
      if (row.category_id !== null && row.category_id !== undefined && !this.rows('categories').some((c) => c.id === row.category_id)) {
        return refusal('23503', 'insert or update on table "expenses" violates foreign key constraint "expenses_category_id_fkey"', 409);
      }
    }
    if (table === 'settlements') {
      const amount = row.amount_pence;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return refusal('23514', 'violates check constraint "settlements_amount_pence_check"');
      if (row.from_user === row.to_user) return refusal('23514', 'violates check constraint "settlements_check"');
    }
    return null;
  }

  write(table: string, next: Row, old: Row | null, actor: string | null): void {
    const rows = this.rows(table);
    const stamped = old && (table === 'expenses' || table === 'settlements') ? { ...next, updated_at: new Date(this.clock).toISOString(), ...(table === 'expenses' ? { updated_by: actor } : {}) } : next;
    if (old) rows.splice(rows.indexOf(old), 1, stamped);
    else rows.push(stamped);
    if (table === 'expenses' || table === 'settlements') {
      const action = !old ? 'created' : old.deleted_at === null && stamped.deleted_at !== null ? 'deleted' : old.deleted_at !== null && stamped.deleted_at === null ? 'restored' : 'edited';
      this.rows('activity').push({ id: this.rows('activity').length + 1, household_id: stamped.household_id, actor, entity: table === 'expenses' ? 'expense' : 'settlement', entity_id: stamped.id, action, summary: {}, at: new Date(this.clock).toISOString() });
    }
    this.advance(1);
    for (const p of this.phones) for (const ch of p.channels) ch.deliver(table, old ? 'UPDATE' : 'INSERT', stamped, old ?? {});
  }

  /** Inserts or replaces a row as if another phone had written it (and broadcasts it). */
  serverWrite(table: string, row: Row, actor: string | null): Row {
    const key = keyOf(table);
    const old = this.rows(table).find((r) => key.every((k) => r[k] === row[k])) ?? null;
    const next = old ? { ...old, ...row } : this.withDefaults(table, row, actor);
    this.write(table, next, old, actor);
    return next;
  }

  rpc(phone: FakePhone, name: string): RpcCall {
    return new RpcCall(() => {
      if (!phone.network.online) return networkFailure();
      this.log.push({ phone: phone.name, table: name, op: 'rpc', rows: [], filters: [], applied: true });
      const min = this.rows('app_config').find((r) => r.key === 'min_client_version')?.value ?? null;
      switch (name) {
        case 'health':
          return ok({ ok: true, min_client_version: min });
        case 'my_household':
          return ok(this.householdOf(phone.user?.id));
        case 'post_due_recurring':
          return ok(0);
        default:
          throw new Error(`fake supabase: rpc ${name} not supported in data-layer tests`);
      }
    });
  }

  /** Live rows of a table for a household. */
  live(table: 'expenses' | 'settlements', householdId: string): Row[] {
    return this.rows(table).filter((r) => r.household_id === householdId && r.deleted_at === null);
  }

  /** The writes (insert/upsert/update) the server applied, in order. */
  writes(table?: string): LogEntry[] {
    return this.log.filter((l) => l.applied && l.op !== 'select' && l.op !== 'rpc' && (table === undefined || l.table === table));
  }
}
