/**
 * S8 on the phone (NOT-1, NOT-3, INB-2, OFF-4): the person's notification switches, this phone's push subscription
 * and the app icon's badge.
 *
 * - The switches are the person's (notification_prefs, one row each, theirs on all their phones). A change shows at
 *   once and goes through the persisted queue to set_notification_prefs, so it is made offline too and sent later.
 * - This phone's subscription is the browser's (PushManager), made with the push function's public key and saved for
 *   the signed-in person (save_push_subscription). On every open the app checks the subscription still uses the
 *   current key (refreshPush). Turning this phone off removes only its own subscription; the switches stay.
 * - The badge counts what is waiting for this person: open Inbox items, this phone's bank rows still to sort, and
 *   change requests from the partner.
 */
import { useMutationState, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { pence, type Pence } from '../core/money';
import type { ChangeRequestRow, InboxItemRow, NotificationPrefsPatch, NotificationPrefsRow } from './api';
import { activeDataLayer } from './context';
import { useChangeRequests, useDataLayer, useInbox, useSession } from './hooks';
import { importQueue, useImportQueue } from './imports';
import { keys, PREFS_KEY } from './keys';
import { notificationPrefsQuery } from './queries';
import type { DataLayer } from './queryClient';
import { EntryInvalidError, newId, overlay, type PrefsOp } from './writes';
import { fromB64u, keyOf, permission, support, writeOf } from './push';

export const PREF_KEYS = ['entries', 'settle_ups', 'comments', 'bills_today', 'bills_tomorrow', 'recap', 'balance'] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type NotificationPrefs = Record<PrefKey, boolean> & { balance_threshold_pence: Pence };
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

/** notification_prefs' defaults: everything on except bills tomorrow and the balance reminder, at £100.00. */
export const DEFAULT_PREFS: NotificationPrefs = {
  entries: true, settle_ups: true, comments: true, bills_today: true, bills_tomorrow: false, recap: true, balance: false,
  balance_threshold_pence: pence(10000),
};
const MAX_THRESHOLD = 100_000_000;

function prefsFrom(row: NotificationPrefsRow | null | undefined, ops: readonly PrefsOp[]): NotificationPrefs {
  const out: NotificationPrefs = { ...DEFAULT_PREFS };
  if (row) {
    for (const k of PREF_KEYS) out[k] = row[k];
    out.balance_threshold_pence = pence(row.balance_threshold_pence);
  }
  for (const op of ops) {
    for (const k of PREF_KEYS) {
      const v = op.patch[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    if (typeof op.patch.balance_threshold_pence === 'number') out.balance_threshold_pence = pence(op.patch.balance_threshold_pence);
  }
  return out;
}

/** This person's switches now: the phone's copy with the waiting changes applied. */
export function notificationPrefs(layer: DataLayer = activeDataLayer()): NotificationPrefs {
  const me = layer.me();
  const row = me ? layer.client.getQueryData<NotificationPrefsRow | null>(keys.notificationPrefs(me)) : null;
  return prefsFrom(row, layer.prefsWaiting());
}

/**
 * A switch (true or false), or for 'balance' a number: the reminder's amount in whole pence above zero (else it
 * throws and nothing changes). Shown at once; sent when the phone can.
 */
export function setNotificationPref(key: PrefKey, value: boolean | Pence, layer: DataLayer = activeDataLayer()): void {
  if (!(PREF_KEYS as readonly string[]).includes(key)) throw new EntryInvalidError(['amount']);
  let patch: NotificationPrefsPatch;
  if (typeof value === 'boolean') patch = { [key]: value };
  else {
    if (key !== 'balance' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_THRESHOLD) throw new EntryInvalidError(['amount']);
    patch = { balance_threshold_pence: value };
  }
  const me = layer.me();
  if (!me) throw new Error('Sign in first.');
  layer.enqueuePrefs({ opId: newId(), by: me, patch });
}

/** For Settings: this person's switches, following every change (theirs or another phone's on the next refresh). */
export function useNotificationPrefs(): NotificationPrefs {
  const layer = useDataLayer();
  const session = useSession();
  const me = session.status === 'signed-in' ? session.userId : null;
  const q = useQuery(notificationPrefsQuery(layer.api, me));
  const ops = useMutationState({ filters: { mutationKey: PREFS_KEY, status: 'pending' }, select: (m) => m.state.variables as PrefsOp | undefined });
  return useMemo(() => prefsFrom(q.data, ops.filter((o): o is PrefsOp => o !== undefined && o.by === me)), [q.data, ops, me]);
}

// ───────────────────────────── this phone ─────────────────────────────

/** The push function hasn't made its keys yet (it does on its first run, right after a deploy). */
export class PushNotReadyError extends Error {
  constructor() {
    super('Notifications aren’t ready yet. Try again in a few minutes.');
    this.name = 'PushNotReadyError';
  }
}

/** What this phone can do now (the browser's own state; the same for any data layer). */
export async function pushState(): Promise<PushState> {
  const push = support();
  if (!push) return 'unsupported';
  const p = permission();
  if (p === 'denied') return 'blocked';
  if (p !== 'granted') return 'off';
  const reg = await push.registration(false);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return sub ? 'on' : 'off';
}

/** "Allow notifications on this phone": asks the browser, subscribes with the server's key and saves this phone. */
export async function enablePush(layer: DataLayer = activeDataLayer()): Promise<PushState> {
  const push = support();
  if (!push) return 'unsupported';
  let p = permission();
  if (p === 'default') p = await Notification.requestPermission();
  if (p === 'denied') return 'blocked';
  if (p !== 'granted') return 'off';
  const reg = await push.registration(true);
  if (!reg) return 'unsupported';
  const key = await layer.api.pushPublicKey();
  if (!key) throw new PushNotReadyError();
  let sub = await reg.pushManager.getSubscription();
  if (sub && keyOf(sub) !== key) {
    // Made with an older key: the push service would refuse the new one's pushes.
    const old = sub.endpoint;
    await sub.unsubscribe();
    await layer.api.removePushSubscription(old).catch(() => undefined);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  await layer.api.savePushSubscription(writeOf(sub));
  return 'on';
}

/** "Turn off on this phone": this phone's subscription goes; the switches (the person's) stay as they are. */
export async function disablePush(layer: DataLayer = activeDataLayer()): Promise<PushState> {
  const push = support();
  if (!push) return 'unsupported';
  const reg = await push.registration(false);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    // Offline, the server forgets it the first time its push service says it is gone.
    await layer.api.removePushSubscription(endpoint).catch(() => undefined);
  }
  return pushState();
}

/**
 * On every open: a subscription made with an older key is made again with the current one (the old one removed,
 * the new one saved); a current one is saved again, so the server knows it is this person's. Nothing without
 * support, permission or a connection; never throws.
 */
export async function refreshPush(layer: DataLayer = activeDataLayer()): Promise<void> {
  try {
    const push = support();
    if (!push || permission() !== 'granted' || !layer.network.online || !layer.me()) return;
    const reg = await push.registration(false);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!reg || !sub) return;
    const key = await layer.api.pushPublicKey();
    if (!key) return;
    if (keyOf(sub) === key) {
      await layer.api.savePushSubscription(writeOf(sub));
      return;
    }
    const old = sub.endpoint;
    await sub.unsubscribe();
    const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
    await layer.api.removePushSubscription(old).catch(() => undefined);
    await layer.api.savePushSubscription(writeOf(fresh));
  } catch {
    /* the next open tries again */
  }
}

// ───────────────────────────── the icon badge ─────────────────────────────

function waitingFor(me: string | null, inbox: readonly InboxItemRow[], changes: readonly ChangeRequestRow[], imports: number): number {
  const open = inbox.filter((i) => i.status === 'open').length;
  const approvals = changes.filter((c) => c.status === 'pending' && c.requested_by !== me).length;
  return open + imports + approvals;
}

/** NOT-3, INB-2: open Inbox items + this phone's waiting import rows + change requests waiting for this person. */
export async function badgeCount(layer: DataLayer = activeDataLayer()): Promise<number> {
  const me = layer.me();
  if (!me) return 0;
  const inbox = overlay(layer.client.getQueryData<InboxItemRow[]>(keys.inbox(me)) ?? [], layer.waiting(), 'inbox_items');
  const changes = layer.client.getQueryData<ChangeRequestRow[]>(keys.changes(me)) ?? [];
  const imports = (await importQueue(layer).catch(() => [])).length;
  return waitingFor(me, inbox, changes, imports);
}

function setAppBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0 && typeof nav.setAppBadge === 'function') void nav.setAppBadge(n).catch(() => undefined);
    else if (n === 0 && typeof nav.clearAppBadge === 'function') void nav.clearAppBadge().catch(() => undefined);
  } catch {
    /* no app badge on this phone */
  }
}

/** Keeps the app icon's badge to what is waiting, once everything it counts is on the phone. */
export function useAppBadge(): void {
  const session = useSession();
  const me = session.status === 'signed-in' ? session.userId : null;
  const inbox = useInbox().data;
  const changes = useChangeRequests().data;
  const imports = useImportQueue();
  const count = inbox && changes && imports ? waitingFor(me, inbox, changes, imports.length) : null;
  useEffect(() => {
    if (count !== null) setAppBadge(count);
  }, [count]);
}

/** Checks this phone's subscription once each time the app opens (NOT-1). */
export function useRefreshPush(): void {
  const layer = useDataLayer();
  useEffect(() => {
    let live = true;
    void layer.ready.then(() => { if (live) void refreshPush(layer); });
    return () => { live = false; };
  }, [layer]);
}
