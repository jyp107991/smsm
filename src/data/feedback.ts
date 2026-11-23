/**
 * S9b (SPEC §6.4, "Report a problem"): a person's own words about something that went wrong, sent the same way as
 * the app's crash reports (client_errors, with the version and the page; ENGINEERING §6). Queued on the phone while
 * offline or signed out, and sent when it can be.
 */
import { reporter } from './reporting';

/** 'sent' once the server has this very report; 'queued' while it waits on the phone (S9b review 6). */
export function reportProblem(words: string, route: string): Promise<'sent' | 'queued'> {
  return reporter.send(new Error(`Reported by a person: ${words.trim().slice(0, 2000)}`), route, { what: 'report a problem' });
}
