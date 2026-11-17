/**
 * SET-2: the Monzo handoff. smsm never moves money: it opens monzo.me with the amount filled in, and when
 * the person comes back asks "Did it go through?".
 *
 * S2 polish Q-U2: the question is kept on the phone in IndexedDB (through `idbStorage()`, the same place as
 * the household's copy), not in this tab's sessionStorage, so it survives the app being closed on the way
 * back from Monzo. After "Not yet" it is kept with `later: true`, and Home shows a quiet banner instead of
 * asking again, until the person answers Yes or Forget it. Signing out forgets it.
 */
import { formatPlainPounds, type Pence } from '../../core/money';
import { idbStorage, type PromiseStorage } from '../../data/storage';

export function monzoLink(username: string, amount: Pence): string {
  return `https://monzo.me/${encodeURIComponent(username)}/${formatPlainPounds(amount)}?d=smsm`;
}

export interface PendingMonzo {
  /**
   * The settle-up's row id, made once when "Pay with Monzo" is tapped: every place that answers Yes (the
   * sheet, the Home banner, after a restart, in another window) records this one row, so it is recorded once.
   * Missing only in a question kept by an earlier version; one is given when it is read.
   */
  id?: string;
  /** Who asked (the person signed in when Monzo was opened): only they are asked. */
  by?: string;
  from: string;
  to: string;
  amount: number;
  date: string;
  note: string | null;
  /** The person said "Not yet": Home shows the quiet banner rather than asking again. */
  later?: boolean;
}

const KEY = 'smsm-monzo-pending';

let store: PromiseStorage | null = null;
function storage(): PromiseStorage {
  store ??= idbStorage();
  return store;
}

/**
 * Where the question lives when IndexedDB can't be used (some private modes): it is still asked while the
 * app stays open, as before.
 */
let fallback: PendingMonzo | null = null;

/** Keeps the question (or forgets it, with null). Resolves once stored; never rejects. */
export async function savePending(p: PendingMonzo | null): Promise<void> {
  fallback = p;
  try {
    if (p) await storage().setItem(KEY, JSON.stringify(p));
    else await storage().removeItem(KEY);
    fallback = null;
  } catch {
    /* no IndexedDB: the copy in memory stands in */
  }
}

function read(raw: string | undefined | null): PendingMonzo | null {
  if (!raw) return null;
  const v = JSON.parse(raw) as Partial<PendingMonzo>;
  if (typeof v.from === 'string' && typeof v.to === 'string' && typeof v.amount === 'number' && Number.isSafeInteger(v.amount) && v.amount > 0 && typeof v.date === 'string') {
    const out: PendingMonzo = { from: v.from, to: v.to, amount: v.amount, date: v.date, note: typeof v.note === 'string' ? v.note : null };
    if (typeof v.id === 'string') out.id = v.id;
    if (typeof v.by === 'string') out.by = v.by;
    if (v.later === true) out.later = true;
    return out;
  }
  return null;
}

/** The question waiting on this phone, if any. Never rejects: unreadable means nothing to ask. */
export async function loadPending(): Promise<PendingMonzo | null> {
  try {
    return read(await storage().getItem(KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}
