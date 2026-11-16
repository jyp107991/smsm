import { createErrorReporter, type ErrorSink } from './errors';
import { supabase } from './supabase';

const sink = (): ErrorSink | null => {
  const db = supabase();
  if (!db) return null;
  return async (rows) => {
    const { data } = await db.auth.getSession();
    if (!data.session) return false; // client_errors accepts signed-in reports only
    const { error } = await db.from('client_errors').insert(rows.map((r) => ({ ...r, context: r.context as never })));
    return !error;
  };
};

/** localStorage, or an in-memory stand-in when the browser blocks storage (the getter itself can throw). */
function safeStorage(): Storage {
  try {
    const s = window.localStorage;
    s.getItem('smsm.probe');
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      get length() { return mem.size; },
      clear: () => { mem.clear(); },
      getItem: (k) => mem.get(k) ?? null,
      key: (i) => [...mem.keys()][i] ?? null,
      removeItem: (k) => { mem.delete(k); },
      setItem: (k, v) => { mem.set(k, v); },
    };
  }
}

export const reporter = createErrorReporter(safeStorage(), sink);

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (e) => void reporter.report(e.error ?? e.message, location.pathname));
  window.addEventListener('unhandledrejection', (e) => void reporter.report(e.reason, location.pathname));
  window.addEventListener('online', () => void reporter.flush());
  // Send anything queued by an earlier visit (S2 also flushes after sign-in).
  void reporter.flush();
}
