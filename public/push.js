/*
 * smsm's notifications in the service worker (S8; NOT-1, NOT-2, NOT-3, INB-2), loaded with importScripts
 * (vite.config.ts), like share-target.js.
 *
 * push: the push function's payload { title, body, path, tag, icon, count } (supabase/functions/push/handler.ts)
 *   becomes a notification: the sender's animal head as its icon, the app's monochrome badge, one tag per thing
 *   (a later change to it replaces the earlier notification), and the path a tap opens. The app icon's badge is
 *   set from `count` where the browser has one. A push with nothing readable still shows something (a browser
 *   requires a notification for every push) and opens Home.
 * notificationclick: brings an open window of the app forward and sends it to the path, or opens one there. A
 *   focus the browser refuses never stops the window going to the path.
 */
const SMSM_BADGE = '/icons/badge-96.png';
const SMSM_ICON = '/icons/icon-192.png';

function smsmPayload(data) {
  if (!data) return null;
  try {
    const p = data.json();
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

function smsmPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

function smsmSetBadge(count) {
  const nav = self.navigator;
  if (!nav || typeof count !== 'number' || !Number.isFinite(count)) return Promise.resolve();
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') return Promise.resolve(nav.setAppBadge(Math.trunc(count))).catch(() => undefined);
    if (count <= 0 && typeof nav.clearAppBadge === 'function') return Promise.resolve(nav.clearAppBadge()).catch(() => undefined);
  } catch {
    /* no app badge here */
  }
  return Promise.resolve();
}

self.addEventListener('push', (event) => {
  const p = smsmPayload(event.data) ?? {};
  const title = typeof p.title === 'string' && p.title.trim() !== '' ? p.title : 'smsm';
  const options = {
    body: typeof p.body === 'string' ? p.body : '',
    icon: typeof p.icon === 'string' && p.icon.startsWith('/icons/') ? p.icon : SMSM_ICON,
    badge: SMSM_BADGE,
    data: { path: smsmPath(p.path) },
  };
  if (typeof p.tag === 'string' && p.tag !== '') options.tag = p.tag;
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), smsmSetBadge(p.count)]));
});

async function smsmOpen(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((c) => c.url.startsWith(self.location.origin)) ?? windows[0];
  if (!open) {
    await self.clients.openWindow(url);
    return;
  }
  // Forward first, while the tap still allows it; a refusal (no real tap) is not a reason to stay put.
  try {
    await open.focus();
  } catch {
    /* refused: go on */
  }
  let moved = false;
  if (typeof open.navigate === 'function') {
    try {
      moved = (await open.navigate(url)) !== null;
    } catch {
      moved = false;
    }
  }
  // Not this worker's window (navigate refused): the app routes to the path itself (src/ui/notificationTaps.ts).
  if (!moved) open.postMessage({ type: 'smsm-open', path });
}

self.addEventListener('notificationclick', (event) => {
  const path = smsmPath(event.notification && event.notification.data ? event.notification.data.path : null);
  event.notification.close();
  event.waitUntil(smsmOpen(path));
});
