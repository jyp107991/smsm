/**
 * S8 screens (docs/slices/S8.md "Decisions made here → Switches, Tapping, Icon badge, Offline", "Interfaces → Settings",
 * "Tests → Data/screens"; SPEC NOT-1, NOT-2, NOT-3, INB-2, OFF-4): Settings → "Notifications" in each state of the phone
 * (can't, blocked, off → allowed → turned off), the switches and the amount, offline; the app-icon badge kept by the app;
 * each notification's path opening its screen; the subscription checked on open. On the real screens over the
 * in-memory Api, with the browser's notification and push APIs faked (tests/fixtures/fake-push.ts). Written before the
 * build (ENGINEERING §5, tests first by someone else). The layout half (320/390 px, both themes, axe) and a real push to
 * the built service worker are tests/e2e/s8.spec.ts.
 *
 * What these tests read (the brief's Interfaces):
 *   Settings: region "Notifications"; button "Allow notifications on this phone" / "Turn off on this phone"; switches
 *     "Entries", "Settle-ups", "Comments", "Bills posted today", "Bills tomorrow", "Recap and settle day", "Balance
 *     reminder"; textbox "Remind me above"; the word "Approvals" with no switch; status lines "This phone can’t show
 *     notifications", "Notifications are blocked in this browser’s settings", "Notifications wait for a connection".
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - A switch is a checkbox in the switch role (src/screens/entry/RecurringParts.tsx Toggle), checked = on.
 *   - The switches are there whether or not this phone is allowed (they are the person's, for all their phones); only
 *     the unsupported and blocked states are not checked for them.
 *   - "Remind me above" holds the amount as pounds ("100.00", "£" before it or not) and saves on blur; it is shown at
 *     least while the balance reminder is on.
 *   - Status lines may use a straight or a curly apostrophe.
 *   - The app keeps the icon badge: navigator.setAppBadge(n) whenever the count changes, clearAppBadge() (or
 *     setAppBadge(0)) when it is 0.
 *   - A tap's path comes from src/core/notify.ts notificationText; the comment and approvals anchors are elements with
 *     id "comments" (the entry's comments) and id "approvals" (Settings' approvals).
 *   - Server tables as in src/data/notifications.test.ts: controls.tables.pushPublicKey, .pushSubscriptions,
 *     .notificationPrefs.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, HID, JAE_ID, SAM_ID, storedExpense, storedInboxItem, storedSettlement } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { b64u, installPush, publicKey, uninstallPush, type FakePush } from '../../tests/fixtures/fake-push';
import { DataProvider, type DataLayer } from '../data';
import type { ChangeRequestRow, ExpenseRow } from '../data/api';
import type { MemoryTables } from '../data/memoryApi';
import { resetHistoryForTests } from '../ui/history';
import { Root } from './AppRoot';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the core's words and paths (src/core/notify.ts, S8) ─────────
type NotificationText = (kind: string, data: Record<string, unknown>, names: Record<string, string>) => { title: string; body: string; path: string };
const NOTIFY = '../core/notify';
const notify = (await import(/* @vite-ignore */ NOTIFY).catch(() => null)) as { notificationText?: NotificationText } | null;
function pathFor(kind: string, data: Record<string, unknown>): string {
  if (typeof notify?.notificationText !== 'function') throw new Error('src/core/notify.ts does not export notificationText yet (S8)');
  return notify.notificationText(kind, data, { [JAE_ID]: 'Jae', [SAM_ID]: 'Sam' }).path;
}

interface PrefsRow { user_id: string; entries: boolean; settle_ups: boolean; comments: boolean; bills_today: boolean; bills_tomorrow: boolean; recap: boolean; balance: boolean; balance_threshold_pence: number }
interface SubscriptionRow { user_id: string; endpoint: string; p256dh: string; auth: string }
type S8Tables = MemoryTables & { pushPublicKey?: string | null; pushSubscriptions?: SubscriptionRow[]; notificationPrefs?: PrefsRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S8Tables;
const myPrefs = (c: { controls: { tables: MemoryTables } }) => (tablesOf(c).notificationPrefs ?? []).find((r) => r.user_id === JAE_ID);
const subsOf = (c: { controls: { tables: MemoryTables } }) => tablesOf(c).pushSubscriptions ?? [];

const KEY = publicKey(3);
const OLD_KEY = publicKey(5);
const SWITCHES = ['Entries', 'Settle-ups', 'Comments', 'Bills posted today', 'Bills tomorrow', 'Recap and settle day', 'Balance reminder'] as const;
const DEFAULT_ON: Record<(typeof SWITCHES)[number], boolean> = {
  Entries: true, 'Settle-ups': true, Comments: true, 'Bills posted today': true, 'Bills tomorrow': false, 'Recap and settle day': true, 'Balance reminder': false,
};
const ALLOW = 'Allow notifications on this phone';
const TURN_OFF = 'Turn off on this phone';
const UNSUPPORTED = /^This phone can[’']t show notifications\.?$/;
const BLOCKED = /^Notifications are blocked in this browser[’']s settings\.?$/;
const WAITS = /^Notifications wait for a connection\.?$/;

// ───────── the app ─────────
let open: DataLayer[] = [];
let push: FakePush | null = null;
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  history.replaceState(null, '', '/');
  resetHistoryForTests();
  sessionStorage.clear();
  localStorage.clear();
  idbData.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const l of open.splice(0)) await l.dispose();
  open = [];
  push?.uninstall();
  push = null;
  uninstallPush();
});

function household(opts: Parameters<typeof couple>[0] & { prefs?: PrefsRow[]; subs?: SubscriptionRow[] } = {}) {
  const { prefs = [], subs = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = tablesOf(c);
  t.pushPublicKey = KEY;
  t.notificationPrefs ??= [];
  t.notificationPrefs.push(...prefs);
  t.pushSubscriptions ??= [];
  t.pushSubscriptions.push(...subs);
  return c;
}
function show(layer: DataLayer) {
  return render(<DataProvider layer={layer}><Root /></DataProvider>);
}
function launchAt(path: string, layer: DataLayer) {
  history.replaceState(null, '', path);
  resetHistoryForTests();
  return show(layer);
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true' || (el instanceof HTMLInputElement && el.checked);
function offline(c: ReturnType<typeof household>) {
  act(() => { c.network.set(false); });
  c.controls.online = false;
}
function online(c: ReturnType<typeof household>) {
  c.controls.online = true;
  act(() => { c.network.set(true); });
}
async function notifications(c: ReturnType<typeof household>): Promise<HTMLElement> {
  launchAt('/settings', c.layer);
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return screen.findByRole('region', { name: 'Notifications' });
}
const switchIn = (scope: HTMLElement, name: string) => within(scope).getByRole('switch', { name });
/** A line of the region, whole, whatever element holds it. */
function says(scope: HTMLElement, re: RegExp): boolean {
  return Array.from(scope.querySelectorAll('p, span, div, li, [role="status"]')).some((el) => re.test(text(el)));
}
function request(over: Partial<ChangeRequestRow> = {}): ChangeRequestRow {
  return {
    id: '00000000-0000-4000-8000-00000000c0d1', household_id: HID, requested_by: SAM_ID, kind: 'default_ratio',
    payload: { ratio: { [JAE_ID]: 60, [SAM_ID]: 40 } }, status: 'pending', decided_by: null, created_at: '2026-11-13T12:00:00.000Z', decided_at: null,
    ...over,
  };
}

// ─────────────────────────────── NOT-1: this phone ───────────────────────────────

describe('Settings → "Notifications": this phone (NOT-1)', () => {
  it('NOT-1: a phone that can’t show notifications says so, and offers no Allow', async () => {
    push = installPush({ support: 'none' });
    const c = household();
    const region = await notifications(c);
    await waitFor(() => { expect(says(region, UNSUPPORTED)).toBe(true); });
    const allow = within(region).queryByRole('button', { name: ALLOW });
    expect(allow === null || allow.hasAttribute('disabled') || allow.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('NOT-1: blocked in the browser’s settings says so, and offers no Allow', async () => {
    push = installPush({ permission: 'denied' });
    const c = household();
    const region = await notifications(c);
    await waitFor(() => { expect(says(region, BLOCKED)).toBe(true); });
    const allow = within(region).queryByRole('button', { name: ALLOW });
    expect(allow === null || allow.hasAttribute('disabled') || allow.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('NOT-1: off → "Allow notifications on this phone" asks the browser, saves this phone, then offers "Turn off on this phone"', async () => {
    push = installPush({ permission: 'default', answer: 'granted' });
    const c = household();
    const region = await notifications(c);
    fireEvent.click(await within(region).findByRole('button', { name: ALLOW }));
    await within(region).findByRole('button', { name: TURN_OFF });
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    await settle(c.layer);
    const endpoint = push.state.subscription?.endpoint;
    expect(endpoint).toBeTruthy();
    expect(subsOf(c)).toEqual([expect.objectContaining({ user_id: JAE_ID, endpoint })]);
    expect(within(region).queryByRole('button', { name: ALLOW })).toBeNull();

    fireEvent.click(within(region).getByRole('button', { name: TURN_OFF }));
    await within(region).findByRole('button', { name: ALLOW });
    await settle(c.layer);
    expect(subsOf(c)).toEqual([]);
    expect(push.unsubscribed).toEqual([endpoint]);
  });

  it('NOT-1: refused at the browser’s prompt: the blocked line, and nothing saved', async () => {
    push = installPush({ permission: 'default', answer: 'denied' });
    const c = household();
    const region = await notifications(c);
    fireEvent.click(await within(region).findByRole('button', { name: ALLOW }));
    await waitFor(() => { expect(says(region, BLOCKED)).toBe(true); });
    await settle(c.layer);
    expect(subsOf(c)).toEqual([]);
  });

  it('NOT-1: a phone already allowed shows "Turn off on this phone"', async () => {
    const here = 'https://fcm.googleapis.com/fcm/send/this-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: here, key: KEY } });
    const c = household({ subs: [{ user_id: JAE_ID, endpoint: here, p256dh: 'p', auth: 'a' }] });
    const region = await notifications(c);
    expect(await within(region).findByRole('button', { name: TURN_OFF })).toBeTruthy();
  });
});

// ─────────────────────────────── NOT-1: the switches ───────────────────────────────

describe('Settings → "Notifications": one switch per type (NOT-1)', () => {
  it('NOT-1: the seven switches with their defaults; approvals are always on, with no switch', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    const region = await notifications(c);
    await waitFor(() => { expect(within(region).queryAllByRole('switch')).toHaveLength(SWITCHES.length); });
    for (const name of SWITCHES) expect(isChecked(switchIn(region, name)), name).toBe(DEFAULT_ON[name]);
    expect(within(region).getByText(/Approvals/)).toBeTruthy();
    expect(within(region).queryByRole('switch', { name: /Approvals/ })).toBeNull();
    expect(within(region).queryByRole('checkbox', { name: /Approvals/ })).toBeNull();
  });

  it('NOT-1: the switches show what this person saved (from either of their phones)', async () => {
    const here = 'https://fcm.googleapis.com/fcm/send/this-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: here, key: KEY } });
    const c = household({
      prefs: [{ user_id: JAE_ID, entries: false, settle_ups: true, comments: true, bills_today: true, bills_tomorrow: true, recap: false, balance: false, balance_threshold_pence: 10000 }],
    });
    const region = await notifications(c);
    await waitFor(() => { expect(isChecked(switchIn(region, 'Entries'))).toBe(false); });
    expect(isChecked(switchIn(region, 'Bills tomorrow'))).toBe(true);
    expect(isChecked(switchIn(region, 'Recap and settle day'))).toBe(false);
  });

  it('NOT-1: turning a switch on and off changes it at once and saves it for this person', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    const region = await notifications(c);
    const tomorrow = await within(region).findByRole('switch', { name: 'Bills tomorrow' });
    fireEvent.click(tomorrow);
    await waitFor(() => { expect(isChecked(switchIn(region, 'Bills tomorrow'))).toBe(true); });
    fireEvent.click(switchIn(region, 'Comments'));
    await waitFor(() => { expect(isChecked(switchIn(region, 'Comments'))).toBe(false); });
    await settle(c.layer);
    await waitFor(() => { expect(myPrefs(c)).toMatchObject({ bills_tomorrow: true, comments: false, entries: true }); });
  });

  it('NOT-1: the balance reminder’s amount: £100.00 to start, changed in pounds and pence; nonsense is not saved', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    const region = await notifications(c);
    fireEvent.click(await within(region).findByRole('switch', { name: 'Balance reminder' }));
    const box = await within(region).findByRole<HTMLInputElement>('textbox', { name: 'Remind me above' });
    expect(box.value.replace(/^£\s*/, '')).toBe('100.00');
    fireEvent.change(box, { target: { value: '150' } });
    fireEvent.blur(box);
    await settle(c.layer);
    await waitFor(() => { expect(myPrefs(c)).toMatchObject({ balance: true, balance_threshold_pence: 15000 }); });
    const again = within(region).getByRole<HTMLInputElement>('textbox', { name: 'Remind me above' });
    fireEvent.change(again, { target: { value: 'lots' } });
    fireEvent.blur(again);
    await settle(c.layer);
    expect(myPrefs(c)?.balance_threshold_pence).toBe(15000);
  });
});

// ─────────────────────────────── OFF-4: offline ───────────────────────────────

describe('Settings → "Notifications" offline (OFF-4)', () => {
  it('OFF-4: says "Notifications wait for a connection"; the switches still change and are saved once back online', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    const region = await notifications(c);
    await within(region).findByRole('switch', { name: 'Entries' });
    await settle(c.layer);
    offline(c);
    await waitFor(() => { expect(says(region, WAITS)).toBe(true); });
    fireEvent.click(switchIn(region, 'Settle-ups'));
    await waitFor(() => { expect(isChecked(switchIn(region, 'Settle-ups'))).toBe(false); });
    await settle(c.layer);
    expect(myPrefs(c)?.settle_ups ?? true).toBe(true);
    online(c);
    await settle(c.layer);
    await waitFor(() => { expect(myPrefs(c)?.settle_ups).toBe(false); });
    await waitFor(() => { expect(says(region, WAITS)).toBe(false); });
  });
});

// ─────────────────────────────── NOT-1: on every open ───────────────────────────────

describe('opening the app checks this phone’s subscription (NOT-1)', () => {
  it('NOT-1: a subscription made with an older public key is replaced on open, and the server told', async () => {
    const old = 'https://fcm.googleapis.com/fcm/send/old-key-phone';
    push = installPush({ permission: 'granted', existing: { endpoint: old, key: OLD_KEY } });
    const c = household({ subs: [{ user_id: JAE_ID, endpoint: old, p256dh: 'p', auth: 'a' }] });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await waitFor(() => { expect(push?.unsubscribed).toContain(old); });
    await settle(c.layer);
    const now = push.state.subscription;
    expect(b64u(new Uint8Array(now?.options.applicationServerKey ?? new ArrayBuffer(0)))).toBe(KEY);
    await waitFor(() => { expect(subsOf(c).map((s) => s.endpoint)).toEqual([now?.endpoint]); });
  });
});

// ─────────────────────────────── NOT-3 INB-2: the icon badge ───────────────────────────────

describe('the app icon’s badge (NOT-3, INB-2)', () => {
  it('NOT-3 INB-2: open Inbox items and approvals waiting for this person; it follows when another arrives', async () => {
    push = installPush({ permission: 'default' });
    const c = household({
      inboxItems: [
        storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c1' }),
        storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c2', recurring_id: null, occurrence_date: null, source: 'scan' }),
      ],
      changeRequests: [request()],
    });
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await waitFor(() => { expect(push?.setAppBadge).toHaveBeenLastCalledWith(3); });
    act(() => {
      c.controls.tables.inboxItems.push(storedInboxItem({ id: '00000000-0000-4000-8000-00000000b0c4', recurring_id: null, occurrence_date: null, source: 'scan' }));
      c.controls.emitChange('inbox_items');
    });
    await waitFor(() => { expect(push?.setAppBadge).toHaveBeenLastCalledWith(4); });
  });

  it('INB-2: nothing waiting clears the badge', async () => {
    push = installPush({ permission: 'default' });
    const c = household();
    show(c.layer);
    await screen.findByRole('region', { name: 'Balance' });
    await waitFor(() => {
      const cleared = (push?.clearAppBadge.mock.calls.length ?? 0) > 0 || push?.setAppBadge.mock.lastCall?.[0] === 0;
      expect(cleared).toBe(true);
    });
    expect(push.setAppBadge.mock.calls.some(([n]) => (n ?? 0) > 0)).toBe(false);
  });

  it('NOT-3: where the browser has no app badge, nothing breaks', async () => {
    push = installPush({ permission: 'default', badge: false });
    const c = household({ inboxItems: [storedInboxItem()] });
    show(c.layer);
    expect(await screen.findByRole('region', { name: 'Balance' })).toBeTruthy();
    expect(push.setAppBadge).not.toHaveBeenCalled();
    // And Settings still offers the switches.
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const region = await screen.findByRole('region', { name: 'Notifications' });
    expect(within(region).getAllByRole('switch').length).toBeGreaterThanOrEqual(SWITCHES.length);
  });
});

// ─────────────────────────────── NOT-2: a tap opens the thing ───────────────────────────────

describe('a notification’s path opens what it is about (NOT-2)', () => {
  const TESCO: ExpenseRow = storedExpense({ id: '00000000-0000-4000-8000-00000000e0a1', description: 'Tesco', amount_pence: 4250 });
  const SETTLED = storedSettlement({ id: '00000000-0000-4000-8000-00000000f0a1' });
  const BALANCE = { [JAE_ID]: 2450, [SAM_ID]: -2450 };
  function tapHousehold() {
    push = installPush({ permission: 'default' });
    return household({ expenses: [TESCO], settlements: [SETTLED], changeRequests: [request()] });
  }

  it('NOT-2: an entry opens that entry', async () => {
    const c = tapHousehold();
    launchAt(pathFor('entry_added', { actor: SAM_ID, ref: TESCO.id, description: 'Tesco', amount: 4250, balance: BALANCE }), c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tesco' })).toBeTruthy();
  });

  it('NOT-2 ACT-4: a comment opens the entry at its comments', async () => {
    const c = tapHousehold();
    const path = pathFor('comment', { actor: SAM_ID, ref: TESCO.id, description: 'Tesco', comment: 'was this the big shop?' });
    launchAt(path, c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Tesco' });
    await waitFor(() => { expect(document.getElementById('comments')).not.toBeNull(); });
    const comments = document.getElementById('comments');
    expect(comments?.closest('section') ?? comments).toBeTruthy();
    expect(text(comments?.closest('section') ?? comments ?? document.body)).toContain('Comments');
  });

  it('NOT-2: a settle-up opens Activity', async () => {
    const c = tapHousehold();
    launchAt(pathFor('settle_added', { actor: SAM_ID, ref: SETTLED.id, amount: 500, balance: BALANCE }), c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeTruthy();
  });

  it('NOT-2: an approval opens Settings at the approvals', async () => {
    const c = tapHousehold();
    launchAt(pathFor('approval_waiting', { actor: SAM_ID, ref: request().id, request: 'default_ratio' }), c.layer);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => { expect(document.getElementById('approvals')).not.toBeNull(); });
    expect(text(document.getElementById('approvals') ?? document.body)).toContain('Sam would like new entries split');
  });

  it('NOT-2: a bill opens Bills', async () => {
    const c = tapHousehold();
    launchAt(pathFor('bill_posted', { actor: null, ref: 'bill', description: 'Rent', amount: 120000, balance: BALANCE }), c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bills' })).toBeTruthy();
  });

  it('NOT-2: the recap opens that month’s recap', async () => {
    const c = tapHousehold();
    launchAt(pathFor('recap_ready', { actor: null, month: '2026-10' }), c.layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'October 2026' })).toBeTruthy();
  });

  it('NOT-2: settle day and the balance reminder open Home', async () => {
    const c = tapHousehold();
    launchAt(pathFor('settle_day', { actor: null, balance: BALANCE }), c.layer);
    expect(await screen.findByRole('region', { name: 'Balance' })).toBeTruthy();
    expect(pathFor('balance_reminder', { actor: null, balance: BALANCE, threshold: 10000 })).toBe('/');
  });
});
