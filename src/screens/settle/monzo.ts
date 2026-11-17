/**
 * SET-2: the Monzo handoff. smsm never moves money: it opens monzo.me with the amount filled in, and when
 * the person comes back asks "Did it go through?".
 *
 * S2 polish Q-U2: the question is kept on the phone in IndexedDB (through `idbStorage()`, the same place as
 * the household's copy), not in this tab's sessionStorage, so it survives the app being closed on the way
 * back from Monzo. After "Not yet" it is kept with `later: true`, and Home shows a quiet banner instead of
 * asking again, until the person answers Yes or Forget it. Signing out forgets it.
 *
 * An answer (Yes, Forget it) is also noted at once in localStorage (`markAnswered`): IndexedDB writes are
 * asynchronous, and an app closed a moment after the tap can lose the delete (CI run 44092991657). A question
 * found in the store that matches the note is treated as answered (`isAnswered`, checked as the app opens). Keeping a question (`savePending` with
 * one) clears the note, so a new question is always asked.
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
/** The last question answered on this phone (its id and what it said), kept where a write is immediate. */
const ANSWERED = 'smsm-monzo-answered';

/** What a question says, so a copy kept before it had an id still matches. */
function said(p: PendingMonzo): string {
  return [p.from, p.to, String(p.amount), p.date, p.note ?? ''].join('|');
}

/** Notes, synchronously, that this question has been answered (Yes or Forget it). Never throws. */
export function markAnswered(p: PendingMonzo): void {
  try {
    localStorage.setItem(ANSWERED, JSON.stringify({ id: p.id ?? null, said: said(p) }));
  } catch {
    /* no localStorage: the store's own delete is all there is */
  }
}

/** True when this question was answered on this phone (its store copy may have outlived the answer). */
export function isAnswered(p: PendingMonzo): boolean {
  try {
    const raw = localStorage.getItem(ANSWERED);
    if (!raw) return false;
    const note = JSON.parse(raw) as { id?: unknown; said?: unknown };
    return (typeof note.id === 'string' && note.id === p.id) || note.said === said(p);
  } catch {
    return false;
  }
}

function clearAnswered(): void {
  try {
    localStorage.removeItem(ANSWERED);
  } catch {
    /* nothing to clear */
  }
}

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
  // A question being kept is not answered (a new one, or "Not yet").
  if (p) clearAnswered();
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
