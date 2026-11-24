/**
 * Owner's report, 24 Nov ("subscriptions category duplicates subscription switch when adding bills"; DECISIONS "One
 * meaning for subscription"). REC-7: "Show in Subscriptions" follows the household's Subscriptions category, found by
 * its starting key (never its name), until the person sets the switch themselves.
 */
import { describe, expect, it } from 'vitest';
import { subscriptionSwitch, subscriptionsCategoryId, switchByPerson, switchForCategory } from './subscription';

const SUBS = 'cat-subs';
const RENT = 'cat-rent';
type Cat = { id: string; name: string; seed_key: string | null; archived: boolean };
const cats: Cat[] = [
  { id: RENT, name: 'Rent & bills', seed_key: 'rent_bills', archived: false },
  { id: SUBS, name: 'Streaming', seed_key: 'subscriptions', archived: false },
  { id: 'cat-own', name: 'Subscriptions', seed_key: null, archived: false },
];

describe('the Subscriptions category (REC-7)', () => {
  it('REC-7: found by its starting key, so a renamed one still is it and a person’s own "Subscriptions" is not', () => {
    expect(subscriptionsCategoryId(cats)).toBe(SUBS);
  });
  it('REC-7: none when the household has no keyed one (or it is archived: it can’t be picked)', () => {
    const own: Cat[] = [{ id: 'x', name: 'Subscriptions', seed_key: null, archived: false }];
    const archived: Cat[] = [{ id: SUBS, name: 'Subscriptions', seed_key: 'subscriptions', archived: true }];
    expect(subscriptionsCategoryId(own)).toBeNull();
    expect(subscriptionsCategoryId(archived)).toBeNull();
    expect(subscriptionsCategoryId([])).toBeNull();
  });
});

describe('"Show in Subscriptions" follows the category until the person sets it (REC-7)', () => {
  it('REC-7: a new regular payment starts on (automatically) in Subscriptions, off elsewhere', () => {
    expect(subscriptionSwitch(SUBS, SUBS)).toEqual({ on: true, auto: true });
    expect(subscriptionSwitch(RENT, SUBS)).toEqual({ on: false, auto: false });
    expect(subscriptionSwitch(null, SUBS)).toEqual({ on: false, auto: false });
    expect(subscriptionSwitch(SUBS, null)).toEqual({ on: false, auto: false });
  });
  it('REC-7: picking Subscriptions turns it on; picking another category then turns that automatic on off again', () => {
    const on = switchForCategory({ on: false, auto: false }, SUBS, SUBS);
    expect(on).toEqual({ on: true, auto: true });
    expect(switchForCategory(on, RENT, SUBS)).toEqual({ on: false, auto: false });
  });
  it('REC-7: turned on by the person, another category leaves it on', () => {
    const mine = switchByPerson(true);
    expect(mine).toEqual({ on: true, auto: false });
    expect(switchForCategory(mine, RENT, SUBS)).toEqual({ on: true, auto: false });
    expect(switchForCategory(switchForCategory(mine, SUBS, SUBS), RENT, SUBS)).toEqual({ on: true, auto: false });
  });
  it('REC-7: the person can switch it off in Subscriptions; it stays off until Subscriptions is picked again', () => {
    const off = switchByPerson(false);
    expect(off).toEqual({ on: false, auto: false });
    expect(switchForCategory(off, RENT, SUBS)).toEqual({ on: false, auto: false });
    expect(switchForCategory(switchForCategory(off, RENT, SUBS), SUBS, SUBS)).toEqual({ on: true, auto: true });
  });
  it('REC-7: with no Subscriptions category, a category change never moves it', () => {
    expect(switchForCategory({ on: true, auto: false }, RENT, null)).toEqual({ on: true, auto: false });
    expect(switchForCategory({ on: false, auto: false }, SUBS, null)).toEqual({ on: false, auto: false });
  });
});
