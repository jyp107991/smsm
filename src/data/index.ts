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
  useHistory, useOnline, useSyncStatus, useDataLayer, useWindowRole, useCategoryMemory, useRecurring, useInbox, useChapters, useCurrentChapter, useCurrentCountry, useLocationSetting, useComments, useAllComments, useCommentCounts, useSmartFeatures,
  type BalanceView, type DataResult, type SessionView, type SyncStatus,
} from './hooks';
export {
  addExpense, editExpense, deleteExpense, restoreExpense, addSettlement, editSettlement, deleteSettlement, restoreSettlement,
  dismissProblem, sendCode, verifyCode, signOut, createHousehold, joinHousehold, setIdentity, setMonzoMe, monzoNameOf, requestChange,
  decideChange, rememberChoice, OfflineError, NotSignedInError, NotInHouseholdError, NotReadyError, EntryNotFoundError, ChangesWaitingError,
  NAME_MAX, OtherWindowError, JOINT_MONEY_EDIT, SPLIT_AGAIN, type ChangeRequest,
  saveRecurring, pauseRecurring, resumeRecurring, endRecurring, keepInboxItem, dismissInboxItem, saveCategory, archiveCategory, reorderCategories,
  CATEGORY_COLOURS, type CategoryColour, type CategoryDraft, type RecurringDraft,
  saveChapter, closeChapter, setCurrentChapter, currentChapterId, currentOpenChapter, type ChapterDraft,
  currentCountry, homeCountry, setCurrentCountry, setUseLocation, locate, rateFor, askLocation,
  addComment, editComment, deleteComment, restoreComment, setSettleDay,
} from './mutations';
export type { WindowRole } from './windows';
export { setSmartFeatures, readReceipt, attachPhoto, keepPhoto, queuePhotoUpload, forgetPhoto, photoBlob, photoUrl, sortLater, sortPhotoLater, parseLoose, guessCategory, type LooseReading } from './smartActions';
export { offAi, workerAi, idbPhotos, memoryPhotoStore, type AiService, type AiResult, type AiReason, type PhotoStore, type Downscale } from './smart';
export { EntryInvalidError, PartnerNotJoinedError, inputFromRow, newId, type ExpenseDraft, type ForeignOriginal, type ReceiptItem, type InvalidReason, type SettlementDraft } from './writes';
export {
  ApiError, type Api, type ExpenseRow, type SettlementRow, type MemberRow, type HouseholdRow, type CategoryRow, type ChangeRequestRow,
  type ActivityRow, type CategoryMemoryRow, type RecurringRow, type InboxItemRow, type ChapterRow, type CommentRow,
} from './api';
export { REFUSAL_MESSAGES, type WriteProblem, type RefusalReason } from './problems';
export { browserGeo, frankfurterRates, type GeoService, type RatesService, type Located } from './places';
