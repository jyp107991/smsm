/**
 * Stale apps (DATA_MODEL §6). The version check is in version.ts and runs before the first write
 * (queryClient.ts). An older app must not write (it might write a shape the database has moved on from):
 * its writes stay queued on the phone, it asks the service worker for the new version (here), and the new
 * version sends the queue after it reloads. Nothing typed is lost and nothing blocks adding.
 */

function waitingWorker(reg: ServiceWorkerRegistration): ServiceWorker | null {
  return reg.waiting;
}

/**
 * Ask the service worker for the new version and reload once it has taken over. Without a service worker
 * (development), or when no newer version exists yet, nothing happens: the writes simply keep waiting.
 */
export function createAppUpdater(opts: {
  beforeReload: () => Promise<void>;
  container?: ServiceWorkerContainer | undefined;
  reload?: () => void;
}): () => void {
  const container = opts.container ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
  const reload = opts.reload ?? (() => { location.reload(); });
  let started = false;
  let listening = false;
  return () => {
    if (started || !container) return;
    started = true;
    void (async () => {
      try {
        const reg = await container.getRegistration();
        if (!reg) {
          started = false;
          return;
        }
        if (!listening) {
          listening = true;
          container.addEventListener('controllerchange', () => {
            void opts.beforeReload().finally(reload);
          }, { once: true });
        }
        const skip = (w: ServiceWorker) => { w.postMessage({ type: 'SKIP_WAITING' }); };
        if (reg.waiting) {
          skip(reg.waiting);
          return;
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') skip(installing);
          });
        });
        await reg.update();
        // Read again: update() may have found and installed a new version.
        const waiting = waitingWorker(reg);
        if (waiting) skip(waiting);
        // No newer version published yet: look again before the next write.
        else if (!reg.installing) started = false;
      } catch {
        started = false; // try again before the next write
      }
    })();
  };
}
