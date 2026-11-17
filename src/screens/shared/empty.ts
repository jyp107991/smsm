/** Stable empty lists for "not on the phone yet", so memoised values don't change on every render. */
import type { CategoryRow, ExpenseRow, SettlementRow } from '../../data';

export const NO_CATEGORIES: readonly CategoryRow[] = [];
export const NO_ENTRIES: readonly ExpenseRow[] = [];
export const NO_SETTLEMENTS: readonly SettlementRow[] = [];
