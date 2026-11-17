/**
 * The signed-in app and the steps before it. Signed out, every route shows sign-in (S2 brief, "Routes");
 * signed in but not in a household, start or join; then name and animal; then the app: Home and Activity
 * and Bills as tabs (Insights waits for S5), the entry page and Settings, and the two sheets.
 */
import { useEffect, useState } from 'react';
import { useHousehold, useSession, useSyncStatus } from '../data';
import { FEATURES } from '../ui/features';
import { BottomTabs, Button, MAIN_TABS, TabPanel, ToastProvider, type MainTab } from '../ui/primitives';
import { go, useRoute, type Route } from '../ui/router';
import { strings } from '../ui/strings';
import { Activity } from './activity/Activity';
import { Bills } from './bills/Bills';
import { Inbox } from './bills/Inbox';
import { Categories } from './settings/Categories';
import { EntryPage } from './entry/EntryPage';
import { EntrySheet } from './entry/EntrySheet';
import { Home } from './home/Home';
import { savePending } from './settle/monzo';
import { MonzoQuestionProvider } from './settle/question';
import { SettleSheet } from './settle/SettleSheet';
import { Settings } from './settings/Settings';
import { usePeople } from './shared/people';
import { SheetsContext, type EntryRequest, type SettleRequest } from './sheets';
import { SignIn } from './signin/SignIn';
import { StartOrJoin, WhoAreYou } from './setup/Setup';
import { useDataLayer } from '../data';

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
  if (session.status === 'signed-out') return <SignIn />;
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
          <p role="alert" className="text-note m-0">{strings.errors.cantLoad}</p>
          <div>
            <Button variant="plain" onClick={() => void layer.refresh()}>{strings.errors.tryAgain}</Button>
          </div>
        </main>
      );
    }
    return <Blank />;
  }
  if (household.data === null) return <StartOrJoin />;
  if (!people.ready) return <Blank />;
  if (!people.myRow?.locked_at) return <WhoAreYou />;
  return <MainApp />;
}

const TABS = MAIN_TABS.filter((t) => t.value === 'home' || t.value === 'activity' || (t.value === 'bills' ? FEATURES.bills : FEATURES.insights));

function tabOf(route: Route, last: MainTab): MainTab {
  if (route.name === 'activity') return 'activity';
  if (route.name === 'bills') return 'bills';
  if (route.name === 'entry') return last;
  return 'home';
}

function Page({ route }: { route: Route }) {
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
    case 'inbox':
      return <Inbox />;
    case 'categories':
      return <Categories />;
  }
}

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
  const route = useRoute();
  const [lastTab, setLastTab] = useState<MainTab>('home');
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [settle, setSettle] = useState<SettleRequest | null>(null);
  const [sheets] = useState(() => ({ openEntry: setEntry, openSettle: setSettle }));
  const tab = tabOf(route, lastTab);
  if (route.name !== 'entry' && tab !== lastTab) setLastTab(tab);

  // A new page starts at its top.
  const path = route.name === 'entry' ? `entry:${route.id}` : route.name;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

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
              const target: Route = t === 'activity' ? { name: 'activity' } : t === 'bills' ? { name: 'bills' } : { name: 'home' };
              if (route.name !== target.name) go(target);
            }}
          >
            <TabPanel value={tab}>
              <OtherWindowNote />
              <Page route={route} />
            </TabPanel>
          </BottomTabs>
          <EntrySheet request={entry} onClose={() => { setEntry(null); }} />
          <SettleSheet request={settle} onClose={() => { setSettle(null); }} />
        </ToastProvider>
      </MonzoQuestionProvider>
    </SheetsContext>
  );
}
