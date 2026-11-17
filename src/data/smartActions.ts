/**
 * S6a smart features, on the phone (docs/slices/S6.md; docs/AI.md): the per-phone switch, reading a receipt,
 * receipt photos (kept on the phone, uploaded ahead of the entry that names them), "Sort it later", loose wording and
 * the AI category guess. AI never writes money (non-negotiable 3): a reading fills a form a person saves; a guess
 * only sets a category, marked as a guess, and never over a person's choice.
 */
import seedList from '../../content/merchants.json';
import { checkReply, type ParseReply, type ScanReply } from '../core/aiReplies';
import { suggest } from '../core/categorise';
import type { IsoDate } from '../core/dates';
import { scanGuards } from '../core/itemise';
import { pence, type Pence } from '../core/money';
import type { UserId } from '../core/split';
import { normaliseKey } from '../core/text';
import type { CategoryRow, ChapterRow, InboxItemRow } from './api';
import { activeDataLayer } from './context';
import { keys } from './keys';
import { currentCountry, editExpense } from './mutations';
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

/** ADD-9: words the grammar couldn't read, read by the AI into the same form (never saved by itself). */
export async function parseLoose(text: string, layer = activeDataLayer()): Promise<Result<LooseReading>> {
  if (!ready(layer)) return { ok: false, reason: 'off' };
  const me = layer.me();
  const members = layer.members();
  const partner = members.find((m) => m.user_id !== me);
  const mine = members.find((m) => m.user_id === me);
  // AI.md rule 4: people go as "A" (me) and "B" (partner), never by name.
  let words = text;
  for (const [m, label] of [[mine, 'A'], [partner, 'B']] as const) {
    const name = m?.display_name?.trim();
    if (name) words = words.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'giu'), label);
  }
  const categories = liveCategories(layer);
  const chapters = openChapters(layer);
  try {
    const res = await layer.ai.parse(words, { categories: categories.map((c) => c.name), chapters: chapters.map((c) => c.name), today: layer.today() });
    if (!res.ok) return res;
    const r = checkReply('parse', res.data);
    if (!r) return { ok: false, reason: 'invalid' };
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
    .filter((e) => e.id !== expenseId && e.deleted_at === null && e.kind === 'expense')
    .map((e) => ({ description: e.description, categoryId: e.category_id }));
  const known = suggest(row.description, { memory: memoryMap(layer.memory()), history, seed: SEED, categories });
  if (known.categoryId !== null) return;
  try {
    const res = await layer.ai.categorise(row.description, categories.map((c) => c.name));
    if (!res.ok) return;
    const reply = checkReply('categorise', res.data);
    const categoryId = byName(categories, reply?.category ?? null);
    if (categoryId === null) return;
    // A person who chose a category meanwhile wins.
    const now = layer.entries().find((e) => e.id === expenseId);
    if (!now || now.deleted_at !== null || !unset(now.category_id)) return;
    editExpense(expenseId, { categoryId, categoryGuess: true }, layer);
    const key = normaliseKey(row.description);
    const before = layer.memory().find((m) => m.key === key);
    if (key !== '' && before?.source !== 'user') {
      layer.remember({
        opId: newId(), by: uid,
        row: { household_id: hid, key, category_id: categoryId, split_mode: before?.split_mode ?? null, split_params: before?.split_params ?? null, uses: before?.uses ?? 0, source: 'ai' },
      });
    }
  } catch { /* the entry stays as saved */ }
}
