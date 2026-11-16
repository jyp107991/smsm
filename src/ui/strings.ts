/**
 * Every interface string lives here (SPEC TXT-7), so another interface language can be added later
 * without touching screens. Sentence case, plain verbs (DESIGN §5).
 */
export const strings = {
  app: {
    name: 'smsm',
    tagline: 'Shared money for two',
    version: (version: string, commit: string) => `Version ${version} · ${commit.slice(0, 7)}`,
    comingSoon: 'Sign-in arrives in the next update.',
  },
  update: {
    ready: 'Updated. Tap to refresh',
    refresh: 'Refresh',
    later: 'Later',
    offlineReady: 'Ready to work offline',
  },
  errors: {
    generic: 'Something went wrong. Reload the app; your entries are saved on this phone.',
    reload: 'Reload',
  },
} as const;
