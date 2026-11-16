import { useRegisterSW } from 'virtual:pwa-register/react';
import { strings } from './strings';

/** "Updated. Tap to refresh" when a new version is waiting (DATA_MODEL §6). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="bg-surface shadow-float fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto flex max-w-md items-center gap-3 rounded-[12px] px-4 py-3"
    >
      <span className="flex-1">{strings.update.ready}</span>
      <button
        type="button"
        className="text-ink-2 min-h-11 px-3"
        onClick={() => { setNeedRefresh(false); }}
      >
        {strings.update.later}
      </button>
      <button
        type="button"
        className="bg-forest text-on-forest min-h-11 rounded-full px-4 font-semibold"
        onClick={() => void updateServiceWorker(true)}
      >
        {strings.update.refresh}
      </button>
    </div>
  );
}
