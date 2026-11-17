/**
 * Gallery previews of the screens the demo can't reach (its session is fixed, signed in as Jae): sign-in,
 * starting or joining a household, and choosing a name and an animal; and Home with an approval waiting or
 * offline with an entry waiting to sync, which the demo's household never is. Each is the real screen (`Root`) over its own in-memory household,
 * full page at /gallery/preview/<name>, so it can be looked at on a phone at its real width.
 * Demo build only: the gallery chunk never reaches production.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { todayIn } from '../../core/dates';
import { pence } from '../../core/money';
import { addExpense, DataProvider } from '../../data';
import type { ChangeRequestRow, MemberRow } from '../../data/api';
import { createMemoryApi } from '../../data/memoryApi';
import { manualNetwork } from '../../data/network';
import { createDataLayer, type DataLayer } from '../../data/queryClient';
import { fixedSession, type SessionKeeper } from '../../data/session';
import { memoryStorage } from '../../data/storage';
import { cx } from '../../ui/primitives/util';
import { Root } from '../AppRoot';
import { usePeople } from '../shared/people';
import { demoHousehold, JAE, SAM } from '../../../tests/fixtures/household';

export const PREVIEWS = [
  { slug: 'sign-in', title: 'Signing in', line: 'Type any email to see the code step.' },
  { slug: 'start', title: 'Starting a household', line: 'Signed in, not in a household yet.' },
  { slug: 'setup', title: 'Which one are you?', line: 'Joining Jae, who is already the dog.' },
  { slug: 'approval', title: 'An approval waiting', line: 'Home, when Sam has asked to change the usual split.' },
  { slug: 'offline', title: 'Offline', line: 'Home with no connection and one entry waiting to sync.' },
] as const;

export type PreviewSlug = (typeof PREVIEWS)[number]['slug'];

export function previewOf(path: string): PreviewSlug | null {
  const slug = /^\/gallery\/preview\/([a-z-]+)\/?$/.exec(path)?.[1];
  return PREVIEWS.find((p) => p.slug === slug)?.slug ?? null;
}

/** Someone new on this phone, signed in but not yet anyone in a household. */
const NEWCOMER = '00000000-0000-4000-8000-0000000000c9';

const signedOut: SessionKeeper = (() => {
  const out = { status: 'signed-out' } as const;
  return { ready: Promise.resolve(), state: () => out, subscribe: () => () => undefined, dispose: () => undefined };
})();

type Network = ReturnType<typeof manualNetwork>;

function layerFor(slug: PreviewSlug, network: Network): DataLayer {
  const today = todayIn(new Date(), 'Europe/London');
  const seed = demoHousehold(today);
  const at = `${today}T09:00:00.000Z`;
  const base = { storage: memoryStorage(), network, today: () => today };
  switch (slug) {
    case 'sign-in': {
      const { api } = createMemoryApi({}, { user: null });
      return createDataLayer({ ...base, api, session: signedOut });
    }
    case 'start': {
      const { api } = createMemoryApi({}, { user: { userId: NEWCOMER, email: null } });
      return createDataLayer({ ...base, api, session: fixedSession(NEWCOMER) });
    }
    case 'setup': {
      const jae = seed.members.find((m) => m.user_id === JAE);
      const me: MemberRow = { household_id: seed.household.id, user_id: NEWCOMER, display_name: null, animal: null, locked_at: null, monzo_me: null, joined_at: at };
      const { api } = createMemoryApi(
        { households: [seed.household], members: jae ? [jae, me] : [me], categories: seed.categories },
        { user: { userId: NEWCOMER, email: null } },
      );
      return createDataLayer({ ...base, api, session: fixedSession(NEWCOMER) });
    }
    case 'offline':
    case 'approval': {
      const ask: ChangeRequestRow = {
        id: '00000000-0000-4000-8000-0000000000d1', household_id: seed.household.id, requested_by: SAM, kind: 'default_ratio',
        payload: { ratio: { [JAE]: 60, [SAM]: 40 } }, status: 'pending', decided_by: null, created_at: at, decided_at: null,
      };
      const { api } = createMemoryApi(
        {
          households: [seed.household], members: seed.members, categories: seed.categories, expenses: seed.expenses,
          settlements: seed.settlements, changeRequests: slug === 'approval' ? [ask] : [],
        },
        { user: { userId: JAE, email: null } },
      );
      return createDataLayer({ ...base, api, session: fixedSession(JAE) });
    }
  }
}

/** Once the household is on the phone: the connection goes, then Jae adds a pint of milk. */
function GoOffline({ network }: { network: Network }) {
  const people = usePeople();
  const done = useRef(false);
  const me = people.me?.id;
  const partner = people.partner?.id;
  useEffect(() => {
    if (done.current || !me || !partner) return;
    done.current = true;
    network.set(false);
    addExpense({
      description: 'Milk', amount: pence(145), date: todayIn(new Date(), 'Europe/London'), categoryId: null, payer: me,
      split: { mode: 'ratio', ratio: { [me]: 50, [partner]: 50 } },
    });
  }, [network, me, partner]);
  return null;
}

/** One preview, full page: the real screens over their own household. */
export function PreviewPage({ slug }: { slug: PreviewSlug }) {
  const [network] = useState(() => manualNetwork(true));
  const [layer] = useState(() => layerFor(slug, network));
  return (
    <DataProvider layer={layer}>
      <Root />
      {slug === 'offline' ? <GoOffline network={network} /> : null}
    </DataProvider>
  );
}

/** The links in "On the page": each opens its preview at the phone's own width. */
export function PreviewLinks() {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {PREVIEWS.map((p) => (
        <li key={p.slug} className="border-line border-b last:border-b-0">
          <a
            href={`/gallery/preview/${p.slug}`}
            className={cx('text-ink press -mx-2 flex min-h-14 items-center gap-3 rounded-[12px] px-2 py-2 no-underline')}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body">{p.title}</span>
              <span className="text-secondary text-ink-2">{p.line}</span>
            </span>
            <ArrowUpRight size={20} strokeWidth={1.75} aria-hidden="true" className="text-forest shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}
