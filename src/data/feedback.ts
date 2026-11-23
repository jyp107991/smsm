/**
 * S9b (SPEC §6.4, "Report a problem"): a person's own words about something that went wrong, sent the same way as
 * the app's crash reports (client_errors, with the version and the page; ENGINEERING §6). Queued on the phone while
 * offline or signed out, and sent when it can be.
 */
import { reporter } from './reporting';

export async function reportProblem(words: string, route: string): Promise<'sent' | 'queued'> {
  const before = reporter.pending();
  await reporter.report(new Error(`Reported by a person: ${words.trim().slice(0, 2000)}`), route, { what: 'report a problem' });
  return reporter.pending() > before ? 'queued' : 'sent';
}
