/**
 * How the screens put things into words (DESIGN §5: a sentence, not a statistic; names, never "you owe").
 * Pure functions over rows and people, so the wording is tested once and every screen says it the same way.
 * Figures come from the core (formatPence and the split maths); nothing here adds money up.
 */
import { balanceState, netPositions } from '../../core/balance';
import { formatDay, todayIn, type IsoDate } from '../../core/dates';
import { formatPence, pence, type Pence } from '../../core/money';
import type { SplitParams, UserId } from '../../core/split';
import { strings } from '../../ui/strings';

export interface Person {
  id: UserId;
  name: string;
  animal: 'cat' | 'dog';
}

export type NameOf = (id: UserId | null | undefined) => string;

/** A map of pence as the database stores it (JSON), read defensively: anything not a number counts as 0. */
export function penceOf(map: unknown, id: UserId): Pence {
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const v = (map as Record<string, unknown>)[id];
    if (typeof v === 'number' && Number.isSafeInteger(v)) return pence(v);
  }
  return pence(0);
}

/** Who paid an entry: the person with the largest part of `paid` (one payer per entry in v1, SPL-4). */
export function payerOf(paid: unknown, people: readonly Person[]): UserId | null {
  let best: { id: UserId; v: number } | null = null;
  for (const p of people) {
    const v = penceOf(paid, p.id);
    if (v > 0 && (best === null || v > best.v)) best = { id: p.id, v };
  }
  return best?.id ?? null;
}

/** "Jae £21.25, Sam £21.25", in the order the two joined. */
export function shareWords(shares: unknown, people: readonly Person[]): string {
  return people.map((p) => strings.entry.sharePart(p.name, formatPence(penceOf(shares, p.id)))).join(', ');
}

interface EntryLike {
  kind: string;
  split_mode: string;
  paid: unknown;
  shares: unknown;
}

/** The entry page's sentence (S2 brief): "Jae paid. Jae £21.25, Sam £21.25". */
export function entrySentence(row: EntryLike, people: readonly Person[]): string {
  const payer = payerOf(row.paid, people);
  const name = people.find((p) => p.id === payer)?.name ?? strings.history.someone;
  const other = people.find((p) => p.id !== payer)?.name ?? '';
  if (row.kind === 'money_back') return strings.entry.gotBackSentence(name, shareWords(row.shares, people));
  if (row.split_mode === 'for_other') return strings.entry.forSentence(name, other);
  if (row.split_mode === 'treat') return strings.entry.treatSentence(name);
  return strings.entry.paidSentence(name, shareWords(row.shares, people));
}

/**
 * The split in the live reading, from the payer's side and with names (Q-U5): "Jae 60 · Sam 40" (an even split
 * stays "50/50"), "Jae's treat", "for Sam".
 */
export function splitWords(split: SplitParams, payer: UserId, people: readonly Person[]): string {
  const other = people.find((p) => p.id !== payer);
  switch (split.mode) {
    case 'ratio': {
      const mine = split.ratio[payer] ?? (other ? 100 - (split.ratio[other.id] ?? 50) : 50);
      const name = people.find((p) => p.id === payer)?.name;
      if (mine === 50) return strings.reading.even;
      if (!other || name === undefined) return strings.reading.ratio(mine, 100 - mine);
      return strings.reading.shares(name, mine, other.name, 100 - mine);
    }
    case 'treat':
      return strings.reading.treat(people.find((p) => p.id === payer)?.name ?? '');
    case 'for_other':
      return strings.reading.forOther(other?.name ?? '');
    case 'exact':
      return strings.reading.exact;
  }
}

/**
 * Q-U9: what an entry alone leaves owing, "Sam owes Jae £21.25 for this", from the core's balance over this one
 * entry; null when it leaves nobody owing (a treat) or no longer counts.
 */
export function owesForThis(row: EntryLike & { deleted_at: string | null }, people: readonly Person[]): string | null {
  const [a, b] = people;
  if (!a || !b || row.deleted_at !== null) return null;
  const map = (m: unknown) => ({ [a.id]: penceOf(m, a.id), [b.id]: penceOf(m, b.id) });
  const kind = row.kind === 'money_back' ? 'money_back' : 'expense';
  const members = [a.id, b.id] as const;
  const state = balanceState(netPositions(members, [{ kind, paid: map(row.paid), shares: map(row.shares), deleted: false }], []), members);
  if (state.kind === 'square') return null;
  const name = (id: UserId) => people.find((p) => p.id === id)?.name ?? strings.history.someone;
  return strings.entry.owesForThis(name(state.debtor), name(state.creditor), formatPence(state.amount));
}

/** Q-L15: the plank described with people (BAL-3): "Jae, the cat, is owed; Sam, the dog, owes". */
export function plankWords(
  state: { kind: 'square' } | { kind: 'owes'; debtor: UserId; creditor: UserId },
  people: readonly Person[],
): string | null {
  const [a, b] = people;
  if (!a || !b) return null;
  const who = (p: Person) => strings.rig.person(p.name, strings.rig.kind[p.animal]);
  if (state.kind === 'square') return strings.rig.plankLevel(who(a), who(b));
  const owed = people.find((p) => p.id === state.creditor);
  const owes = people.find((p) => p.id === state.debtor);
  return owed && owes ? strings.rig.plankOwed(who(owed), who(owes)) : null;
}

/** The balance sentence's two parts (BAL-2): the words, and the amount drawn one step larger. */
export function balanceWords(
  state: { kind: 'square' } | { kind: 'owes'; debtor: UserId; creditor: UserId; amount: Pence },
  name: NameOf,
): { words: string; amount: string | null } {
  if (state.kind === 'square') return { words: strings.home.square, amount: null };
  return { words: strings.home.owes(name(state.debtor), name(state.creditor)), amount: formatPence(state.amount) };
}

// ───────────── history (ACT-2) ─────────────

export interface ActivityLike {
  actor: string | null;
  action: string;
  summary: unknown;
  at: string;
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A day inside a sentence: "today", "yesterday", or the date ("Mon 10 Nov"). */
export function dayInSentence(d: IsoDate, today: IsoDate): string {
  const day = formatDay(d, today);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
}

/** "today 18:02", "yesterday 18:02", "Mon 10 Nov 18:02": when, on this phone's calendar (DAT-1). */
export function whenWords(at: string, today: IsoDate, timeZone?: string): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return '';
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lowered = dayInSentence(todayIn(moment, zone), today);
  const time = timeZone ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(moment) : TIME.format(moment);
  return strings.history.when(lowered, time);
}

function field(summary: unknown, key: string): { before: unknown; after: unknown } | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const v = (summary as Record<string, unknown>)[key];
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('before' in v) || !('after' in v)) return null;
  return { before: v.before, after: v.after };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(strings.history.comma)}${strings.history.and}${parts[parts.length - 1] ?? ''}`;
}

/** What an edit changed, in words: "£42.50 to £45.20 and the category". */
function editWords(summary: unknown, people: readonly Person[]): string {
  const parts: string[] = [];
  const amount = field(summary, 'amount_pence');
  if (amount && typeof amount.before === 'number' && typeof amount.after === 'number') {
    parts.push(strings.history.amount(formatPence(pence(amount.before)), formatPence(pence(amount.after))));
  }
  if (field(summary, 'description')) parts.push(strings.history.description);
  if (field(summary, 'date')) parts.push(strings.history.date);
  if (field(summary, 'category_id')) parts.push(strings.history.category);
  const paid = field(summary, 'paid');
  const payerChanged = paid !== null && payerOf(paid.before, people) !== payerOf(paid.after, people);
  if (payerChanged) parts.push(strings.history.payer);
  const people2 = field(summary, 'from_user') ?? field(summary, 'to_user');
  if (people2) parts.push(strings.history.people);
  const mode = field(summary, 'split_mode');
  const params = field(summary, 'split_params');
  const shares = field(summary, 'shares');
  // Shares follow the amount: only a change of split itself is "the split".
  const splitChanged = (mode !== null && !same(mode.before, mode.after)) || (params !== null && !same(params.before, params.after))
    || (shares !== null && !amount && !payerChanged);
  if (splitChanged) parts.push(strings.history.split);
  if (field(summary, 'notes') ?? field(summary, 'note')) parts.push(strings.history.notes);
  if (field(summary, 'tags')) parts.push(strings.history.tags);
  // A regular payment's schedule (REC-1, REC-6).
  if (field(summary, 'frequency') ?? field(summary, 'every')) parts.push(strings.history.often);
  if (field(summary, 'start_date')) parts.push(strings.history.start);
  if (field(summary, 'end_date')) parts.push(strings.history.endDate);
  return parts.length > 0 ? listWords(parts) : strings.history.details;
}

/** REC-1: a regular payment paused or resumed and nothing else changed: "Jae paused it". */
function pausedOrResumed(summary: unknown, who: string): string | null {
  const active = field(summary, 'active');
  if (!active || typeof active.after !== 'boolean') return null;
  const others = Object.keys(summary as Record<string, unknown>).filter((k) => k !== 'active' && k !== 'posted_count');
  if (others.length > 0) return null;
  return active.after ? strings.history.resumed(who) : strings.history.paused(who);
}

/** One line of an entry's history (ACT-2): "Sam changed £42.50 to £45.20, yesterday 18:02". */
export function historyLine(a: ActivityLike, people: readonly Person[], today: IsoDate, timeZone?: string): string {
  const who = a.actor === null ? null : (people.find((p) => p.id === a.actor)?.name ?? strings.history.someone);
  let line: string;
  if (who === null) line = strings.history.automatic;
  else if (a.action === 'created') line = strings.history.added(who);
  else if (a.action === 'deleted') line = strings.history.deleted(who);
  else if (a.action === 'restored') line = strings.history.restored(who);
  else line = pausedOrResumed(a.summary, who) ?? strings.history.changed(who, editWords(a.summary, people));
  const when = whenWords(a.at, today, timeZone);
  return when ? strings.history.at(line, when) : line;
}

// ───────────── change requests (PPL-4, PPL-5) ─────────────

export interface RequestLike {
  requested_by: string;
  kind: string;
  payload: unknown;
}

function payloadOf(r: RequestLike): Record<string, unknown> {
  return r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : {};
}

/** "Jae 60 · Sam 40" for a ratio naming both people (Q-L9). */
export function ratioWords(ratio: unknown, people: readonly Person[]): string {
  const [a, b] = people;
  if (!a || !b || !ratio || typeof ratio !== 'object') return '';
  const r = ratio as Record<string, unknown>;
  const ap = typeof r[a.id] === 'number' ? r[a.id] as number : 50;
  const bp = typeof r[b.id] === 'number' ? r[b.id] as number : 100 - ap;
  return strings.settings.splitWords(a.name, ap, b.name, bp);
}

/** What a pending request asks, for the partner ("Sam asked to change their name to Sammy") or the requester. */
export function requestWords(r: RequestLike, people: readonly Person[], me: UserId): string {
  const p = payloadOf(r);
  const mine = r.requested_by === me;
  const who = people.find((x) => x.id === r.requested_by);
  const whoName = who?.name ?? strings.history.someone;
  if (r.kind === 'default_ratio') {
    const split = ratioWords(p['ratio'], people);
    return mine ? strings.settings.youAskedSplit(split) : strings.settings.askedSplit(whoName, split);
  }
  const name = typeof p['display_name'] === 'string' ? p['display_name'] : null;
  const animal = p['animal'] === 'cat' || p['animal'] === 'dog' ? p['animal'] : null;
  const newName = name !== null && name !== who?.name ? name : null;
  const newAnimal = animal !== null && animal !== who?.animal ? animal : null;
  if (newName !== null && newAnimal !== null) return mine ? strings.settings.youAskedBoth(newName, newAnimal) : strings.settings.askedBoth(whoName, newName, newAnimal);
  if (newAnimal !== null) return mine ? strings.settings.youAskedAnimal(newAnimal) : strings.settings.askedAnimal(whoName, newAnimal);
  const shown = newName ?? name ?? whoName;
  return mine ? strings.settings.youAskedName(shown) : strings.settings.askedName(whoName, shown);
}
