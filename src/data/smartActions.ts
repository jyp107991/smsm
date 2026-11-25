/**
 * S6a smart features, on the phone (docs/slices/S6.md; docs/AI.md): the per-phone switch, reading a receipt,
 * receipt photos (kept on the phone, uploaded ahead of the entry that names them), "Sort it later", loose wording and
 * the AI category guess. AI never writes money (non-negotiable 3): a reading fills a form a person saves; a guess
 * only sets a category, marked as a guess, and never over a person's choice.
 */
import seedList from '../../content/merchants.json';
import { checkReply, type AskReply, type ParseReply, type ScanReply } from '../core/aiReplies';
import { recapOf } from '../core/recap';
import { recapStats, wordingGuard, type RecapStats, type Wording } from '../core/wording';
import { createStore, del, get } from 'idb-keyval';
import type { Json } from './database.types';
import { toInsight, toSettle, toTemplate } from './insightRows';
import { suggest } from '../core/categorise';
import type { IsoDate } from '../core/dates';
import { scanGuards } from '../core/itemise';
import { readLoose } from '../core/loose';
import { pence, type Pence } from '../core/money';
import type { UserId } from '../core/split';
import { normaliseKey } from '../core/text';
import type { CategoryRow, ChapterRow, InboxItemRow, RecurringRow } from './api';
import { activeDataLayer } from './context';
import { keys } from './keys';
import { currentCountry, editExpense, learned } from './mutations';
import { receiptPath } from './photos';
import type { DataLayer } from './queryClient';
import { memoryMap } from './rows';
import type { AiReason } from './smart';
import { newId, overlay } from './writes';

const SEED: Readonly<Record<string, string>> = seedList;
const SMART_KEY = 'smsm-smart';
const listeners = new Set<() => void>();

type Result<T> = { ok: true; data: T } | { ok: false; reason: AiReason };

// ───────── the switch (per phone) ─────────

export function storedSmart(): boolean {
  try { return localStorage.getItem(SMART_KEY) === 'on'; } catch { return false; }
}

/** S6 "One switch": this phone sends photos and words to the AI (off until turned on; never sent to the server). */
export function setSmartFeatures(on: boolean): void {
  try {
    if (on) localStorage.setItem(SMART_KEY, 'on');
    else localStorage.removeItem(SMART_KEY);
  } catch { /* private mode: stays as it was */ }
  for (const cb of listeners) cb();
}

export function subscribeSmart(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === SMART_KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

// ───────── what the household has (names only are ever sent) ─────────

function rowsOf<R extends { id: string }>(layer: DataLayer, key: readonly unknown[], table: 'categories' | 'chapters' | 'inbox_items'): R[] {
  return overlay(layer.client.getQueryData<R[]>(key) ?? [], layer.waiting(), table);
}
function liveCategories(layer: DataLayer): CategoryRow[] {
  return rowsOf<CategoryRow>(layer, keys.categories(layer.me() ?? ''), 'categories').filter((c) => !c.archived);
}
function openChapters(layer: DataLayer): ChapterRow[] {
  return rowsOf<ChapterRow>(layer, keys.chapters(layer.me() ?? ''), 'chapters').filter((c) => !c.closed);
}
const byName = (rows: readonly { id: string; name: string }[], name: string | null) =>
  name === null ? null : (rows.find((r) => r.name === name) ?? rows.find((r) => normaliseKey(r.name) === normaliseKey(name)))?.id ?? null;

function ready(layer: DataLayer): boolean {
  return storedSmart() && layer.network.online;
}

// ───────── SCAN-1: read a receipt ─────────

/** SCAN-1, SCAN-5: the receipt's fields, or why not (the form then stays as it is, with the photo). Writes nothing. */
export async function readReceipt(photo: Blob, layer = activeDataLayer()): Promise<Result<ScanReply>> {
  if (!ready(layer)) return { ok: false, reason: 'off' };
  try {
    const small = await layer.downscale(photo);
    const categories = liveCategories(layer).map((c) => c.name);
    const res = await layer.ai.scan(small, { categories, today: layer.today(), country: currentCountry(layer) });
    if (!res.ok) return res;
    // AI.md rule 3: checked again on the phone; then the guards (dates, signs, names; low confidence is no reply).
    const reply = checkReply('scan', res.data);
    const guarded = reply ? scanGuards(reply, layer.today(), categories) : null;
    return guarded ? { ok: true, data: guarded as ScanReply } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ───────── photos ─────────

/** SCAN-1: shrinks the photo and keeps it on this phone only (nothing is queued); returns its future path. */
export async function keepPhoto(photo: Blob, layer = activeDataLayer()): Promise<string> {
  const hid = layer.householdId();
  if (!hid) throw new Error('Start or join a household first.');
  const small = await layer.downscale(photo);
  const path = receiptPath(hid);
  await layer.photos.put(path, small);
  return path;
}

/**
 * OFF-2: queues a kept photo's upload. Call it just before the write that names the photo: the upload sits ahead of
 * that write in the same ordered queue, so an entry never reaches the server before its photo.
 */
export function queuePhotoUpload(path: string, layer = activeDataLayer()): void {
  const uid = layer.me();
  if (!uid) throw new Error('Sign in first.');
  layer.enqueue({ opId: newId(), by: uid, table: 'receipts', op: 'upload', id: path, label: 'Receipt photo' });
}

/** SCAN-1, OFF-2: keep the photo on the phone and queue its upload at once; returns its path. */
export async function attachPhoto(photo: Blob, layer = activeDataLayer()): Promise<string> {
  const path = await keepPhoto(photo, layer);
  queuePhotoUpload(path, layer);
  return path;
}

/** A kept photo that was never saved with anything is let go from this phone. */
export function forgetPhoto(path: string, layer = activeDataLayer()): void {
  void layer.photos.remove?.(path).catch(() => undefined);
}

/** The photo as a Blob, for reading it again (this phone's copy, else downloaded from the bucket). */
export async function photoBlob(path: string, layer = activeDataLayer()): Promise<Blob | null> {
  const local = await layer.photos.get(path).catch(() => null);
  if (local) return local;
  if (!layer.network.online) return null;
  try {
    const res = await fetch(await layer.api.receiptUrl(path));
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** The photo to show: this phone's own copy while it has one, else a short-lived address from the server. */
export async function photoUrl(path: string, layer = activeDataLayer()): Promise<string | null> {
  const local = await layer.photos.get(path).catch(() => null);
  if (local) return URL.createObjectURL(local);
  if (!layer.network.online) return null;
  try { return await layer.api.receiptUrl(path); } catch { return null; }
}

/** SCAN-4: a photo already kept on this phone goes to the Inbox to sort later (offline too); saves no money. */
export function sortPhotoLater(path: string, layer = activeDataLayer()): string {
  const uid = layer.me() ?? '';
  queuePhotoUpload(path, layer);
  const stamp = layer.now().toISOString();
  const row: InboxItemRow = {
    id: newId(), household_id: layer.householdId() ?? '', source: 'scan', status: 'open', payload: {}, receipt_path: path,
    recurring_id: null, occurrence_date: null, external_id: null, expense_id: null, created_by: uid, created_at: stamp, updated_at: stamp,
  };
  layer.enqueue({ opId: newId(), by: uid, table: 'inbox_items', op: 'upsert', isNew: true, row, input: null });
  return row.id;
}

/** SCAN-4: the photo goes to the Inbox to sort later (offline too); saves no money. Returns the item's id. */
export async function sortLater(photo: Blob, layer = activeDataLayer()): Promise<string> {
  return sortPhotoLater(await keepPhoto(photo, layer), layer);
}

// ───────── ADD-9: loose wording ─────────

export interface LooseReading {
  amount: Pence | null;
  description: string | null;
  categoryId: string | null;
  payer: UserId | null;
  date: IsoDate | null;
  tags: string[];
  chapterId: string | null;
  split: ParseReply['split'];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** AI.md rule 4: the two people's names, as whole words in any case, become "A" (this phone's person) and "B". */
function masked(text: string, layer: DataLayer, prefix = ''): string {
  const me = layer.me();
  const members = layer.members();
  let words = text;
  for (const [m, label] of [[members.find((x) => x.user_id === me), 'A'], [members.find((x) => x.user_id !== me), 'B']] as const) {
    const name = m?.display_name?.trim();
    if (name) words = words.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu'), `${prefix}${label}`);
  }
  return words;
}

/** ADD-9: words the grammar couldn't read, read by the AI into the same form (never saved by itself). */
export async function parseLoose(text: string, layer = activeDataLayer()): Promise<Result<LooseReading>> {
  if (!ready(layer)) return { ok: false, reason: 'off' };
  const me = layer.me();
  const partner = layer.members().find((m) => m.user_id !== me);
  const words = masked(text, layer);
  const categories = liveCategories(layer);
  const chapters = openChapters(layer);
  try {
    const res = await layer.ai.parse(words, { categories: categories.map((c) => c.name), chapters: chapters.map((c) => c.name), today: layer.today() });
    if (!res.ok) return res;
    const checked = checkReply('parse', res.data);
    if (!checked) return { ok: false, reason: 'invalid' };
    // AI.md §3.2: the amount the words give wins over the AI's; a split needs words that say so (core/loose).
    const { reply: r, amountDisagreed } = readLoose(checked, words);
    // Seen in real use, so the AI's reading can be judged: no words, no amounts, nothing that identifies anyone.
    if (amountDisagreed) layer.report?.(new Error('loose wording: ai amount disagreed with the words'), { what: 'ai amount disagreed', task: 'parse' });
    const today = layer.today();
    const amount = r.amount_pence !== null && Number.isSafeInteger(r.amount_pence) && r.amount_pence > 0 ? pence(r.amount_pence) : null;
    const date = r.date !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= today ? r.date : null;
    return {
      ok: true,
      data: {
        amount,
        description: r.description?.trim() ? r.description.trim() : null,
        categoryId: byName(categories, r.category),
        payer: r.payer === 'A' ? (me ?? null) : r.payer === 'B' ? (partner?.user_id ?? null) : null,
        date,
        tags: r.tags ?? [],
        chapterId: byName(chapters, r.chapter),
        split: r.split,
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ───────── CAT-2 step 4: the AI guess ─────────

const isOther = (c: CategoryRow | undefined) => c !== undefined && normaliseKey(c.name) === 'other';

/**
 * CAT-2 step 4: after a save that steps 1–3 couldn't categorise, ask the AI; a household category comes back as a
 * guess (an edit by this phone, marked), remembered as the AI's so the same words never cost a second call.
 */
export async function guessCategory(expenseId: string, layer = activeDataLayer()): Promise<void> {
  if (!ready(layer)) return;
  const uid = layer.me();
  const hid = layer.householdId();
  if (!uid || !hid) return;
  const categories = liveCategories(layer);
  const unset = (id: string | null) => id === null || isOther(categories.find((c) => c.id === id));
  const row = layer.entries().find((e) => e.id === expenseId);
  if (!row || row.deleted_at !== null || !unset(row.category_id)) return;
  // Steps 1–3 first: memory, the household's history, the built-in list.
  const history = layer.entries()
    // S10 (REC-12): the household's shared history only; one person's own entries are theirs.
    .filter((e) => e.id !== expenseId && e.deleted_at === null && e.kind === 'expense' && (e.owner_id ?? null) === null)
    .map((e) => ({ description: e.description, categoryId: e.category_id }));
  const known = suggest(row.description, { memory: memoryMap(layer.memory()), history, seed: SEED, categories });
  if (known.categoryId !== null) return;
  try {
    const res = await layer.ai.categorise(masked(row.description, layer), categories.map((c) => c.name));
    if (!res.ok) return;
    const reply = checkReply('categorise', res.data);
    const categoryId = byName(categories, reply?.category ?? null);
    if (categoryId === null) return;
    // A person who chose a category meanwhile wins.
    const now = layer.entries().find((e) => e.id === expenseId);
    if (!now || now.deleted_at !== null || !unset(now.category_id)) return;
    editExpense(expenseId, { categoryId, categoryGuess: true }, layer);
    const key = normaliseKey(row.description);
    const before = learned(layer.memory(), key);
    if (key !== '' && before?.source !== 'user') {
      layer.remember({
        opId: newId(), by: uid,
        row: { household_id: hid, key, category_id: categoryId, split_mode: before?.split_mode ?? null, split_params: before?.split_params ?? null, uses: before?.uses ?? 0, source: 'ai' },
      });
    }
  } catch { /* the entry stays as saved */ }
}

// ───────── S6b, INS-2: the recap's wording ─────────

/** Months whose wording failed on this phone while the app runs (not asked again), and the one being asked now. */
const unworded = new WeakMap<DataLayer, Set<string>>();
const asking = new WeakMap<DataLayer, Map<string, Promise<Wording | null>>>();

/** The figures that make a month's wording true: kept wording is shown only while they are the same. */
const sameFigures = (kept: unknown, now: RecapStats) => {
  if (!kept || typeof kept !== 'object') return false;
  const k = kept as Partial<RecapStats>;
  return k.total === now.total && (k.paid === undefined || JSON.stringify(k.paid) === JSON.stringify(now.paid))
    && (k.bar === undefined || JSON.stringify(k.bar) === JSON.stringify(now.bar));
};

/** The two people as the wording names them: A joined first, so both phones read the same sentence. */
function inJoinOrder(layer: DataLayer): [{ id: UserId; name: string }, { id: UserId; name: string }] | null {
  const [a, b] = [...layer.members()].sort((x, y) => (x.joined_at < y.joined_at ? -1 : x.joined_at > y.joined_at ? 1 : 0));
  return a && b ? [{ id: a.user_id, name: a.display_name ?? '' }, { id: b.user_id, name: b.display_name ?? '' }] : null;
}

function wordingOf(prose: string | null): Wording | null {
  if (prose === null) return null;
  return checkReply('recap', prose);
}

/**
 * INS-2: a finished month's wording by the AI, guarded (every number is one of the month's own; no advice), with the
 * names put in; null for the template. Stored once per household (the first phone to ask keeps it, the other reads it).
 */
export async function recapWording(month: string, layer = activeDataLayer()): Promise<Wording | null> {
  if (!storedSmart()) return null;
  // One question per month at a time (the page re-renders as the household syncs; the AI is asked once).
  const inFlight = asking.get(layer) ?? new Map<string, Promise<Wording | null>>();
  asking.set(layer, inFlight);
  const pending = inFlight.get(month);
  if (pending) return pending;
  const run = wordMonth(month, layer).finally(() => { inFlight.delete(month); });
  inFlight.set(month, run);
  return run;
}

async function wordMonth(month: string, layer: DataLayer): Promise<Wording | null> {
  const today = layer.today();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= today.slice(0, 7)) return null;
  const failed = unworded.get(layer) ?? new Set<string>();
  unworded.set(layer, failed);
  const hid = layer.householdId();
  const people = inJoinOrder(layer);
  if (!hid || !people || failed.has(month)) return null;
  const categories = liveCategories(layer);
  // REC-7: a subscription is one in the Subscriptions category, archived or not.
  const allCategories = rowsOf<CategoryRow>(layer, keys.categories(layer.me() ?? ''), 'categories');
  // S10 review 4 (REC-12): the shared entries and regular payments only: nothing of one person's own reaches the AI.
  const shared = (r: { owner_id?: string | null }) => (r.owner_id ?? null) === null;
  const templates = (layer.client.getQueryData<RecurringRow[]>(keys.recurring(layer.me() ?? '')) ?? []).filter(shared);
  const recap = recapOf(
    layer.entries().filter(shared).map(toInsight), layer.settlements().map(toSettle), [people[0].id, people[1].id], month,
    { today, names: { [people[0].id]: people[0].name, [people[1].id]: people[1].name }, categories: categories.map((c) => ({ id: c.id, name: c.name })), templates: templates.map((t) => toTemplate(t, allCategories)) },
  );
  // AI.md rule 4: names in the notes (an entry's description) go as Person A / Person B, like everything else.
  const plain = recapStats(recap, [people[0].id, people[1].id]);
  const stats: RecapStats = { ...plain, notes: plain.notes.map((n) => masked(n, layer, 'Person ')), bar: plain.bar.map((b) => ({ ...b, name: masked(b.name, layer, 'Person ') })) };
  // A month with nothing spent together is the template's ("Nothing was spent together"); never asked.
  if (recap.total <= 0) return null;
  const names = { A: people[0].name, B: people[1].name };
  const shown = (w: Wording | null) => (w === null ? null : wordingGuard(stats, w, names));
  const give = (w: Wording | null) => { if (w === null) failed.add(month); return w; };
  if (!layer.network.online) return null;
  try {
    const keptRow = await layer.api.recapProse(hid, month);
    if (keptRow !== null) {
      // Kept wording is true only for the figures it was written for; an entry changed since: the template.
      if (!sameFigures(keptRow.stats, stats)) return give(null);
      return give(shown(wordingOf(keptRow.prose)));
    }
    const res = await layer.ai.recap(stats);
    const reply = res.ok ? checkReply('recap', res.data) : null;
    if (!reply || shown(reply) === null) return give(null);
    // Kept once for the household; the wording shown is whichever got there first.
    let prose = JSON.stringify(reply);
    try { prose = await layer.api.saveRecapProse(month, stats as unknown as Json, prose); } catch { /* shown anyway */ }
    return give(shown(wordingOf(prose)));
  } catch {
    return give(null);
  }
}

// ───────── S6b, INS-9: Ask smsm ─────────

/** INS-9: a question read by the AI into a closed filter (the app works out the figure); or why not. */
export async function askSmsm(question: string, layer = activeDataLayer()): Promise<Result<AskReply>> {
  if (!ready(layer)) return { ok: false, reason: 'off' };
  // S10 (REC-12): Ask answers about shared spending; one person's own entries are invisible to it.
  const countries = [...new Set(layer.entries().filter((e) => e.deleted_at === null && (e.owner_id ?? null) === null).map((e) => e.country))].sort();
  // A chapter named after a person ("Alex's birthday") goes masked like the question, and comes back by its own name.
  const chapterNames = rowsOf<ChapterRow>(layer, keys.chapters(layer.me() ?? ''), 'chapters').map((c) => c.name);
  const sentChapters = chapterNames.map((n) => masked(n, layer));
  try {
    const res = await layer.ai.ask(masked(question, layer), {
      categories: liveCategories(layer).map((c) => c.name),
      chapters: sentChapters,
      countries,
      today: layer.today(),
    });
    if (!res.ok) return res;
    const reply = checkReply('ask', res.data);
    if (!reply) return { ok: false, reason: 'invalid' };
    if ('unsupported' in reply || !reply.filters.chapters) return { ok: true, data: reply };
    const chapters = reply.filters.chapters.map((c) => chapterNames[sentChapters.indexOf(c)] ?? c);
    return { ok: true, data: { ...reply, filters: { ...reply.filters, chapters } } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ───────── S6b, ADD-8: shared into the app ─────────

/** ADD-8: what the service worker kept from the share sheet, read once and cleared (nothing is sent anywhere). */
export async function takeShared(layer = activeDataLayer()): Promise<{ photo?: Blob; text?: string } | null> {
  const store = createStore('smsm-shared', 'shared');
  let kept: { photo?: string | null; text?: string | null } | undefined;
  try { kept = await get(SHARED_KEY, store); } catch { return null; }
  if (!kept) return null;
  await del(SHARED_KEY, store).catch(() => undefined);
  const out: { photo?: Blob; text?: string } = {};
  if (kept.photo) {
    const photo = await layer.photos.get(kept.photo).catch(() => null);
    if (photo) out.photo = photo;
    void layer.photos.remove?.(kept.photo).catch(() => undefined);
  }
  if (kept.text && kept.text.trim() !== '') out.text = kept.text.trim();
  return out.photo || out.text ? out : null;
}
const SHARED_KEY = 'latest';
