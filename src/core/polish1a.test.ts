/**
 * S2 polish wave 1a (docs/slices/S2-polish.md), quick add's grammar: Q-F3 and Q-U3 (ADD-1, TXT-4).
 * Written before the fix (ENGINEERING §5: tests first, by someone else).
 *
 * No new interface: `parseQuickAdd(text, ctx)` as it is.
 *
 * Note for the builder: src/core/review.test.ts keeps "12 cat food", "18 dog food" and "30 dog walker" as
 * descriptions (payer me, unsure). Q-U3 asks for `cat`/`dog` to read as the payer in any position, so
 * "20 cat pizza" must name the cat while those pet-product phrases still stay words: both sets hold.
 */
import { describe, expect, it } from 'vitest';
import { parseQuickAdd, type QuickAddContext } from './quickadd';

const cats = ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other']
  .map((n) => ({ id: `c-${n}`, name: n }));
// Jae (typing) is the dog, Sam is the cat: as in tests/vectors/quickadd.json.
const ctx: QuickAddContext = {
  today: '2026-11-17', me: 'J', partner: 'S', names: { J: 'Jae', S: 'Sam' }, animals: { J: 'dog', S: 'cat' }, categories: cats,
};

describe('Q-F3 ADD-1: "for <person>" after another split word is not read as the payer', () => {
  it.each([
    ['30 dinner 70/30 for sam'],
    ['25 dinner treat for sam'],
    ['25 dinner 60/40 for Sam'],
    ['25 treat for sam dinner'],
  ])('Q-F3 %j: Sam is not the payer, and the reading is not confident (Enter opens the form)', (text) => {
    const r = parseQuickAdd(text, ctx);
    expect(r).not.toBeNull();
    expect(r?.amount).toBeGreaterThan(0);
    // The person typing paid: "for sam" never turns Sam into the payer.
    expect(r?.payer).toBe('J');
    expect(r?.confident).toBe(false);
  });

  it('Q-F3 ADD-1: "for sam" on its own still means paid for Sam (unchanged)', () => {
    expect(parseQuickAdd('30 haircut for sam', ctx)).toMatchObject({ payer: 'J', split: { mode: 'for_other' }, description: 'haircut' });
  });
});

describe('Q-U3 ADD-1: cat and dog name the payer in any position', () => {
  it.each([
    ['20 cat pizza', 'S', 'pizza'],
    ['42.50 cat tesco', 'S', 'tesco'],
    ['42.50 tesco cat big shop', 'S', 'tesco big shop'],
    ['20 dog pizza', 'J', 'pizza'],
  ])('Q-U3 ADD-1 %j: payer %s, description %j', (text, payer, description) => {
    const r = parseQuickAdd(text, ctx);
    expect(r?.payer).toBe(payer);
    expect(r?.description).toBe(description);
  });

  it('Q-U3 ADD-1: from the cat\'s own phone, "dog" names the partner', () => {
    const sams = { ...ctx, me: 'S', partner: 'J' };
    expect(parseQuickAdd('20 dog pizza', sams)).toMatchObject({ payer: 'J', description: 'pizza' });
  });
});

describe('Q-U3 ADD-1 TXT-4: a comma decimal with exactly two digits', () => {
  it('Q-U3 "42,50 tesco" reads as £42.50', () => {
    expect(parseQuickAdd('42,50 tesco', ctx)).toMatchObject({ amount: 4250, description: 'tesco' });
    expect(parseQuickAdd('tesco 42,50', ctx)).toMatchObject({ amount: 4250, description: 'tesco' });
    expect(parseQuickAdd('3,05 coffee', ctx)?.amount).toBe(305);
  });

  it('Q-U3 "1,200" stays twelve hundred pounds; a group of three is thousands', () => {
    expect(parseQuickAdd('1,200 sofa', ctx)?.amount).toBe(120000);
    expect(parseQuickAdd('12,345 car', ctx)?.amount).toBe(1234500);
  });

  it('Q-U3 full-width "４２，５０" reads the same as "42,50"', () => {
    expect(parseQuickAdd('４２，５０ 이마트', ctx)).toMatchObject({ amount: 4250, description: '이마트' });
  });
});
