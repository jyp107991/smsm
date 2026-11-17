import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from './primitives';
import { strings } from './strings';

/**
 * "A new version is ready" with Refresh when a new version is waiting (DATA_MODEL §6, S2 polish Q-L1).
 * It goes through the one toast system, as a sticky toast: above the tab bar like every toast, read by the
 * one live region, and back again after any passing toast ("Saved") has gone. Dismissing it means "later".
 */
export function UpdatePrompt() {
  const toast = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (!needRefresh || shown.current !== null) return;
    shown.current = toast.show({
      message: strings.update.ready,
      action: { label: strings.update.refresh, onAction: () => void updateServiceWorker(true) },
      duration: 0,
      sticky: true,
    });
  }, [needRefresh, toast, updateServiceWorker]);
  useEffect(() => {
    if (needRefresh || shown.current === null) return;
    toast.dismiss(shown.current);
    shown.current = null;
  }, [needRefresh, toast]);
  // Dismissed with its X, it means "later": it doesn't ask again in this visit.
  return null;
}
