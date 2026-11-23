/**
 * The signed-in app and the steps before it. Signed out, every route shows sign-in (S2 brief, "Routes");
 * signed in but not in a household, start or join; then name and animal; then the app: Home and Activity
 * and Bills as tabs (Insights waits for S5), the entry page and Settings, and the two sheets.
 */
import { memo, startTransition, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppBadge, useHousehold, useRefreshPush, useSession, useSyncStatus } from '../data';
import { scrollToAnchor, useNotificationTaps } from '../ui/anchors';
import { FEATURES } from '../ui/features';
import { BottomTabs, Button, MAIN_TABS, TabPanel, ToastProvider, type MainTab } from '../ui/primitives';
import { go, parseRoute, usePath, type Route } from '../ui/router';
import { strings } from '../ui/strings';
import { rememberNotHome, useBootDone } from '../ui/boot';
import { useWide } from '../ui/wide';
import { Home } from './home/Home';
// S9 (performance audit P2): every other screen and both sheets load on demand (src/screens/lazy.tsx).
import {
  Activity, Bills, Categories, ChapterPage, Chapters, EntryPage, EntrySheet, Inbox, Insights, preloadWhenIdle, RecapPage, SettleSheet, Settings,
  StatementPage, YearPage,
} from './lazy';
import { savePending } from './settle/monzo';
import { MonzoQuestionProvider } from './settle/question';
import { usePeople } from './shared/people';
import { FromOutside } from './shell/FromOutside';
import { SheetsContext, type EntryRequest, type SettleRequest } from './sheets';
import { SignIn } from './signin/SignIn';
import { StartOrJoin, WhoAreYou } from './setup/Setup';
import { useDataLayer } from '../data';

/**
 * S9: the first real screen is drawn, so the static first paint (index.html) goes in the same frame. A screen
 * other than Home that starts the app (sign-in, setup) is remembered, so next time the first paint is plain paper.
 */
function BootDone({ home = true }: { home?: boolean }) {
  useBootDone();
  useEffect(() => { if (!home) rememberNotHome(); }, [home]);
  return null;
}

/** The paper while the phone's copy is read (milliseconds); nothing that would jump when it arrives. */
function Blank() {
  return <div className="min-h-dvh" aria-busy="true" />;
}

export function Root() {
  const session = useSession();
  const signedOut = session.status === 'signed-out';
  useEffect(() => {
    // A "Did it go through?" question belongs to the person who asked it: signing out forgets it (SET-2).
    if (signedOut) void savePending(null);
  }, [signedOut]);
  if (session.status === 'loading') return <Blank />;
  if (session.status === 'signed-out') return <><SignIn /><BootDone home={false} /></>;
  return <Household />;
}

function Household() {
  const household = useHousehold();
  const people = usePeople();
  const layer = useDataLayer();
  if (household.data === undefined) {
    if (household.status === 'error') {
      return (
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5">
          <BootDone />
          <p role="alert" className="text-note m-0">{strings.errors.cantLoad}</p>
          <div>
            <Button variant="plain" onClick={() => void layer.refresh()}>{strings.errors.tryAgain}</Button>
          </div>
        </main>
      );
    }
    return <Blank />;
  }
  if (household.data === null) return <><StartOrJoin /><BootDone home={false} /></>;
  if (!people.ready) return <Blank />;
  if (!people.myRow?.locked_at) return <><WhoAreYou /><BootDone home={false} /></>;
  return <MainApp />;
}

const TABS = MAIN_TABS.filter((t) => t.value === 'home' || t.value === 'activity' || (t.value === 'bills' ? FEATURES.bills : FEATURES.insights));

function tabOf(route: Route, last: MainTab): MainTab {
  if (route.name === 'activity') return 'activity';
  if (route.name === 'bills') return 'bills';
  if (route.name === 'insights' || route.name === 'recap' || route.name === 'year') return 'insights';
  if (route.name === 'entry') return last;
  return 'home';
}

/**
 * S9b (DESIGN §4.11, L2): from 900 px wide, Activity is two panes: the list on the left and, on the right (region
 * "Details"), the entry picked from it. The list stays as it was (its search, filters and scroll) while entries
 * change beside it. The same two screens as on a phone; only their arrangement differs.
 */
function Panes({ list, detail, detailKey }: { list: ReactNode; detail: ReactNode; detailKey: string | null }) {
  const pane = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useRef(detailKey);
  // Another entry starts at its own top.
  useEffect(() => { pane.current?.scrollTo(0, 0); }, [detailKey]);
  // S9b review: focus follows the pick. An entry opened from the list takes focus at its heading (so the keyboard and
  // a screen reader go on from there, not from the top of the list); closing the pane gives focus back to its row.
  useEffect(() => {
    const was = shown.current;
    shown.current = detailKey;
    if (was === detailKey) return;
    let frame = 0;
    let tries = 0;
    if (detailKey !== null) {
      const toHeading = () => {
        const heading = pane.current?.querySelector<HTMLElement>('h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        } else if (tries++ < 60) frame = requestAnimationFrame(toHeading);
      };
      toHeading();
    } else if (was !== null) {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(was)}"]`);
      row?.focus();
    }
    return () => { cancelAnimationFrame(frame); };
  }, [detailKey]);
  return (
    <div className="mx-auto grid max-w-[76rem] grid-cols-[minmax(20rem,28rem)_minmax(0,40rem)] justify-center gap-x-10">
      {/* data-panes-list: a pick here replaces the entry the pane shows (rows.tsx), so Back closes the pane. */}
      <div ref={listRef} data-panes-list="" className="min-w-0">{list}</div>
      <section
        ref={pane}
        aria-label={strings.activity.details}
        className="sticky top-0 h-dvh min-w-0 self-start overflow-y-auto overscroll-contain"
      >
        {detail ?? (
          <p className="text-secondary text-ink-2 m-0 flex min-h-[calc(max(1rem,env(safe-area-inset-top))+3rem)] items-end px-5">{strings.activity.pickOne}</p>
        )}
      </section>
    </div>
  );
}

const Page = memo(function Page({ route, tab, wide }: { route: Route; tab: MainTab; wide: boolean }) {
  if (wide && tab === 'activity' && (route.name === 'activity' || route.name === 'entry')) {
    const id = route.name === 'entry' ? route.id : null;
    return <Panes list={<Activity />} detail={id === null ? null : <EntryPage key={id} id={id} />} detailKey={id} />;
  }
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'activity':
      return <Activity />;
    case 'settings':
      return <Settings />;
    case 'entry':
      return <EntryPage key={route.id} id={route.id} />;
    case 'bills':
      return <Bills />;
    case 'insights':
      return <Insights />;
    case 'recap':
      return <RecapPage key={route.month} month={route.month} />;
    case 'year':
      return <YearPage key={route.year} year={Number(route.year)} />;
    case 'inbox':
      return <Inbox />;
    case 'categories':
      return <Categories />;
    case 'chapters':
      return <Chapters />;
    case 'chapter':
      return <ChapterPage key={route.id} id={route.id} />;
    case 'statement':
      return <StatementPage key={route.month} month={route.month} />;
  }
});

/** smsm open twice on this phone: only the first window saves; this one shows, and says so. */
function OtherWindowNote() {
  const { otherWindow } = useSyncStatus();
  if (!otherWindow) return null;
  return (
    <p role="note" className="bg-sunk text-secondary text-ink mx-auto mt-[max(0.75rem,env(safe-area-inset-top))] mb-0 max-w-lg rounded-[12px] px-4 py-3">
      {strings.windows.otherWindow}
    </p>
  );
}

function MainApp() {
  // S9 (performance audit P2): a tap on a tab answers at once (the tab bar and the address change in that
  // frame); the screen it opens is drawn just after, as a deferred render React can interrupt, with the old
  // screen still showing meanwhile (and never a blank, even when the new screen's file is still on its way).
  const where = usePath();
  const [painted, setPainted] = useState(where);
  useEffect(() => {
    if (painted === where) return;
    // After the frame that shows the tab's answer to the tap: then the new screen, as a deferred render.
    let timer = 0;
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => { startTransition(() => { setPainted(where); }); }, 0); });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [where, painted]);
  const shownWhere = useDeferredValue(painted);
  const route = useMemo(() => parseRoute(where), [where]);
  const shown = useMemo(() => parseRoute(shownWhere), [shownWhere]);
  const [lastTab, setLastTab] = useState<MainTab>('home');
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [settle, setSettle] = useState<SettleRequest | null>(null);
  const [sheets] = useState(() => ({ openEntry: setEntry, openSettle: setSettle }));
  const tab = tabOf(route, lastTab);
  if (route.name !== 'entry' && tab !== lastTab) setLastTab(tab);
  const wide = useWide();
  const shownTab = tabOf(shown, lastTab);
  // S9b: an entry opened beside the Activity list (two panes) is not a new page; the list keeps its place.
  const paned = wide && shownTab === 'activity' && (shown.name === 'activity' || shown.name === 'entry');

  // A new page starts at its top.
  // (Of the screen shown, so the old one isn't scrolled while the new one is being drawn.)
  const path = paned ? 'activity' : shown.name === 'entry' ? `entry:${shown.id}` : shown.name === 'chapter' ? `chapter:${shown.id}`
    : shown.name === 'recap' ? `recap:${shown.month}` : shown.name === 'year' ? `year:${shown.year}`
    : shown.name === 'statement' ? `statement:${shown.month}` : shown.name;
  useEffect(() => {
    window.scrollTo(0, 0);
    // NOT-2: a notification's path may name a part of the page (#comments, #approvals).
    return scrollToAnchor();
  }, [path]);
  // S8: the app icon's badge (NOT-3, INB-2), this phone's subscription checked on open, and notification taps.
  useAppBadge();
  useRefreshPush();
  useNotificationTaps();
  // S9: the other screens and the sheets are fetched once Home is up and the phone is idle.
  useEffect(() => preloadWhenIdle(), []);

  return (
    <SheetsContext value={sheets}>
      {/* Back from Monzo, even after the app was closed: ask "Did it go through?" (SET-2, Q-U2). */}
      <MonzoQuestionProvider onUnanswered={(pending) => { setSettle({ mode: 'asking', pending }); }}>
        {/* The app's own toast system when it has none around it (the screens' tests); in the app, the shell's. */}
        <ToastProvider>
          <BottomTabs
            items={TABS}
            value={tab}
            onValueChange={(t) => {
              const target: Route = t === 'activity' ? { name: 'activity' } : t === 'bills' ? { name: 'bills' } : t === 'insights' ? { name: 'insights' } : { name: 'home' };
              if (route.name !== target.name) go(target);
            }}
          >
            <TabPanel value={tab}>
              <OtherWindowNote />
              {/* Only a screen asked for before its file arrived waits here, on plain paper (nothing that jumps). */}
              <Suspense fallback={<Blank />}>
                <Page route={shown} tab={shownTab} wide={wide} />
                {/* Home takes the first paint away itself, once its balance is drawn. */}
                {shown.name === 'home' ? null : <BootDone />}
              </Suspense>
            </TabPanel>
          </BottomTabs>
          <Suspense fallback={null}>
            <EntrySheet request={entry} onClose={() => { setEntry(null); }} />
          </Suspense>
          {/* S6b (ADD-8): the app-icon shortcuts and the share sheet open their sheet once. */}
          <FromOutside />
          <Suspense fallback={null}>
            <SettleSheet request={settle} onClose={() => { setSettle(null); }} />
          </Suspense>
        </ToastProvider>
      </MonzoQuestionProvider>
    </SheetsContext>
  );
}
