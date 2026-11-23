/**
 * S9 (performance audit P2): every screen but Home, and the two sheets, load on demand, so the first screen's
 * script is only what Home needs. After Home shows, the rest are fetched in idle time (`preloadScreens`), and
 * a screen that is already here renders straight away, with no loading step in between: React.lazy only
 * covers a screen asked for before its file has arrived (an address opened directly, a very quick tap).
 * A file that doesn't arrive shows "Couldn't load this." in its own place, with Try again.
 */
import { lazy, Suspense, useState, type ComponentType, type JSX } from 'react';
import { LoadBoundary, retryable } from '../ui/loadRetry';
import { whenFirstScreen } from '../ui/boot';
import { preloadSheet } from '../ui/primitives/Sheet';

export interface LazyScreen<P extends object> {
  (props: P): JSX.Element | null;
  /** Fetches the screen's file (once); resolves when it can render without waiting. */
  preload: () => Promise<void>;
}

/** After this many failed tries in a row, Try again reloads the page instead. */
const TRIES_BEFORE_RELOAD = 3;

/**
 * `idle` says when there is nothing to show yet (a sheet nobody has asked for): then a screen whose file
 * hasn't arrived draws nothing and doesn't fetch it ahead of the idle-time prefetch. `sheet` puts its
 * "Couldn't load this." over the page with Close (`close` reads how), rather than in the page.
 *
 * S9 review: a file that doesn't arrive stays this screen's problem ("Couldn't load this.", Try again), and Try
 * again really fetches it again (src/ui/loadRetry.tsx).
 */
export function lazyScreen<M, P extends object>(
  importer: () => Promise<M>,
  pick: (m: M) => ComponentType<P>,
  opts: { idle?: (props: P) => boolean; close?: (props: P) => () => void } = {},
): LazyScreen<P> {
  const file = retryable(importer);
  const makeWaiting = () => lazy(async () => ({ default: pick(await file.load({ onScreen: true })) }));
  let Waiting = makeWaiting();
  const retry = () => {
    if (file.failures() >= TRIES_BEFORE_RELOAD) {
      location.reload();
      return;
    }
    Waiting = makeWaiting();
  };
  const Screen = (props: P): JSX.Element | null => {
    // A screen that started out waiting for its file stays on React.lazy (which renders at once from then on):
    // switching to the loaded component later would remount it and lose what was typed or chosen.
    const [waited, setWaited] = useState(false);
    const [, setTries] = useState(0);
    const loaded = file.loaded();
    const Ready = loaded ? pick(loaded) : null;
    if (Ready && !waited) return <Ready {...props} />;
    if (opts.idle?.(props) && !waited) return null;
    if (!waited) setWaited(true);
    const Now = Waiting;
    return (
      <LoadBoundary
        onRetry={() => { retry(); setTries((n) => n + 1); }}
        floating={opts.close !== undefined}
        {...(opts.close ? { onClose: opts.close(props) } : {})}
      >
        <Suspense fallback={null}>
          <Now {...props} />
        </Suspense>
      </LoadBoundary>
    );
  };
  Screen.preload = () => file.load().then(() => undefined);
  return Screen;
}

export const Activity = lazyScreen(() => import('./activity/Activity'), (m) => m.Activity);
export const Bills = lazyScreen(() => import('./bills/Bills'), (m) => m.Bills);
export const Inbox = lazyScreen(() => import('./bills/Inbox'), (m) => m.Inbox);
export const Insights = lazyScreen(() => import('./insights/Insights'), (m) => m.Insights);
export const RecapPage = lazyScreen(() => import('./insights/RecapPage'), (m) => m.RecapPage);
export const YearPage = lazyScreen(() => import('./insights/YearPage'), (m) => m.YearPage);
export const Categories = lazyScreen(() => import('./settings/Categories'), (m) => m.Categories);
export const Settings = lazyScreen(() => import('./settings/Settings'), (m) => m.Settings);
export const ChapterPage = lazyScreen(() => import('./chapters/ChapterPage'), (m) => m.ChapterPage);
export const Chapters = lazyScreen(() => import('./chapters/Chapters'), (m) => m.Chapters);
export const EntryPage = lazyScreen(() => import('./entry/EntryPage'), (m) => m.EntryPage);
export const StatementPage = lazyScreen(() => import('./statement/Statement'), (m) => m.StatementPage);
type SheetRequestProps = { request: unknown; onClose: () => void };
const asSheet = { idle: (p: SheetRequestProps) => p.request === null, close: (p: SheetRequestProps) => p.onClose };
export const EntrySheet = lazyScreen(() => import('./entry/EntrySheet'), (m) => m.EntrySheet, asSheet);
export const SettleSheet = lazyScreen(() => import('./settle/SettleSheet'), (m) => m.SettleSheet, asSheet);

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
