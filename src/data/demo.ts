/**
 * Demo mode (ENGINEERING §7): the same data layer and hooks, served from the seeded household in memory.
 * Writes change the in-memory copy (and are forgotten on reload). Imported only behind `__APP_DEMO__`, so
 * neither this file nor the seed reaches the production bundle (CI greps for the demo's join code).
 */
import { todayIn } from '../core/dates';
import { demoHousehold, JAE } from '../../tests/fixtures/household';
import { createMemoryApi } from './memoryApi';
import { manualNetwork } from './network';
import { createDataLayer, type DataLayer } from './queryClient';
import { fixedSession } from './session';
import { memoryStorage } from './storage';

export function createDemoLayer(now: Date = new Date()): DataLayer {
  const seed = demoHousehold(todayIn(now, 'Europe/London'));
  const user = { userId: JAE, email: 'jae@example.com' };
  const { api } = createMemoryApi(
    {
      households: [seed.household],
      members: seed.members,
      categories: seed.categories,
      expenses: seed.expenses,
      settlements: seed.settlements,
      recurring: seed.recurring,
      inboxItems: seed.inboxItems,
      chapters: seed.chapters,
    },
    { user, today: () => todayIn(now, 'Europe/London') },
  );
  const today = todayIn(now, 'Europe/London');
  return createDataLayer({ api, storage: memoryStorage(), network: manualNetwork(true), session: fixedSession(JAE), today: () => today });
}
