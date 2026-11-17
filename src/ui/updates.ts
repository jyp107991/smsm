import type { UpdateResult } from './launchUpdate';

/**
 * The one update check (src/ui/LaunchUpdate.tsx registers it), so "Check for updates" in Settings runs the
 * same check as a launch: newer → the "Updating smsm" screen takes over; otherwise a plain answer.
 */
let check: (() => Promise<UpdateResult>) | null = null;

export function registerUpdateCheck(fn: () => Promise<UpdateResult>): () => void {
  check = fn;
  return () => { if (check === fn) check = null; };
}

/** 'skipped' where there is nothing to check with (no service worker, a test, the gallery). */
export function checkForUpdates(): Promise<UpdateResult> {
  return check ? check() : Promise.resolve('skipped');
}
