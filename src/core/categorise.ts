/**
 * Auto-categorise (SPEC CAT-2, steps 1–3; step 4, the AI guess, is S6) and learning (CAT-3, CAT-4).
 * Never delays a save: this is a synchronous lookup.
 */
import type { SplitParams } from './split';
import { normaliseKey } from './text';

export interface CategoryRef { id: string; name: string }
export interface Memory { categoryId: string | null; split: SplitParams | null; source: 'user' | 'ai' | 'seed' }
export type MemoryMap = ReadonlyMap<string, Memory>;
export interface Suggestion { categoryId: string | null; split: SplitParams | null; source: 'memory' | 'history' | 'seed' | 'none' }

const NONE: Suggestion = { categoryId: null, split: null, source: 'none' };

function categoryIdByName(categories: readonly CategoryRef[], name: string): string | null {
  const key = normaliseKey(name);
  return categories.find((c) => normaliseKey(c.name) === key)?.id ?? null;
}

/** The longest key k such that the text equals k, starts with k + " ", or contains k as a whole word. */
function bestKeyMatch(text: string, keys: Iterable<string>): string | null {
  let best: string | null = null;
  for (const k of keys) {
    if (k === '' || (best !== null && k.length <= best.length)) continue;
    if (text === k || text.startsWith(`${k} `) || text.endsWith(` ${k}`) || text.includes(` ${k} `)) best = k;
  }
  return best;
}

export function suggest(
  description: string,
  ctx: {
    memory: MemoryMap;
    history: readonly { description: string; categoryId: string | null }[];
    seed: Readonly<Record<string, string>>;
    categories: readonly CategoryRef[];
  },
): Suggestion {
  const key = normaliseKey(description);
  if (key === '') return NONE;
  // (1) What this household chose last time for exactly this description.
  const remembered = ctx.memory.get(key);
  if (remembered && (remembered.categoryId !== null || remembered.split !== null)) {
    return { categoryId: remembered.categoryId, split: remembered.split, source: 'memory' };
  }
  // (2) A close match in the household's history: the longest earlier description contained in this one
  // as whole words ("tesco" in "tesco express"), or this one contained in it.
  const historyKeys = new Map<string, string>();
  for (const h of ctx.history) {
    if (h.categoryId !== null) historyKeys.set(normaliseKey(h.description), h.categoryId);
  }
  const hk = bestKeyMatch(key, historyKeys.keys()) ?? [...historyKeys.keys()].filter((k) => k.startsWith(`${key} `)).sort((a, b) => a.length - b.length)[0] ?? null;
  if (hk !== null) {
    const categoryId = historyKeys.get(hk) ?? null;
    const memSplit = ctx.memory.get(hk)?.split ?? null;
    if (categoryId !== null) return { categoryId, split: memSplit, source: 'history' };
  }
  // (3) The built-in list of common UK names and words.
  const seedKeys = new Map<string, string>();
  for (const [name, cat] of Object.entries(ctx.seed)) seedKeys.set(normaliseKey(name), cat);
  const sk = bestKeyMatch(key, seedKeys.keys());
  if (sk !== null) {
    const categoryId = categoryIdByName(ctx.categories, seedKeys.get(sk) ?? '');
    if (categoryId !== null) return { categoryId, split: null, source: 'seed' };
  }
  return NONE;
}

/** A person's choice teaches the app (CAT-3, CAT-4) and always overwrites an AI guess. */
export function learn(
  memory: MemoryMap,
  description: string,
  choice: { categoryId: string | null; split: SplitParams | null },
): Map<string, Memory> {
  const next = new Map(memory);
  const key = normaliseKey(description);
  if (key !== '') next.set(key, { categoryId: choice.categoryId, split: choice.split, source: 'user' });
  return next;
}
