/**
 * What the app fills in that the person didn't say (ADD-3, SPL-2, CAT-2 steps 1–3): the category and the
 * usual split for a description, from what this household chose before, then a close match in its history,
 * then the built-in list of common UK names (content/merchants.json); otherwise "Other". Synchronous, so it
 * never delays a save. The quick-add reading (ADD-1, ADD-2) is built from the same pieces.
 */
import seedList from '../../../content/merchants.json';
import { suggest, type Memory } from '../../core/categorise';
import { formatDay, type IsoDate } from '../../core/dates';
import { formatPence } from '../../core/money';
import { parseQuickAdd, type QuickAddReading } from '../../core/quickadd';
import { resolveDefaultSplit, type SplitParams, type UserId } from '../../core/split';
import { normaliseKey } from '../../core/text';
import type { CategoryRow, ExpenseRow } from '../../data';
import { strings } from '../../ui/strings';
import { splitWords, type Person } from './words';

const SEED: Readonly<Record<string, string>> = seedList;

export interface LearnContext {
  categories: readonly CategoryRow[];
  memory: ReadonlyMap<string, Memory>;
  /** Live entries, newest first (history for step 2). */
  entries: readonly ExpenseRow[];
}

export interface Guess {
  categoryId: string | null;
  split: SplitParams | null;
  /** Where the category came from: what the household chose (memory or history), the built-in list, or none. */
  source: 'memory' | 'history' | 'seed' | 'none';
}

function usable(categories: readonly CategoryRow[], id: string | null): string | null {
  return id !== null && categories.some((c) => c.id === id && !c.archived) ? id : null;
}

/** The household's guess for a description (CAT-2 steps 1–3). A remembered split with no category still lets the others name one. */
export function guessFor(description: string, ctx: LearnContext): Guess {
  const categories = ctx.categories.filter((c) => !c.archived);
  const history = ctx.entries.filter((e) => e.deleted_at === null && e.kind === 'expense').map((e) => ({ description: e.description, categoryId: e.category_id }));
  const input = { memory: ctx.memory, history, seed: SEED, categories };
  const first = suggest(description, input);
  let categoryId = usable(categories, first.categoryId);
  let source: Guess['source'] = categoryId === null ? 'none' : first.source;
  if (categoryId === null && first.source === 'memory') {
    const key = normaliseKey(description);
    const without = new Map(ctx.memory);
    without.delete(key);
    const rest = suggest(description, { ...input, memory: without });
    categoryId = usable(categories, rest.categoryId);
    source = categoryId === null ? 'none' : rest.source;
  }
  return { categoryId, split: first.split, source };
}

export function otherCategoryId(categories: readonly CategoryRow[]): string | null {
  return categories.find((c) => !c.archived && normaliseKey(c.name) === 'other')?.id ?? null;
}

function ratioOf(json: unknown, members: readonly UserId[]): Readonly<Record<UserId, number>> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  return members.length === 2 && members.every((m) => typeof r[m] === 'number') ? (r as Record<UserId, number>) : null;
}

/** SPL-2: this description's usual split → the category's default → the household default → 50/50. */
export function defaultSplit(opts: {
  remembered: SplitParams | null;
  category: CategoryRow | undefined;
  householdRatio: unknown;
  people: readonly Person[];
  me: UserId;
}): SplitParams {
  const ids = opts.people.map((p) => p.id);
  const [a, b] = ids;
  if (a === undefined || b === undefined) return { mode: 'ratio', ratio: { [opts.me]: 50 } };
  return resolveDefaultSplit({
    remembered: opts.remembered,
    categoryDefault: ratioOf(opts.category?.default_ratio, ids),
    householdDefault: ratioOf(opts.householdRatio, ids),
    members: [a, b],
  });
}

export interface Reading extends QuickAddReading {
  /** What will be saved, with everything not typed filled in (ADD-3). */
  categoryId: string | null;
  split: SplitParams;
  /** The person said these themselves (so saving teaches the app, CAT-3, CAT-4). */
  typedCategory: boolean;
  typedSplit: boolean;
  /** The text to save as the description: as typed, or the category's name when none was typed. */
  saveAs: string;
}

/** ADD-1, ADD-3: the quick-add text read, with what wasn't typed filled from what the household taught. */
export function readQuickAdd(
  text: string,
  ctx: LearnContext & { today: IsoDate; me: Person; partner: Person | null; householdRatio: unknown },
): Reading | null {
  const people = ctx.partner ? [ctx.me, ctx.partner] : [ctx.me];
  const partnerId = ctx.partner?.id ?? '\u0000partner';
  const names: Record<UserId, string> = { [ctx.me.id]: ctx.me.name, [partnerId]: ctx.partner?.name ?? '' };
  const animals: Record<UserId, 'cat' | 'dog'> = { [ctx.me.id]: ctx.me.animal, [partnerId]: ctx.partner?.animal ?? (ctx.me.animal === 'cat' ? 'dog' : 'cat') };
  const live = ctx.categories.filter((c) => !c.archived);
  const r = parseQuickAdd(text, {
    today: ctx.today, me: ctx.me.id, partner: partnerId, names, animals, categories: live.map((c) => ({ id: c.id, name: c.name })),
  });
  if (!r) return null;
  // Before the partner joins, only the person holding the phone can have paid, and the split is the default.
  const payer = ctx.partner ? r.payer : ctx.me.id;
  const guess = r.description === '' ? { categoryId: null, split: null, source: 'none' as const } : guessFor(r.description, ctx);
  const categoryId = r.categoryId ?? guess.categoryId ?? otherCategoryId(live);
  const category = live.find((c) => c.id === categoryId);
  const typedSplit = r.split !== null && ctx.partner !== null;
  const split = typedSplit && r.split ? r.split : defaultSplit({ remembered: guess.split, category, householdRatio: ctx.householdRatio, people, me: ctx.me.id });
  return {
    ...r,
    payer,
    categoryId,
    split,
    typedCategory: r.categoryId !== null,
    typedSplit,
    saveAs: r.description !== '' ? r.description : (category?.name ?? ''),
  };
}

/** ADD-2: the live reading, "£42.50 · Tesco · Groceries · Jae paid · 50/50" (date and tags only when said). */
export function readingWords(r: Reading, ctx: { categories: readonly CategoryRow[]; people: readonly Person[]; today: IsoDate }): string {
  const name = ctx.people.find((p) => p.id === r.payer)?.name ?? '';
  const category = ctx.categories.find((c) => c.id === r.categoryId)?.name;
  const parts = [formatPence(r.amount)];
  if (r.description !== '') parts.push(r.description);
  if (category) parts.push(category);
  parts.push(strings.reading.paid(name), splitWords(r.split, r.payer, ctx.people));
  if (r.date !== ctx.today) parts.push(formatDay(r.date, ctx.today));
  for (const t of r.tags) parts.push(strings.reading.tag(t));
  return parts.join(strings.reading.sep);
}

/** Earlier descriptions that start like this one (ADD-4 "autocomplete from history"), most used first. */
export function descriptionSuggestions(typed: string, entries: readonly ExpenseRow[], limit = 3): string[] {
  const key = normaliseKey(typed);
  if (key.length < 2) return [];
  const counts = new Map<string, { text: string; n: number }>();
  for (const e of entries) {
    if (e.deleted_at !== null) continue;
    const k = normaliseKey(e.description);
    if (k === key || !k.startsWith(key)) continue;
    const seen = counts.get(k);
    if (seen) seen.n += 1;
    else counts.set(k, { text: e.description, n: 1 });
  }
  return [...counts.values()].sort((x, y) => y.n - x.n || x.text.localeCompare(y.text)).slice(0, limit).map((c) => c.text);
}
