/**
 * S8: this phone's notification support and push subscription, as the browser has them (PushManager), shared by the
 * Settings calls (notifications.ts) and sign-out (queryClient.ts): signing out stops notifications on the phone.
 */
import type { Api } from './api';
import { onForget } from './forget';

export interface Push { registration(wait: boolean): Promise<ServiceWorkerRegistration | null> }

/** The browser's notification and push support, or null (an iPhone outside an installed app; an old browser). */
export function support(): Push | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return null;
  const container = navigator.serviceWorker;
  return {
    async registration(wait) {
      const found = await container.getRegistration().catch(() => undefined);
      if (found?.pushManager) return found;
      if (!wait) return null;
      // Still installing: give it a few seconds.
      const ready = await Promise.race([container.ready, new Promise<null>((r) => { setTimeout(() => { r(null); }, 4000); })]);
      return ready?.pushManager ? ready : null;
    },
  };
}

export function permission(): NotificationPermission {
  try {
    return Notification.permission;
  } catch {
    return 'default';
  }
}

export function b64u(bytes: ArrayBuffer | Uint8Array | null | undefined): string {
  if (!bytes) return '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** The key a subscription was made with, as base64url. */
export function keyOf(sub: PushSubscription): string {
  return b64u(sub.options.applicationServerKey);
}

export function writeOf(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' };
}


/** Resolves when `p` settles or after `ms`, whichever is first; never rejects (best effort, never blocking). */
export function within(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.then(() => undefined, () => undefined).finally(() => { clearTimeout(timer); resolve(); });
  });
}

/**
 * Sign-out (NOT-1): this phone stops showing the person's notifications. While still signed in, the server forgets
 * the subscription (remove_push_subscription); then the browser drops it, offline too (its push service then answers
 * 410 and the push function forgets it). Never throws.
 */
export async function dropThisPhone(api: Api | null): Promise<void> {
  try {
    const push = support();
    if (!push) return;
    const reg = await push.registration(false);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    if (api) await within(api.removePushSubscription(sub.endpoint), 2500);
    await sub.unsubscribe();
  } catch {
    /* best effort: the person is signed out either way */
  }
}

// However the person was signed out, the phone's subscription goes with them.
onForget(() => within(dropThisPhone(null), 2500));
