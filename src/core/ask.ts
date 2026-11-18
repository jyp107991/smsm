/**
 * Ask smsm (S6b; INS-9, docs/AI.md §3.5): the AI's closed-schema reading of a question becomes the app's own filter,
 * and the answer is computed with the same filter code as Activity (core/filters) and the same money rules as
 * Insights (shared spend: counted expenses minus money back; never paid-for-the-other or settle-ups). The AI never
 * gives the figure. Pure: no I/O, no clock; money in integer pence.
 */
import type { AskReply } from './aiReplies';
import type { IsoDate } from './dates';
import { applyFilter, type Filter, type FilterEntry } from './filters';
import { formatPence, type Pence } from './money';
import type { PenceMap, SplitMode, UserId } from './split';

export type Measure = 'total' | 'count' | 'average' | 'largest';
export type GroupBy = 'category' | 'month' | 'country' | 'payer' | 'chapter';

export interface AskLookups {
  categories: readonly { id: string; name: string }[];
  chapters: readonly { id: string; name: string }[];
  countries: readonly { code: string; name: string }[];
  people: readonly [{ id: UserId; name: string }, { id: UserId; name: string }];
  today: IsoDate;
}

export interface AskFilter extends Filter { modes?: SplitMode[] }
export interface Chip { key: 'category' | 'chapter' | 'country' | 'payer' | 'dates' | 'text' | 'tag' | 'mode'; value: string; label: string }
export interface AskQuery { filter: AskFilter; measure: Measure; groupBy: GroupBy | null; chips: Chip[] }

/** An entry as Ask reads it: Insights' money fields with Activity's filter fields. */
export interface AskEntry extends FilterEntry {
  id: string;
  amount: Pence;
  paid: PenceMap;
  deleted: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODE_WORDS: Record<string, string> = { ratio: 'Shared', exact: 'Exact split', treat: 'Treats', for_other: 'Paid for the other' };

const key = (s: string) => s.trim().toLowerCase();
function realDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}
const dayWords = (d: IsoDate) => `${String(Number(d.slice(8, 10)))} ${SHORT[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
const datesWords = (from?: IsoDate, to?: IsoDate) =>
  from && to ? `${dayWords(from)} to ${dayWords(to)}` : from ? `since ${dayWords(from)}` : to ? `until ${dayWords(to)}` : 'all time';

/** INS-9: the AI's reading as the app's own filter, or null when it can't be answered as asked. */
export function askFilter(reply: AskReply, lookups: AskLookups): AskQuery | null {
  if ('unsupported' in reply) return null;
  const f = reply.filters;
  const filter: AskFilter = {};
  const chips: Chip[] = [];

  /** Names → ids; null when names were given and none is the household's (never a wider question than asked). */
  const named = (given: readonly string[] | undefined, rows: readonly { id: string; name: string }[]) => {
    if (!given || given.length === 0) return [];
    const ids = [...new Set(given.map((n) => rows.find((r) => key(r.name) === key(n))?.id).filter((x): x is string => x !== undefined))];
    return ids.length === 0 ? null : ids;
  };
  const categories = named(f.categories, lookups.categories);
  const chapters = named(f.chapters, lookups.chapters);
  const countries = f.countries && f.countries.length > 0
    ? [...new Set(f.countries.map((c) => c.toUpperCase()).filter((c) => lookups.countries.some((x) => x.code === c)))] : [];
  if (categories === null || chapters === null || (f.countries && f.countries.length > 0 && countries.length === 0)) return null;

  if (categories.length > 0) filter.categories = categories;
  if (chapters.length > 0) filter.chapters = chapters;
  if (countries.length > 0) filter.countries = countries;
  for (const id of categories) chips.push({ key: 'category', value: id, label: lookups.categories.find((c) => c.id === id)?.name ?? '' });
  for (const id of chapters) chips.push({ key: 'chapter', value: id, label: lookups.chapters.find((c) => c.id === id)?.name ?? '' });
  for (const code of countries) chips.push({ key: 'country', value: code, label: lookups.countries.find((c) => c.code === code)?.name ?? code });

  if (f.payer) {
    const person = f.payer === 'A' ? lookups.people[0] : lookups.people[1];
    filter.payer = person.id;
    chips.push({ key: 'payer', value: person.id, label: `Paid by ${person.name}` });
  }
  const from = f.from !== undefined && realDay(f.from) ? f.from : undefined;
  const to = f.to !== undefined && realDay(f.to) ? f.to : undefined;
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (from || to) chips.push({ key: 'dates', value: `${from ?? ''}..${to ?? ''}`, label: datesWords(from, to).replace(/^./, (c) => c.toUpperCase()) });
  const text = f.text?.trim();
  if (text) {
    filter.text = text;
    chips.push({ key: 'text', value: text, label: `“${text}”` });
  }
  if (f.tags && f.tags.length > 0) {
    filter.tags = [...f.tags];
    for (const t of f.tags) chips.push({ key: 'tag', value: t, label: `#${t}` });
  }
  if (f.mode && f.mode.length > 0) {
    filter.modes = [...f.mode];
    for (const m of f.mode) chips.push({ key: 'mode', value: m, label: MODE_WORDS[m] ?? m });
  }
  return { filter, measure: reply.measure, groupBy: reply.group_by ?? null, chips };
}

const COUNTED = new Set<string>(['ratio', 'exact', 'treat']);
/** Insights' rule: live counted expenses, and live money back that isn't for the other. */
function counts(e: AskEntry): boolean {
  if (e.deleted || e.kind === 'settlement') return false;
  return e.kind === 'expense' ? e.splitMode !== null && COUNTED.has(e.splitMode) : e.splitMode !== 'for_other';
}
const signed = (e: AskEntry) => (e.kind === 'money_back' ? 0 - e.amount : e.amount);

function measured(rows: readonly AskEntry[], measure: Measure): number {
  const expenses = rows.filter((e) => e.kind === 'expense');
  switch (measure) {
    case 'total': return rows.reduce((t, e) => t + signed(e), 0);
    case 'count': return expenses.length;
    case 'average': {
      if (expenses.length === 0) return 0;
      const total = rows.reduce((t, e) => t + signed(e), 0);
      return Math.floor((2 * total + expenses.length) / (2 * expenses.length));
    }
    case 'largest': return expenses.reduce((m, e) => Math.max(m, e.amount), 0);
  }
}

/** INS-9: the figure (code, never the AI), its sentence, and the groups when asked for (`_today` is kept for the pinned signature). */
export function answer(entries: readonly AskEntry[], filter: AskFilter, measure: Measure, groupBy: GroupBy | null, _today: IsoDate, lookups: AskLookups):
  { figure: number; sentence: string; groups?: { key: string | null; label: string; figure: number }[] } {
  const picked = applyFilter(entries, filter).filter((e) => counts(e) && (!filter.modes || filter.modes.length === 0 || (e.splitMode !== null && filter.modes.includes(e.splitMode))));
  const figure = measured(picked, measure);
  const money = measure !== 'count';
  const head = money ? formatPence(figure as Pence) : `${String(figure)} ${figure === 1 ? 'entry' : 'entries'}`;
  const cats = (filter.categories ?? []).map((id) => lookups.categories.find((c) => c.id === id)?.name ?? '').filter((n) => n !== '');
  const where = [
    ...(filter.chapters ?? []).map((id) => lookups.chapters.find((c) => c.id === id)?.name ?? '').filter((n) => n !== ''),
    ...(filter.countries ?? []).map((code) => lookups.countries.find((c) => c.code === code)?.name ?? code),
  ];
  const sentence = `${head}${cats.length > 0 ? ` on ${cats.join(' and ')}` : ''}${where.length > 0 ? ` in ${where.join(' and ')}` : ''}, ${datesWords(filter.from, filter.to)}`;
  if (!groupBy) return { figure, sentence };

  let groups: { key: string | null; label: string; figure: number }[];
  if (groupBy === 'payer') {
    // What each paid (money back: minus what each received), as Insights' whoPaid.
    groups = lookups.people.map((p) => ({
      key: p.id, label: p.name,
      figure: picked.reduce((t, e) => t + (e.kind === 'money_back' ? -1 : 1) * (e.paid[p.id] ?? 0), 0),
    }));
  } else {
    const keyOf = (e: AskEntry): string | null =>
      groupBy === 'category' ? e.categoryId : groupBy === 'month' ? e.date.slice(0, 7) : groupBy === 'country' ? e.country : e.chapterId;
    const byKey = new Map<string | null, AskEntry[]>();
    for (const e of picked) byKey.set(keyOf(e), [...(byKey.get(keyOf(e)) ?? []), e]);
    const label = (k: string | null) => {
      if (groupBy === 'category') return lookups.categories.find((c) => c.id === k)?.name ?? 'Uncategorised';
      if (groupBy === 'month') return k === null ? '' : `${MONTHS[Number(k.slice(5, 7)) - 1] ?? ''} ${k.slice(0, 4)}`;
      if (groupBy === 'country') return lookups.countries.find((c) => c.code === k)?.name ?? k ?? '';
      return k === null ? 'Everyday' : (lookups.chapters.find((c) => c.id === k)?.name ?? '');
    };
    groups = [...byKey].map(([k, rows]) => ({ key: k, label: label(k), figure: measured(rows, measure) }));
  }
  groups = groups.filter((g) => g.figure !== 0);
  groups.sort((a, b) => (groupBy === 'month' ? String(a.key).localeCompare(String(b.key)) : b.figure - a.figure));
  return { figure, sentence, groups };
}
