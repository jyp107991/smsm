/// <reference types="node" />
/**
 * S8, the push Edge Function (docs/slices/S8.md "Decisions made here → No owner steps, Delivery, Words, Icon", "Data →
 * Edge Function", "Tests → Function"; SPEC NOT-1, NOT-2, NOT-3, INB-2): `?init=1` makes the VAPID keys once; a call
 * from the database (with its token) drains the outbox, builds each text with src/core/notify.ts, sends it to each of the
 * recipient's subscriptions as a standard Web Push (RFC 8291 aes128gcm, RFC 8292 VAPID), marks it sent and forgets a
 * subscription the push service says is gone. Runs in Vitest with a fake database and a fake fetch: no network. The
 * pushes are decrypted here with the subscription's own keys, so any maintained Web-Crypto library passes as long as it
 * speaks the standard. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, exported as `handle` from supabase/functions/push/index.ts (or from a handler.ts beside
 * it that index.ts serves). The module must import in Node/Vitest: no Deno globals at import time (serve only under
 * Deno, e.g. `if (typeof Deno !== 'undefined') Deno.serve(...)`), and any `npm:` / `jsr:` specifier needs a Vitest alias.
 *
 *   handle(req: Request, deps: PushDeps): Promise<Response>
 *   interface PushDeps {
 *     db: PushDb;                         // over the database with the function's secret key (a fake here)
 *     fetch: typeof fetch;                // used only for the push services
 *     env: { SUPABASE_URL: string };
 *     now?: () => Date;
 *   }
 *   interface PushConfig { vapid_public: string | null; vapid_private: string | null; token: string | null; function_url: string | null }
 *   interface Outgoing {                  // one row of next_notifications(limit) (tests/sql/notifications_test.sql)
 *     id: string; recipient: string; kind: NotificationKind; data: NotificationData;   // as src/core/notify.ts takes them
 *     names: Record<string, string>; animal: 'cat' | 'dog' | null; badge: number;
 *   }
 *   interface SubscriptionRow { user_id: string; endpoint: string; p256dh: string; auth: string }
 *   interface PushDb {
 *     config(): Promise<PushConfig | null>;                  // push_config's one row
 *     saveConfig(patch: Partial<PushConfig>): Promise<void>; // writes the fields given (this fake overwrites them)
 *     next(limit: number): Promise<Outgoing[]>;              // next_notifications(limit)
 *     subscriptions(userIds: readonly string[]): Promise<SubscriptionRow[]>;
 *     markSent(ids: readonly string[]): Promise<void>;
 *     removeSubscription(endpoint: string): Promise<void>;
 *   }
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - `?init=1` (any method): fills in only what is missing: a P-256 key pair (vapid_public = base64url of the raw
 *     uncompressed 65-byte point, as a browser's applicationServerKey takes it; vapid_private = the private key's JWK
 *     as text) and function_url = `${SUPABASE_URL}/functions/v1/push`. Never replaces a stored value; never touches
 *     the token (the database's own). Answers 200.
 *   - The database's call: POST with header `x-push-token: <push_config.token>`. Anything else (no token, a wrong one,
 *     or no token stored at all) → 401, with nothing read from the outbox and nothing sent.
 *   - Draining: db.next(100); for each row the recipient's subscriptions; one POST per subscription with headers TTL,
 *     Content-Encoding: aes128gcm and Authorization: `vapid t=<ES256 JWT>, k=<vapid_public>` (aud = the endpoint's
 *     origin, exp within 24 hours, sub a mailto: or https: address). A subscription answered 404 or 410 is removed.
 *     A row is marked sent when at least one push was accepted (2xx), when every subscription was gone (404/410), or
 *     when the recipient has none; when every push failed otherwise (e.g. 500 or 429) it stays unsent for the next
 *     minute's run (rows unsent for 2 days are dropped by the database).
 *   - The push's plaintext is JSON { title, body, path, tag, icon, count } (what public/push.js shows; see
 *     tests/unit/push-sw.test.ts): title, body and path = notificationText(kind, data, names); tag the same for two rows
 *     about the same ref (a later change replaces an earlier one) and different for different refs; icon
 *     `/icons/head-<animal>.png` for the sender's animal, another `/icons/…png` without a sender; count = badge.
 *   - If supabase/functions/_shared/notify.ts exists (the brief's fallback when the bundler can't reach src/), it is
 *     identical to src/core/notify.ts.
 *
 * Until the function exists it is loaded by a computed path (so this file type-checks and each test fails).
 */
import { createDecipheriv, createECDH, createHmac, createPublicKey, generateKeyPairSync, randomBytes, verify, type ECDH } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ───────── the interface above, typed so this file compiles before it exists ─────────
interface PushConfig { vapid_public: string | null; vapid_private: string | null; token: string | null; function_url: string | null }
type Kind = 'entry_added' | 'entry_changed' | 'entry_deleted' | 'settle_added' | 'comment' | 'bill_posted' | 'approval_waiting';
interface Outgoing {
  id: string; recipient: string; kind: Kind; data: Record<string, unknown>;
  names: Record<string, string>; animal: 'cat' | 'dog' | null; badge: number;
}
interface SubscriptionRow { user_id: string; endpoint: string; p256dh: string; auth: string }
interface PushDb {
  config(): Promise<PushConfig | null>;
  saveConfig(patch: Partial<PushConfig>): Promise<void>;
  next(limit: number): Promise<Outgoing[]>;
  subscriptions(userIds: readonly string[]): Promise<SubscriptionRow[]>;
  markSent(ids: readonly string[]): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
}
interface PushDeps { db: PushDb; fetch: typeof fetch; env: { SUPABASE_URL: string }; now?: () => Date }
type Handle = (req: Request, deps: PushDeps) => Promise<Response>;
type NotificationText = (kind: string, data: Record<string, unknown>, names: Record<string, string>) => { title: string; body: string; path: string };

const CANDIDATES = ['../../supabase/functions/push/index.ts', '../../supabase/functions/push/handler.ts'];
let loadedHandle: Handle | null = null;
for (const path of CANDIDATES) {
  const m = (await import(/* @vite-ignore */ path).catch(() => null)) as { handle?: Handle } | null;
  if (typeof m?.handle === 'function') { loadedHandle = m.handle; break; }
}
function handle(): Handle {
  if (!loadedHandle) throw new Error('supabase/functions/push does not export handle(req, deps) yet (S8)');
  return loadedHandle;
}
const NOTIFY = '../../src/core/notify';
const notify = (await import(/* @vite-ignore */ NOTIFY).catch(() => null)) as { notificationText?: NotificationText } | null;
function words(row: Outgoing) {
  if (typeof notify?.notificationText !== 'function') throw new Error('src/core/notify.ts does not export notificationText yet (S8)');
  return notify.notificationText(row.kind, row.data, row.names);
}

// ───────── people, keys and rows ─────────
const SUPABASE_URL = 'https://test-project.supabase.co';
const FUNCTION = `${SUPABASE_URL}/functions/v1/push`;
const TOKEN = 'db-made-token-0123456789abcdef0123456789abcdef';
const JAE = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000b1';
const NAMES = { [JAE]: 'Jae', [SAM]: 'Sam' };
const ENTRY = '00000000-0000-4000-8000-00000000e001';
const OTHER_ENTRY = '00000000-0000-4000-8000-00000000e002';
const NOW = new Date('2026-11-18T09:00:00.000Z');

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

/** A VAPID pair as the function would store it: raw public point (base64url) and the private JWK. */
function vapidPair(): { vapid_public: string; vapid_private: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x ?? ''), unb64u(jwk.y ?? '')]);
  return { vapid_public: b64u(raw), vapid_private: JSON.stringify(jwk) };
}
const KEYS = vapidPair();
const READY: PushConfig = { ...KEYS, token: TOKEN, function_url: FUNCTION };

/** A browser's subscription: its own P-256 key pair and auth secret, so this test can read what was sent. */
interface Phone { row: SubscriptionRow; ecdh: ECDH; auth: Buffer }
function phone(userId: string, endpoint: string): Phone {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { row: { user_id: userId, endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) }, ecdh, auth };
}

function row(over: Partial<Outgoing> = {}): Outgoing {
  return {
    id: 'out-1', recipient: JAE, kind: 'entry_added',
    data: { actor: SAM, ref: ENTRY, description: 'Tesco', amount: 4250, balance: { [JAE]: 2450, [SAM]: -2450 } },
    names: NAMES, animal: 'dog', badge: 3, ...over,
  };
}

/** The database, in memory: push_config's row, what next_notifications answers, the subscriptions. */
function fakeDb(opts: { config?: PushConfig | null; rows?: Outgoing[]; subs?: SubscriptionRow[] } = {}) {
  const state = {
    config: opts.config === undefined ? { ...READY } : opts.config === null ? null : { ...opts.config },
    rows: [...(opts.rows ?? [])],
    subs: [...(opts.subs ?? [])],
    sent: [] as string[],
    removed: [] as string[],
    saves: [] as Partial<PushConfig>[],
  };
  const next = vi.fn((limit: number) => Promise.resolve(state.rows.filter((r) => !state.sent.includes(r.id)).slice(0, limit)));
  const db: PushDb = {
    config: vi.fn(() => Promise.resolve(state.config ? { ...state.config } : null)),
    saveConfig: vi.fn((patch: Partial<PushConfig>) => {
      state.saves.push({ ...patch });
      state.config = { ...(state.config ?? { vapid_public: null, vapid_private: null, token: null, function_url: null }), ...patch };
      return Promise.resolve();
    }),
    next,
    subscriptions: vi.fn((ids: readonly string[]) => Promise.resolve(state.subs.filter((s) => ids.includes(s.user_id)))),
    markSent: vi.fn((ids: readonly string[]) => { state.sent.push(...ids); return Promise.resolve(); }),
    removeSubscription: vi.fn((endpoint: string) => {
      state.removed.push(endpoint);
      state.subs = state.subs.filter((s) => s.endpoint !== endpoint);
      return Promise.resolve();
    }),
  };
  return { db, state, next };
}

/** The push services: answers by endpoint (201 unless told), and keeps every request. */
interface Sent { url: string; method: string; headers: Headers; body: Buffer }
function pushServices(status: Record<string, number> = {}) {
  const sent: Sent[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = Buffer.from(await req.arrayBuffer());
    sent.push({ url: req.url, method: req.method, headers: req.headers, body });
    return new Response(null, { status: status[req.url] ?? 201 });
  });
  return { fetch: impl as unknown as typeof fetch, sent };
}

function deps(db: PushDb, f: typeof fetch): PushDeps {
  return { db, fetch: f, env: { SUPABASE_URL }, now: () => NOW };
}
const fromDatabase = (token: string | null = TOKEN) =>
  new Request(FUNCTION, { method: 'POST', headers: token === null ? {} : { 'x-push-token': token } });
const init = () => new Request(`${FUNCTION}?init=1`, { method: 'POST' });

// ───────── reading a push the way the browser does (RFC 8188 / RFC 8291 aes128gcm) ─────────
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
function decrypt(body: Buffer, p: Phone): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20] ?? 0;
  const serverKey = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const uaPublic = p.ecdh.getPublicKey();
  const secret = p.ecdh.computeSecret(serverKey);
  const prkKey = hmac(p.auth, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, serverKey, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'latin1')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'latin1')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1;
  expect(plain[end], 'the last record ends with the 0x02 delimiter').toBe(2);
  return plain.subarray(0, end).toString('utf8');
}
interface Payload { title: string; body: string; path: string; tag: string; icon: string; count: number }
function payloadOf(s: Sent, p: Phone): Payload {
  return JSON.parse(decrypt(s.body, p)) as Payload;
}

/** RFC 8292: `vapid t=<JWT>, k=<public key>`, the JWT signed with ES256 by the stored private key. */
function checkVapid(s: Sent, publicKey: string) {
  const auth = s.headers.get('authorization') ?? '';
  const m = /^vapid\s+t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(auth.trim());
  expect(m, `Authorization: ${auth}`).not.toBeNull();
  const [, jwt = '', k = ''] = m ?? [];
  expect(k).toBe(publicKey);
  const [h = '', c = '', sig = ''] = jwt.split('.');
  expect(JSON.parse(unb64u(h).toString('utf8'))).toMatchObject({ alg: 'ES256' });
  const raw = unb64u(publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(sig)), 'the JWT is signed by the VAPID key').toBe(true);
  const claims = JSON.parse(unb64u(c).toString('utf8')) as { aud?: string; exp?: number; sub?: string };
  expect(claims.aud).toBe(new URL(s.url).origin);
  expect(claims.exp ?? 0).toBeGreaterThan(NOW.getTime() / 1000);
  expect(claims.exp ?? Infinity).toBeLessThanOrEqual(NOW.getTime() / 1000 + 24 * 3600);
  expect(claims.sub ?? '').toMatch(/^(mailto:|https:)/);
}

// ─────────────────────────────── setup: ?init=1 ───────────────────────────────

describe('push function ?init=1: the keys are made once, with nothing for the owner to set up (NOT-1)', () => {
  it('NOT-1: with nothing stored, it makes a P-256 key pair and records its own address; the token stays the database’s', async () => {
    const { db, state, next } = fakeDb({ config: { vapid_public: null, vapid_private: null, token: TOKEN, function_url: null } });
    const services = pushServices();
    const res = await handle()(init(), deps(db, services.fetch));
    expect(res.status).toBe(200);
    const c = state.config;
    expect(c?.token).toBe(TOKEN);
    expect(c?.function_url).toBe(FUNCTION);
    const raw = unb64u(c?.vapid_public ?? '');
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(4);
    const jwk = JSON.parse(c?.vapid_private ?? '{}') as JsonWebKey;
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(typeof jwk.d).toBe('string');
    expect(b64u(raw.subarray(1, 33))).toBe(jwk.x);
    expect(b64u(raw.subarray(33, 65))).toBe(jwk.y);
    // The private key works: what it signs, the public key verifies.
    const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const pub = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = new TextEncoder().encode('smsm');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data)).toBe(true);
    expect(services.sent).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('NOT-1: running it again changes nothing (the phones’ subscriptions keep working)', async () => {
    const { db, state } = fakeDb({ config: { vapid_public: null, vapid_private: null, token: TOKEN, function_url: null } });
    await handle()(init(), deps(db, pushServices().fetch));
    const first = { ...state.config };
    const res = await handle()(init(), deps(db, pushServices().fetch));
    expect(res.status).toBe(200);
    expect(state.config).toEqual(first);
  });

  it('NOT-1: with keys already stored, only what is missing is filled in', async () => {
    const { db, state } = fakeDb({ config: { ...KEYS, token: TOKEN, function_url: null } });
    await handle()(init(), deps(db, pushServices().fetch));
    expect(state.config).toEqual({ ...KEYS, token: TOKEN, function_url: FUNCTION });
    for (const patch of state.saves) {
      expect(patch.vapid_public, 'the stored public key is never replaced').toBeUndefined();
      expect(patch.vapid_private, 'the stored private key is never replaced').toBeUndefined();
      expect(patch.token, 'the token is the database’s').toBeUndefined();
    }
  });
});

// ─────────────────────────────── only the database may ask ───────────────────────────────

describe('push function: only the database’s call drains the outbox (NOT-1)', () => {
  it('NOT-1: a wrong token is refused: nothing read, nothing sent', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const { db, state, next } = fakeDb({ rows: [row()], subs: [jae.row] });
    const services = pushServices();
    const res = await handle()(fromDatabase('not-the-token'), deps(db, services.fetch));
    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(services.sent).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('NOT-1: no token is refused, and so is any call when no token is stored', async () => {
    const services = pushServices();
    const a = fakeDb({ rows: [row()] });
    expect((await handle()(fromDatabase(null), deps(a.db, services.fetch))).status).toBe(401);
    const b = fakeDb({ config: { ...KEYS, token: null, function_url: FUNCTION }, rows: [row()] });
    expect((await handle()(fromDatabase(''), deps(b.db, services.fetch))).status).toBe(401);
    expect(a.next).not.toHaveBeenCalled();
    expect(b.next).not.toHaveBeenCalled();
    expect(services.sent).toEqual([]);
  });
});

// ─────────────────────────────── draining ───────────────────────────────

describe('push function: draining the outbox (NOT-1, NOT-2, NOT-3, INB-2)', () => {
  it('NOT-1 NOT-2: each of the recipient’s phones gets a standard, encrypted push with the core’s words and path; the row is marked sent', async () => {
    const jaePhone = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const jaeLaptop = phone(JAE, 'https://updates.push.services.mozilla.com/wpush/v2/jae-laptop');
    const { db, state, next } = fakeDb({ rows: [row()], subs: [jaePhone.row, jaeLaptop.row] });
    const services = pushServices();
    const res = await handle()(fromDatabase(), deps(db, services.fetch));
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledWith(100);
    expect(services.sent.map((s) => s.url).sort()).toEqual([jaePhone.row.endpoint, jaeLaptop.row.endpoint].sort());
    const expected = words(row());
    expect(expected.body).toBe('Sam added Tesco £42.50 · Sam owes Jae £24.50');
    for (const [s, p] of [[services.sent.find((x) => x.url === jaePhone.row.endpoint), jaePhone], [services.sent.find((x) => x.url === jaeLaptop.row.endpoint), jaeLaptop]] as const) {
      if (!s) throw new Error('no push');
      expect(s.method).toBe('POST');
      expect(s.headers.get('content-encoding')).toBe('aes128gcm');
      expect(Number(s.headers.get('ttl'))).toBeGreaterThan(0);
      expect(s.body.length).toBeLessThanOrEqual(4096);
      expect(s.body.toString('latin1')).not.toContain('Tesco');
      checkVapid(s, KEYS.vapid_public);
      const payload = payloadOf(s, p);
      expect(payload).toMatchObject({ title: expected.title, body: expected.body, path: `/entry/${ENTRY}` });
      expect(payload.path).toBe(expected.path);
    }
    expect(state.sent).toEqual(['out-1']);
  });

  it('NOT-1: only the recipient’s phones: the person who made the change gets nothing', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const sam = phone(SAM, 'https://fcm.googleapis.com/fcm/send/sam-phone');
    const { db } = fakeDb({ rows: [row()], subs: [jae.row, sam.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    expect(services.sent.map((s) => s.url)).toEqual([jae.row.endpoint]);
  });

  it('NOT-1 NOT-3 INB-2: the sender’s animal is the icon, and the badge count travels with it', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const { db } = fakeDb({ rows: [row({ animal: 'dog', badge: 3 })], subs: [jae.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    const payload = payloadOf(services.sent[0] ?? { url: '', method: '', headers: new Headers(), body: Buffer.alloc(0) }, jae);
    expect(payload.icon).toMatch(/\/icons\/head-dog\.png$/);
    expect(payload.count).toBe(3);
  });

  it('NOT-1: with no sender (a bill posted today), the icon is the app’s, not an animal', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const bill = row({ id: 'out-bill', kind: 'bill_posted', animal: null, data: { actor: null, ref: 'bill-1', description: 'Rent', amount: 120000, balance: { [JAE]: 2450, [SAM]: -2450 } } });
    const { db } = fakeDb({ rows: [bill], subs: [jae.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    const s = services.sent[0];
    if (!s) throw new Error('no push');
    const payload = payloadOf(s, jae);
    expect(payload.body).toBe('Rent £1,200.00 posted today · Sam owes Jae £24.50');
    expect(payload.path).toBe('/bills');
    expect(payload.icon).toMatch(/^\/icons\/[\w-]+\.png$/);
    expect(payload.icon).not.toMatch(/head-(cat|dog)/);
  });

  it('NOT-1: a later change to the same entry carries the same tag (it replaces the earlier one); another entry’s differs', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const added = row({ id: 'out-1' });
    const changed = row({ id: 'out-2', kind: 'entry_changed', data: { ...row().data, amount: 4520 } });
    const other = row({ id: 'out-3', data: { ...row().data, ref: OTHER_ENTRY, description: 'Boots' } });
    const { db, state } = fakeDb({ rows: [added, changed, other], subs: [jae.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    const payloads = services.sent.map((s) => payloadOf(s, jae));
    expect(payloads).toHaveLength(3);
    const [a, b, c] = payloads;
    expect(a?.tag).toBeTruthy();
    expect(b?.tag).toBe(a?.tag);
    expect(c?.tag).not.toBe(a?.tag);
    expect(b?.body).toBe('Sam changed Tesco to £45.20 · Sam owes Jae £24.50');
    expect([...state.sent].sort()).toEqual(['out-1', 'out-2', 'out-3']);
  });

  it('NOT-1: a subscription the push service says is gone (404, 410) is removed; the row still counts as sent', async () => {
    const phoneGone = phone(JAE, 'https://fcm.googleapis.com/fcm/send/gone-410');
    const phoneMissing = phone(JAE, 'https://fcm.googleapis.com/fcm/send/missing-404');
    const phoneOk = phone(JAE, 'https://fcm.googleapis.com/fcm/send/ok');
    const { db, state } = fakeDb({ rows: [row()], subs: [phoneGone.row, phoneMissing.row, phoneOk.row] });
    const services = pushServices({ [phoneGone.row.endpoint]: 410, [phoneMissing.row.endpoint]: 404 });
    await handle()(fromDatabase(), deps(db, services.fetch));
    expect([...state.removed].sort()).toEqual([phoneMissing.row.endpoint, phoneGone.row.endpoint].sort());
    expect(state.subs.map((s) => s.endpoint)).toEqual([phoneOk.row.endpoint]);
    expect(state.sent).toEqual(['out-1']);

    const only = phone(JAE, 'https://fcm.googleapis.com/fcm/send/only-one-410');
    const second = fakeDb({ rows: [row({ id: 'out-9' })], subs: [only.row] });
    await handle()(fromDatabase(), deps(second.db, pushServices({ [only.row.endpoint]: 410 }).fetch));
    expect(second.state.removed).toEqual([only.row.endpoint]);
    expect(second.state.sent).toEqual(['out-9']);
  });

  it('NOT-1: a push service that is down leaves the row for the next minute; the subscription is kept', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const { db, state } = fakeDb({ rows: [row()], subs: [jae.row] });
    await handle()(fromDatabase(), deps(db, pushServices({ [jae.row.endpoint]: 500 }).fetch));
    expect(state.sent).toEqual([]);
    expect(state.removed).toEqual([]);
    // A minute later it works.
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    expect(services.sent).toHaveLength(1);
    expect(state.sent).toEqual(['out-1']);
  });

  it('NOT-1: a recipient with no phone switched on: nothing to send, the row is done', async () => {
    const { db, state } = fakeDb({ rows: [row()], subs: [] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    expect(services.sent).toEqual([]);
    expect(state.sent).toEqual(['out-1']);
  });

  it('NOT-1: switched-off kinds are skipped: what next_notifications leaves out is never sent, and nothing else is read', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    // The comment is switched off: next_notifications (the database) leaves it out, so this fake does too.
    const comment = row({ id: 'out-comment', kind: 'comment', data: { actor: SAM, ref: ENTRY, description: 'Tesco', comment: 'was this the big shop?' } });
    const { db, state } = fakeDb({ rows: [row()], subs: [jae.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    expect(services.sent.map((s) => payloadOf(s, jae).body)).toEqual(['Sam added Tesco £42.50 · Sam owes Jae £24.50']);
    expect(state.sent).not.toContain(comment.id);
    expect(services.sent.every((s) => s.url === jae.row.endpoint)).toBe(true);
  });

  it('NOT-1: an empty outbox sends nothing and answers 200', async () => {
    const { db } = fakeDb({ rows: [] });
    const services = pushServices();
    const res = await handle()(fromDatabase(), deps(db, services.fetch));
    expect(res.status).toBe(200);
    expect(services.sent).toEqual([]);
  });

  it('NOT-1: a long description still fits one push (≤ 4096 bytes) and says at most 180 characters', async () => {
    const jae = phone(JAE, 'https://fcm.googleapis.com/fcm/send/jae-phone');
    const long = row({ data: { ...row().data, description: '편의점 '.repeat(200) } });
    const { db } = fakeDb({ rows: [long], subs: [jae.row] });
    const services = pushServices();
    await handle()(fromDatabase(), deps(db, services.fetch));
    const s = services.sent[0];
    if (!s) throw new Error('no push');
    expect(s.body.length).toBeLessThanOrEqual(4096);
    expect(Array.from(payloadOf(s, jae).body).length).toBeLessThanOrEqual(180);
  });
});

// ─────────────────────────────── one source of truth for the words ───────────────────────────────

describe('push function: the words come from src/core/notify.ts (NOT-1)', () => {
  it('NOT-1: a copy for the functions bundler, if there is one, is identical to the core', () => {
    const copy = resolve(process.cwd(), 'supabase/functions/_shared/notify.ts');
    const source = resolve(process.cwd(), 'src/core/notify.ts');
    expect(existsSync(source), 'src/core/notify.ts exists').toBe(true);
    if (existsSync(copy)) expect(readFileSync(copy, 'utf8')).toBe(readFileSync(source, 'utf8'));
  });
});
