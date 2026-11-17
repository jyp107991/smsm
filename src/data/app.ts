/**
 * The app's data layer: over Supabase with IndexedDB in the real app, over the seeded household in memory
 * in the demo build. `__APP_DEMO__` is replaced at build time, so the production bundle drops the demo
 * branch (and its seed) entirely.
 */
import { todayIn } from '../core/dates';
import { build } from './build';
import { browserNetwork } from './network';
import type { DataLayer } from './queryClient';
import { reporter } from './reporting';
import { createAppUpdater } from './staleApp';
import { idbStorage, requestPersistentStorage } from './storage';
import { createStore } from './store';
import { supabase } from './supabase';

/** The phone's own calendar date, in its own time zone (DAT-2). */
export function phoneToday(): string {
  return todayIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Null when the build has no Supabase settings (and isn't the demo). */
export async function createAppDataLayer(): Promise<DataLayer | null> {
  if (__APP_DEMO__) {
    const { createDemoLayer } = await import('./demo');
    return createDemoLayer();
  }
  const db = supabase();
  if (!db) return null;
  // OFF-1: ask the browser to keep the household's copy and the queue.
  void requestPersistentStorage();
  let layer: DataLayer | null = null;
  // The updater saves the queue to IndexedDB before the page reloads into the new version.
  const onStale = createAppUpdater({ beforeReload: () => layer?.flush() ?? Promise.resolve() });
  const store = createStore({
    client: db,
    storage: idbStorage(),
    network: browserNetwork(),
    appVersion: build.version,
    today: phoneToday,
    onStale,
    report: (err, context) => void reporter.report(err, location.pathname, context),
    // Crash reports queued before sign-in or offline are sent once someone is signed in.
    onSignedIn: () => void reporter.flush(),
  });
  layer = store.layer;
  return layer;
}
