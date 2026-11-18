/**
 * The two sheets any page can open: add / edit / money back (EntrySheet) and settle up (SettleSheet). One
 * of each lives at the top of the signed-in app, so opening one from Home, an entry page or a banner is
 * the same sheet with the same back behaviour.
 */
import { createContext, use } from 'react';
import type { ExpenseDraft, ExpenseRow, SettlementRow } from '../data';
import type { FormState } from './entry/form';
import type { ScheduleState } from './entry/schedule';
import type { PendingMonzo } from './settle/monzo';

export type EntryRequest =
  /** A new expense, optionally prefilled (the quick-add reading, "Same as last time"). */
  | {
    mode: 'add'; prefill?: Partial<FormState>; fromQuickAdd?: { typedCategory: boolean; typedSplit: boolean };
    /** INB-2 Keep: the Inbox bill this entry settles (saved with its template and occurrence). */
    inboxItem?: string;
    /** S7 (IMP-3) Change first: the bank row this entry keeps, and whether to make it a rule ("Always do this for"). */
    importCard?: string;
    importAlways?: boolean;
    /** S6a (SCAN-4): a receipt sorted later: its photo, already on its way to the bucket. */
    receiptPath?: string;
    /** S6b (ADD-8): opened from the "Scan receipt" shortcut: the camera (or the photo picker) offered at once. */
    start?: 'scan';
    /** S6b (ADD-8): a photo shared into the app; attached, and read as a scan when smart features are on. */
    shared?: { photo: Blob };
  }
  /** S3: a new regular payment (optionally prefilled, e.g. from "looks monthly"), or edit one by its id. */
  | { mode: 'recurring'; id?: string; prefill?: Partial<FormState>; schedule?: Partial<ScheduleState> }
  /** Edit an entry; `row` and `input` when it is a refused write kept on the phone (OFF-5). */
  | { mode: 'edit'; id: string; row?: ExpenseRow; input?: ExpenseDraft }
  /** MB-2: money back for this expense. */
  | { mode: 'refund'; of: ExpenseRow };

export type SettleRequest =
  | { mode: 'new' }
  | { mode: 'edit'; row: SettlementRow }
  /** Back from Monzo after the page was reloaded: ask "Did it go through?" (SET-2). */
  | { mode: 'asking'; pending: PendingMonzo };

export interface Sheets {
  openEntry: (req: EntryRequest) => void;
  openSettle: (req: SettleRequest) => void;
}

export const SheetsContext = createContext<Sheets | null>(null);

export function useSheets(): Sheets {
  const s = use(SheetsContext);
  if (!s) throw new Error('useSheets needs the signed-in app above it');
  return s;
}
