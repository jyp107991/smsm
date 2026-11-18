/**
 * S8 core (docs/slices/S8.md "Decisions made here → Words, Tapping", "Data → Core", "Tests → Core"; SPEC NOT-1, NOT-2,
 * ACT-4; DESIGN §5): the words and the path of every notification. The push function imports this module (one
 * source of truth), so what is tested here is what a phone shows. Written before the build (ENGINEERING §5, tests
 * first by someone else).
 *
 * Interface these tests expect, in src/core/notify.ts (pure; no I/O, no clock; integer pence):
 *
 *   notificationText(kind: NotificationKind, data: NotificationData, names: Record<UserId, string>)
 *     → { title: string; body: string; path: string }
 *   balanceWords(balance: Record<UserId, Pence>, names: Record<UserId, string>) → string
 *     "Sam owes Jae £24.50" / "All square": exactly the app's balance sentence (src/screens/shared/words.ts
 *     balanceWords, words + amount), from the two people's nets as member_net gives them (positive = owed).
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these; the SQL test, the push
 * function's test and the service worker's test use the same names):
 *   - NotificationKind, one per thing that is sent (the outbox's `kind` column holds the same strings):
 *       'entry_added' | 'entry_changed' | 'entry_deleted' | 'entry_restored'      (switch "Entries")
 *       'settle_added' | 'settle_changed' | 'settle_deleted'                       (switch "Settle-ups")
 *       'comment'                                                                  (switch "Comments")
 *       'bill_posted'                                                              (switch "Bills posted today")
 *       'bill_tomorrow'                                                            (switch "Bills tomorrow")
 *       'recap_ready' | 'settle_day'                                               (switch "Recap and settle day")
 *       'balance_reminder'                                                         (switch "Balance reminder")
 *       'approval_waiting' | 'approval_decided'                                    (always on)
 *   - NotificationData (every field optional; each kind reads what it needs):
 *       actor: UserId | null            who did it (null for the daily ones)
 *       ref: string | null              the entry, settle-up, change request or regular payment it is about; for a
 *                                       comment, the ENTRY's id (the path opens the entry's comments)
 *       description: string             the entry's or the bill's description
 *       amount: Pence                   the entry's, settle-up's or bill's amount (after the change, for *_changed)
 *       comment: string                 the comment's words
 *       month: 'YYYY-MM'                recap_ready: the month the recap is for
 *       request: 'identity' | 'default_ratio'   approvals: what was asked
 *       approved: boolean               approval_decided: yes or no
 *       balance: Record<UserId, Pence>  both people's nets now (member_net); money notifications end with its words
 *       threshold: Pence                balance_reminder: the person's chosen amount
 *   - body is the sentence the brief gives (the whole notification text, ≤ 180 characters); title is the
 *     builder's (not checked beyond: present, short, no "you").
 *   - Kinds the brief gives no example for are checked by shape only: entry_restored ("Sam restored Tesco £42.50 · …"
 *     suggested), settle_changed, settle_deleted, approval_decided, and approval_waiting for an identity change.
 *   - The comment's quotation marks may be straight or curly; so may the apostrophe in "October’s".
 *   - The recap path: the brief says /insights/recap/<YYYY-MM>, but the app's recap route is /recap/<YYYY-MM>
 *     (src/ui/router.ts); either is accepted here, and src/screens/s8.test.tsx checks that the path opens the recap.
 *   - Whitespace in a description or comment (newlines too) is shown as single spaces: a body is one line.
 *   - "≤ 180 characters" is counted in code points; a cut never splits a surrogate pair (the body is well formed).
 *
 * Until src/core/notify.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceState } from './balance';
import { formatPence, pence, type Pence } from './money';
import type { UserId } from './split';
import { balanceWords as appBalanceWords } from '../screens/shared/words';

type NotificationKind =
  | 'entry_added' | 'entry_changed' | 'entry_deleted' | 'entry_restored'
  | 'settle_added' | 'settle_changed' | 'settle_deleted'
  | 'comment' | 'bill_posted' | 'bill_tomorrow' | 'recap_ready' | 'settle_day' | 'balance_reminder'
  | 'approval_waiting' | 'approval_decided';
interface NotificationData {
  actor?: UserId | null; ref?: string | null; description?: string; amount?: Pence; comment?: string; month?: string;
  request?: 'identity' | 'default_ratio'; approved?: boolean; balance?: Record<UserId, Pence>; threshold?: Pence;
}
interface NotificationText { title: string; body: string; path: string }
interface NotifyCore {
  notificationText(kind: NotificationKind, data: NotificationData, names: Record<UserId, string>): NotificationText;
  balanceWords(balance: Record<UserId, Pence>, names: Record<UserId, string>): string;
}

const NOTIFY = './notify';
const loaded = (await import(/* @vite-ignore */ NOTIFY).catch(() => null)) as Partial<NotifyCore> | null;
function core(): NotifyCore {
  if (typeof loaded?.notificationText !== 'function' || typeof loaded.balanceWords !== 'function') {
    throw new Error('src/core/notify.ts does not export notificationText and balanceWords yet (S8)');
  }
  return loaded as NotifyCore;
}
const text = (kind: NotificationKind, data: NotificationData, names: Record<UserId, string> = NAMES) => core().notificationText(kind, data, names);

const JAE: UserId = '00000000-0000-4000-8000-0000000000a1';
const SAM: UserId = '00000000-0000-4000-8000-0000000000b1';
const NAMES: Record<UserId, string> = { [JAE]: 'Jae', [SAM]: 'Sam' };
const ENTRY = '00000000-0000-4000-8000-00000000e001';
const SETTLE = '00000000-0000-4000-8000-00000000f001';
const REQUEST = '00000000-0000-4000-8000-00000000c0d1';
const BILL = '00000000-0000-4000-8000-00000000d001';
/** Sam owes Jae £24.50. */
const OWES: Record<UserId, Pence> = { [JAE]: pence(2450), [SAM]: pence(-2450) };
const SQUARE: Record<UserId, Pence> = { [JAE]: pence(0), [SAM]: pence(0) };
const SAM_OWES = 'Sam owes Jae £24.50';

const KINDS: readonly NotificationKind[] = [
  'entry_added', 'entry_changed', 'entry_deleted', 'entry_restored', 'settle_added', 'settle_changed', 'settle_deleted',
  'comment', 'bill_posted', 'bill_tomorrow', 'recap_ready', 'settle_day', 'balance_reminder', 'approval_waiting', 'approval_decided',
];
/** A full set of data for each kind, Sam acting (the partner of Jae, who receives it). */
function sample(kind: NotificationKind, over: NotificationData = {}): NotificationData {
  const base: NotificationData = { actor: SAM, balance: OWES };
  switch (kind) {
    case 'entry_added': case 'entry_changed': case 'entry_deleted': case 'entry_restored':
      return { ...base, ref: ENTRY, description: 'Tesco', amount: pence(4250), ...over };
    case 'settle_added': case 'settle_changed': case 'settle_deleted':
      return { ...base, ref: SETTLE, amount: pence(3000), ...over };
    case 'comment':
      return { ...base, ref: ENTRY, description: 'Tesco', comment: 'was this the big shop?', ...over };
    case 'bill_posted':
      return { actor: null, balance: OWES, ref: BILL, description: 'Rent', amount: pence(120000), ...over };
    case 'bill_tomorrow':
      return { actor: null, ref: BILL, description: 'Water', amount: pence(2874), ...over };
    case 'recap_ready':
      return { actor: null, month: '2026-10', ...over };
    case 'settle_day':
      return { actor: null, balance: OWES, ...over };
    case 'balance_reminder':
      return { actor: null, balance: OWES, threshold: pence(10000), ...over };
    case 'approval_waiting':
      return { ...base, ref: REQUEST, request: 'default_ratio', ...over };
    case 'approval_decided':
      return { actor: JAE, ref: REQUEST, request: 'default_ratio', approved: true, ...over };
  }
}
const MONEY_KINDS: readonly NotificationKind[] = ['entry_added', 'entry_changed', 'entry_deleted', 'entry_restored', 'settle_added', 'settle_changed', 'settle_deleted', 'bill_posted'];
const codePoints = (s: string) => Array.from(s).length;

// ─────────────────────────────── NOT-1: the words of each kind ───────────────────────────────

describe('notificationText: what each notification says (NOT-1; the brief’s examples, word for word)', () => {
  it('NOT-1: the partner added an entry: "Sam added Tesco £42.50 · Sam owes Jae £24.50"', () => {
    expect(text('entry_added', sample('entry_added')).body).toBe('Sam added Tesco £42.50 · Sam owes Jae £24.50');
  });

  it('NOT-1: the partner changed an entry: "Sam changed Tesco to £45.20 · …" (the amount after the change)', () => {
    expect(text('entry_changed', sample('entry_changed', { amount: pence(4520) })).body).toBe('Sam changed Tesco to £45.20 · Sam owes Jae £24.50');
  });

  it('NOT-1: the partner deleted an entry: "Sam deleted Tesco £42.50 · …"', () => {
    expect(text('entry_deleted', sample('entry_deleted')).body).toBe('Sam deleted Tesco £42.50 · Sam owes Jae £24.50');
  });

  it('NOT-1: the partner restored an entry: Sam’s name, the entry and its amount, then the balance', () => {
    const { body } = text('entry_restored', sample('entry_restored'));
    expect(body).toMatch(/^Sam restored Tesco\b/);
    expect(body).toContain('£42.50');
    expect(body.endsWith(` · ${SAM_OWES}`)).toBe(true);
  });

  it('NOT-1: the partner recorded a settle-up: "Sam settled up £30.00 · All square"', () => {
    expect(text('settle_added', sample('settle_added', { balance: SQUARE })).body).toBe('Sam settled up £30.00 · All square');
  });

  it('NOT-1: the partner changed or deleted a settle-up: Sam’s name, the amount, then the balance; the two read differently', () => {
    const changed = text('settle_changed', sample('settle_changed', { amount: pence(3500) })).body;
    const deleted = text('settle_deleted', sample('settle_deleted')).body;
    expect(changed).toMatch(/^Sam /);
    expect(changed).toContain('£35.00');
    expect(changed.endsWith(` · ${SAM_OWES}`)).toBe(true);
    expect(deleted).toMatch(/^Sam /);
    expect(deleted).toContain('£30.00');
    expect(deleted.endsWith(` · ${SAM_OWES}`)).toBe(true);
    expect(changed).not.toBe(deleted.replace('£30.00', '£35.00'));
  });

  it('NOT-1 ACT-4: the partner commented: Sam commented on Tesco: "was this the big shop?" (not money: no balance)', () => {
    const { body } = text('comment', sample('comment'));
    expect(body).toMatch(/^Sam commented on Tesco: ["“]was this the big shop\?["”]$/);
    expect(body).not.toContain(' · ');
  });

  it('NOT-1: a shared regular payment posted today: "Rent £1,200.00 posted today · …"', () => {
    expect(text('bill_posted', sample('bill_posted')).body).toBe('Rent £1,200.00 posted today · Sam owes Jae £24.50');
  });

  it('NOT-1: a shared bill posts tomorrow: "Water £28.74 posts tomorrow" (nothing has changed the balance yet: no balance)', () => {
    expect(text('bill_tomorrow', sample('bill_tomorrow')).body).toBe('Water £28.74 posts tomorrow');
  });

  it('NOT-1: the recap is ready: "October’s recap is ready", the month named in words', () => {
    expect(text('recap_ready', sample('recap_ready')).body).toMatch(/^October[’']s recap is ready$/);
    expect(text('recap_ready', sample('recap_ready', { month: '2027-01' })).body).toMatch(/^January[’']s recap is ready$/);
  });

  it('NOT-1: settle day: "Settle day: Sam owes Jae £24.50"', () => {
    expect(text('settle_day', sample('settle_day')).body).toBe('Settle day: Sam owes Jae £24.50');
  });

  it('NOT-1: the balance has been above the chosen amount for 30 days: "Sam has owed Jae more than £100.00 for 30 days"', () => {
    expect(text('balance_reminder', sample('balance_reminder')).body).toBe('Sam has owed Jae more than £100.00 for 30 days');
    const other = text('balance_reminder', sample('balance_reminder', { balance: { [JAE]: pence(-30000), [SAM]: pence(30000) }, threshold: pence(25000) })).body;
    expect(other).toBe('Jae has owed Sam more than £250.00 for 30 days');
  });

  it('NOT-1: a change request is waiting: "Sam asked to change the default split"', () => {
    expect(text('approval_waiting', sample('approval_waiting')).body).toBe('Sam asked to change the default split');
    expect(text('approval_waiting', sample('approval_waiting', { request: 'identity' })).body).toMatch(/^Sam asked to /);
  });

  it('NOT-1: a decision on one’s request: the partner’s name, and yes and no read differently', () => {
    const yes = text('approval_decided', sample('approval_decided', { approved: true })).body;
    const no = text('approval_decided', sample('approval_decided', { approved: false })).body;
    expect(yes).toMatch(/^Jae /);
    expect(no).toMatch(/^Jae /);
    expect(yes).not.toBe(no);
  });
});

// ─────────────────────────────── NOT-1: the balance in words ───────────────────────────────

describe('balanceWords: the balance as the app says it (NOT-1; BAL-2 words)', () => {
  it('NOT-1: "Sam owes Jae £24.50", "Jae owes Sam £1,200.00", "All square"', () => {
    expect(core().balanceWords(OWES, NAMES)).toBe('Sam owes Jae £24.50');
    expect(core().balanceWords({ [JAE]: pence(-120000), [SAM]: pence(120000) }, NAMES)).toBe('Jae owes Sam £1,200.00');
    expect(core().balanceWords(SQUARE, NAMES)).toBe('All square');
  });

  it('NOT-1: pence are always shown, as the app shows them', () => {
    expect(core().balanceWords({ [JAE]: pence(5), [SAM]: pence(-5) }, NAMES)).toBe('Sam owes Jae £0.05');
    expect(core().balanceWords({ [JAE]: pence(100), [SAM]: pence(-100) }, NAMES)).toBe('Sam owes Jae £1.00');
  });

  it('NOT-1: for any balance, exactly the sentence Home shows (src/screens/shared/words.ts)', () => {
    fc.assert(fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (n) => {
      const nets = { [JAE]: pence(n + 0), [SAM]: pence(-n + 0) };
      const w = appBalanceWords(balanceState(nets, [JAE, SAM]), (id) => NAMES[id ?? ''] ?? '');
      expect(core().balanceWords(nets, NAMES)).toBe(`${w.words}${w.amount ?? ''}`);
    }), { seed: 8001, numRuns: 300 });
  });

  it('NOT-1: every money notification ends with the balance in words; the others don’t carry it', () => {
    for (const kind of KINDS) {
      const { body } = text(kind, sample(kind));
      if (MONEY_KINDS.includes(kind)) expect(body.endsWith(` · ${SAM_OWES}`), `${kind}: ${body}`).toBe(true);
      else if (kind !== 'settle_day' && kind !== 'balance_reminder') expect(body, kind).not.toContain(' · ');
    }
  });

  it('NOT-1: the balance is the one given (the database’s, at send time), not worked out from the entry', () => {
    const later = { [JAE]: pence(-1999), [SAM]: pence(1999) };
    expect(text('entry_added', sample('entry_added', { balance: later })).body).toBe('Sam added Tesco £42.50 · Jae owes Sam £19.99');
  });
});

// ─────────────────────────────── DESIGN §5: names, sentence case ───────────────────────────────

describe('notificationText: the voice (NOT-1; DESIGN §5: names, never "you"; sentence case; amounts as the app writes them)', () => {
  it('NOT-1: every kind uses names, never "you"; one line, sentence case, a title', () => {
    for (const kind of KINDS) {
      const { title, body } = text(kind, sample(kind));
      expect(body, kind).not.toMatch(/\byou(r|rs)?\b/i);
      expect(title, kind).not.toMatch(/\byou(r|rs)?\b/i);
      expect(body.trim(), kind).toBe(body);
      expect(body, kind).not.toMatch(/\s{2}|\n/);
      expect(body.charAt(0), kind).toBe(body.charAt(0).toUpperCase());
      expect(title.trim().length, kind).toBeGreaterThan(0);
      expect(codePoints(title), kind).toBeLessThanOrEqual(60);
      // Sentence case: no word after the first is capitalised unless it is a name or a month.
      const rest = body.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w));
      for (const w of rest) expect(['Sam', 'Jae', 'Tesco', 'Rent', 'Water', 'All', 'October'], `${kind}: "${w}" in ${body}`).toContain(w.replace(/[’']s\b.*$/u, '').replace(/[^\p{L}]/gu, ''));
    }
  });

  it('NOT-1: the partner’s own names, in any language', () => {
    const names = { [JAE]: '재', [SAM]: '샘' };
    expect(text('entry_added', sample('entry_added', { description: '편의점' }), names).body).toBe('샘 added 편의점 £42.50 · 샘 owes 재 £24.50');
  });

  it('NOT-1: amounts are formatPence’s, at every size', () => {
    for (const amount of [1, 99, 100, 4250, 100000, 123456, 99999999]) {
      expect(text('entry_added', sample('entry_added', { amount: pence(amount) })).body).toContain(` ${formatPence(pence(amount))} · `);
    }
  });

  it('NOT-1: the same data gives the same words (no clock, nothing random)', () => {
    for (const kind of KINDS) expect(text(kind, sample(kind))).toEqual(text(kind, sample(kind)));
  });

  it('NOT-1: whitespace in a description or comment becomes single spaces', () => {
    expect(text('comment', sample('comment', { comment: 'was this\nthe   big shop?' })).body).toMatch(/^Sam commented on Tesco: ["“]was this the big shop\?["”]$/);
    expect(text('entry_added', sample('entry_added', { description: '  Tesco \n Metro ' })).body).toBe('Sam added Tesco Metro £42.50 · Sam owes Jae £24.50');
  });
});

// ─────────────────────────────── NOT-1: at most 180 characters ───────────────────────────────

describe('notificationText: at most 180 characters, a long description cut with "…" (NOT-1)', () => {
  const LONG = 'The big monthly shop with everything for the party on Saturday, the cleaning things, the cat food and the dog food, '.repeat(3);

  it('NOT-1: a long description is cut with "…"; the amount and the balance stay whole', () => {
    const { body } = text('entry_added', sample('entry_added', { description: LONG }));
    expect(codePoints(body)).toBeLessThanOrEqual(180);
    expect(body).toMatch(/^Sam added The big monthly shop/);
    expect(body).toContain('…');
    expect(body.endsWith(`£42.50 · ${SAM_OWES}`)).toBe(true);
  });

  it('NOT-1 ACT-4: a long comment is cut with "…" too', () => {
    const { body } = text('comment', sample('comment', { comment: LONG }));
    expect(codePoints(body)).toBeLessThanOrEqual(180);
    expect(body).toMatch(/^Sam commented on Tesco: ["“]The big monthly shop/);
    expect(body).toContain('…');
  });

  it('NOT-1: a short one is never cut', () => {
    for (const kind of KINDS) expect(text(kind, sample(kind)).body, kind).not.toContain('…');
    const exactly = 'x'.repeat(180 - codePoints('Sam added  £42.50 · Sam owes Jae £24.50'));
    const { body } = text('entry_added', sample('entry_added', { description: exactly }));
    expect(body).toBe(`Sam added ${exactly} £42.50 · Sam owes Jae £24.50`);
    expect(codePoints(body)).toBe(180);
  });

  it('NOT-1: for any description, comment and names: ≤ 180 characters, well formed, money ones still end with the balance', () => {
    const word = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 300 }).filter((s) => s.trim() !== '');
    // Names are 1–24 characters (members.display_name), in any language.
    const name = fc.constantFrom('Jae', 'Sam', '재', '샘', 'Ana-Lúcia', 'Maximiliana Alexandrovna', '👩🏽‍💻 Robin', 'ジェイ');
    fc.assert(fc.property(
      fc.constantFrom(...KINDS), word, word, name, name, fc.integer({ min: 1, max: 100_000_000 }), fc.integer({ min: -100_000_000, max: 100_000_000 }),
      (kind, description, comment, a, b, amount, net) => {
        fc.pre(a !== b);
        const names = { [JAE]: a, [SAM]: b };
        const balance = { [JAE]: pence(net + 0), [SAM]: pence(-net + 0) };
        const { body, path } = text(kind, sample(kind, { description, comment, amount: pence(amount), balance }), names);
        expect(codePoints(body)).toBeLessThanOrEqual(180);
        expect(body.isWellFormed()).toBe(true);
        expect(path.startsWith('/')).toBe(true);
        if (MONEY_KINDS.includes(kind)) expect(body.endsWith(` · ${core().balanceWords(balance, names)}`), body).toBe(true);
      },
    ), { seed: 8002, numRuns: 400 });
  });
});

// ─────────────────────────────── NOT-2: where a tap goes ───────────────────────────────

describe('notificationText: the path a tap opens (NOT-2)', () => {
  it('NOT-2: an entry → /entry/<id> (deleted ones too: the entry page offers Restore)', () => {
    for (const kind of ['entry_added', 'entry_changed', 'entry_deleted', 'entry_restored'] as const) {
      expect(text(kind, sample(kind)).path, kind).toBe(`/entry/${ENTRY}`);
    }
  });

  it('NOT-2: a settle-up → /activity', () => {
    for (const kind of ['settle_added', 'settle_changed', 'settle_deleted'] as const) expect(text(kind, sample(kind)).path, kind).toBe('/activity');
  });

  it('NOT-2 ACT-4: a comment → /entry/<id>#comments', () => {
    expect(text('comment', sample('comment')).path).toBe(`/entry/${ENTRY}#comments`);
  });

  it('NOT-2: an approval, waiting or decided → /settings#approvals', () => {
    expect(text('approval_waiting', sample('approval_waiting')).path).toBe('/settings#approvals');
    expect(text('approval_decided', sample('approval_decided')).path).toBe('/settings#approvals');
  });

  it('NOT-2: a bill → /bills', () => {
    expect(text('bill_posted', sample('bill_posted')).path).toBe('/bills');
    expect(text('bill_tomorrow', sample('bill_tomorrow')).path).toBe('/bills');
  });

  it('NOT-2: the recap → that month’s recap page', () => {
    expect(['/recap/2026-10', '/insights/recap/2026-10']).toContain(text('recap_ready', sample('recap_ready')).path);
    expect(['/recap/2027-01', '/insights/recap/2027-01']).toContain(text('recap_ready', sample('recap_ready', { month: '2027-01' })).path);
  });

  it('NOT-2: settle day and the balance reminder → Home', () => {
    expect(text('settle_day', sample('settle_day')).path).toBe('/');
    expect(text('balance_reminder', sample('balance_reminder')).path).toBe('/');
  });

  it('NOT-2: an id is put in the path safely', () => {
    expect(text('entry_added', sample('entry_added', { ref: 'a b/c' })).path).toBe(`/entry/${encodeURIComponent('a b/c')}`);
  });
});
