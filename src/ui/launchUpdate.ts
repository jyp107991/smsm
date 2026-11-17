/**
 * Keeping the app current (owner, 17 Nov: "app must check for updates on launch and update if it is not
 * latest version, and must show progress bar of updating"). A phone had stayed on an old build because the
 * old app only offered "Refresh" and its service worker waited for every window to close.
 *
 * On launch (and on a return after a while), compare this build with the server's /version.json. If the
 * server has a newer one: let the service worker download and install it, tell it to take over, save the
 * waiting writes (nothing typed is lost), and reload. Stages and progress (0–1) drive the "Updating smsm" bar.
 * Offline or unreadable: the app opens as it is (nothing blocks adding). One reload per new version at most.
 */

export type UpdateStage = 'idle' | 'checking' | 'downloading' | 'installing' | 'restarting';
export type UpdateResult = 'latest' | 'skipped' | 'updated' | 'failed';

interface SessionLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LaunchUpdateDeps {
  /** This build's commit. */
  current: string;
  /** The server's current commit (from /version.json, never cached); rejects or null when unknown. */
  fetchVersion: () => Promise<string | null>;
  /** The service worker container; undefined where there is none. Omitted: the browser's. */
  container?: ServiceWorkerContainer | undefined;
  /** Save the waiting writes and the cache before the page goes. */
  beforeReload: () => Promise<void>;
  reload: () => void;
  onStage: (stage: UpdateStage, progress: number) => void;
  /** Remembers which version a reload was for (sessionStorage in the app), so it never loops. */
  session: SessionLike;
  /** How long an install may take before the app carries on as it is. */
  timeoutMs?: number;
}

const RELOADED_FOR = 'smsm-update-reloaded-for';
const SKIP = { type: 'SKIP_WAITING' } as const;

export function createLaunchUpdate(deps: LaunchUpdateDeps): () => Promise<UpdateResult> {
  const container = 'container' in deps ? deps.container : (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
  const timeoutMs = deps.timeoutMs ?? 30_000;
  let progress = 0;
  const stage = (s: UpdateStage, p: number) => {
    progress = Math.max(progress, p); // the bar never goes backwards
    deps.onStage(s, s === 'idle' || s === 'checking' ? p : progress);
  };

  return async () => {
    stage('checking', 0);
    let latest: string | null;
    try {
      latest = await deps.fetchVersion();
    } catch {
      stage('idle', 0);
      return 'skipped';
    }
    if (!latest) {
      stage('idle', 0);
      return 'skipped';
    }
    if (latest === deps.current) {
      stage('idle', 0);
      return 'latest';
    }
    // Already reloaded once for this version and still old: don't loop; the prompt offers Refresh instead.
    if (safeGet(deps.session, RELOADED_FOR) === latest) {
      stage('idle', 0);
      return 'failed';
    }

    const restart = async (): Promise<UpdateResult> => {
      stage('restarting', 1);
      try { deps.session.setItem(RELOADED_FOR, latest); } catch { /* private mode: still fine once */ }
      await deps.beforeReload().catch(() => undefined);
      deps.reload();
      return 'updated';
    };

    stage('downloading', 0.15);
    if (!container) return restart();
    let reg: ServiceWorkerRegistration | undefined;
    try {
      reg = await container.getRegistration();
    } catch {
      reg = undefined;
    }
    if (!reg) return restart();
    const registration = reg;

    return new Promise<UpdateResult>((resolve) => {
      let done = false;
      const finish = (r: Promise<UpdateResult> | UpdateResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void Promise.resolve(r).then(resolve);
      };
      const timer = setTimeout(() => {
        stage('idle', 0);
        finish('failed');
      }, timeoutMs);

      container.addEventListener('controllerchange', () => { finish(restart()); }, { once: true });

      const watch = (w: ServiceWorker) => {
        const onState = () => {
          if (w.state === 'installed') {
            stage('installing', 0.7);
            w.postMessage(SKIP);
          } else if (w.state === 'activating') stage('installing', 0.85);
          else if (w.state === 'activated') stage('installing', 0.95);
        };
        w.addEventListener('statechange', onState);
        onState();
      };
      registration.addEventListener('updatefound', () => {
        stage('downloading', 0.3);
        if (registration.installing) watch(registration.installing);
      });

      if (registration.waiting) {
        stage('installing', 0.8);
        registration.waiting.postMessage(SKIP);
        return;
      }
      if (registration.installing) watch(registration.installing);
      void registration.update().then(
        () => {
          if (done) return;
          if (registration.waiting) {
            stage('installing', 0.8);
            registration.waiting.postMessage(SKIP);
          } else if (!registration.installing) {
            // Nothing to install: the new version is already in charge (it took over while this old page
            // was opening). One reload brings it in.
            finish(restart());
          }
        },
        () => {
          if (!done) {
            stage('idle', 0);
            finish('failed');
          }
        },
      );
    });
  };
}

function safeGet(s: SessionLike, key: string): string | null {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}
