/**
 * Filtering for Activity, chapters and (in S6) Ask smsm: one implementation, so every screen agrees.
 * Text search ignores case and character width and is Unicode-normalised (TXT-3).
 */
import type { IsoDate } from './dates';
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
}

export interface Filter {
  text?: string;
  payer?: UserId;
  categories?: readonly string[];
  chapters?: readonly (string | null)[];
  countries?: readonly string[];
  from?: IsoDate;
  to?: IsoDate;
  tags?: readonly string[];
  kinds?: readonly FilterEntry['kind'][];
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
    if (f.from !== undefined && r.date < f.from) return false;
    if (f.to !== undefined && r.date > f.to) return false;
    if (f.tags && f.tags.length > 0) {
      const have = r.tags.map((t) => t.normalize('NFKC').toLowerCase());
      if (!f.tags.every((t) => have.includes(t.normalize('NFKC').toLowerCase()))) return false;
    }
    if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(r.kind)) return false;
    return true;
  });
}
