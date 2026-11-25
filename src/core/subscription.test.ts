/**
 * Owner, 25 Nov ("why do you still have a subscriptions category and a subscriptions switch"; DECISIONS 25 Nov "The
 * category alone decides what a subscription is"). REC-7: a regular payment is a subscription exactly when its
 * category is the household's Subscriptions category, found by its starting key (never its name). No switch.
 */
import { describe, expect, it } from 'vitest';
import * as subscription from './subscription';
import { isSubscription } from './subscription';

const SUBS = 'cat-subs';
const RENT = 'cat-rent';
type Cat = { id: string; name: string; seed_key: string | null; archived: boolean };
const cats: Cat[] = [
  { id: RENT, name: 'Rent & bills', seed_key: 'rent_bills', archived: false },
  { id: SUBS, name: 'Streaming', seed_key: 'subscriptions', archived: false },
  { id: 'cat-own', name: 'Subscriptions', seed_key: null, archived: false },
];

describe('the category alone decides (REC-7)', () => {
  it('REC-7: in the household’s Subscriptions category (renamed or not), it is a subscription', () => {
    expect(isSubscription({ category_id: SUBS }, cats)).toBe(true);
  });
  it('REC-7: in any other category, or none, it is not', () => {
    expect(isSubscription({ category_id: RENT }, cats)).toBe(false);
    expect(isSubscription({ category_id: null }, cats)).toBe(false);
    expect(isSubscription({ category_id: 'cat-gone' }, cats)).toBe(false);
  });
  it('REC-7: a category a person added and named "Subscriptions" is not the Subscriptions category', () => {
    expect(isSubscription({ category_id: 'cat-own' }, cats)).toBe(false);
  });
  it('REC-7: archived, the Subscriptions category still is it (what is in it stays a subscription, as in the database)', () => {
    expect(isSubscription({ category_id: SUBS }, [{ id: SUBS, seed_key: 'subscriptions' }])).toBe(true);
    expect(isSubscription({ category_id: SUBS }, cats.map((c) => ({ ...c, archived: true })))).toBe(true);
  });
  it('REC-7: nothing about a switch is left: the module is the one pure rule', () => {
    expect(Object.keys(subscription).sort()).toEqual(['SUBSCRIPTIONS_KEY', 'isSubscription']);
  });
});
