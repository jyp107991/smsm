/**
 * A small household for screen and data tests: Jae (the cat, joined first) and Sam (the dog), the twelve
 * starting categories, no entries yet, served by the in-memory Api. Signed in as whoever `as` names.
 */
import { createMemoryApi, type MemoryControls } from '../../src/data/memoryApi';
import { manualNetwork } from '../../src/data/network';
import { createDataLayer, type DataLayer } from '../../src/data/queryClient';
import { fixedSession } from '../../src/data/session';
import { memoryStorage } from '../../src/data/storage';
import type { CategoryRow, HouseholdRow, MemberRow } from '../../src/data/api';

export const HID = '00000000-0000-4000-8000-0000000000c1';
export const JAE_ID = '00000000-0000-4000-8000-0000000000a1';
export const SAM_ID = '00000000-0000-4000-8000-0000000000b1';
export const TODAY = '2026-11-14';

const CATEGORIES: readonly [string, string, string][] = [
  ['Groceries', '🛒', 'moss'], ['Eating out', '🍜', 'amber'], ['Rent & bills', '🏠', 'walnut'], ['Utilities', '💡', 'honey'],
  ['Transport', '🚆', 'slate'], ['Subscriptions', '📺', 'plum'], ['Household', '🧺', 'oak'], ['Going out', '🍸', 'berry'],
  ['Travel', '✈️', 'lake'], ['Gifts', '🎁', 'clay'], ['Health', '💊', 'fern'], ['Other', '•', 'stone'],
];

export function categoryId(name: string): string {
  const i = CATEGORIES.findIndex(([n]) => n === name);
  return `00000000-0000-4000-8000-${(0x900 + i).toString(16).padStart(12, '0')}`;
}

export interface Couple {
  layer: DataLayer;
  controls: MemoryControls;
  network: ReturnType<typeof manualNetwork>;
}

export function couple(opts: { as?: 'jae' | 'sam'; partnerJoined?: boolean } = {}): Couple {
  const stamp = '2026-11-01T12:00:00.000Z';
  const household: HouseholdRow = {
    id: HID, join_code: 'AB12CD', home_country: 'GB', default_ratio: null, joint_enabled: false, joint_ratio: null, created_at: stamp,
  };
  const members: MemberRow[] = [
    { household_id: HID, user_id: JAE_ID, display_name: 'Jae', animal: 'cat', locked_at: stamp, monzo_me: 'jaetest', joined_at: stamp },
  ];
  if (opts.partnerJoined !== false) {
    members.push({ household_id: HID, user_id: SAM_ID, display_name: 'Sam', animal: 'dog', locked_at: stamp, monzo_me: null, joined_at: '2026-11-02T12:00:00.000Z' });
  }
  const categories: CategoryRow[] = CATEGORIES.map(([name, emoji, colour], i) => ({
    id: categoryId(name), household_id: HID, name, emoji, colour, default_ratio: null, archived: false, sort: i + 1, updated_at: stamp,
  }));
  const me = opts.as === 'sam' ? SAM_ID : JAE_ID;
  const { api, controls } = createMemoryApi({ households: [household], members, categories }, { user: { userId: me, email: null } });
  const network = manualNetwork(true);
  const layer = createDataLayer({ api, storage: memoryStorage(), network, session: fixedSession(me), today: () => TODAY });
  return { layer, controls, network };
}
