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

export const reporter = createErrorReporter(window.localStorage, sink);

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (e) => void reporter.report(e.error ?? e.message, location.pathname));
  window.addEventListener('unhandledrejection', (e) => void reporter.report(e.reason, location.pathname));
  window.addEventListener('online', () => void reporter.flush());
}
