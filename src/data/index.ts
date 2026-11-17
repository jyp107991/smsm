/** The data layer's public face: what screens and the app shell import. */
export { DataProvider } from './DataProvider';
export { backupJson, BACKUP_FORMAT } from './backup';
export { build } from './build';
export { createAppDataLayer, phoneToday } from './app';
export { createStore, storeOver, type Store, type StoreDeps, type RefusedChange } from './store';
export { createDataLayer, type DataLayer, type DataLayerOptions } from './queryClient';
export { createSessionKeeper, type SessionKeeper, type SessionState } from './session';
export { checkClientVersion, compareVersions, isStale, type VersionCheck } from './version';
export { browserNetwork, type Network } from './network';
export { installDataLayer, activeDataLayer } from './context';
export {
  useSession, useHousehold, useMembers, useCategories, useEntries, useSettlements, useBalance, useChangeRequests,
  useHistory, useOnline, useSyncStatus, useDataLayer, useWindowRole, useCategoryMemory, useRecurring, useInbox,
  type BalanceView, type DataResult, type SessionView, type SyncStatus,
} from './hooks';
export {
  addExpense, editExpense, deleteExpense, restoreExpense, addSettlement, editSettlement, deleteSettlement, restoreSettlement,
  dismissProblem, sendCode, verifyCode, signOut, createHousehold, joinHousehold, setIdentity, setMonzoMe, monzoNameOf, requestChange,
  decideChange, rememberChoice, OfflineError, NotSignedInError, NotInHouseholdError, NotReadyError, EntryNotFoundError, ChangesWaitingError,
  NAME_MAX, OtherWindowError, JOINT_MONEY_EDIT, SPLIT_AGAIN, type ChangeRequest,
  saveRecurring, pauseRecurring, resumeRecurring, endRecurring, keepInboxItem, dismissInboxItem, saveCategory, archiveCategory, reorderCategories,
  CATEGORY_COLOURS, type CategoryColour, type CategoryDraft, type RecurringDraft,
} from './mutations';
export type { WindowRole } from './windows';
export { EntryInvalidError, PartnerNotJoinedError, inputFromRow, newId, type ExpenseDraft, type InvalidReason, type SettlementDraft } from './writes';
export {
  ApiError, type Api, type ExpenseRow, type SettlementRow, type MemberRow, type HouseholdRow, type CategoryRow, type ChangeRequestRow,
  type ActivityRow, type CategoryMemoryRow, type RecurringRow, type InboxItemRow,
} from './api';
export { REFUSAL_MESSAGES, type WriteProblem, type RefusalReason } from './problems';
