/**
 * Hearing the partner's changes (DATA_MODEL §6). One Supabase Realtime channel per household; a change to a
 * table refetches that table, so the partner's entry appears within seconds. When the channel comes back
 * after a drop (the phone slept, the connection changed), everything is refetched once, since changes made
 * meanwhile were not heard. Refetch on open, on reconnect and on return to the foreground is done by the
 * layer itself (queryClient.ts).
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Api, WatchedTable } from './api';
import { keys } from './keys';

export interface Realtime {
  /** Listen to this household (or to nothing). Calling again with the same id changes nothing. */
  follow(householdId: string | null): void;
  stop(): void;
}

function keysFor(uid: string, table: WatchedTable): (readonly unknown[])[] {
  switch (table) {
    case 'households': return [keys.household(uid)];
    case 'members': return [keys.members(uid), keys.membership(uid)];
    case 'categories': return [keys.categories(uid)];
    case 'expenses': return [keys.expenses(uid), keys.activityAll(uid)];
    case 'settlements': return [keys.settlements(uid), keys.activityAll(uid)];
    case 'change_requests': return [keys.changes(uid), keys.members(uid), keys.household(uid)];
  }
}

export function createRealtime(deps: { api: Api; client: QueryClient; userId: () => string | null; onChange?: (table: WatchedTable) => void }): Realtime {
  let current: string | null = null;
  let unsubscribe: (() => void) | null = null;

  // Refetch whether or not a screen is showing the data: the store's own reads use the cache too.
  const refetch = (queryKey: readonly unknown[]) => deps.client.invalidateQueries({ queryKey, refetchType: 'all' });

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
    current = null;
  };

  return {
    follow(householdId) {
      if (householdId === current) return;
      stop();
      if (!householdId) return;
      current = householdId;
      let subscribedBefore = false;
      unsubscribe = deps.api.watchHousehold(
        householdId,
        (table) => {
          const uid = deps.userId();
          if (!uid) return;
          void Promise.all(keysFor(uid, table).map(refetch)).then(() => deps.onChange?.(table));
        },
        (status) => {
          if (status !== 'subscribed') return;
          const uid = deps.userId();
          // The first subscription follows a fresh load; a later one means changes may have been missed.
          if (subscribedBefore && uid) void refetch(keys.all(uid));
          subscribedBefore = true;
        },
      );
    },
    stop,
  };
}
