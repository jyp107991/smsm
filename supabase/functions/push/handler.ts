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
import { BATCH_FROM, batchText, ENTRY_KINDS, notificationText, type NotificationData, type NotificationKind } from '../_shared/notify.ts';

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
  /**
   * What a push service said (note_push_result): taken, or refused in a way that counts against the subscription
   * (it is forgotten after 24 hours of that). Optional: a database that doesn't keep it simply isn't told.
   */
  noteResult?(endpoint: string, ok: boolean): Promise<void>;
}

export interface PushDeps {
  db: PushDb;
  /** Used only for the push services. */
  fetch: typeof fetch;
  env: { SUPABASE_URL: string };
  now?: () => Date;
}

/** What public/push.js shows. */
export interface PushPayload { title: string; body: string; path: string; tag: string; icon: string; count: number; renotify?: boolean }

const BATCH = 100;
/** How long a push service keeps a push for a phone that is off (seconds). */
const TTL = 24 * 60 * 60;
/** The VAPID token's life (RFC 8292: at most 24 hours). */
const VAPID_LIFE = 12 * 60 * 60;
const APP_ICON = '/icons/icon-192.png';
/** How long one push service may take to answer (ms). */
const PUSH_TIMEOUT = 10_000;

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
      // Each comment its own notification (a reply never silently replaces the one before).
      return `comment:${row.data.commentId ?? ref ?? row.id}`;
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

const iconOf = (row: Outgoing) => (row.animal === 'cat' || row.animal === 'dog' ? `/icons/head-${row.animal}.png` : APP_ICON);
const countOf = (row: Outgoing) => Math.max(0, Math.trunc(row.badge));

export function payloadOf(row: Outgoing): PushPayload {
  const { title, body, path } = notificationText(row.kind, row.data, row.names);
  const tag = tagOf(row);
  // A tag that comes back (a request waiting, then decided) alerts again rather than replacing quietly.
  return { title, body, path, tag, icon: iconOf(row), count: countOf(row), ...(tag.startsWith('approval:') ? { renotify: true } : {}) };
}

/** One notification and the outbox rows it stands for. */
interface Message { ids: string[]; recipient: string; payload: PushPayload }

/**
 * The rows as notifications: one each, except a batch of one person's entry changes for the same person (a bank
 * import, a phone's queue synced at once) of BATCH_FROM or more, which is one ("Kim added 30 entries").
 */
export function messagesOf(rows: readonly Outgoing[]): Message[] {
  const batches = new Map<string, Outgoing[]>();
  const keyOf = (r: Outgoing) => (ENTRY_KINDS.includes(r.kind) && r.data.actor ? `${r.recipient}|${r.data.actor}` : null);
  for (const r of rows) {
    const k = keyOf(r);
    if (k) batches.set(k, [...(batches.get(k) ?? []), r]);
  }
  const out: Message[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r);
    const batch = k ? batches.get(k) ?? [] : [];
    if (k && batch.length >= BATCH_FROM) {
      if (done.has(k)) continue;
      done.add(k);
      const last = batch[batch.length - 1] ?? r;
      const { title, body, path } = batchText(batch.map((b) => b.kind), last.data, last.names);
      out.push({
        ids: batch.map((b) => b.id), recipient: r.recipient,
        payload: { title, body, path, tag: `entries:${r.data.actor ?? ''}`, icon: iconOf(last), count: countOf(last), renotify: true },
      });
    } else {
      out.push({ ids: [r.id], recipient: r.recipient, payload: payloadOf(r) });
    }
  }
  return out;
}

type Outcome = 'ok' | 'gone' | 'failed' | 'refused';

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
      signal: AbortSignal.timeout(PUSH_TIMEOUT),
    });
    if (res.status >= 200 && res.status < 300) return 'ok';
    if (res.status === 404 || res.status === 410) return 'gone';
    // Busy or down: try again next minute. Anything else (400, 401, 403, 413…) counts against the subscription.
    if (res.status === 429 || res.status >= 500) return 'failed';
    return 'refused';
  } catch {
    return 'failed';
  }
}

async function quietly(p: Promise<void> | undefined): Promise<void> {
  try {
    await p;
  } catch (err) {
    console.error('push:', err instanceof Error ? err.message : String(err));
  }
}

async function drain(deps: PushDeps, config: PushConfig): Promise<{ sent: number; waiting: number }> {
  const rows = await deps.db.next(BATCH);
  if (rows.length === 0) return { sent: 0, waiting: 0 };
  const recipients = [...new Set(rows.map((r) => r.recipient))];
  let subs = await deps.db.subscriptions(recipients);
  let sent = 0;
  let waiting = 0;
  for (const message of messagesOf(rows)) {
    const mine = subs.filter((s) => s.user_id === message.recipient);
    const outcomes: Outcome[] = [];
    for (const sub of mine) {
      const outcome = await sendOne(sub, message.payload, config, deps);
      outcomes.push(outcome);
      if (outcome === 'gone') {
        await quietly(deps.db.removeSubscription(sub.endpoint));
        subs = subs.filter((s) => s.endpoint !== sub.endpoint);
      } else if (outcome === 'ok' || outcome === 'refused') {
        await quietly(deps.db.noteResult?.(sub.endpoint, outcome === 'ok'));
      }
    }
    // Sent once a phone took it; done too when every phone was gone or there are none. Otherwise it waits for
    // the next minute's run (the database drops it after 2 days). Marked at once, so a failure later in this run
    // never sends it again.
    if (outcomes.includes('ok') || outcomes.every((o) => o === 'gone')) {
      await deps.db.markSent(message.ids);
      sent += message.ids.length;
    } else waiting += message.ids.length;
  }
  return { sent, waiting };
}

export async function handle(req: Request, deps: PushDeps): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('init') === '1') {
      // Anyone may call it, so once it is set up it does nothing at all: a read, no write, an empty answer.
      const stored = await deps.db.config();
      if (stored?.vapid_public && stored.vapid_private && stored.function_url) return new Response(null, { status: 204 });
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
