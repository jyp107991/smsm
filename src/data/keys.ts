/** Query and mutation keys for the data layer. */

export const MONEY_KEY = ['money'] as const;
export const MONEY_SCOPE = { id: 'money' } as const;
/** What a person's choices teach the app (CAT-3, CAT-4): queued like money, but not counted as waiting changes. */
export const MEMORY_KEY = ['memory'] as const;
export const MEMORY_SCOPE = { id: 'memory' } as const;
/** S8 (NOT-1): a person's notification switches: queued like money (offline too), not counted as waiting changes. */
export const PREFS_KEY = ['prefs'] as const;
export const PREFS_SCOPE = { id: 'prefs' } as const;

/** Query keys. Everything is under the signed-in person's id, so two accounts on one phone never mix. */
export const keys = {
  all: (uid: string) => ['smsm', uid] as const,
  membership: (uid: string) => ['smsm', uid, 'membership'] as const,
  household: (uid: string) => ['smsm', uid, 'household'] as const,
  members: (uid: string) => ['smsm', uid, 'members'] as const,
  categories: (uid: string) => ['smsm', uid, 'categories'] as const,
  chapters: (uid: string) => ['smsm', uid, 'chapters'] as const,
  comments: (uid: string) => ['smsm', uid, 'comments'] as const,
  expenses: (uid: string) => ['smsm', uid, 'expenses'] as const,
  settlements: (uid: string) => ['smsm', uid, 'settlements'] as const,
  changes: (uid: string) => ['smsm', uid, 'changes'] as const,
  memory: (uid: string) => ['smsm', uid, 'memory'] as const,
  recurring: (uid: string) => ['smsm', uid, 'recurring'] as const,
  inbox: (uid: string) => ['smsm', uid, 'inbox'] as const,
  /** S7 (IMP-3): the hashes of rows decided "Not ours", and the "always do this" rules. */
  importIgnores: (uid: string) => ['smsm', uid, 'import-ignores'] as const,
  importRules: (uid: string) => ['smsm', uid, 'import-rules'] as const,
  /** S8: this person's notification switches (notification_prefs, their own row). */
  notificationPrefs: (uid: string) => ['smsm', uid, 'notification-prefs'] as const,
  activityAll: (uid: string) => ['smsm', uid, 'activity'] as const,
  activity: (uid: string, entityId: string) => ['smsm', uid, 'activity', entityId] as const,
  appConfig: () => ['smsm-config', 'min_client_version'] as const,
};
