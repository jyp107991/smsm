/**
 * S4a data layer (docs/slices/S4.md "Interfaces → Data", "Decisions made here"): chapters saved and closed
 * through the persisted queue (offline too), read with waiting writes applied, entries carrying their chapter,
 * and "current chapter" kept per phone. Written before the build (ENGINEERING §5, tests first by someone else);
 * each test names its SPEC ids and fails because the functions, hooks and table below don't exist yet.
 *
 * Interface these tests expect (exported from src/data/index.ts):
 *   useChapters(): DataResult<ChapterRow[]>        every chapter, closed ones included, waiting writes applied
 *   saveChapter({ name, emoji, kind, country, startDate, endDate, id? }, layer?): string
 *     CHP-1: adds (or with an existing id, edits) a chapter; returns its id; through the queue (MoneyOp table
 *     'chapters', upsert by the phone-made id), so the same form saved twice is one chapter (Q-F1).
 *   closeChapter(id, closed = true, layer?): boolean   CHP-3: closed true/false; true when something changed
 *   ExpenseDraft.chapterId?: string | null              CHP-2: addExpense / editExpense store it as chapter_id
 *   setCurrentChapter(id | null): void / useCurrentChapter(): string | null
 *     CHP-2: per phone, in localStorage 'smsm-current-chapter'; a closed chapter is never current.
 *   Memory Api: MemoryTables gains `chapters: ChapterRow[]`; Api gains `upsertChapter(row)`. Nothing is
 *   ever hard-deleted.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, TODAY, type ChapterRow } from '../../tests/fixtures/couple';
import type { IsoDate } from '../core/dates';
import { pence } from '../core/money';
import { DataProvider } from './DataProvider';
import * as hooksModule from './hooks';
import type { DataResult } from './hooks';
import * as dataIndex from './index';
import type { MemoryTables } from './memoryApi';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import { memoryStorage } from './storage';
import type { ExpenseDraft } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
interface ChapterDraft {
  name: string; emoji: string; kind: 'trip' | 'project'; country: string | null; startDate: IsoDate | null; endDate: IsoDate | null;
}
interface S4Mutations {
  saveChapter(input: ChapterDraft & { id?: string }, layer?: DataLayer): string;
  closeChapter(id: string, closed?: boolean, layer?: DataLayer): boolean;
}
interface S4Data {
  useChapters(): DataResult<ChapterRow[]>;
  setCurrentChapter(id: string | null): void;
  useCurrentChapter(): string | null;
}
type S4Draft = ExpenseDraft & { chapterId?: string | null };
const m = mutations as unknown as typeof mutations & S4Mutations & {
  addExpense(input: S4Draft & { id?: string }, layer?: DataLayer): string;
  editExpense(id: string, patch: Partial<S4Draft>, layer?: DataLayer): void;
};
const data = { ...(hooksModule as object), ...(dataIndex as object) } as unknown as S4Data & typeof hooksModule;
type S4Tables = MemoryTables & { chapters: ChapterRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S4Tables;

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}

const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });

function watch(layer: DataLayer) {
  return renderHook(
    () => ({ chapters: data.useChapters(), entries: data.useEntries(), balance: data.useBalance(), sync: data.useSyncStatus() }),
    { wrapper: wrapperFor(layer) },
  );
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const FORM_ID = '00000000-0000-4000-8000-0000000c4f01';
const JAPAN = storedChapter();
const SOFA = storedChapter({ id: '00000000-0000-4000-8000-00000000c402', name: 'New sofa', emoji: '🛋️', kind: 'project', country: null, start_date: null, end_date: null });

const japanDraft = (over: Partial<ChapterDraft> = {}): ChapterDraft => ({
  name: 'Japan', emoji: '🗾', kind: 'trip', country: 'JP', startDate: '2026-11-01', endDate: '2026-11-09', ...over,
});

const ramen = (over: Partial<S4Draft> = {}): S4Draft => ({
  description: 'Ramen', amount: pence(1800), date: TODAY, categoryId: categoryId('Eating out'), payer: JAE_ID, split: even, ...over,
});

// ─────────────────────────────── CHP-1: saving chapters ───────────────────────────────

describe('saveChapter (CHP-1, OFF-2)', () => {
  it('CHP-1 OFF-2 OFF-5: offline, a new chapter shows at once, waits to sync, then is stored as typed', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    let id = '';
    act(() => { id = m.saveChapter(japanDraft(), c.layer); });
    await waitFor(() => { expect(view.result.current.chapters.data?.map((r) => r.id)).toEqual([id]); });
    expect(view.result.current.chapters.data?.[0]).toMatchObject({ name: 'Japan', kind: 'trip', closed: false });
    expect(view.result.current.sync.waiting).toBeGreaterThanOrEqual(1);
    expect(tablesOf(c).chapters).toEqual([]);

    c.network.set(true);
    await settle(c.layer);
    expect(tablesOf(c).chapters).toHaveLength(1);
    expect(tablesOf(c).chapters[0]).toMatchObject({
      id, household_id: HID, name: 'Japan', emoji: '🗾', kind: 'trip', country: 'JP', start_date: '2026-11-01', end_date: '2026-11-09', closed: false,
    });
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    view.unmount();
  });

  it('CHP-1: a project with no dates and no country', async () => {
    const c = household();
    await c.layer.ready;
    const id = m.saveChapter({ name: 'New sofa', emoji: '🛋️', kind: 'project', country: null, startDate: null, endDate: null }, c.layer);
    await settle(c.layer);
    expect(tablesOf(c).chapters.find((r) => r.id === id)).toMatchObject({ name: 'New sofa', kind: 'project', start_date: null, end_date: null, closed: false });
  });

  it('Q-F1 CHP-1: the same form saved twice is one chapter', async () => {
    const c = household();
    await c.layer.ready;
    expect(m.saveChapter({ ...japanDraft(), id: FORM_ID }, c.layer)).toBe(FORM_ID);
    expect(m.saveChapter({ ...japanDraft(), id: FORM_ID }, c.layer)).toBe(FORM_ID);
    await settle(c.layer);
    expect(tablesOf(c).chapters.map((r) => r.id)).toEqual([FORM_ID]);
  });

  it('CHP-1: editing keeps the id and changes what was changed', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    await settle(c.layer);
    expect(m.saveChapter({ ...japanDraft({ name: 'Japan & Korea', endDate: '2026-11-12' }), id: JAPAN.id }, c.layer)).toBe(JAPAN.id);
    await settle(c.layer);
    expect(tablesOf(c).chapters).toHaveLength(1);
    expect(tablesOf(c).chapters[0]).toMatchObject({ id: JAPAN.id, name: 'Japan & Korea', end_date: '2026-11-12', country: 'JP' });
  });

  it('OFF-5 OFF-7: a chapter saved offline survives closing the app and is sent once on the next open', async () => {
    const storage = memoryStorage();
    const first = household({ storage });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    const id = m.saveChapter(japanDraft(), first.layer);
    await first.layer.flush();
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);
    expect(tablesOf(first).chapters).toEqual([]);

    const second = household({ storage });
    await second.layer.ready;
    await settle(second.layer);
    expect(tablesOf(second).chapters.map((r) => r.id)).toEqual([id]);
  });
});

// ─────────────────────────────── CHP-3: close, reopen, never delete ───────────────────────────────

describe('closeChapter (CHP-3)', () => {
  it('CHP-3 OFF-2: closing offline shows at once, then is stored; a second tap changes nothing; Reopen brings it back', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    await settle(c.layer);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.chapters.data).toHaveLength(1); });
    c.network.set(false);
    act(() => { expect(m.closeChapter(JAPAN.id, true, c.layer)).toBe(true); });
    await waitFor(() => { expect(view.result.current.chapters.data?.[0]?.closed).toBe(true); });
    expect(m.closeChapter(JAPAN.id, true, c.layer)).toBe(false);
    expect(tablesOf(c).chapters[0]?.closed).toBe(false);
    c.network.set(true);
    await settle(c.layer);
    expect(tablesOf(c).chapters[0]?.closed).toBe(true);

    act(() => { expect(m.closeChapter(JAPAN.id, false, c.layer)).toBe(true); });
    await settle(c.layer);
    expect(tablesOf(c).chapters[0]?.closed).toBe(false);
    view.unmount();
  });

  it('CHP-3: closing keeps the chapter and its entries; nothing is ever deleted', async () => {
    const inJapan = storedExpense({ chapter_id: JAPAN.id });
    const c = household({ chapters: [JAPAN], expenses: [inJapan] });
    await c.layer.ready;
    m.closeChapter(JAPAN.id, undefined, c.layer);
    await settle(c.layer);
    expect(tablesOf(c).chapters).toHaveLength(1);
    expect(tablesOf(c).chapters[0]?.closed).toBe(true);
    expect(c.controls.tables.expenses.find((e) => e.id === inJapan.id)?.chapter_id).toBe(JAPAN.id);
    expect(c.controls.calls.some((call) => /delete/i.test(call.name))).toBe(false);
  });
});

// ─────────────────────────────── CHP-2 CHP-4: entries carry their chapter ───────────────────────────────

describe('entries in a chapter (CHP-2, CHP-4)', () => {
  it('CHP-2 OFF-2: addExpense with a chapterId stores chapter_id (offline too); CHP-4 the one balance moves as usual', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    await settle(c.layer);
    const view = watch(c.layer);
    c.network.set(false);
    let id = '';
    act(() => { id = m.addExpense(ramen({ chapterId: JAPAN.id }), c.layer); });
    await waitFor(() => { expect(view.result.current.entries.data?.find((e) => e.id === id)?.chapter_id).toBe(JAPAN.id); });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ chapter_id: JAPAN.id, amount_pence: 1800 });
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 900, [SAM_ID]: -900 });
    view.unmount();
  });

  it('CHP-2: without a chapterId an entry is everyday (chapter_id null)', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    const id = m.addExpense(ramen(), c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.chapter_id).toBeNull();
  });

  it('CHP-2: editExpense moves an entry into a chapter and back to everyday', async () => {
    const c = household({ chapters: [JAPAN], expenses: [storedExpense()] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(storedExpense().id, { chapterId: JAPAN.id }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]?.chapter_id).toBe(JAPAN.id);
    m.editExpense(storedExpense().id, { chapterId: null }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]?.chapter_id).toBeNull();
  });

  it('CHP-2: editing something else keeps the entry’s own chapter', async () => {
    const c = household({ chapters: [JAPAN], expenses: [storedExpense({ chapter_id: JAPAN.id })] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(storedExpense().id, { description: 'Paper lamp' }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]).toMatchObject({ description: 'Paper lamp', chapter_id: JAPAN.id });
  });
});

// ─────────────────────────────── CHP-2: the current chapter, per phone ───────────────────────────────

describe('current chapter (CHP-2): this phone’s own', () => {
  function current(layer: DataLayer) {
    return renderHook(() => data.useCurrentChapter(), { wrapper: wrapperFor(layer) });
  }

  it('CHP-2: setCurrentChapter is kept in localStorage "smsm-current-chapter" and useCurrentChapter follows it', async () => {
    const c = household({ chapters: [JAPAN, SOFA] });
    await c.layer.ready;
    await settle(c.layer);
    const view = current(c.layer);
    expect(view.result.current).toBeNull();
    act(() => { data.setCurrentChapter(JAPAN.id); });
    await waitFor(() => { expect(view.result.current).toBe(JAPAN.id); });
    expect(localStorage.getItem('smsm-current-chapter')).toContain(JAPAN.id);
    act(() => { data.setCurrentChapter(null); });
    await waitFor(() => { expect(view.result.current).toBeNull(); });
    expect(localStorage.getItem('smsm-current-chapter') ?? '').not.toContain(JAPAN.id);
    view.unmount();
  });

  it('CHP-2: it survives restarting the app on this phone and is never sent to the server', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    await settle(c.layer);
    act(() => { data.setCurrentChapter(JAPAN.id); });
    await settle(c.layer);
    // Nothing about "current" reaches the household's data: the partner's phone never changes.
    expect(c.controls.calls.some((call) => JSON.stringify(call.arg ?? null).includes('current'))).toBe(false);
    expect(tablesOf(c).chapters[0]).toEqual(JAPAN);
    const again = household({ chapters: [JAPAN] });
    await again.layer.ready;
    await settle(again.layer);
    const view = current(again.layer);
    await waitFor(() => { expect(view.result.current).toBe(JAPAN.id); });
    view.unmount();
  });

  it('CHP-2: a closed chapter is never current', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    await settle(c.layer);
    const view = current(c.layer);
    act(() => { data.setCurrentChapter(JAPAN.id); });
    await waitFor(() => { expect(view.result.current).toBe(JAPAN.id); });
    act(() => { m.closeChapter(JAPAN.id, true, c.layer); });
    await waitFor(() => { expect(view.result.current).toBeNull(); });
    view.unmount();
  });

  it('CHP-2: a chapter closed from the start is never current, even if this phone had chosen it', async () => {
    localStorage.setItem('smsm-current-chapter', JAPAN.id);
    const c = household({ chapters: [{ ...JAPAN, closed: true }] });
    await c.layer.ready;
    await settle(c.layer);
    const view = current(c.layer);
    await settle(c.layer);
    expect(view.result.current).toBeNull();
    view.unmount();
  });
});
