/**
 * S8 data layer (docs/slices/S8.md "Decisions made here → Switches, Subscriptions, Icon badge, Offline", "Data → Data",
 * "Tests → Data/screens"; SPEC NOT-1, NOT-3, INB-2, OFF-4): the person's notification switches (synced between their
 * phones, changed offline and sent later through the queue), this phone's push subscription (allowed, turned off,
 * checked against the current public key on every open), and the app-icon badge's count, over the in-memory Api and
 * the browser faked in tests/fixtures/fake-push.ts. Written before the build (ENGINEERING §5, tests first by someone
 * else); each test names its SPEC ids.
 *
 * Interface these tests expect, in src/data/notifications.ts (also re-exported from src/data/index.ts):
 *   notificationPrefs(layer?) → NotificationPrefs                    (at once, from the phone's copy, waiting changes applied)
 *   setNotificationPref(key: PrefKey, value: boolean | Pence, layer?) → void
 *     A boolean sets the switch; for 'balance' a number sets the amount instead (balance_threshold_pence; whole pence
 *     above 0, else it throws and nothing changes). Shown at once; sent through the queue (offline too, kept across a
 *     restart) to the set_notification_prefs RPC.
 *   pushState(layer?) → Promise<'unsupported' | 'blocked' | 'off' | 'on'>
 *     'unsupported' without Notification, PushManager or a service worker; 'blocked' when Notification.permission is
 *     'denied'; 'on' when permission is 'granted' and this phone has a push subscription; else 'off'.
 *   enablePush(layer?) → Promise<PushState>
 *     Asks the browser (Notification.requestPermission); if granted, subscribes ({ userVisibleOnly: true,
 *     applicationServerKey: the bytes of push_public_key() }) and saves the subscription (save_push_subscription with
 *     the endpoint and its p256dh and auth keys). Returns the new state ('blocked' if refused).
 *   disablePush(layer?) → Promise<unknown>: unsubscribes this phone and removes its subscription; the switches stay.
 *   refreshPush(layer?) → Promise<void>: what the app does on every open: if this phone has a subscription made with an
 *     older public key, unsubscribes and subscribes again with the current one (the old endpoint is removed, the new
 *     one saved); with a current one, saves it again (so the server knows it is this person's); nothing without
 *     permission, support or a connection, and never throws.
 *   badgeCount(layer?) → Promise<number>: open Inbox items + this phone's waiting import rows + change requests waiting
 *     for this person (the partner's, pending).
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - NotificationPrefs = { entries, settle_ups, comments, bills_today, bills_tomorrow, recap, balance: boolean;
 *     balance_threshold_pence: Pence } (notification_prefs' columns, tests/sql/notifications_test.sql); PrefKey is one of
 *     the seven switch names. Defaults: all on except bills_tomorrow and balance; £100.00.
 *   - The Api gains pushPublicKey(), savePushSubscription({ endpoint, p256dh, auth }), removePushSubscription(endpoint),
 *     notificationPrefs(userId) and setNotificationPrefs(patch). The in-memory Api keeps them in controls.tables:
 *     pushPublicKey (string | null), pushSubscriptions ({ user_id, endpoint, p256dh, auth }[]) and notificationPrefs
 *     (notification_prefs rows); setNotificationPrefs merges the patch into the signed-in person's row (made with the
 *     defaults if missing). Reads go to the household's refresh like the other tables.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, HID, JAE_ID, SAM_ID, storedInboxItem } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { b64u, FAKE_AUTH, FAKE_P256DH, fromB64u, installPush, publicKey, uninstallPush, type FakePush } from '../../tests/fixtures/fake-push';
import { pence, type Pence } from '../core/money';
import type { ChangeRequestRow } from './api';
import type { MemoryTables } from './memoryApi';
import type { DataLayer } from './queryClient';
import { memoryStorage } from './storage';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
type PrefKey = 'entries' | 'settle_ups' | 'comments' | 'bills_today' | 'bills_tomorrow' | 'recap' | 'balance';
type NotificationPrefs = Record<PrefKey, boolean> & { balance_threshold_pence: Pence };
type PushState = 'unsupported' | 'blocked' | 'off' | 'on';
interface PrefsRow extends Record<PrefKey, boolean> { user_id: string; balance_threshold_pence: number; updated_at?: string }
interface SubscriptionRow { user_id: string; endpoint: string; p256dh: string; auth: string }
interface NotificationsData {
  notificationPrefs(layer?: DataLayer): NotificationPrefs;
  setNotificationPref(key: PrefKey, value: boolean | Pence, layer?: DataLayer): void;
  pushState(layer?: DataLayer): Promise<PushState>;
  enablePush(layer?: DataLayer): Promise<PushState>;
  disablePush(layer?: DataLayer): Promise<unknown>;
  refreshPush(layer?: DataLayer): Promise<void>;
  badgeCount(layer?: DataLayer): Promise<number>;
  startImport(rows: readonly unknown[], source: 'csv' | 'monzo', layer?: DataLayer): Promise<unknown>;
}
const NOTIFICATIONS = './notifications';
const INDEX = './index';
const loadedOwn = (await import(/* @vite-ignore */ NOTIFICATIONS).catch(() => null)) as Partial<NotificationsData> | null;
const loadedIndex = (await import(/* @vite-ignore */ INDEX).catch(() => null)) as Partial<NotificationsData> | null;
const data = { ...(loadedIndex ?? {}), ...(loadedOwn ?? {}) } as Partial<NotificationsData>;
function fn<K extends keyof NotificationsData>(name: K): NotificationsData[K] {
  const f = data[name];
  if (typeof f !== 'function') throw new Error(`src/data/notifications.ts does not export ${name} yet (S8)`);
  return f as NotificationsData[K];
}

type S8Tables = MemoryTables & { pushPublicKey?: string | null; pushSubscriptions?: SubscriptionRow[]; notificationPrefs?: PrefsRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S8Tables;
const prefsRowOf = (c: { controls: { tables: MemoryTables } }, user: string) => (tablesOf(c).notificationPrefs ?? []).find((r) => r.user_id === user);
const subsOf = (c: { controls: { tables: MemoryTables } }) => tablesOf(c).pushSubscriptions ?? [];

const KEY = publicKey(3);
const OLD_KEY = publicKey(5);
const DEFAULTS: NotificationPrefs = {
  entries: true, settle_ups: true, comments: true, bills_today: true, bills_tomorrow: false, recap: true, balance: false,
  balance_threshold_pence: pence(10000),
};
function prefsRow(user: string, over: Partial<PrefsRow> = {}): PrefsRow {
  return { user_id: user, ...DEFAULTS, updated_at: '2026-11-10T12:00:00.000Z', ...over };
}

// ───────── helpers ─────────
const open: DataLayer[] = [];
let push: FakePush | null = null;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); idbData.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
  push?.uninstall();
  push = null;
  uninstallPush();
});
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
/** A household on the in-memory Api with the push tables seeded (before the layer's first read). */
function household(opts: Parameters<typeof couple>[0] & { key?: string | null; prefs?: PrefsRow[]; subs?: SubscriptionRow[] } = {}) {
  const { key = KEY, prefs = [], subs = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = tablesOf(c);
  t.pushPublicKey = key;
  t.notificationPrefs ??= [];
  t.notificationPrefs.push(...prefs);
  t.pushSubscriptions ??= [];
  t.pushSubscriptions.push(...subs);
  return c;
}
async function ready(c: { layer: DataLayer }) {
  await c.layer.ready;
  await settle(c.layer);
}
function offline(c: ReturnType<typeof household>) {
  act(() => { c.network.set(false); });
  c.controls.online = false;
}
function online(c: ReturnType<typeof household>) {
  c.controls.online = true;
  act(() => { c.network.set(true); });
}
const keyBytes = (k: BufferSource | string | undefined) =>
  k === undefined ? '' : typeof k === 'string' ? b64u(fromB64u(k)) : b64u(k instanceof ArrayBuffer ? new Uint8Array(k) : new Uint8Array(k.buffer, k.byteOffset, k.byteLength));
function request(over: Partial<ChangeRequestRow>): ChangeRequestRow {
  return {
    id: crypto.randomUUID(), household_id: HID, requested_by: SAM_ID, kind: 'default_ratio', payload: { ratio: { [JAE_ID]: 60, [SAM_ID]: 40 } },
    status: 'pending', decided_by: null, created_at: '2026-11-13T12:00:00.000Z', decided_at: null, ...over,
  };
}

// ─────────────────────────────── NOT-1: the switches ───────────────────────────────

describe('notificationPrefs / setNotificationPref: one switch per type, per person (NOT-1)', () => {
  it('NOT-1: with nothing saved yet, the defaults: everything on except bills tomorrow and the balance reminder; £100.00', async () => {
    const c = household();
    await ready(c);
    expect(fn('notificationPrefs')(c.layer)).toEqual(DEFAULTS);
  });

  it('NOT-1: this person’s saved switches are read; the partner’s are not theirs', async () => {
    const c = household({ prefs: [prefsRow(JAE_ID, { entries: false, balance: true, balance_threshold_pence: 25000 }), prefsRow(SAM_ID, { comments: false })] });
    await ready(c);
    expect(fn('notificationPrefs')(c.layer)).toEqual({ ...DEFAULTS, entries: false, balance: true, balance_threshold_pence: 25000 });
  });

  it('NOT-1: a switch changes at once and is saved for this person only', async () => {
    const c = household({ prefs: [prefsRow(SAM_ID)] });
    await ready(c);
    fn('setNotificationPref')('bills_tomorrow', true, c.layer);
    expect(fn('notificationPrefs')(c.layer).bills_tomorrow).toBe(true);
    await settle(c.layer);
    expect(prefsRowOf(c, JAE_ID)).toMatchObject({ ...DEFAULTS, bills_tomorrow: true });
    expect(prefsRowOf(c, SAM_ID)).toMatchObject(DEFAULTS);
  });

  it('NOT-1: the balance reminder’s amount is set with a number of pence; its switch with true or false', async () => {
    const c = household();
    await ready(c);
    fn('setNotificationPref')('balance', true, c.layer);
    fn('setNotificationPref')('balance', pence(15000), c.layer);
    expect(fn('notificationPrefs')(c.layer)).toMatchObject({ balance: true, balance_threshold_pence: 15000 });
    await settle(c.layer);
    expect(prefsRowOf(c, JAE_ID)).toMatchObject({ balance: true, balance_threshold_pence: 15000 });
  });

  it('NOT-1: an amount that isn’t whole pence above zero is refused and nothing changes', async () => {
    const c = household();
    await ready(c);
    for (const bad of [0, -100, 12.5, Number.NaN]) {
      expect(() => { fn('setNotificationPref')('balance', bad as Pence, c.layer); }, String(bad)).toThrow();
    }
    await settle(c.layer);
    expect(fn('notificationPrefs')(c.layer).balance_threshold_pence).toBe(10000);
    expect(prefsRowOf(c, JAE_ID)?.balance_threshold_pence ?? 10000).toBe(10000);
  });

  it('NOT-1: a change made on this person’s other phone arrives with the next refresh', async () => {
    const c = household({ prefs: [prefsRow(JAE_ID)] });
    await ready(c);
    const row = prefsRowOf(c, JAE_ID);
    if (!row) throw new Error('no row');
    row.comments = false;
    await act(async () => { await c.layer.refresh(); });
    await settle(c.layer);
    expect(fn('notificationPrefs')(c.layer).comments).toBe(false);
  });
});

describe('the switches offline (OFF-4, OFF-5, NOT-1)', () => {
  it('OFF-4 NOT-1: offline, a switch still changes; it reaches the server once the connection is back', async () => {
    const c = household();
    await ready(c);
    offline(c);
    fn('setNotificationPref')('entries', false, c.layer);
    expect(fn('notificationPrefs')(c.layer).entries).toBe(false);
    await settle(c.layer);
    expect(prefsRowOf(c, JAE_ID)?.entries ?? true).toBe(true);
    online(c);
    await settle(c.layer);
    await vi.waitFor(() => { expect(prefsRowOf(c, JAE_ID)?.entries).toBe(false); });
    expect(fn('notificationPrefs')(c.layer).entries).toBe(false);
  });

  it('OFF-4 OFF-5: a switch changed offline survives closing the app and is sent on the next open', async () => {
    const storage = memoryStorage();
    const first = household({ storage });
    await ready(first);
    offline(first);
    fn('setNotificationPref')('recap', false, first.layer);
    await settle(first.layer);
    await first.layer.flush();
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);

    const second = household({ storage, online: true });
    await ready(second);
    await vi.waitFor(() => { expect(prefsRowOf(second, JAE_ID)?.recap).toBe(false); });
    expect(fn('notificationPrefs')(second.layer).recap).toBe(false);
  });
});

// ─────────────────────────────── NOT-1: this phone ───────────────────────────────

describe('pushState: what this phone can do (NOT-1)', () => {
  it('NOT-1: no notification support at all (an iPhone outside an installed app): unsupported', async () => {
    push = installPush({ support: 'none' });
    const c = household();
    await ready(c);
    expect(await fn('pushState')(c.layer)).toBe('unsupported');
  });

  it('NOT-1: refused in the browser’s settings: blocked', async () => {
    push = installPush({ permission: 'denied' });
    const c = household();
    await ready(c);
    expect(await fn('pushState')(c.layer)).toBe('blocked');
  });

  it('NOT-1: never asked, or allowed but not subscribed: off; allowed and subscribed: on', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    await ready(c);
    expect(await fn('pushState')(c.layer)).toBe('off');
    push = installPush({ permission: 'granted' });
    expect(await fn('pushState')(c.layer)).toBe('off');
    push = installPush({ permission: 'granted', existing: { endpoint: 'https://fcm.googleapis.com/fcm/send/this-phone', key: KEY } });
    expect(await fn('pushState')(c.layer)).toBe('on');
  });
});

describe('enablePush / disablePush: "Allow notifications on this phone" and "Turn off on this phone" (NOT-1)', () => {
  it('NOT-1: allowing asks the browser, subscribes with the server’s public key and saves this phone for this person', async () => {
    push = installPush({ permission: 'default', answer: 'granted' });
    const c = household();
    await ready(c);
    expect(await fn('enablePush')(c.layer)).toBe('on');
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    const opts = push.subscribe.mock.calls[0]?.[0];
    expect(opts?.userVisibleOnly).toBe(true);
    expect(keyBytes(opts?.applicationServerKey)).toBe(KEY);
    await settle(c.layer);
    const endpoint = push.state.subscription?.endpoint;
    expect(endpoint).toBeTruthy();
    expect(subsOf(c)).toEqual([expect.objectContaining({ user_id: JAE_ID, endpoint, p256dh: FAKE_P256DH, auth: FAKE_AUTH })]);
    expect(await fn('pushState')(c.layer)).toBe('on');
  });

  it('NOT-1: refused at the prompt: blocked, nothing subscribed or saved', async () => {
    push = installPush({ permission: 'default', answer: 'denied' });
    const c = household();
    await ready(c);
    expect(await fn('enablePush')(c.layer)).toBe('blocked');
    expect(push.subscribe).not.toHaveBeenCalled();
    await settle(c.layer);
    expect(subsOf(c)).toEqual([]);
  });

  it('NOT-1: on a phone that can’t show notifications: unsupported, and nothing is asked', async () => {
    push = installPush({ support: 'none' });
    const c = household();
    await ready(c);
    expect(await fn('enablePush')(c.layer)).toBe('unsupported');
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(subsOf(c)).toEqual([]);
  });

  it('NOT-1: turning off removes only this phone’s subscription; the switches stay as they were', async () => {
    const here = 'https://fcm.googleapis.com/fcm/send/this-phone';
    const there = 'https://fcm.googleapis.com/fcm/send/jae-other-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: here, key: KEY } });
    const c = household({
      prefs: [prefsRow(JAE_ID, { comments: false })],
      subs: [{ user_id: JAE_ID, endpoint: here, p256dh: FAKE_P256DH, auth: FAKE_AUTH }, { user_id: JAE_ID, endpoint: there, p256dh: 'x', auth: 'y' }],
    });
    await ready(c);
    await fn('disablePush')(c.layer);
    await settle(c.layer);
    expect(push.unsubscribed).toEqual([here]);
    expect(subsOf(c).map((s) => s.endpoint)).toEqual([there]);
    expect(await fn('pushState')(c.layer)).toBe('off');
    expect(fn('notificationPrefs')(c.layer).comments).toBe(false);
    expect(prefsRowOf(c, JAE_ID)?.comments).toBe(false);
  });
});

describe('refreshPush: on every open, this phone’s subscription uses the current public key (NOT-1)', () => {
  it('NOT-1: made with an older key: unsubscribed and subscribed again with the current one; the old endpoint goes', async () => {
    const old = 'https://fcm.googleapis.com/fcm/send/old-key-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: old, key: OLD_KEY } });
    const c = household({ subs: [{ user_id: JAE_ID, endpoint: old, p256dh: FAKE_P256DH, auth: FAKE_AUTH }] });
    await ready(c);
    await fn('refreshPush')(c.layer);
    await settle(c.layer);
    expect(push.unsubscribed).toContain(old);
    const now = push.state.subscription;
    expect(now?.endpoint).toBeTruthy();
    expect(now?.endpoint).not.toBe(old);
    expect(b64u(new Uint8Array(now?.options.applicationServerKey ?? new ArrayBuffer(0)))).toBe(KEY);
    expect(subsOf(c).map((s) => s.endpoint)).toEqual([now?.endpoint]);
  });

  it('NOT-1: made with the current key: kept, and saved again as this person’s (another account may have had this phone)', async () => {
    const here = 'https://fcm.googleapis.com/fcm/send/this-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: here, key: KEY } });
    const c = household({ subs: [] });
    await ready(c);
    await fn('refreshPush')(c.layer);
    await settle(c.layer);
    expect(push.subscribe).not.toHaveBeenCalled();
    expect(push.unsubscribed).toEqual([]);
    expect(subsOf(c)).toEqual([expect.objectContaining({ user_id: JAE_ID, endpoint: here })]);
  });

  it('NOT-1 OFF-4: without permission, support or a connection it does nothing and never throws', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    await ready(c);
    await expect(fn('refreshPush')(c.layer)).resolves.toBeUndefined();
    expect(push.subscribe).not.toHaveBeenCalled();
    push = installPush({ support: 'none' });
    await expect(fn('refreshPush')(c.layer)).resolves.toBeUndefined();
    push = installPush({ permission: 'granted', existing: { endpoint: 'https://fcm.googleapis.com/fcm/send/p', key: OLD_KEY } });
    offline(c);
    await expect(fn('refreshPush')(c.layer)).resolves.toBeUndefined();
    expect(push.unsubscribed).toEqual([]);
  });
});

// ─────────────────────────────── NOT-3 INB-2: the icon badge ───────────────────────────────

describe('badgeCount: what the app icon shows (NOT-3, INB-2)', () => {
  it('NOT-3 INB-2: open Inbox items + this phone’s waiting import rows + approvals waiting for this person', async () => {
    const c = household({
      inboxItems: [
        storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c1' }),
        storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c2', recurring_id: null, occurrence_date: null, source: 'scan' }),
        storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c3', recurring_id: null, occurrence_date: null, status: 'kept' }),
      ],
      changeRequests: [
        request({ requested_by: SAM_ID }),                                                  // waiting for Jae
        request({ requested_by: JAE_ID, kind: 'identity', payload: { user_id: JAE_ID, display_name: 'J', animal: 'cat' } }), // Jae's own
        request({ requested_by: SAM_ID, status: 'approved', decided_by: JAE_ID, decided_at: '2026-11-13T13:00:00.000Z' }),
      ],
    });
    await ready(c);
    expect(await fn('badgeCount')(c.layer)).toBe(3);
    await fn('startImport')([
      { bankId: 'tx_1', date: '2026-11-10', description: 'Larder & Leaf', amount: pence(4250), categoryHint: null, note: null },
      { bankId: 'tx_2', date: '2026-11-11', description: 'Noodle Bar', amount: pence(1820), categoryHint: null, note: null },
    ], 'csv', c.layer);
    await settle(c.layer);
    expect(await fn('badgeCount')(c.layer)).toBe(5);
  });

  it('INB-2: nothing waiting: 0', async () => {
    const c = household();
    await ready(c);
    expect(await fn('badgeCount')(c.layer)).toBe(0);
  });
});
