/** Query and mutation keys for the data layer. */

export const MONEY_KEY = ['money'] as const;
export const MONEY_SCOPE = { id: 'money' } as const;

/** Query keys. Everything is under the signed-in person's id, so two accounts on one phone never mix. */
export const keys = {
  all: (uid: string) => ['smsm', uid] as const,
  membership: (uid: string) => ['smsm', uid, 'membership'] as const,
  household: (uid: string) => ['smsm', uid, 'household'] as const,
  members: (uid: string) => ['smsm', uid, 'members'] as const,
  categories: (uid: string) => ['smsm', uid, 'categories'] as const,
  expenses: (uid: string) => ['smsm', uid, 'expenses'] as const,
  settlements: (uid: string) => ['smsm', uid, 'settlements'] as const,
  changes: (uid: string) => ['smsm', uid, 'changes'] as const,
  activityAll: (uid: string) => ['smsm', uid, 'activity'] as const,
  activity: (uid: string, entityId: string) => ['smsm', uid, 'activity', entityId] as const,
  appConfig: () => ['smsm-config', 'min_client_version'] as const,
};
