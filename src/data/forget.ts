/**
 * What else a sign-out clears (src/data/queryClient.ts forget): modules that keep something of their own for a person on
 * this phone register here, so the data layer clears it without depending on them. S7: the bank rows waiting to be
 * reviewed and the phone-only import rules and ignores (imports.ts).
 */
import type { DataLayer } from './queryClient';

type Forget = (layer: DataLayer, uid: string | null) => Promise<void>;
const hooks = new Set<Forget>();

export function onForget(fn: Forget): void {
  hooks.add(fn);
}

/** Clears what every module keeps for `uid` (everyone's, when null). A failure in one never stops the others. */
export async function runForget(layer: DataLayer, uid: string | null): Promise<void> {
  for (const fn of hooks) {
    try {
      await fn(layer, uid);
    } catch {
      /* best effort: the person is signed out either way */
    }
  }
}
