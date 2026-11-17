/**
 * Every interface string lives here (SPEC TXT-7), so another interface language can be added later
 * without touching screens. Sentence case, plain verbs (DESIGN §5).
 */
export const strings = {
  app: {
    name: 'smsm',
    tagline: 'A home ledger for two',
    version: (version: string, commit: string) => `Version ${version} · ${commit.slice(0, 7)}`,
    comingSoon: 'Soon you’ll sign in here.',
  },
  update: {
    ready: 'Updated. Tap to refresh',
    refresh: 'Refresh',
    later: 'Later',
    offlineReady: 'Ready to work offline',
  },
  /** smsm open twice on one phone: only one window saves (src/data/windows.ts). */
  windows: {
    otherWindow: 'smsm is open in another window. Make changes there; this one only shows them.',
  },
  rig: {
    kind: { cat: 'the cat', dog: 'the dog' },
    plank: (left: string, right: string, higher: 'left' | 'right' | 'level') =>
      higher === 'level'
        ? `The plank is level between ${left} and ${right}`
        : `The plank tilts: ${higher === 'left' ? left : right} sits higher than ${higher === 'left' ? right : left}`,
  },
  /** Shared primitives in src/ui/primitives. */
  ui: {
    working: 'Working…',
    currency: '£',
    suggested: 'Suggested',
    close: 'Close',
    dismiss: 'Dismiss',
    notifications: 'Notifications',
    discardTitle: 'Discard your changes?',
    discardBody: "What you typed here won't be kept.",
    keepEditing: 'Keep editing',
    discard: 'Discard',
  },
  tabs: {
    label: 'Main',
    home: 'Home',
    activity: 'Activity',
    bills: 'Bills',
    insights: 'Insights',
  },
  errors: {
    generic: 'Something went wrong. Reload the app; your entries are saved on this phone.',
    reload: 'Reload',
  },
} as const;
