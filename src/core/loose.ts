/**
 * Loose wording read by the AI (ADD-9; docs/AI.md §3.2), checked by code before it fills the form (non-negotiable 3:
 * code computes, people decide). Pure. The words are the ones sent to the AI, with the two people as "A" and "B".
 * - The amount: when exactly one word of the note is an amount, as quick add reads amounts (money parseAmount), that
 *   amount is used and the AI's is not; the AI's is used only when the words give none ("twenty five quid") or several
 *   ("2 x 38").
 * - The split: one other than the household's default is kept only when the words say so. "B paid" or "B got" names
 *   the payer and nothing else (live eval, 24 Nov: three "B paid …" notes came back as treats).
 */
import type { ParseReply } from './aiReplies';
import { parseAmount, type Pence } from './money';

/** A word of the note with the punctuation round it taken off ("bath," "(12.50)" "10.99."). */
const bare = (word: string) => word.replace(/^[("'‘“[]+/u, '').replace(/[)"'’”\],.;:!?]+$/u, '');

/** ADD-9: the one amount the words give, in pence, or null for none or more than one. */
export function wordsAmount(words: string): Pence | null {
  const found = words.normalize('NFKC').split(/\s+/u).map((w) => parseAmount(bare(w))).filter((p): p is Pence => p !== null);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** Words that make it one person's treat: "treat", "my shout", "my round", "on me", "on A", "on B". */
const TREAT = /\b(?:treat(?:s|ed|ing)?|shout|my round)\b|\bon me\b/iu;
const TREAT_PERSON = /\bon [AB]\b/u;
/** Words that make it for the other person: "for B", "B's", "for me", "for them", "for him", "for her". */
const FOR_OTHER = /\bfor (?:me|them|him|her)\b/iu;
const FOR_PERSON = /\bfor [AB]\b|\b[AB]['’]s\b/u;
/** Words that state a share: "60/40", "70%", "half", "halves", "evenly", "equally", "50-50". */
const RATIO = /\b\d{1,3}\s*\/\s*\d{1,3}\b|\b\d{1,3}\s*%|\b(?:half|halves|evenly|equally|fifty[\s-]fifty)\b/iu;

/**
 * ADD-9, SPL-1: the AI's split if the words say so, else null (the household's default). A share with no percentage
 * is the default too.
 */
export function looseSplit(split: ParseReply['split'], words: string): ParseReply['split'] {
  if (split === null) return null;
  const w = words.normalize('NFKC');
  switch (split.mode) {
    case 'treat': return TREAT.test(w) || TREAT_PERSON.test(w) ? split : null;
    case 'for_other': return FOR_OTHER.test(w) || FOR_PERSON.test(w) ? split : null;
    case 'ratio': return split.ratio != null && RATIO.test(w) ? split : null;
  }
}

/**
 * ADD-9: the reply as the form gets it: the amount from the words when they give one (and whether the AI said
 * otherwise, for the caller to report), the split as the words allow; everything else as read.
 */
export function readLoose(reply: ParseReply, words: string): { reply: ParseReply; amountDisagreed: boolean } {
  const fromWords = wordsAmount(words);
  const amount = fromWords ?? reply.amount_pence;
  return {
    reply: { ...reply, amount_pence: amount, split: looseSplit(reply.split, words) },
    amountDisagreed: fromWords !== null && reply.amount_pence !== fromWords,
  };
}
