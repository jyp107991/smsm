/**
 * S9 (performance audit P2): every screen but Home, and the two sheets, load on demand, so the first screen's
 * script is only what Home needs. After Home shows, the rest are fetched in idle time (`preloadScreens`), and
 * a screen that is already here renders straight away, with no loading step in between: React.lazy only
 * covers a screen asked for before its file has arrived (an address opened directly, a very quick tap).
 */
import { lazy, useState, type ComponentType, type JSX } from 'react';
import { whenFirstScreen } from '../ui/boot';
import { preloadSheet } from '../ui/primitives/Sheet';

export interface LazyScreen<P extends object> {
  (props: P): JSX.Element | null;
  /** Fetches the screen's file (once); resolves when it can render without waiting. */
  preload: () => Promise<void>;
}

/**
 * `idle` says when there is nothing to show yet (a sheet nobody has asked for): then a screen whose file
 * hasn't arrived draws nothing and doesn't fetch it ahead of the idle-time prefetch.
 */
function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>, idle?: (props: P) => boolean): LazyScreen<P> {
  let ready: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const fetchIt = (): Promise<ComponentType<P>> => {
    loading ??= load().then(
      (screen) => {
        ready = screen;
        return screen;
      },
      (err: unknown) => {
        // Offline before it was cached: the next try fetches again.
        loading = null;
        throw err;
      },
    );
    return loading;
  };
  const Waiting = lazy(async () => ({ default: await fetchIt() }));
  const Screen = (props: P): JSX.Element | null => {
    // A screen that started out waiting for its file stays on React.lazy (which renders at once from then on):
    // switching to the loaded component later would remount it and lose what was typed or chosen.
    const [waited, setWaited] = useState(false);
    const Ready = ready;
    if (Ready && !waited) return <Ready {...props} />;
    if (idle?.(props) && !waited) return null;
    if (!waited) setWaited(true);
    return <Waiting {...props} />;
  };
  Screen.preload = () => fetchIt().then(() => undefined);
  return Screen;
}

export const Activity = lazyScreen(() => import('./activity/Activity').then((m) => m.Activity));
export const Bills = lazyScreen(() => import('./bills/Bills').then((m) => m.Bills));
export const Inbox = lazyScreen(() => import('./bills/Inbox').then((m) => m.Inbox));
export const Insights = lazyScreen(() => import('./insights/Insights').then((m) => m.Insights));
export const RecapPage = lazyScreen(() => import('./insights/RecapPage').then((m) => m.RecapPage));
export const YearPage = lazyScreen(() => import('./insights/YearPage').then((m) => m.YearPage));
export const Categories = lazyScreen(() => import('./settings/Categories').then((m) => m.Categories));
export const Settings = lazyScreen(() => import('./settings/Settings').then((m) => m.Settings));
export const ChapterPage = lazyScreen(() => import('./chapters/ChapterPage').then((m) => m.ChapterPage));
export const Chapters = lazyScreen(() => import('./chapters/Chapters').then((m) => m.Chapters));
export const EntryPage = lazyScreen(() => import('./entry/EntryPage').then((m) => m.EntryPage));
export const StatementPage = lazyScreen(() => import('./statement/Statement').then((m) => m.StatementPage));
export const EntrySheet = lazyScreen(() => import('./entry/EntrySheet').then((m) => m.EntrySheet), (p) => p.request === null);
export const SettleSheet = lazyScreen(() => import('./settle/SettleSheet').then((m) => m.SettleSheet), (p) => p.request === null);

/** Most likely first: the add sheet and the tabs, then the pages under them. */
const ORDER: readonly { preload: () => Promise<void> }[] = [
  EntrySheet, Activity, EntryPage, SettleSheet, Insights, Bills, Settings, RecapPage, Inbox, Chapters, ChapterPage, YearPage, Categories, StatementPage,
];

/** Fetches every screen (each once). The app calls it in idle time after Home shows. */
export function preloadScreens(): Promise<void> {
  // The sheet's own code (vaul) first: every sheet, on any screen, needs it.
  return Promise.all([preloadSheet(), ...ORDER.map((s) => s.preload())]).then(() => undefined);
}

/** Runs `preloadScreens` once the first screen has painted and the phone is idle (src/ui/boot.ts). */
export function preloadWhenIdle(): () => void {
  let live = true;
  void whenFirstScreen().then(() => (live ? preloadScreens() : undefined)).catch(() => undefined);
  return () => { live = false; };
}
