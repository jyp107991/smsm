/**
 * Writes the server refused after reconnecting (OFF-5). The entry is never dropped silently: the refused
 * row is kept here, on the phone, until the person fixes it (edit and save again) or dismisses it. Kept in
 * the same IndexedDB store as the cache, so it survives a restart.
 */
import type { AsyncStorage } from '@tanstack/react-query-persist-client';
import * as z from 'zod/mini';
import { strings } from '../ui/strings';
import { opLabel, opRowId, type MoneyOp, type QueuedRow } from './writes';

/** Why the server said no, in categories the interface can explain (strings.sync.reasons). */
export type RefusalReason = 'money' | 'not-member' | 'not-allowed' | 'missing' | 'category' | 'chapter' | 'photo' | 'other';

/** What the person is told (DESIGN §5: plain words, no codes); the words live with the interface's (TXT-7). */
export const REFUSAL_MESSAGES: Record<RefusalReason, string> = strings.sync.reasons;

export interface WriteProblem {
  /** The id of the refused write (one per write, not per entry). */
  id: string;
  table: MoneyOp['table'];
  op: 'upsert' | 'patch' | 'upload' | 'insert' | 'delete';
  /** The entry it was for. */
  rowId: string;
  /** "Tesco £42.50". */
  label: string;
  reason: RefusalReason;
  /** For the person, in plain words. */
  message: string;
  /** The server's own words, for the error report and for anyone debugging. */
  detail: string;
  /** What the person entered (for a fix), or the change asked for (delete or restore). */
  input: unknown;
  at: string;
  /** What the person had entered, so the form can open with it to fix (upserts only). */
  row: QueuedRow | null;
  /** Who made the write (absent in problems kept before this field existed). */
  by?: string;
}

const MONEY_REFUSAL = new RegExp([
  'must sum to amount', 'must add up to the amount', 'must not be negative', 'can’t be negative', 'paid-for-the-other',
  'paid for the other', 'treat: whoever pays', 'treat is covered', 'whole pence', 'must be more than £0\\.00',
  '_amount_pence_check', 'violates check constraint "settlements_check"', 'invalid input syntax for type bigint',
].join('|'), 'i');

export function refusalReason(message: string, code: string): RefusalReason {
  // S6a: a receipt photo that couldn't go up (gone from the phone, or refused by the bucket); its entry is saved.
  if (code === 'photo-missing' || /mime type|payload too large|maximum allowed size/i.test(message)) return 'photo';
  if (code === '42501' || /row-level security|permission denied/i.test(message)) return 'not-allowed';
  if (/non-member|only the two of you/i.test(message)) return 'not-member';
  // The database's own money checks (check_money, the amount constraints) and the phone's (validateEntry);
  // not any message that merely mentions an amount (e.g. a column the server doesn't know).
  if (MONEY_REFUSAL.test(message)) return 'money';
  if (code === 'PGRST116' || /no row/i.test(message)) return 'missing';
  // check_entry_chapter (migration 9), or a chapter that was itself refused.
  if (/chapter is not one of yours|chapter_id_fkey/i.test(message)) return 'chapter';
  if (code === '23503' || /foreign key/i.test(message)) return 'category';
  return 'other';
}

export function problemFrom(op: MoneyOp, message: string, code: string, now: Date): WriteProblem {
  const reason = refusalReason(message, code);
  return {
    message: REFUSAL_MESSAGES[reason],
    input: op.op === 'upsert' ? op.input : op.op === 'patch' ? { id: op.id, ...op.patch } : { id: op.id },
    id: op.opId,
    table: op.table,
    op: op.op,
    rowId: opRowId(op),
    label: opLabel(op),
    reason,
    detail: message.slice(0, 500),
    at: now.toISOString(),
    row: op.op === 'upsert' ? op.row : null,
    by: op.by,
  };
}

const stored = z.array(z.looseObject({ id: z.string(), table: z.enum(['expenses', 'settlements', 'recurring', 'inbox_items', 'categories', 'chapters', 'comments', 'receipts', 'import_ignores', 'import_rules']), rowId: z.string(), label: z.string() }));

export interface ProblemStore {
  load: () => Promise<void>;
  list: () => readonly WriteProblem[];
  add: (p: WriteProblem) => void;
  dismiss: (id: string) => void;
  /** Forget every problem about this entry (it was saved again successfully). */
  resolveRow: (rowId: string) => void;
  clear: () => void;
  subscribe: (cb: () => void) => () => void;
  /** Resolves when everything added so far is in storage. */
  saved: () => Promise<void>;
}

export const PROBLEMS_KEY = 'smsm-problems';

export function createProblemStore(storage: AsyncStorage): ProblemStore {
  let items: readonly WriteProblem[] = [];
  const listeners = new Set<() => void>();
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(items);
    saving = saving.then(async () => { await storage.setItem(PROBLEMS_KEY, snapshot); }).catch(() => undefined);
  };
  const set = (next: readonly WriteProblem[]) => {
    items = next;
    save();
    for (const l of listeners) l();
  };
  return {
    async load() {
      try {
        const raw = await storage.getItem(PROBLEMS_KEY);
        const parsed = stored.safeParse(raw ? JSON.parse(raw) : []);
        // Validated for the fields every reader relies on; the rest was written by this code.
        if (parsed.success) items = parsed.data as unknown as WriteProblem[];
      } catch {
        items = [];
      }
      for (const l of listeners) l();
    },
    list: () => items,
    add: (p) => { set([...items.filter((x) => x.id !== p.id), p]); },
    dismiss: (id) => { set(items.filter((x) => x.id !== id)); },
    resolveRow: (rowId) => {
      if (items.some((x) => x.rowId === rowId)) set(items.filter((x) => x.rowId !== rowId));
    },
    clear: () => { set([]); },
    saved: () => saving,
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
