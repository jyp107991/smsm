/**
 * S8 (NOT-2): a notification opens the thing it is about. The service worker sends an open window to the path
 * (public/push.js): by navigating it, or, for a window it doesn't control, with a message the app routes here.
 * A path with an anchor (/entry/<id>#comments, /settings#approvals) is brought into view once the page is drawn.
 */
import { useEffect } from 'react';
import { navigate } from './history';

/** Follows the service worker's "open this path" messages for as long as the app is open. */
export function useNotificationTaps(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; path?: unknown } | null;
      if (data?.type !== 'smsm-open' || typeof data.path !== 'string') return;
      if (!data.path.startsWith('/') || data.path.startsWith('//')) return;
      navigate(data.path);
    };
    container.addEventListener('message', onMessage);
    return () => { container.removeEventListener('message', onMessage); };
  }, []);
}

/** Brings the element the URL's anchor names into view, trying for a moment while the page is drawn. */
export function scrollToAnchor(): () => void {
  const id = typeof location === 'undefined' ? '' : decodeURIComponent(location.hash.slice(1));
  if (id === '') return () => undefined;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = () => {
    const el = document.getElementById(id);
    if (el) {
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
      return;
    }
    tries += 1;
    if (tries < 20) timer = setTimeout(look, 50);
  };
  look();
  return () => { if (timer !== undefined) clearTimeout(timer); };
}
