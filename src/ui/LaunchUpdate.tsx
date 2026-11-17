import { useEffect, useState } from 'react';
import { build } from '../data/build';
import { Logo } from './Logo';
import { strings } from './strings';
import { createLaunchUpdate, type UpdateStage } from './launchUpdate';

/** A return to the app after this long counts as a launch (Android often resumes rather than relaunches). */
const RESUME_AFTER_MS = 10 * 60 * 1000;

async function serverVersion(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const res = await fetch('/version.json', { cache: 'no-store' });
  if (!res.ok) return null;
  const body = (await res.json()) as { commit?: unknown };
  return typeof body.commit === 'string' ? body.commit : null;
}

function sheetOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

/**
 * "Updating smsm" (owner, 17 Nov): on launch, and on a return after a while, the app checks the server's
 * version and updates itself, with a progress bar. It never restarts under an open sheet: then the update
 * waits for the next launch (the "A new version is ready" prompt offers it meanwhile).
 */
export function LaunchUpdate({ beforeReload }: { beforeReload: () => Promise<void> }) {
  const [stage, setStage] = useState<UpdateStage>('idle');
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      const update = createLaunchUpdate({
        current: build.commit,
        fetchVersion: serverVersion,
        beforeReload,
        reload: () => { location.reload(); },
        onStage: (s, p) => { setStage(s); setProgress(p); },
        session: sessionStorage,
      });
      void update().finally(() => { running = false; });
    };
    run();
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_MS && !sheetOpen()) run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); };
  }, [beforeReload]);

  if (stage === 'idle' || stage === 'checking') return null;
  const pct = Math.round(progress * 100);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="launch-update-title" className="bg-paper fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 px-8 text-center">
      <Logo size={56} />
      <h1 id="launch-update-title" className="text-title m-0">{strings.update.updating}</h1>
      <div
        role="progressbar"
        aria-label={strings.update.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="bg-sunk h-2 w-full max-w-64 overflow-hidden rounded-full"
      >
        <div className="bg-forest h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${String(Math.max(pct, 6))}%` }} />
      </div>
      <p className="text-secondary text-ink-2 m-0 max-w-72">{strings.update.updatingNote}</p>
    </div>
  );
}
