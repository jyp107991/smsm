/**
 * The push Edge Function's work (S8; NOT-1, NOT-2, NOT-3, INB-2), with its database and network passed in so it
 * runs the same under Deno (index.ts) and in Vitest (tests/unit/push-function.test.ts).
 *
 * - `?init=1` (any method, no secret): fills in only what is missing in push_config: a P-256 key pair (the public
 *   key as base64url of the raw 65-byte point, as a browser's applicationServerKey takes it; the private key as
 *   its JWK) and this function's own address. Never replaces a stored value, never touches the token.
 * - POST with `x-push-token: <push_config.token>` (the database's call through pg_net): takes up to 100 waiting
 *   notifications (next_notifications), words each with src/core/notify.ts, sends a standard Web Push to each of
 *   the recipient's phones (RFC 8291 aes128gcm, via @block65/webcrypto-web-push; RFC 8292 VAPID, signed here with
 *   the injected clock), forgets a phone its push service says is gone (404, 410) and marks the row sent when a
 *   push was accepted, every phone was gone, or the recipient has none. Anything else: 401.
 */
import { encryptNotification } from '@block65/webcrypto-web-push';
import { notificationText, type NotificationData, type NotificationKind } from '../_shared/notify.ts';

export interface PushConfig { vapid_public: string | null; vapid_private: string | null; token: string | null; function_url: string | null }

/** One row of next_notifications(limit). */
export interface Outgoing {
  id: string;
  recipient: string;
  kind: NotificationKind;
  data: NotificationData;
  names: Record<string, string>;
  animal: 'cat' | 'dog' | null;
  badge: number;
}

export interface SubscriptionRow { user_id: string; endpoint: string; p256dh: string; auth: string }

export interface PushDb {
  config(): Promise<PushConfig | null>;
  saveConfig(patch: Partial<PushConfig>): Promise<void>;
  next(limit: number): Promise<Outgoing[]>;
  subscriptions(userIds: readonly string[]): Promise<SubscriptionRow[]>;
  markSent(ids: readonly string[]): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
}

export interface PushDeps {
  db: PushDb;
  /** Used only for the push services. */
  fetch: typeof fetch;
  env: { SUPABASE_URL: string };
  now?: () => Date;
}

/** What public/push.js shows. */
export interface PushPayload { title: string; body: string; path: string; tag: string; icon: string; count: number }

const BATCH = 100;
/** How long a push service keeps a push for a phone that is off (seconds). */
const TTL = 24 * 60 * 60;
/** The VAPID token's life (RFC 8292: at most 24 hours). */
const VAPID_LIFE = 12 * 60 * 60;
const APP_ICON = '/icons/icon-192.png';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64uText = (s: string) => b64u(new TextEncoder().encode(s));

/** The same length and the same characters, without stopping at the first difference. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function newKeyPair(): Promise<{ vapid_public: string; vapid_private: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { vapid_public: b64u(raw), vapid_private: JSON.stringify(jwk) };
}

/** Fills in only what is missing: the keys, the function's own address. Returns the config as it now is. */
async function setUp(deps: PushDeps): Promise<PushConfig> {
  const stored = (await deps.db.config()) ?? { vapid_public: null, vapid_private: null, token: null, function_url: null };
  const patch: Partial<PushConfig> = {};
  if (!stored.vapid_public || !stored.vapid_private) Object.assign(patch, await newKeyPair());
  if (!stored.function_url) patch.function_url = `${deps.env.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/push`;
  if (Object.keys(patch).length > 0) await deps.db.saveConfig(patch);
  return { ...stored, ...patch };
}

/** RFC 8292: `vapid t=<ES256 JWT>, k=<public key>`; aud the push service's origin, sub this project's address. */
async function vapidAuthorization(endpoint: string, config: PushConfig, deps: PushDeps): Promise<string> {
  const jwk = JSON.parse(config.vapid_private ?? '{}') as JsonWebKey;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const head = b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uText(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + VAPID_LIFE, sub: deps.env.SUPABASE_URL }));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${config.vapid_public ?? ''}`;
}

/** Two rows about the same thing share a tag, so a later change replaces the earlier notification. */
function tagOf(row: Outgoing): string {
  const ref = row.data.ref ?? null;
  switch (row.kind) {
    case 'entry_added': case 'entry_changed': case 'entry_deleted': case 'entry_restored':
      return `entry:${ref ?? row.id}`;
    case 'settle_added': case 'settle_changed': case 'settle_deleted':
      return `settle:${ref ?? row.id}`;
    case 'comment':
      return `comment:${ref ?? row.id}`;
    case 'approval_waiting': case 'approval_decided':
      return `approval:${ref ?? row.id}`;
    case 'bill_posted': case 'bill_tomorrow':
      return `bill:${ref ?? row.id}`;
    case 'recap_ready':
      return `recap:${row.data.month ?? row.id}`;
    case 'settle_day': case 'balance_reminder':
      return row.kind;
  }
}

export function payloadOf(row: Outgoing): PushPayload {
  const { title, body, path } = notificationText(row.kind, row.data, row.names);
  const icon = row.animal === 'cat' || row.animal === 'dog' ? `/icons/head-${row.animal}.png` : APP_ICON;
  return { title, body, path, tag: tagOf(row), icon, count: Math.max(0, Math.trunc(row.badge)) };
}

type Outcome = 'ok' | 'gone' | 'failed';

async function sendOne(sub: SubscriptionRow, payload: PushPayload, config: PushConfig, deps: PushDeps): Promise<Outcome> {
  let body: Uint8Array;
  try {
    body = await encryptNotification(
      { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      new TextEncoder().encode(JSON.stringify(payload)),
    );
  } catch {
    // Keys no browser would make, or an address that isn't a push service: this subscription can never work.
    return 'gone';
  }
  try {
    const res = await deps.fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, config, deps),
        ttl: String(TTL),
        urgency: 'normal',
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
      },
      body: body as BodyInit,
    });
    if (res.status >= 200 && res.status < 300) return 'ok';
    if (res.status === 404 || res.status === 410) return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}

async function drain(deps: PushDeps, config: PushConfig): Promise<{ sent: number; waiting: number }> {
  const rows = await deps.db.next(BATCH);
  if (rows.length === 0) return { sent: 0, waiting: 0 };
  const recipients = [...new Set(rows.map((r) => r.recipient))];
  let subs = await deps.db.subscriptions(recipients);
  const done: string[] = [];
  let waiting = 0;
  for (const row of rows) {
    const payload = payloadOf(row);
    const mine = subs.filter((s) => s.user_id === row.recipient);
    const outcomes: Outcome[] = [];
    for (const sub of mine) {
      const outcome = await sendOne(sub, payload, config, deps);
      outcomes.push(outcome);
      if (outcome === 'gone') {
        await deps.db.removeSubscription(sub.endpoint);
        subs = subs.filter((s) => s.endpoint !== sub.endpoint);
      }
    }
    // Sent once a phone took it; done too when every phone was gone or there are none. Otherwise it waits for
    // the next minute's run (the database drops it after 2 days).
    if (outcomes.includes('ok') || outcomes.every((o) => o === 'gone')) done.push(row.id);
    else waiting += 1;
  }
  if (done.length > 0) await deps.db.markSent(done);
  return { sent: done.length, waiting };
}

export async function handle(req: Request, deps: PushDeps): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('init') === '1') {
      await setUp(deps);
      return json(200, { ok: true });
    }
    if (req.method !== 'POST') return json(405, { ok: false });
    const given = req.headers.get('x-push-token') ?? '';
    const config = await deps.db.config();
    const token = config?.token ?? '';
    if (token === '' || given === '' || !sameToken(given, token)) return json(401, { ok: false });
    const ready = config && config.vapid_public && config.vapid_private ? config : await setUp(deps);
    return json(200, { ok: true, ...(await drain(deps, ready)) });
  } catch (err) {
    console.error('push:', err instanceof Error ? err.message : String(err));
    return json(500, { ok: false });
  }
}
