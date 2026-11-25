/**
 * REC-7 (owner, 25 Nov: "why do you still have a subscriptions category and a subscriptions switch"; DECISIONS 25 Nov
 * "The category alone decides what a subscription is"). One concept: a regular payment is a subscription exactly when
 * its category is the household's Subscriptions category. Shared or one person's own alike. There is no switch.
 *
 * The Subscriptions category is the household's starting one, known by its key (categories.seed_key, set by the
 * server), never by its name: renamed, it still is; a category a person adds and names "Subscriptions" is not. The
 * database keeps recurring.is_subscription to the same rule (trigger recurring_category_subscription); the app reads
 * the category, never that column.
 */

export const SUBSCRIPTIONS_KEY = 'subscriptions';

/** A category as this rule reads it. */
export interface KeyedCategory { id: string; seed_key: string | null }

/** Whether a regular payment (or an entry made from one) is a subscription: its category is the Subscriptions one. */
export function isSubscription(template: { category_id: string | null }, categories: readonly KeyedCategory[]): boolean {
  if (template.category_id === null) return false;
  return categories.some((c) => c.id === template.category_id && c.seed_key === SUBSCRIPTIONS_KEY);
}
