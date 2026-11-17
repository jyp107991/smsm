/**
 * SET-2: the Monzo handoff. smsm never moves money: it opens monzo.me with the amount filled in, and when
 * the person comes back asks "Did it go through?". The question survives the page being reloaded on the
 * way back (some phones reopen the app), held in sessionStorage for this tab only.
 */
import { formatPlainPounds, type Pence } from '../../core/money';

export function monzoLink(username: string, amount: Pence): string {
  return `https://monzo.me/${encodeURIComponent(username)}/${formatPlainPounds(amount)}?d=smsm`;
}

export interface PendingMonzo {
  from: string;
  to: string;
  amount: number;
  date: string;
  note: string | null;
}

const KEY = 'smsm-monzo-pending';

export function savePending(p: PendingMonzo | null): void {
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* no session storage (private mode): the question is still asked while the page stays open */
  }
}

export function loadPending(): PendingMonzo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingMonzo>;
    if (typeof v.from === 'string' && typeof v.to === 'string' && typeof v.amount === 'number' && Number.isSafeInteger(v.amount) && v.amount > 0 && typeof v.date === 'string') {
      return { from: v.from, to: v.to, amount: v.amount, date: v.date, note: typeof v.note === 'string' ? v.note : null };
    }
  } catch {
    /* unreadable: ask nothing */
  }
  return null;
}
