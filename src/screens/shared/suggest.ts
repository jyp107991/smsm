/**
 * What the app fills in that the person didn't say (ADD-3, SPL-2, CAT-2 steps 1–3): the category and the
 * usual split for a description, from what this household chose before, then a close match in its history,
 * then the built-in list of common UK names (content/merchants.json); otherwise "Other". Synchronous, so it
 * never delays a save. The quick-add reading (ADD-1, ADD-2) is built from the same pieces.
 */
import seedList from '../../../content/merchants.json';
import { suggest, type Memory } from '../../core/categorise';
import { formatDay, type IsoDate } from '../../core/dates';
import { formatForeign } from '../../core/fx';
import { formatPence } from '../../core/money';
import { parseQuickAdd, quickAddProblem, type QuickAddContext, type QuickAddProblem, type QuickAddReading } from '../../core/quickadd';
import { resolveDefaultSplit, type SplitParams, type UserId } from '../../core/split';
import { normaliseKey, tidyDescription } from '../../core/text';
import type { CategoryRow, ExpenseRow } from '../../data';
import { strings } from '../../ui/strings';
import { splitWords, type Person } from './words';

const SEED: Readonly<Record<string, string>> = seedList;
/** Names the list writes in their own case ("IKEA", "easyJet"), by their lowercase form (Q-U6). */
const SPELLINGS: ReadonlyMap<string, string> = new Map(
  Object.keys(SEED).filter((k) => k !== k.toLowerCase()).map((k) => [k.toLowerCase(), k]),
);

/** Q-U6: a description as it is shown and saved: the list's spelling of a name, else a capital first letter. */
export function tidy(description: string): string {
  return tidyDescription(description, SPELLINGS);
}

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

/** What readQuickAdd and quickAddTrouble read with. */
export type QuickAddCtx = LearnContext & {
  today: IsoDate; me: Person; partner: Person | null; householdRatio: unknown;
  /** PLC-6 (S9a): abroad, the currency of a bare amount and the rate this phone has for it (pounds per unit). */
  currency?: string | null; rate?: string | null;
};

function grammarContext(ctx: QuickAddCtx): QuickAddContext {
  const partnerId = ctx.partner?.id ?? '\u0000partner';
  const names: Record<UserId, string> = { [ctx.me.id]: ctx.me.name, [partnerId]: ctx.partner?.name ?? '' };
  const animals: Record<UserId, 'cat' | 'dog'> = { [ctx.me.id]: ctx.me.animal, [partnerId]: ctx.partner?.animal ?? (ctx.me.animal === 'cat' ? 'dog' : 'cat') };
  const live = ctx.categories.filter((c) => !c.archived);
  return {
    today: ctx.today, me: ctx.me.id, partner: partnerId, names, animals, categories: live.map((c) => ({ id: c.id, name: c.name })),
    currency: ctx.currency ?? null, rate: ctx.rate ?? null,
  };
}

/** S9a (fix 21): why Enter can't save the quick-add text (no amount, over the maximum, no such day), or null. */
export function quickAddTrouble(text: string, ctx: QuickAddCtx): QuickAddProblem | null {
  return quickAddProblem(text, grammarContext(ctx));
}

/** ADD-1, ADD-3: the quick-add text read, with what wasn't typed filled from what the household taught. */
export function readQuickAdd(text: string, ctx: QuickAddCtx): Reading | null {
  const people = ctx.partner ? [ctx.me, ctx.partner] : [ctx.me];
  const live = ctx.categories.filter((c) => !c.archived);
  const r = parseQuickAdd(text, grammarContext(ctx));
  if (!r) return null;
  // Q-U6: read and saved tidy, so the reading, the form opened from it and the saved row all say the same.
  const description = tidy(r.description);
  // Before the partner joins, only the person holding the phone can have paid, and the split is the default.
  const payer = ctx.partner ? r.payer : ctx.me.id;
  const guess = description === '' ? { categoryId: null, split: null, source: 'none' as const } : guessFor(description, ctx);
  const categoryId = r.categoryId ?? guess.categoryId ?? otherCategoryId(live);
  const category = live.find((c) => c.id === categoryId);
  const typedSplit = r.split !== null && ctx.partner !== null;
  const split = typedSplit && r.split ? r.split : defaultSplit({ remembered: guess.split, category, householdRatio: ctx.householdRatio, people, me: ctx.me.id });
  return {
    ...r,
    description,
    payer,
    categoryId,
    split,
    typedCategory: r.categoryId !== null,
    typedSplit,
    saveAs: description !== '' ? description : (category?.name ?? ''),
  };
}

/** ADD-2: the reading's first words: the amount as typed ("£42.50"; abroad, "¥2,000"). */
export function readingAmount(r: QuickAddReading): string {
  return r.original ? formatForeign(r.original.amount, r.original.currency) : formatPence(r.amount);
}

/**
 * ADD-2: the live reading, "£42.50 · Tesco · Groceries · Jae paid · 50/50" (date and tags only when said). Abroad
 * (PLC-6), the amount as typed and then the pounds it saves as: "¥2,000 · £10.53 · Ramen · …" (no pounds while no rate).
 */
export function readingWords(r: Reading, ctx: { categories: readonly CategoryRow[]; people: readonly Person[]; today: IsoDate }): string {
  const name = ctx.people.find((p) => p.id === r.payer)?.name ?? '';
  const category = ctx.categories.find((c) => c.id === r.categoryId)?.name;
  const parts = [readingAmount(r)];
  if (r.original?.rate != null) parts.push(formatPence(r.amount));
  if (r.description !== '') parts.push(r.description);
  if (category) parts.push(category);
  parts.push(strings.reading.paid(name), splitWords(r.split, r.payer, ctx.people));
  if (r.date !== ctx.today) parts.push(formatDay(r.date, ctx.today));
  for (const t of r.tags) parts.push(strings.reading.tag(t));
  return parts.join(strings.reading.sep);
}

/**
 * Earlier descriptions that start like this one (ADD-4 "autocomplete from history"), most used first. Before
 * anything is typed (Q-L12), the most recent ones, so the row is never an empty gap.
 */
export function descriptionSuggestions(typed: string, entries: readonly ExpenseRow[], limit = 3): string[] {
  const key = normaliseKey(typed);
  if (key === '') return recentDescriptions(entries, limit);
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

/** The last few different descriptions, newest first (entries are newest first by date; ties by when added). */
export function recentDescriptions(entries: readonly ExpenseRow[], limit = 3): string[] {
  const live = entries.filter((e) => e.deleted_at === null && e.kind === 'expense' && e.description.trim() !== '');
  const newest = [...live].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of newest) {
    const k = normaliseKey(e.description);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e.description);
    if (out.length === limit) break;
  }
  return out;
}
