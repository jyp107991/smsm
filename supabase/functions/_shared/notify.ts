/**
 * S8 (NOT-1, NOT-2, ACT-4; DESIGN §5): what each notification says and where a tap goes. Pure: no I/O, no clock,
 * integer pence. The push function sends exactly these words: it imports this file (a byte-identical copy in
 * supabase/functions/_shared/, kept by scripts/sync-shared.ts and checked by a test), so the wording lives here
 * rather than in src/ui/strings.ts, which the function can't reach.
 *
 * Every body is one line of at most 180 characters (code points). Money notifications end with the balance in
 * words as the database has it at send time ("· Sam owes Jae £24.50"); a description or comment too long to fit
 * is cut with "…", never the amount or the balance. Names, never "you"; sentence case.
 */
import { formatPence, type Pence } from './money.ts';

type UserId = string;

export type NotificationKind =
  | 'entry_added' | 'entry_changed' | 'entry_deleted' | 'entry_restored'
  | 'settle_added' | 'settle_changed' | 'settle_deleted'
  | 'comment' | 'bill_posted' | 'bill_tomorrow' | 'recap_ready' | 'settle_day' | 'balance_reminder'
  | 'approval_waiting' | 'approval_decided';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'entry_added', 'entry_changed', 'entry_deleted', 'entry_restored', 'settle_added', 'settle_changed', 'settle_deleted',
  'comment', 'bill_posted', 'bill_tomorrow', 'recap_ready', 'settle_day', 'balance_reminder', 'approval_waiting', 'approval_decided',
];

/** What a notification is about, as next_notifications builds it at send time (every field optional). */
export interface NotificationData {
  /** Who did it (null for the daily ones). */
  actor?: UserId | null;
  /** The entry, settle-up, change request or bill it is about; for a comment, the entry's id. */
  ref?: string | null;
  description?: string;
  amount?: Pence;
  comment?: string;
  /** recap_ready: 'YYYY-MM'. */
  month?: string;
  request?: 'identity' | 'default_ratio';
  approved?: boolean;
  /** Both people's nets now (member_net; positive = owed). */
  balance?: Record<UserId, Pence>;
  /** balance_reminder: the person's chosen amount. */
  threshold?: Pence;
  /** A settle-up: who paid it. */
  from?: UserId | null;
  /** entry_changed: what changed (none given: the amount, as the words always said). */
  change?: 'amount' | 'category' | 'details';
  /** entry_changed with change 'category': the category's name now. */
  category?: string | null;
  /** comment: the comment's own id (each comment its own notification). */
  commentId?: string | null;
  /** bill_tomorrow: the amount varies (the template's usual amount is given). */
  varies?: boolean;
}

export interface NotificationText { title: string; body: string; path: string }

export const NOTIFICATION_TITLE = 'smsm';
/** The most a body says, in code points. */
export const MAX_BODY = 180;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Whitespace of any kind, newlines too, becomes single spaces; one line. */
function oneLine(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/gu, ' ').trim();
}

const length = (s: string): number => Array.from(s).length;

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** At most `max` code points; a cut ends with "…" and never splits a character (whole graphemes where known). */
function cut(s: string, max: number): string {
  if (length(s) <= max) return s;
  if (max <= 1) return '…';
  const room = max - 1;
  let out = '';
  let used = 0;
  const parts = segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
  for (const g of parts) {
    const n = length(g);
    if (used + n > room) break;
    out += g;
    used += n;
  }
  return `${out.trimEnd()}…`;
}

function nameOf(names: Record<UserId, string>, id: UserId | null | undefined): string {
  const n = id ? oneLine(names[id]) : '';
  return n === '' ? 'Someone' : n;
}

function amountOf(p: Pence | undefined): string {
  return formatPence((typeof p === 'number' && Number.isSafeInteger(p) ? p : 0) as Pence);
}

/**
 * The balance in words, exactly as Home says it (src/screens/shared/words.ts balanceWords): "Sam owes Jae £24.50"
 * or "All square". From the two nets as member_net gives them (positive = this person is owed).
 */
export function balanceWords(balance: Record<UserId, Pence>, names: Record<UserId, string>): string {
  const people = Object.keys(balance).length > 0 ? Object.keys(balance) : Object.keys(names);
  const creditor = people.find((id) => (balance[id] ?? 0) > 0);
  if (creditor === undefined) {
    const debtorOnly = people.find((id) => (balance[id] ?? 0) < 0);
    if (debtorOnly === undefined) return 'All square';
    const other = [...people, ...Object.keys(names)].find((id) => id !== debtorOnly);
    return `${nameOf(names, debtorOnly)} owes ${nameOf(names, other)} ${amountOf((0 - (balance[debtorOnly] ?? 0)) as Pence)}`;
  }
  const debtor = [...people, ...Object.keys(names)].find((id) => id !== creditor);
  return `${nameOf(names, debtor)} owes ${nameOf(names, creditor)} ${amountOf(balance[creditor])}`;
}

/** "Sam has owed Jae more than £100.00 for 30 days", from the balance and the person's chosen amount. */
function reminderWords(balance: Record<UserId, Pence>, names: Record<UserId, string>, threshold: Pence | undefined): string {
  const people = Object.keys(balance);
  const creditor = people.find((id) => (balance[id] ?? 0) > 0);
  if (creditor === undefined) return 'All square';
  const debtor = [...people, ...Object.keys(names)].find((id) => id !== creditor);
  return `${nameOf(names, debtor)} has owed ${nameOf(names, creditor)} more than ${amountOf(threshold)} for 30 days`;
}

/** A sentence with one variable part (a description) cut to fit, then " · the balance" for money. */
function fitted(make: (part: string) => string, part: string, tail: string): string {
  const fixed = length(make('')) + length(tail);
  const room = MAX_BODY - fixed;
  const body = make(cut(part, Math.max(1, room))) + tail;
  return length(body) <= MAX_BODY ? body : cut(body, MAX_BODY);
}

function monthName(month: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  const i = m ? Number(m[2]) - 1 : -1;
  return MONTHS[i] ?? 'Last month';
}

const enc = (ref: string | null | undefined) => encodeURIComponent(ref ?? '');

/** Where a tap goes (NOT-2): the app's own routes (src/ui/router.ts). */
function pathFor(kind: NotificationKind, data: NotificationData): string {
  switch (kind) {
    case 'entry_added': case 'entry_changed': case 'entry_deleted': case 'entry_restored':
      return data.ref ? `/entry/${enc(data.ref)}` : '/activity';
    case 'comment':
      return data.ref ? `/entry/${enc(data.ref)}#comments` : '/activity';
    case 'settle_added': case 'settle_changed': case 'settle_deleted':
      return '/activity';
    case 'approval_waiting': case 'approval_decided':
      return '/settings#approvals';
    case 'bill_posted': case 'bill_tomorrow':
      return '/bills';
    case 'recap_ready':
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month ?? '') ? `/recap/${data.month ?? ''}` : '/insights';
    case 'settle_day': case 'balance_reminder':
      return '/';
  }
}

function bodyFor(kind: NotificationKind, data: NotificationData, names: Record<UserId, string>): string {
  const who = nameOf(names, data.actor);
  const description = oneLine(data.description) || 'an entry';
  const amount = amountOf(data.amount);
  const tail = ` · ${balanceWords(data.balance ?? {}, names)}`;
  switch (kind) {
    case 'entry_added':
      return fitted((d) => `${who} added ${d} ${amount}`, description, tail);
    case 'entry_changed': {
      const category = oneLine(data.category);
      if (data.change === 'category' && category !== '') {
        return fitted((d) => `${who} moved ${d} to ${cut(category, 40)}`, description, tail);
      }
      if (data.change === 'details' || data.change === 'category') return fitted((d) => `${who} changed ${d}`, description, tail);
      return fitted((d) => `${who} changed ${d} to ${amount}`, description, tail);
    }
    case 'entry_deleted':
      return fitted((d) => `${who} deleted ${d} ${amount}`, description, tail);
    case 'entry_restored':
      return fitted((d) => `${who} restored ${d} ${amount}`, description, tail);
    case 'settle_added': {
      const paidBy = data.from ?? data.actor;
      if (!paidBy || paidBy === data.actor) return `${who} settled up ${amount}${tail}`;
      return `${who} recorded that ${nameOf(names, paidBy)} paid ${amount}${tail}`;
    }
    case 'settle_changed':
      return `${who} changed a settle-up to ${amount}${tail}`;
    case 'settle_deleted':
      return `${who} deleted a settle-up of ${amount}${tail}`;
    case 'comment': {
      const words = oneLine(data.comment);
      const make = (d: string, c: string) => `${who} commented on ${d}: “${c}”`;
      const room = MAX_BODY - length(make('', ''));
      if (length(description) + length(words) <= room) return make(description, words);
      // The comment matters most: the entry's name gives way first, down to a third of the room.
      const d = cut(description, Math.min(length(description), Math.max(room - length(words), Math.floor(room / 3))));
      const body = make(d, cut(words, Math.max(1, room - length(d))));
      return length(body) <= MAX_BODY ? body : cut(body, MAX_BODY);
    }
    case 'bill_posted':
      return fitted((d) => `${d} ${amount} posted today`, oneLine(data.description) || 'A regular payment', tail);
    case 'bill_tomorrow':
      if (data.varies === true) return fitted((d) => `${d} is due tomorrow (usually ${amount})`, oneLine(data.description) || 'A regular payment', '');
      return fitted((d) => `${d} ${amount} posts tomorrow`, oneLine(data.description) || 'A regular payment', '');
    case 'recap_ready':
      return `${monthName(data.month)}’s recap is ready`;
    case 'settle_day':
      return cut(`Settle day: ${balanceWords(data.balance ?? {}, names)}`, MAX_BODY);
    case 'balance_reminder':
      return cut(reminderWords(data.balance ?? {}, names, data.threshold), MAX_BODY);
    case 'approval_waiting':
      return cut(data.request === 'identity' ? `${who} asked to change their name or animal` : `${who} asked to change the default split`, MAX_BODY);
    case 'approval_decided': {
      const what = data.request === 'identity' ? 'the new name and animal' : 'the new default split';
      return cut(data.approved === true ? `${who} approved ${what}` : `${who} said no to ${what}`, MAX_BODY);
    }
  }
}

/** The notification for one outbox row: its title, its one line, and the path a tap opens. */
export function notificationText(kind: NotificationKind, data: NotificationData, names: Record<UserId, string>): NotificationText {
  return { title: NOTIFICATION_TITLE, body: bodyFor(kind, data, names), path: pathFor(kind, data) };
}

/** The entry kinds a batch of the partner's changes is made of (S8 review: a bank import or a synced batch). */
export const ENTRY_KINDS: readonly NotificationKind[] = ['entry_added', 'entry_changed', 'entry_deleted', 'entry_restored'];
/** From this many of one person's entry changes waiting for the same person at once, they become one notification. */
export const BATCH_FROM = 3;

const BATCH_VERB: Partial<Record<NotificationKind, string>> = {
  entry_added: 'added', entry_changed: 'changed', entry_deleted: 'deleted', entry_restored: 'restored',
};

/**
 * One notification for a batch of the partner's entry changes ("each one at once" is for single changes): "Kim added
 * 30 entries · Sam owes Kim £…", "Kim changed 4 entries", or "Kim made 7 changes" when they are of different kinds.
 * The balance is the one given (the database's, at send time); a tap opens Activity.
 */
export function batchText(kinds: readonly NotificationKind[], data: NotificationData, names: Record<UserId, string>): NotificationText {
  const who = nameOf(names, data.actor);
  const n = kinds.length;
  const first = kinds[0];
  const verb = first !== undefined && kinds.every((k) => k === first) ? BATCH_VERB[first] : undefined;
  const what = verb ? `${who} ${verb} ${String(n)} ${n === 1 ? 'entry' : 'entries'}` : `${who} made ${String(n)} ${n === 1 ? 'change' : 'changes'}`;
  return { title: NOTIFICATION_TITLE, body: cut(`${what} · ${balanceWords(data.balance ?? {}, names)}`, MAX_BODY), path: '/activity' };
}
