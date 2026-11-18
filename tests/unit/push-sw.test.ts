/// <reference types="node" />
/**
 * S8, the service worker's push and click handlers (docs/slices/S8.md "Decisions made here → Tapping, Icon, Icon badge",
 * "Data → Service worker"; SPEC NOT-1, NOT-2, NOT-3, INB-2): public/push.js, loaded into the service worker with
 * importScripts like public/share-target.js. Here it runs in a fake service-worker global (node's vm) so every branch
 * is checked without a browser; tests/e2e/s8.spec.ts delivers a real push to the built worker. Written before the
 * build (ENGINEERING §5, tests first by someone else).
 *
 * What these tests expect of public/push.js (plain script, no imports; listens with self.addEventListener):
 *   push: event.data.json() is the function's payload { title, body, path, tag, icon, count }
 *     (tests/unit/push-function.test.ts). It calls event.waitUntil with a promise that shows
 *     self.registration.showNotification(title, { body, icon, badge, tag, data: { path } }) — badge being the app's
 *     monochrome badge image (an /icons/… .png) — and sets the app-icon badge: navigator.setAppBadge(count) when count
 *     > 0, navigator.clearAppBadge() at 0, nothing (and no error) where the browser has neither.
 *     A push with no data or data that isn't JSON still shows a notification (a browser requires one per push):
 *     some title, path "/".
 *   notificationclick: closes the notification, then (in event.waitUntil) takes an open window of the app
 *     (self.clients.matchAll({ type: 'window', includeUncontrolled: true })), sends it to data.path — client.navigate
 *     to the path (absolute or relative to the origin), or client.postMessage with an object carrying the path for the
 *     app to route — and focuses it; with no window open, self.clients.openWindow(path). A focus that is refused (as
 *     outside a real tap) never stops the navigation.
 *
 * Choices made here: the badge image's file name is the builder's (any /icons/*.png); a push without a tag may have
 * any tag. Until public/push.js exists every test fails on the missing file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const FILE = resolve(process.cwd(), 'public/push.js');
const ORIGIN = 'https://smsm.example.workers.dev';

interface ShowCall { title: string; options: { body?: string; icon?: string; badge?: string; tag?: string; data?: { path?: string } } }
interface FakeClient { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }

function worker(opts: { clients?: FakeClient[]; badge?: boolean } = {}) {
  if (!existsSync(FILE)) throw new Error('public/push.js does not exist yet (S8)');
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const shown: ShowCall[] = [];
  const badge = { set: [] as number[], cleared: 0 };
  const opened: string[] = [];
  const clientList = opts.clients ?? [];
  const self: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    registration: {
      scope: `${ORIGIN}/`,
      showNotification: vi.fn((title: string, options: ShowCall['options']) => { shown.push({ title, options }); return Promise.resolve(); }),
      getNotifications: () => Promise.resolve([]),
    },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(clientList)),
      openWindow: vi.fn((url: string) => { opened.push(url); return Promise.resolve(null); }),
      claim: () => Promise.resolve(),
    },
    location: new URL(`${ORIGIN}/sw.js`),
    navigator: opts.badge === false ? {} : {
      setAppBadge: vi.fn((n: number) => { badge.set.push(n); return Promise.resolve(); }),
      clearAppBadge: vi.fn(() => { badge.cleared += 1; return Promise.resolve(); }),
    },
    URL, console, setTimeout, clearTimeout, Promise, JSON, Response, Request, Headers, fetch: () => Promise.reject(new Error('no network in this test')),
    importScripts: () => undefined,
  };
  self.self = self;
  self.globalThis = self;
  runInNewContext(readFileSync(FILE, 'utf8'), self, { filename: 'public/push.js' });

  async function fire(type: string, event: Record<string, unknown>): Promise<void> {
    const waits: Promise<unknown>[] = [];
    const e = { ...event, waitUntil: (p: Promise<unknown>) => { waits.push(Promise.resolve(p)); } };
    const fns = listeners.get(type) ?? [];
    expect(fns.length, `public/push.js listens for "${type}"`).toBeGreaterThan(0);
    for (const fn of fns) fn(e);
    await Promise.allSettled(waits);
    // Let any chained work (focus, then navigate) finish.
    await new Promise((r) => setTimeout(r, 0));
  }
  const push = (payload: unknown) => fire('push', {
    data: payload === undefined ? null : {
      json: () => (typeof payload === 'string' ? JSON.parse(payload) as unknown : payload),
      text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    },
  });
  const click = (path: string | null) => {
    const notification = { data: path === null ? null : { path }, close: vi.fn(), tag: 't' };
    return { notification, done: fire('notificationclick', { notification, action: '' }) };
  };
  return { self, shown, badge, opened, push, click };
}

function client(url = `${ORIGIN}/`, focus: () => Promise<unknown> = () => Promise.resolve(undefined)): FakeClient {
  const c: FakeClient = {
    url,
    focus: vi.fn(focus),
    navigate: vi.fn((u: string) => Promise.resolve({ url: u })),
    postMessage: vi.fn(),
  };
  return c;
}
/** Where the client was sent: by navigate (absolute or relative) or by a message carrying the path. */
function sentTo(c: FakeClient): string[] {
  const out: string[] = [];
  for (const [u] of c.navigate.mock.calls as [string][]) { const url = new URL(u, ORIGIN); out.push(`${url.pathname}${url.search}${url.hash}`); }
  for (const [m] of c.postMessage.mock.calls as [unknown][]) {
    const s = JSON.stringify(m);
    const found = /"(\/[^"]*)"/.exec(s);
    if (found?.[1]) out.push(found[1]);
  }
  return out;
}

const PAYLOAD = {
  title: 'smsm', body: 'Sam added Tesco £42.50 · Sam owes Jae £24.50', path: '/entry/00000000-0000-4000-8000-00000000e001',
  tag: 'entry:00000000-0000-4000-8000-00000000e001', icon: '/icons/head-dog.png', count: 3,
};

describe('public/push.js: a push shows the notification (NOT-1, NOT-3, INB-2)', () => {
  it('NOT-1: the title, the words, the sender’s head as the icon, the app’s badge image, a tag per thing, and where a tap goes', async () => {
    const sw = worker();
    await sw.push(PAYLOAD);
    expect(sw.shown).toHaveLength(1);
    const [n] = sw.shown;
    expect(n?.title).toBe('smsm');
    expect(n?.options.body).toBe(PAYLOAD.body);
    expect(n?.options.icon).toBe('/icons/head-dog.png');
    expect(n?.options.badge ?? '').toMatch(/^\/icons\/[\w-]+\.png$/);
    expect(n?.options.badge).not.toBe(n?.options.icon);
    expect(n?.options.tag).toBe(PAYLOAD.tag);
    expect(n?.options.data?.path).toBe(PAYLOAD.path);
  });

  it('NOT-3 INB-2: the app icon’s badge is set from the count the push carries, and cleared at 0', async () => {
    const sw = worker();
    await sw.push(PAYLOAD);
    expect(sw.badge.set).toEqual([3]);
    await sw.push({ ...PAYLOAD, count: 0 });
    expect(sw.badge.cleared).toBe(1);
    expect(sw.badge.set).toEqual([3]);
  });

  it('NOT-3: where the browser has no app badge, the notification still shows', async () => {
    const sw = worker({ badge: false });
    await sw.push(PAYLOAD);
    expect(sw.shown).toHaveLength(1);
  });

  it('NOT-1: a push with nothing readable in it still shows something, and a tap opens Home', async () => {
    const sw = worker();
    await sw.push(undefined);
    await sw.push('not json at all');
    expect(sw.shown).toHaveLength(2);
    for (const n of sw.shown) {
      expect(n.title.trim().length).toBeGreaterThan(0);
      expect(n.options.data?.path ?? '/').toBe('/');
    }
  });
});

describe('public/push.js: tapping opens the thing it is about (NOT-2)', () => {
  it('NOT-2: an open window is sent to the path and brought forward; the notification closes', async () => {
    const open = client();
    const sw = worker({ clients: [open] });
    const { notification, done } = sw.click('/settings#approvals');
    await done;
    expect(notification.close).toHaveBeenCalled();
    expect(sentTo(open)).toContain('/settings#approvals');
    expect(open.focus).toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
  });

  it('NOT-2: with no window open, one is opened at the path', async () => {
    const sw = worker({ clients: [] });
    await sw.click('/bills').done;
    expect(sw.opened.map((u) => new URL(u, ORIGIN).pathname)).toEqual(['/bills']);
  });

  it('NOT-2: a refused focus (not a real tap) still sends the window to the path', async () => {
    const open = client(`${ORIGIN}/activity`, () => Promise.reject(new Error('InvalidAccessError: Not allowed to focus a window.')));
    const sw = worker({ clients: [open] });
    await sw.click('/entry/00000000-0000-4000-8000-00000000e001#comments').done;
    expect(sentTo(open)).toContain('/entry/00000000-0000-4000-8000-00000000e001#comments');
  });

  it('NOT-2: a notification with no path opens Home', async () => {
    const open = client(`${ORIGIN}/bills`);
    const sw = worker({ clients: [open] });
    await sw.click(null).done;
    expect(sentTo(open)).toEqual(['/']);
    const none = worker({ clients: [] });
    await none.click(null).done;
    expect(none.opened.map((u) => new URL(u, ORIGIN).pathname)).toEqual(['/']);
  });
});
