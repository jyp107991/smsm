/**
 * REC-7 (owner's report, 24 Nov; DECISIONS "One meaning for subscription"): a regular payment shows under
 * Subscriptions on Bills when its "Show in Subscriptions" switch is on. Picking the household's Subscriptions category
 * turns the switch on; picking another category afterwards turns it off again only if it was that automatic "on". Once
 * the person sets the switch themselves, a category change leaves it alone.
 *
 * The Subscriptions category is the household's starting one, known by its key (categories.seed_key, set by the
 * server), never by its name: renamed, it still is; a category a person adds and names "Subscriptions" is not.
 */

export const SUBSCRIPTIONS_KEY = 'subscriptions';

/** The household's Subscriptions category that can be picked (not archived), or null. */
export function subscriptionsCategoryId(categories: readonly { id: string; seed_key: string | null; archived: boolean }[]): string | null {
  return categories.find((c) => c.seed_key === SUBSCRIPTIONS_KEY && !c.archived)?.id ?? null;
}

/** The switch, and whether its "on" came from picking the category (and so goes with it). */
export interface SubscriptionSwitch { on: boolean; auto: boolean }

/** A new regular payment's switch: on (automatically) when it starts in the Subscriptions category. */
export function subscriptionSwitch(categoryId: string | null, subscriptionsId: string | null): SubscriptionSwitch {
  const on = subscriptionsId !== null && categoryId === subscriptionsId;
  return { on, auto: on };
}

/** The category changed to `categoryId`. */
export function switchForCategory(current: SubscriptionSwitch, categoryId: string | null, subscriptionsId: string | null): SubscriptionSwitch {
  if (subscriptionsId === null) return current;
  if (categoryId === subscriptionsId) return current.on ? current : { on: true, auto: true };
  return current.auto ? { on: false, auto: false } : current;
}

/** The person set the switch: theirs from now on. */
export function switchByPerson(on: boolean): SubscriptionSwitch {
  return { on, auto: false };
}
