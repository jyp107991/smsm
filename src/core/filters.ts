/**
 * Filtering for Activity, chapters and (in S6) Ask smsm: one implementation, so every screen agrees.
 * Text search ignores case and character width and is Unicode-normalised (TXT-3).
 */
import { isPersonal } from './balance';
import type { IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { SplitMode, UserId } from './split';
import { matches } from './text';

export interface FilterEntry {
  kind: 'expense' | 'money_back' | 'settlement';
  description: string;
  notes: string | null;
  tags: readonly string[];
  place: string | null;
  payer: UserId | null;
  categoryId: string | null;
  chapterId: string | null;
  country: string;
  date: IsoDate;
  splitMode: SplitMode | null;
  /** S10 (REC-9): whose it is: null or absent, shared; a person's id, their own. */
  ownerId?: UserId | null;
}

export interface Filter {
  text?: string;
  payer?: UserId;
  categories?: readonly string[];
  chapters?: readonly (string | null)[];
  countries?: readonly string[];
  /** PLC-7: place names, exactly as stored. */
  places?: readonly string[];
  from?: IsoDate;
  to?: IsoDate;
  tags?: readonly string[];
  kinds?: readonly FilterEntry['kind'][];
  /** S10 (REC-9): 'shared' keeps what the two of you share (settle-ups too); a person's id (UserId), only their own entries. */
  owner?: string;
}

function textMatches(r: FilterEntry, text: string): boolean {
  return [r.description, r.notes ?? '', r.place ?? '', ...r.tags].some((field) => matches(field, text));
}

export function applyFilter<T extends FilterEntry>(rows: readonly T[], f: Filter): T[] {
  return rows.filter((r) => {
    if (f.text !== undefined && f.text.trim() !== '' && !textMatches(r, f.text)) return false;
    if (f.payer !== undefined && r.payer !== f.payer) return false;
    if (f.categories && f.categories.length > 0 && (r.categoryId === null || !f.categories.includes(r.categoryId))) return false;
    if (f.chapters && f.chapters.length > 0 && !f.chapters.includes(r.chapterId)) return false;
    if (f.countries && f.countries.length > 0 && !f.countries.includes(r.country)) return false;
    if (f.places && f.places.length > 0 && (r.place === null || !f.places.includes(r.place))) return false;
    if (f.from !== undefined && r.date < f.from) return false;
    if (f.to !== undefined && r.date > f.to) return false;
    if (f.tags && f.tags.length > 0) {
      const have = r.tags.map((t) => t.normalize('NFKC').toLowerCase());
      // Within a filter, any chosen value matches (as with categories and countries).
      if (!f.tags.some((t) => have.includes(t.normalize('NFKC').toLowerCase()))) return false;
    }
    if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(r.kind)) return false;
    if (f.owner === 'shared' && isPersonal(r)) return false;
    if (f.owner !== undefined && f.owner !== 'shared' && r.ownerId !== f.owner) return false;
    return true;
  });
}

/**
 * S9a (PLC-7, CHP-6): the line above a filtered Activity ("12 entries · £340.20"), from the whole filtered set, not
 * the rows drawn: expenses add, money back subtracts; settle-ups and deleted rows are in neither the count nor the total.
 * S10 (REC-9, REC-12): the shared total never counts one person's own entries; with `owner`, the total of that
 * person's own entries alone.
 */
export function filteredTotal(rows: readonly (FilterEntry & { amount: Pence; deleted?: boolean })[], owner?: UserId): { count: number; total: Pence } {
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (r.kind === 'settlement' || r.deleted === true) continue;
    if (owner === undefined ? isPersonal(r) : r.ownerId !== owner) continue;
    count += 1;
    total += r.kind === 'money_back' ? 0 - r.amount : r.amount;
  }
  return { count, total: pence(total) };
}

/** S9a (ACT-1): what the one order reads: the entry's date, when it was added (an ISO timestamp) and its id. */
export interface Ordered { date: IsoDate; createdAt: string; id: string }

/**
 * S9a (ACT-1, EXP-1): the one order for Home's Recent, Activity and the statement: by date, newest first; then by when
 * it was added, newest first; then by id, so the order never depends on the order rows arrive in.
 */
export function newestFirst(a: Ordered, b: Ordered): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}
