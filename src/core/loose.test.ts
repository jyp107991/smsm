/**
 * Loose wording read by the AI (ADD-9; docs/AI.md §3.2), checked by code before it fills the form. From the live eval
 * of 24 Nov (run 45367987613): the AI missed the trailing "35" in "birthday present for B's sister 35", read "189" as
 * 189 pence, and called "B paid for the hotel" a treat. Now:
 * - wordsAmount: the amount the words themselves give, read by the quick-add amount grammar (core/money parseAmount),
 *   when exactly one word is an amount; that amount wins over the AI's.
 * - looseSplit: a split other than the household's default is kept only when the words say so ("treat", "on me",
 *   "for B", "B's", "60/40"); "B paid" or "B got" only names the payer.
 * - readLoose: both, on a reply; says when the words and the AI disagreed on the amount.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParseReply } from './aiReplies';
import { looseSplit, readLoose, wordsAmount } from './loose';

const reply = (over: Partial<ParseReply> = {}): ParseReply => ({
  amount_pence: null, description: null, category: null, payer: null, split: null, date: null, tags: null, chapter: null, ...over,
});

describe('wordsAmount: the one amount in the words (ADD-9)', () => {
  it('ADD-9: a single amount anywhere in the words, as quick add reads amounts', () => {
    expect(wordsAmount("birthday present for B's sister 35")).toBe(3500);
    expect(wordsAmount('B paid for the hotel in bath, 189')).toBe(18900);
    expect(wordsAmount('vet for the cat, 72 pounds, B paid')).toBe(7200);
    expect(wordsAmount('B got wine and cheese for friday, 22.40')).toBe(2240);
    expect(wordsAmount('I paid the electricity, £64')).toBe(6400);
    expect(wordsAmount('rent for november 1450')).toBe(145000);
    expect(wordsAmount('cinema and popcorn for us both — 31 pounds')).toBe(3100);
    expect(wordsAmount('netflix again, 10.99.')).toBe(1099);
    expect(wordsAmount('lunch (12.50)')).toBe(1250);
    expect(wordsAmount('big shop 1,200')).toBe(120000);
    expect(wordsAmount('pizza 12+8.50')).toBe(2050);
    expect(wordsAmount('ramen １２.５０')).toBe(1250);
  });

  it('ADD-9: no amount, or more than one, is no reading: the AI’s amount is used ("twenty five quid", "2 x 38")', () => {
    expect(wordsAmount('haircut for B, twenty five quid')).toBeNull();
    expect(wordsAmount('coffees this morning three pound eighty')).toBeNull();
    expect(wordsAmount('tickets for the gig, 2 x 38')).toBeNull();
    expect(wordsAmount('4 pints 18.50')).toBeNull();
    expect(wordsAmount('lunch on 12/11')).toBeNull();
    expect(wordsAmount('')).toBeNull();
  });

  it('ADD-9: never throws, and anything it gives is whole pence within the app’s maximum', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const p = wordsAmount(s);
      expect(p === null || (Number.isSafeInteger(p) && p > 0 && p <= 100_000_000)).toBe(true);
    }));
  });
});

describe('looseSplit: the words decide the split (ADD-9, SPL-1)', () => {
  it('ADD-9 SPL-1: "B paid" or "B got" names the payer only: a treat the words don’t mention becomes the household default (null)', () => {
    const treat = { mode: 'treat' as const, ratio: null };
    expect(looseSplit(treat, 'B paid for the hotel in bath, 189')).toBeNull();
    expect(looseSplit(treat, 'vet for the cat, 72 pounds, B paid')).toBeNull();
    expect(looseSplit(treat, 'B got wine and cheese for friday, 22.40')).toBeNull();
    expect(looseSplit({ mode: 'for_other', ratio: null }, 'B got the big tesco shop, 86.40')).toBeNull();
  });

  it('ADD-9 SPL-1: a treat stays when the words say so', () => {
    for (const words of ['dinner, my treat, 40', 'B treated us to dinner 40', 'drinks on me 30', 'drinks on B 30', 'my shout at the pub 26', 'B’s treat 20']) {
      expect(looseSplit({ mode: 'treat', ratio: null }, words), words).toEqual({ mode: 'treat', ratio: null });
    }
  });

  it('ADD-9 SPL-1: paid for the other person stays when the words name them ("for B", "B\'s", "for me", "for them")', () => {
    for (const words of ['haircut for B, twenty five quid', "birthday present for B's sister 35", 'B’s train ticket 20', 'B paid for me, cinema 12', 'A bought shoes for them 50']) {
      expect(looseSplit({ mode: 'for_other', ratio: null }, words), words).toEqual({ mode: 'for_other', ratio: null });
    }
    // "for a drink", "for the cat": "a" is a word, not the person A; "for the" names nobody.
    expect(looseSplit({ mode: 'for_other', ratio: null }, 'out for a drink 12')).toBeNull();
    expect(looseSplit({ mode: 'for_other', ratio: null }, 'food for the cat 12')).toBeNull();
  });

  it('ADD-9 SPL-1: a stated percentage stays ("60/40", "70%", "half each"); an unstated one is the default', () => {
    expect(looseSplit({ mode: 'ratio', ratio: 60 }, 'groceries 60/40 80')).toEqual({ mode: 'ratio', ratio: 60 });
    expect(looseSplit({ mode: 'ratio', ratio: 70 }, 'A pays 70% of the boiler fix, 300')).toEqual({ mode: 'ratio', ratio: 70 });
    expect(looseSplit({ mode: 'ratio', ratio: 50 }, 'taxi, half each, 30')).toEqual({ mode: 'ratio', ratio: 50 });
    expect(looseSplit({ mode: 'ratio', ratio: 0 }, 'B got the big tesco shop, 86.40')).toBeNull();
    expect(looseSplit({ mode: 'ratio', ratio: null }, 'tesco 86.40')).toBeNull();
    expect(looseSplit(null, 'anything')).toBeNull();
  });
});

describe('readLoose: a reply as the form gets it (ADD-9; AI.md §3.2)', () => {
  it('ADD-9: the words’ amount wins and a disagreement is said; the AI’s is used only when the words give none', () => {
    expect(readLoose(reply({ amount_pence: 189 }), 'B paid for the hotel in bath, 189')).toMatchObject({ reply: { amount_pence: 18900 }, amountDisagreed: true });
    expect(readLoose(reply({ amount_pence: null }), "birthday present for B's sister 35")).toMatchObject({ reply: { amount_pence: 3500 }, amountDisagreed: true });
    expect(readLoose(reply({ amount_pence: 7200 }), 'vet for the cat, 72 pounds, B paid')).toMatchObject({ reply: { amount_pence: 7200 }, amountDisagreed: false });
    expect(readLoose(reply({ amount_pence: 2500 }), 'haircut for B, twenty five quid')).toMatchObject({ reply: { amount_pence: 2500 }, amountDisagreed: false });
    expect(readLoose(reply({ amount_pence: 7600 }), 'tickets for the gig, 2 x 38')).toMatchObject({ reply: { amount_pence: 7600 }, amountDisagreed: false });
  });

  it('ADD-9: everything else in the reply is kept as read; the split goes through looseSplit', () => {
    const r = readLoose(reply({ amount_pence: 189, description: 'hotel in bath', category: 'Travel', payer: 'B', split: { mode: 'treat', ratio: null }, date: '2026-11-18' }), 'B paid for the hotel in bath, 189');
    expect(r.reply).toEqual({ amount_pence: 18900, description: 'hotel in bath', category: 'Travel', payer: 'B', split: null, date: '2026-11-18', tags: null, chapter: null });
  });
});
