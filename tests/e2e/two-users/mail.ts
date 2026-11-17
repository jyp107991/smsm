/**
 * Sign-in codes from the local stack's mail catcher. Supabase CLI 3.2.0 runs Mailpit (image
 * axllent/mailpit:v1.31.3; `[local_smtp]` in config.toml, web port 54324 by default) and prints its address
 * as MAILPIT_URL in `supabase status -o env`. Mailpit's HTTP API (v1, from its swagger.json at v1.31.3):
 *   GET /api/v1/search?query=to:"<address>"  → { messages: [{ ID, To: [{ Address }], Subject, Created }] }, newest first
 *   GET /api/v1/message/{ID}                  → { Text, HTML, Subject, ... }
 *   DELETE /api/v1/search?query=…             → deletes the matching messages
 */
import { env } from './env';

interface MailpitAddress { Address: string; Name: string }
interface MailpitSummary { ID: string; To: MailpitAddress[] | null; Subject: string; Created: string }
interface MailpitSearch { messages: MailpitSummary[] | null; total: number }
interface MailpitMessage { ID: string; Subject: string; Text: string; HTML: string }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${env.mailpitUrl}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Mailpit ${path}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

const query = (address: string) => `query=${encodeURIComponent(`to:"${address}"`)}`;

/**
 * The 6-digit code in a sign-in email. Works for GoTrue's default templates ("…enter the code: 123456") and
 * for supabase/templates/code.html (the code alone in a large paragraph).
 */
export function extractCode(text: string): string | null {
  const labelled = /code(?:\s+is)?\s*:?\s*(?:<[^>]*>\s*)*(\d{6})(?!\d)/i.exec(text);
  if (labelled?.[1]) return labelled[1];
  const bare = /(?<![\d#&=/a-z])(\d{6})(?![\d])/i.exec(text.replace(/https?:\/\/\S+/g, ' '));
  return bare?.[1] ?? null;
}

/** Waits for a sign-in email to `address` that arrived after `after`, and returns its code. */
export async function waitForCode(address: string, after: Date, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  // Mailpit stores Created with millisecond precision from its own clock; allow a little skew.
  const since = after.getTime() - 2_000;
  for (;;) {
    const found = await getJson<MailpitSearch>(`/api/v1/search?${query(address)}&limit=10`);
    const fresh = (found.messages ?? []).filter((m) => Date.parse(m.Created) >= since);
    for (const m of fresh) {
      const full = await getJson<MailpitMessage>(`/api/v1/message/${encodeURIComponent(m.ID)}`);
      const code = extractCode(full.Text) ?? extractCode(full.HTML);
      if (code) return code;
    }
    if (Date.now() > deadline) throw new Error(`No sign-in code reached ${address} within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Removes every message to `address` (keeps the shared mailbox small between scenarios). */
export async function clearMail(address: string): Promise<void> {
  await fetch(`${env.mailpitUrl}/api/v1/search?${query(address)}`, { method: 'DELETE' });
}
