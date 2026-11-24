/**
 * Which cases a live-eval run sends (docs/AI.md §5), and when it stops. On 24 Nov three full runs used up the account's
 * 10,000 free Neurons for the day, which the app and MacroPy share, so a run by default sends a stratified sample
 * (SAMPLE below: a few of each kind, the same ones every time); the full set only when asked for ("full" in the eval-ai
 * workflow, EVAL_FULL=true by hand), on a quiet day. A run stops at the first answer saying the allocation is used up.
 * Pure: no I/O. Checked by worker/ai-eval-plan.test.ts.
 */
import { isDailyLimit } from '../../../worker/ai-core';

/** The sample's size of each kind. */
export const SAMPLE = { uk: 4, cord: 4, parse: 10, ask: 10, categorise: 10, recap: 4 } as const;

/** `n` items spread evenly through the list, first one included, in order; all of them when n covers the list. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)] as T);
}

/** Receipts: 4 generated UK ones and 4 CORD photos (Indonesian, the ones a power of ten went wrong on). */
export function sampleReceipts(names: readonly string[], full: boolean): string[] {
  if (full) return [...names];
  return [...spread(names.filter((n) => n.startsWith('uk-')), SAMPLE.uk), ...spread(names.filter((n) => n.startsWith('cord-')), SAMPLE.cord)];
}

/** Loose wording or questions: spread through the file. */
export function sampleSpread<T>(cases: readonly T[], n: number, full: boolean): T[] {
  return full ? [...cases] : spread(cases, n);
}

const HANGUL = /\p{Script=Hangul}/u;
/** Category guesses: 6 English with a right category, 2 Korean, 2 where no guess is right. */
export function sampleCategorise<T extends { description: string; category: string | null }>(cases: readonly T[], full: boolean): T[] {
  if (full) return [...cases];
  const korean = cases.filter((c) => HANGUL.test(c.description) && c.category !== null);
  const none = cases.filter((c) => c.category === null);
  const english = cases.filter((c) => !HANGUL.test(c.description) && c.category !== null);
  const picked = new Set([...spread(english, 6), ...spread(korean, 2), ...spread(none, 2)]);
  return cases.filter((c) => picked.has(c));
}

/**
 * Recap months: one of each kind (no comparison, less, more, about the same), preferring a chapter month, money back
 * or a month with notes, so four months still cover them.
 */
export function sampleRecap<T extends { scenario: string; chapter: boolean; moneyBack: boolean; stats: { notes: readonly string[] } }>(months: readonly T[], full: boolean): T[] {
  if (full) return [...months];
  const picked: T[] = [];
  // What the months picked so far don't yet show counts most.
  const worth = (m: T) => (m.chapter && !picked.some((p) => p.chapter) ? 4 : 0) + (m.moneyBack && !picked.some((p) => p.moneyBack) ? 4 : 0)
    + (m.stats.notes.length > 0 ? 1 : 0);
  for (const scenario of ['no comparison', 'less', 'more', 'same']) {
    const best = months.filter((m) => m.scenario === scenario).reduce<T | null>((b, m) => (b === null || worth(m) > worth(b) ? m : b), null);
    if (best) picked.push(best);
  }
  return months.filter((m) => picked.includes(m));
}

/**
 * Cloudflare saying the account's free daily allocation is used up (HTTP 429 with error 4006, "you have used up your
 * daily free allocation of 10,000 neurons"). A 429 for anything else (3040, capacity) is an ordinary failure.
 */
export function isAllocationError(text: string): boolean {
  return isDailyLimit(text) && !/\b3040\b|capacity/i.test(text);
}
