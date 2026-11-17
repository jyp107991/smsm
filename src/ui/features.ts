/**
 * Build flags for screens that aren't finished (ENGINEERING §6: main is always releasable). Bills arrives
 * in S3 and Insights in S5; until then their tabs are hidden.
 */
export const FEATURES = {
  bills: true,
  insights: true,
} as const;
