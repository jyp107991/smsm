/**
 * Demo mode (ENGINEERING §7): the same data layer and hooks, served from the seeded household in memory.
 * Writes change the in-memory copy (and are forgotten on reload). Imported only behind `__APP_DEMO__`, so
 * neither this file nor the seed reaches the production bundle (CI greps for the demo's join code).
 */
import { addDays, todayIn } from '../core/dates';
import { demoHousehold, JAE } from '../../tests/fixtures/household';
import { createMemoryApi } from './memoryApi';
import { manualNetwork } from './network';
import { createDataLayer, type DataLayer } from './queryClient';
import { fixedSession } from './session';
import { memoryPhotoStore, type AiService } from './smart';
import { memoryStorage } from './storage';

/**
 * S6a: the demo's smart features never touch the network: every photo reads as the same Tesco receipt (five lines,
 * £1.00 off, £13.99), loose words as dinner at Dishoom, and no category is guessed. Off until switched on, as in the app.
 */
function demoAi(today: string): AiService {
  const receipt = {
    merchant: 'Tesco Express', date: addDays(today, -1), currency: 'GBP', total_pence: 1399,
    items: [
      { label: 'Milk', pence: 120 }, { label: 'Sourdough', pence: 250 }, { label: 'Bananas', pence: 95 },
      { label: 'Washing-up liquid', pence: 135 }, { label: 'Red wine', pence: 899 },
    ],
    discount_pence: 100, service_pence: 0, category: 'Groceries', confidence: 'high',
  };
  const loose = { amount_pence: 4200, description: 'Dishoom', category: 'Eating out', payer: 'B', split: null, date: today, tags: [], chapter: null };
  const later = <T,>(data: T) => new Promise<{ ok: true; data: T }>((resolve) => { setTimeout(() => { resolve({ ok: true, data }); }, 600); });
  return {
    scan: () => later(receipt),
    parse: () => later(loose),
    categorise: () => Promise.resolve({ ok: true, data: { category: null } }),
  };
}

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
      comments: seed.comments,
    },
    { user, today: () => todayIn(now, 'Europe/London') },
  );
  const today = todayIn(now, 'Europe/London');
  return createDataLayer({
    api, storage: memoryStorage(), network: manualNetwork(true), session: fixedSession(JAE), today: () => today,
    ai: demoAi(today), photos: memoryPhotoStore(),
  });
}
