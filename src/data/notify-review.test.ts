/**
 * S8 fresh-review fixes on the phone (NOT-1): signing out stops notifications on that phone, best effort and never
 * holding sign-out up; push addresses are the push services' only; an endpoint moves to another account only on the
 * same phone (its own keys) within the household.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, JAE_ID, SAM_ID } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { FAKE_AUTH, FAKE_P256DH, installPush, publicKey, uninstallPush } from '../../tests/fixtures/fake-push';
import type { MemoryTables } from './memoryApi';
import { signOut } from './mutations';
import type { DataLayer } from './queryClient';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Sub { user_id: string; endpoint: string; p256dh: string; auth: string }
type Tables = MemoryTables & { pushPublicKey?: string | null; pushSubscriptions?: Sub[] };
const KEY = publicKey(3);
const HERE = 'https://fcm.googleapis.com/fcm/send/this-phone';
const open: DataLayer[] = [];

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); idbData.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
  uninstallPush();
});

function household(subs: Sub[] = []) {
  const c = couple();
  open.push(c.layer);
  const t = c.controls.tables as Tables;
  t.pushPublicKey = KEY;
  t.pushSubscriptions = subs;
  return { ...c, subs: () => (c.controls.tables as Tables).pushSubscriptions ?? [] };
}
async function ready(layer: DataLayer) {
  await layer.ready;
  await act(async () => { await layer.idle(); });
}

describe('signing out stops notifications on this phone (NOT-1; review fix 1)', () => {
  it('NOT-1: the server forgets this phone (while still signed in), then the browser drops the subscription', async () => {
    const push = installPush({ permission: 'granted', existing: { endpoint: HERE, key: KEY } });
    const other = { user_id: JAE_ID, endpoint: 'https://fcm.googleapis.com/fcm/send/jae-other-phone', p256dh: 'x', auth: 'y' };
    const c = household([{ user_id: JAE_ID, endpoint: HERE, p256dh: FAKE_P256DH, auth: FAKE_AUTH }, other]);
    await ready(c.layer);
    await signOut({}, c.layer);
    expect(push.unsubscribed).toEqual([HERE]);
    expect(c.subs().map((s) => s.endpoint)).toEqual([other.endpoint]);
    const calls = c.controls.calls.map((x) => x.name);
    expect(calls.indexOf('removePushSubscription')).toBeLessThan(calls.indexOf('auth.signOut'));
  });

  it('NOT-1: the server refusing, or too slow, never holds sign-out up; the browser drops it anyway', async () => {
    const push = installPush({ permission: 'granted', existing: { endpoint: HERE, key: KEY } });
    const c = household([{ user_id: JAE_ID, endpoint: HERE, p256dh: FAKE_P256DH, auth: FAKE_AUTH }]);
    await ready(c.layer);
    c.controls.delay = (name) => (name === 'removePushSubscription' ? 60_000 : 0);
    const started = Date.now();
    await signOut({}, c.layer);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(push.unsubscribed).toEqual([HERE]);
    expect(c.controls.calls.some((x) => x.name === 'auth.signOut')).toBe(true);
  }, 10_000);

  it('NOT-1: with no subscription, or no support, sign-out is as before', async () => {
    installPush({ support: 'none' });
    const c = household();
    await ready(c.layer);
    await signOut({}, c.layer);
    expect(c.controls.calls.some((x) => x.name === 'removePushSubscription')).toBe(false);
  });
});

describe('push addresses (NOT-1; review fix 8)', () => {
  it('NOT-1: only the push services browsers use', async () => {
    const c = household();
    await ready(c.layer);
    await expect(c.layer.api.savePushSubscription({ endpoint: 'https://push.example.com/x', p256dh: 'p', auth: 'a' })).rejects.toThrow();
    await expect(c.layer.api.savePushSubscription({ endpoint: 'https://fcm.googleapis.com.evil.example/x', p256dh: 'p', auth: 'a' })).rejects.toThrow();
    await c.layer.api.savePushSubscription({ endpoint: 'https://web.push.apple.com/QGs', p256dh: 'p', auth: 'a' });
    await c.layer.api.savePushSubscription({ endpoint: 'https://wns2-par02p.notify.windows.com/w/?token=x', p256dh: 'p', auth: 'a' });
    expect(c.subs()).toHaveLength(2);
  });

  it('NOT-1: the partner’s endpoint moves only with its own keys (the same phone handed over)', async () => {
    const c = household([{ user_id: SAM_ID, endpoint: HERE, p256dh: 'sam-p', auth: 'sam-a' }]);
    await ready(c.layer);
    await expect(c.layer.api.savePushSubscription({ endpoint: HERE, p256dh: 'other', auth: 'other' })).rejects.toThrow();
    expect(c.subs()[0]?.user_id).toBe(SAM_ID);
    await c.layer.api.savePushSubscription({ endpoint: HERE, p256dh: 'sam-p', auth: 'sam-a' });
    expect(c.subs()).toEqual([{ user_id: JAE_ID, endpoint: HERE, p256dh: 'sam-p', auth: 'sam-a' }]);
  });

  it('NOT-1: another household’s endpoint is never taken', async () => {
    const stranger = '00000000-0000-4000-8000-0000000000d9';
    const c = household([{ user_id: stranger, endpoint: HERE, p256dh: 'p', auth: 'a' }]);
    await ready(c.layer);
    await expect(c.layer.api.savePushSubscription({ endpoint: HERE, p256dh: 'p', auth: 'a' })).rejects.toThrow();
    expect(c.subs()[0]?.user_id).toBe(stranger);
  });
});
