/**
 * S8: the browser's notification and push APIs, faked in jsdom for data and screen tests (docs/slices/S8.md "Switches",
 * "Subscriptions", "Icon badge"). jsdom has none of them, so a test installs exactly what the phone it plays has:
 *   - 'full': window.Notification (permission, requestPermission), window.PushManager, navigator.serviceWorker whose
 *     `ready` registration has a pushManager (getSubscription, subscribe, permissionState); and, unless `badge: false`,
 *     navigator.setAppBadge / navigator.clearAppBadge.
 *   - 'none': nothing (an iPhone's Safari outside an installed app; an old browser).
 * A subscription looks like the browser's PushSubscription: endpoint, options.applicationServerKey (ArrayBuffer),
 * getKey('p256dh' | 'auth') (ArrayBuffer), toJSON() → { endpoint, expirationTime: null, keys: { p256dh, auth } }
 * (base64url), unsubscribe(). subscribe() refuses unless permission is 'granted', as a browser does, and accepts the
 * key as an ArrayBuffer, a typed array or a base64url string.
 * Call `uninstall()` (or `uninstallPush()`) after each test.
 */
import { vi, type Mock } from 'vitest';

export interface FakeSubscription {
  endpoint: string;
  expirationTime: null;
  options: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer };
  getKey(name: 'p256dh' | 'auth'): ArrayBuffer;
  toJSON(): { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  unsubscribe(): Promise<boolean>;
}

export interface FakePushOptions {
  support?: 'full' | 'none';
  /** Notification.permission to start with. */
  permission?: NotificationPermission;
  /** What the browser's prompt answers when asked. */
  answer?: NotificationPermission;
  /** A subscription this phone already has, made with this public key (base64url). */
  existing?: { endpoint: string; key: string } | null;
  /** navigator.setAppBadge / clearAppBadge exist. */
  badge?: boolean;
}

export interface FakePush {
  state: { permission: NotificationPermission; subscription: FakeSubscription | null };
  requestPermission: Mock<() => Promise<NotificationPermission>>;
  subscribe: Mock<(opts: { userVisibleOnly?: boolean; applicationServerKey?: BufferSource | string }) => Promise<FakeSubscription>>;
  /** Endpoints this phone unsubscribed. */
  unsubscribed: string[];
  setAppBadge: Mock<(n?: number) => Promise<void>>;
  clearAppBadge: Mock<() => Promise<void>>;
  uninstall(): void;
}

/** The p256dh and auth every fake subscription reports (base64url, the sizes a browser gives). */
export const FAKE_P256DH = b64u(new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256)));
export const FAKE_AUTH = b64u(new Uint8Array(16).map((_, i) => (i * 13) % 256));

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
/** A server public key as push_public_key() answers it: base64url of a raw P-256 point (65 bytes, 0x04 first). */
export function publicKey(seed: number): string {
  return b64u(new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * seed + 11) % 256)));
}
function bytesOf(key: BufferSource | string | undefined): Uint8Array {
  if (key === undefined) return new Uint8Array();
  if (typeof key === 'string') return fromB64u(key);
  if (key instanceof ArrayBuffer) return new Uint8Array(key);
  return new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
}
const bufferOf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

let serial = 0;
let installed: FakePush | null = null;

export function installPush(opts: FakePushOptions = {}): FakePush {
  installed?.uninstall();
  const support = opts.support ?? 'full';
  const answer = opts.answer ?? 'granted';
  const unsubscribed: string[] = [];
  const state: FakePush['state'] = { permission: opts.permission ?? 'default', subscription: null };

  function makeSubscription(endpoint: string, key: Uint8Array): FakeSubscription {
    const sub: FakeSubscription = {
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: bufferOf(key) },
      getKey: (name) => bufferOf(fromB64u(name === 'p256dh' ? FAKE_P256DH : FAKE_AUTH)),
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH } }),
      unsubscribe: () => {
        if (state.subscription === sub) state.subscription = null;
        unsubscribed.push(endpoint);
        return Promise.resolve(true);
      },
    };
    return sub;
  }
  if (opts.existing) state.subscription = makeSubscription(opts.existing.endpoint, fromB64u(opts.existing.key));

  const requestPermission = vi.fn(() => {
    if (state.permission === 'default') state.permission = answer;
    return Promise.resolve(state.permission);
  });
  const subscribe = vi.fn((o: { userVisibleOnly?: boolean; applicationServerKey?: BufferSource | string }) => {
    if (state.permission !== 'granted') return Promise.reject(new DOMException('Registration failed - permission denied', 'NotAllowedError'));
    if (state.subscription) {
      const same = b64u(new Uint8Array(state.subscription.options.applicationServerKey)) === b64u(bytesOf(o.applicationServerKey));
      if (!same) return Promise.reject(new DOMException('A subscription with a different applicationServerKey already exists', 'InvalidStateError'));
      return Promise.resolve(state.subscription);
    }
    serial += 1;
    state.subscription = makeSubscription(`https://fcm.googleapis.com/fcm/send/fake-${String(serial)}`, bytesOf(o.applicationServerKey));
    return Promise.resolve(state.subscription);
  });
  const setAppBadge = vi.fn((n?: number) => (n === undefined || n >= 0 ? Promise.resolve() : Promise.reject(new TypeError("negative"))));
  const clearAppBadge = vi.fn(() => Promise.resolve());

  const touched: { target: object; key: string; had: PropertyDescriptor | undefined }[] = [];
  const define = (target: object, key: string, value: unknown) => {
    touched.push({ target, key, had: Object.getOwnPropertyDescriptor(target, key) });
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
  };
  const remove = (target: object, key: string) => {
    touched.push({ target, key, had: Object.getOwnPropertyDescriptor(target, key) });
    Reflect.deleteProperty(target, key);
  };

  if (support === 'full') {
    const FakeNotification = function Notification() { /* never constructed here */ } as unknown as Record<string, unknown>;
    Object.defineProperty(FakeNotification, 'permission', { configurable: true, get: () => state.permission });
    FakeNotification.requestPermission = requestPermission;
    const pushManager = {
      getSubscription: () => Promise.resolve(state.subscription),
      subscribe,
      permissionState: () => Promise.resolve(state.permission === 'default' ? 'prompt' : state.permission),
    };
    const registration = {
      scope: `${location.origin}/`, active: { state: 'activated' }, pushManager,
      showNotification: () => Promise.resolve(), getNotifications: () => Promise.resolve([]), update: () => Promise.resolve(),
      addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    const container = {
      controller: null, ready: Promise.resolve(registration),
      getRegistration: () => Promise.resolve(registration), getRegistrations: () => Promise.resolve([registration]),
      register: () => Promise.resolve(registration), addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    define(window, 'Notification', FakeNotification);
    define(window, 'PushManager', function PushManager() { /* exists */ });
    define(navigator, 'serviceWorker', container);
    if (opts.badge !== false) {
      define(navigator, 'setAppBadge', setAppBadge);
      define(navigator, 'clearAppBadge', clearAppBadge);
    } else {
      remove(navigator, 'setAppBadge');
      remove(navigator, 'clearAppBadge');
    }
  } else {
    remove(window, 'Notification');
    remove(window, 'PushManager');
    remove(navigator, 'serviceWorker');
    if (opts.badge === true) {
      define(navigator, 'setAppBadge', setAppBadge);
      define(navigator, 'clearAppBadge', clearAppBadge);
    } else {
      remove(navigator, 'setAppBadge');
      remove(navigator, 'clearAppBadge');
    }
  }

  const fake: FakePush = {
    state, requestPermission, subscribe, unsubscribed, setAppBadge, clearAppBadge,
    uninstall: () => {
      for (const t of touched.reverse()) {
        if (t.had) Object.defineProperty(t.target, t.key, t.had);
        else Reflect.deleteProperty(t.target, t.key);
      }
      touched.length = 0;
      if (installed === fake) installed = null;
    },
  };
  installed = fake;
  return fake;
}

export function uninstallPush(): void {
  installed?.uninstall();
}
