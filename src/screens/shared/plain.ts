/**
 * Every error a screen shows, in plain words (DESIGN §5: what happened and what to do; no codes, no
 * server wording). The data layer throws classes and codes; this is the one place they are worded, from
 * src/ui/strings.ts (TXT-7). A server's own message never reaches the screen: what has no plainer
 * explanation becomes `fallback`.
 */
import {
  ApiError, EntryInvalidError, EntryNotFoundError, NotInHouseholdError, NotReadyError, NotSignedInError, OfflineError,
  OtherWindowError, PartnerNotJoinedError, type InvalidReason,
} from '../../data';
import { strings } from '../../ui/strings';

const INVALID: Record<InvalidReason, string> = strings.invalid;

/** The phone's own refusal codes, worded; duplicates said once. */
export function invalidWords(reasons: readonly InvalidReason[]): string {
  return [...new Set(reasons.map((r) => INVALID[r]))].join(' ');
}

export function plainError(err: unknown, fallback: string = strings.errors.didntWork): string {
  if (err instanceof EntryInvalidError) return invalidWords(err.reasons);
  if (err instanceof OfflineError) return strings.errors.offline;
  if (err instanceof OtherWindowError) return strings.windows.otherWindow;
  if (err instanceof NotReadyError) return strings.errors.stillOpening;
  if (err instanceof NotSignedInError) return strings.errors.notSignedIn;
  if (err instanceof NotInHouseholdError) return strings.errors.noHousehold;
  if (err instanceof EntryNotFoundError) return strings.errors.entryGone;
  if (err instanceof PartnerNotJoinedError) return strings.errors.partnerFirst;
  if (err instanceof ApiError) {
    if (err.kind === 'network') return strings.errors.offline;
    if (/change_requests_one_pending/.test(err.message)) return strings.errors.alreadyAsked;
    if (/partner has not joined/i.test(err.message)) return strings.settings.needsPartner;
  }
  return fallback;
}
