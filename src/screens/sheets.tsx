/**
 * The two sheets any page can open: add / edit / money back (EntrySheet) and settle up (SettleSheet). One
 * of each lives at the top of the signed-in app, so opening one from Home, an entry page or a banner is
 * the same sheet with the same back behaviour.
 */
import { createContext, use } from 'react';
import type { ExpenseDraft, ExpenseRow, SettlementRow } from '../data';
import type { FormState } from './entry/form';
import type { PendingMonzo } from './settle/monzo';

export type EntryRequest =
  /** A new expense, optionally prefilled (the quick-add reading, "Same as last time"). */
  | { mode: 'add'; prefill?: Partial<FormState>; fromQuickAdd?: { typedCategory: boolean; typedSplit: boolean } }
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
