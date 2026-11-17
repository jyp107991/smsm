import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from './primitives';
import { strings } from './strings';

/**
 * "A new version is ready" with Refresh when a new version is waiting (DATA_MODEL §6, S2 polish Q-L1).
 * It goes through the one toast system, as a sticky toast: above the tab bar like every toast, read by the
 * one live region, and back again after any passing toast ("Saved") has gone. Dismissing it means "later".
 */
export function UpdatePrompt({ beforeReload }: { beforeReload: () => Promise<void> }) {
  const toast = useToast();
  // The new worker takes over at once (skipWaiting): an old page that stays open learns of it here. A first
  // install also changes the controller, so only a page that already had one counts.
  const [tookOver, setTookOver] = useState(false);
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw?.controller) return;
    const on = () => { if (!document.getElementById('launch-update-title')) setTookOver(true); };
    sw.addEventListener('controllerchange', on);
    return () => { sw.removeEventListener('controllerchange', on); };
  }, []);
  const {
    needRefresh: [waiting],
    updateServiceWorker,
  } = useRegisterSW({
    // A new version takes over at once (skipWaiting). The plugin would reload the page then, even mid-entry;
    // instead the prompt offers Refresh, and the next launch updates by itself (LaunchUpdate).
    onNeedReload() { setTookOver(true); },
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  const needRefresh = waiting || tookOver;
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (!needRefresh || shown.current !== null) return;
    shown.current = toast.show({
      message: strings.update.ready,
      action: {
        label: strings.update.refresh,
        onAction: () => {
          if (waiting) void updateServiceWorker(true);
          else void beforeReload().finally(() => { location.reload(); });
        },
      },
      duration: 0,
      sticky: true,
    });
  }, [needRefresh, waiting, beforeReload, toast, updateServiceWorker]);
  useEffect(() => {
    if (needRefresh || shown.current === null) return;
    toast.dismiss(shown.current);
    shown.current = null;
  }, [needRefresh, toast]);
  // Dismissed with its X, it means "later": it doesn't ask again in this visit.
  return null;
}
