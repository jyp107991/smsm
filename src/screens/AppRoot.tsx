/**
 * The signed-in app and the steps before it. Signed out, every route shows sign-in (S2 brief, "Routes");
 * signed in but not in a household, start or join; then name and animal; then the app: Home and Activity
 * as tabs (Bills and Insights wait for S3 and S5), the entry page and Settings, and the two sheets.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useHousehold, useSession } from '../data';
import { FEATURES } from '../ui/features';
import { BottomTabs, Button, MAIN_TABS, TabPanel, ToastProvider, type MainTab } from '../ui/primitives';
import { go, useRoute, type Route } from '../ui/router';
import { strings } from '../ui/strings';
import { Activity } from './activity/Activity';
import { EntryPage } from './entry/EntryPage';
import { EntrySheet } from './entry/EntrySheet';
import { Home } from './home/Home';
import { loadPending } from './settle/monzo';
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
  }
}

function MainApp() {
  const route = useRoute();
  const [lastTab, setLastTab] = useState<MainTab>('home');
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  // Back from Monzo after the page reloaded: ask "Did it go through?" (SET-2).
  const [settle, setSettle] = useState<SettleRequest | null>(() => {
    const pending = loadPending();
    return pending ? { mode: 'asking', pending } : null;
  });
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
      <div style={{ '--toast-lift': '5.25rem' } as CSSProperties}>
        <ToastProvider>
          <BottomTabs
            items={TABS}
            value={tab}
            onValueChange={(t) => {
              const target: Route = t === 'activity' ? { name: 'activity' } : { name: 'home' };
              if (route.name !== target.name) go(target);
            }}
          >
            <TabPanel value={tab}>
              <Page route={route} />
            </TabPanel>
          </BottomTabs>
          <EntrySheet request={entry} onClose={() => { setEntry(null); }} />
          <SettleSheet request={settle} onClose={() => { setSettle(null); }} />
        </ToastProvider>
      </div>
    </SheetsContext>
  );
}
