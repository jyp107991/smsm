/// <reference types="node" />
/**
 * S8 fresh-review fixes to the push function (NOT-1, NOT-2): a batch of the partner's entry changes is one
 * notification; each row is marked sent as soon as it is done (a database failure later never sends it again); a
 * subscription that can't be removed never stops the run; every push has a time limit; a comment and an approval tag
 * themselves so each alerts; what push services say is kept; ?init=1 does nothing once set up.
 */
import { createDecipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes, type ECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handle, type Outgoing, type PushConfig, type PushDb, type SubscriptionRow } from '../../supabase/functions/push/handler';

const URL_ = 'https://test-project.supabase.co';
const FUNCTION = `${URL_}/functions/v1/push`;
const TOKEN = 'db-made-token-0123456789abcdef0123456789abcdef';
const JAE = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000b1';
const NAMES = { [JAE]: 'Jae', [SAM]: 'Sam' };
const BALANCE = { [JAE]: 2450, [SAM]: -2450 };
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

function keys(): { vapid_public: string; vapid_private: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { vapid_public: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x ?? '', 'base64url'), Buffer.from(jwk.y ?? '', 'base64url')])), vapid_private: JSON.stringify(jwk) };
}
const READY: PushConfig = { ...keys(), token: TOKEN, function_url: FUNCTION };

interface Phone { row: SubscriptionRow; ecdh: ECDH; auth: Buffer }
function phone(endpoint: string, user = JAE): Phone {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { row: { user_id: user, endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) }, ecdh, auth };
}
const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
function read(body: Buffer, p: Phone): Record<string, unknown> {
  const salt = body.subarray(0, 16);
  const idlen = body[20] ?? 0;
  const server = body.subarray(21, 21 + idlen);
  const rec = body.subarray(21 + idlen);
  const ikm = hmac(hmac(p.auth, p.ecdh.computeSecret(server)), Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), p.ecdh.getPublicKey(), server, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const d = createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'latin1')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'latin1')).subarray(0, 12));
  d.setAuthTag(rec.subarray(rec.length - 16));
  const plain = Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8')) as Record<string, unknown>;
}

function entry(id: string, kind: Outgoing['kind'] = 'entry_added', ref = `e-${id}`): Outgoing {
  return { id, recipient: JAE, kind, data: { actor: SAM, ref, description: `Shop ${id}`, amount: 1000 as never, balance: BALANCE as never }, names: NAMES, animal: 'dog', badge: 2 };
}

function fakeDb(rows: Outgoing[], subs: SubscriptionRow[], over: Partial<PushDb> = {}) {
  const state = { sent: [] as string[], removed: [] as string[], notes: [] as [string, boolean][], saves: 0, config: { ...READY } };
  const db: PushDb = {
    config: () => Promise.resolve({ ...state.config }),
    saveConfig: (p) => { state.saves += 1; state.config = { ...state.config, ...p }; return Promise.resolve(); },
    next: (limit) => Promise.resolve(rows.filter((r) => !state.sent.includes(r.id)).slice(0, limit)),
    subscriptions: (ids) => Promise.resolve(subs.filter((s) => ids.includes(s.user_id))),
    markSent: (ids) => { state.sent.push(...ids); return Promise.resolve(); },
    removeSubscription: (e) => { state.removed.push(e); return Promise.resolve(); },
    noteResult: (e, ok) => { state.notes.push([e, ok]); return Promise.resolve(); },
    ...over,
  };
  return { db, state };
}
function services(status: Record<string, number> = {}) {
  const sent: { url: string; body: Buffer; signal: AbortSignal | null }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: Buffer.from(init.body as Uint8Array), signal: init.signal ?? null });
    await Promise.resolve();
    return new Response(null, { status: status[url] ?? 201 });
  });
  return { fetch: f as unknown as typeof fetch, sent };
}
const call = (db: PushDb, f: typeof fetch) => handle(new Request(FUNCTION, { method: 'POST', headers: { 'x-push-token': TOKEN } }), { db, fetch: f, env: { SUPABASE_URL: URL_ }, now: () => new Date() });

describe('a batch of the partner’s entry changes is one notification (NOT-1, NOT-2; review fix 2)', () => {
  it('NOT-1 NOT-2: 30 entries added at once (a bank import): one push, "Sam added 30 entries", tag entries:<Sam>, renotify, opens Activity; all 30 done', async () => {
    const jae = phone('https://fcm.googleapis.com/fcm/send/jae');
    const rows = Array.from({ length: 30 }, (_, i) => entry(`r${String(i)}`));
    const { db, state } = fakeDb(rows, [jae.row]);
    const s = services();
    await call(db, s.fetch);
    expect(s.sent).toHaveLength(1);
    const p = read(s.sent[0]?.body ?? Buffer.alloc(0), jae);
    expect(p).toMatchObject({ body: 'Sam added 30 entries · Sam owes Jae £24.50', path: '/activity', tag: `entries:${SAM}`, renotify: true, icon: '/icons/head-dog.png', count: 2 });
    expect([...state.sent].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('NOT-1: mixed kinds say "made N changes"; one or two stay single notifications; other kinds never join a batch', async () => {
    const jae = phone('https://fcm.googleapis.com/fcm/send/jae');
    const comment: Outgoing = { ...entry('c1', 'comment'), data: { actor: SAM, ref: 'e-x', description: 'Tesco', comment: 'big shop?', commentId: 'cm-1', balance: BALANCE as never } };
    const { db } = fakeDb([entry('a'), entry('b', 'entry_changed'), comment, entry('d', 'entry_deleted')], [jae.row]);
    const s = services();
    await call(db, s.fetch);
    expect(s.sent.map((x) => read(x.body, jae)['body'])).toEqual(['Sam made 3 changes · Sam owes Jae £24.50', 'Sam commented on Tesco: “big shop?”']);
    const two = fakeDb([entry('a'), entry('b')], [jae.row]);
    const s2 = services();
    await call(two.db, s2.fetch);
    expect(s2.sent.map((x) => read(x.body, jae)['tag'])).toEqual(['entry:e-a', 'entry:e-b']);
  });
});

describe('each row is done as soon as it is (review fix 4)', () => {
  it('NOT-1: a database failure partway through never sends again what was already delivered', async () => {
    const jae = phone('https://fcm.googleapis.com/fcm/send/jae');
    const rows = [entry('one'), { ...entry('two', 'settle_added'), data: { actor: SAM, ref: 's2', amount: 500 as never, balance: BALANCE as never } }, entry('three', 'comment')];
    let failOnce = true;
    const { db, state } = fakeDb(rows, [jae.row]);
    const markSent = db.markSent.bind(db);
    db.markSent = (ids) => {
      if (ids.includes('two') && failOnce) { failOnce = false; return Promise.reject(new Error('connection lost')); }
      return markSent(ids);
    };
    const s = services();
    expect((await call(db, s.fetch)).status).toBe(500);
    expect(state.sent).toEqual(['one']);
    await call(db, s.fetch);
    const ones = s.sent.filter((x) => read(x.body, jae)['tag'] === 'entry:e-one');
    expect(ones).toHaveLength(1);
    expect([...state.sent].sort()).toEqual(['one', 'three', 'two']);
  });

  it('NOT-1: a subscription that can’t be removed never stops the run; every push has a time limit', async () => {
    const gone = phone('https://fcm.googleapis.com/fcm/send/gone');
    const ok = phone('https://fcm.googleapis.com/fcm/send/ok');
    const { db, state } = fakeDb([entry('one')], [gone.row, ok.row], { removeSubscription: () => Promise.reject(new Error('timeout')) });
    const s = services({ [gone.row.endpoint]: 410 });
    expect((await call(db, s.fetch)).status).toBe(200);
    expect(state.sent).toEqual(['one']);
    for (const x of s.sent) expect(x.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('tags that alert (review fix 5)', () => {
  it('ACT-4 NOT-1: each comment has its own tag; an approval alerts again when its tag comes back', async () => {
    const jae = phone('https://fcm.googleapis.com/fcm/send/jae');
    const comment = (id: string, cid: string): Outgoing => ({ ...entry(id, 'comment'), data: { actor: SAM, ref: 'e-1', description: 'Tesco', comment: 'hi', commentId: cid, balance: BALANCE as never } });
    const approval: Outgoing = { ...entry('ap', 'approval_waiting'), data: { actor: SAM, ref: 'req-1', request: 'default_ratio' } };
    const { db } = fakeDb([comment('c1', 'cm-1'), comment('c2', 'cm-2'), approval], [jae.row]);
    const s = services();
    await call(db, s.fetch);
    const ps = s.sent.map((x) => read(x.body, jae));
    expect(ps.map((p) => p['tag'])).toEqual(['comment:cm-1', 'comment:cm-2', 'approval:req-1']);
    expect(ps[2]?.['renotify']).toBe(true);
    expect(ps[0]?.['renotify']).toBeUndefined();
  });
});

describe('what push services say is kept (review fix 7)', () => {
  it('NOT-1: taken: noted well; 400/401/403/413: noted as failing and the row waits; busy or down: not counted', async () => {
    const good = phone('https://fcm.googleapis.com/fcm/send/good');
    const forbidden = phone('https://fcm.googleapis.com/fcm/send/forbidden', SAM);
    const down = phone('https://fcm.googleapis.com/fcm/send/down', SAM);
    const toSam: Outgoing = { ...entry('s', 'approval_waiting'), recipient: SAM, data: { actor: JAE, ref: 'req', request: 'identity' } };
    const { db, state } = fakeDb([entry('j'), toSam], [good.row, forbidden.row, down.row]);
    await call(db, services({ [forbidden.row.endpoint]: 403, [down.row.endpoint]: 503 }).fetch);
    expect(state.notes).toEqual([[good.row.endpoint, true], [forbidden.row.endpoint, false]]);
    expect(state.sent).toEqual(['j']);
    for (const status of [400, 401, 413]) {
      const again = fakeDb([toSam], [forbidden.row]);
      await call(again.db, services({ [forbidden.row.endpoint]: status }).fetch);
      expect(again.state.notes, String(status)).toEqual([[forbidden.row.endpoint, false]]);
      expect(again.state.removed).toEqual([]);
    }
  });
});

describe('?init=1 once set up (review fix 8)', () => {
  it('NOT-1: does nothing at all: 204, no write', async () => {
    const { db, state } = fakeDb([], []);
    const res = await handle(new Request(`${FUNCTION}?init=1`, { method: 'POST' }), { db, fetch: services().fetch, env: { SUPABASE_URL: URL_ } });
    expect(res.status).toBe(204);
    expect(state.saves).toBe(0);
  });
});
