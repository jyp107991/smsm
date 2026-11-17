/**
 * S5b data layer (docs/slices/S5b.md "Data", "Interfaces → Data"): comments on an entry (ACT-4), saved through the
 * persisted queue (offline too), read with waiting writes applied, editable and deletable (softly) only by their
 * author; and the household's settle day (SET-4). Written before the build (ENGINEERING §5, tests first by someone
 * else); each test names its SPEC ids and fails because the functions, hooks and table below don't exist yet.
 *
 * Interface these tests expect (exported from src/data/index.ts, mutations from src/data/mutations.ts):
 *   useComments(expenseId): DataResult<CommentRow[]>
 *     ACT-4: that entry's comments, oldest first, deleted ones included (deleted_at set: the thread shows "Deleted"),
 *     with this phone's waiting writes applied.
 *   addComment(expenseId, body, layer?): string
 *     ACT-4: the trimmed body (1–500 characters, else it throws and nothing is queued); returns the phone-made id;
 *     through the queue (MoneyOp table 'comments', upsert by id), author = me.
 *   editComment(id, body, layer?): void      ACT-4: my own only (the partner's → throws); the same 1–500 rule
 *   deleteComment(id, layer?): void          ACT-4: my own only; soft (deleted_at set); never a hard delete
 *   setSettleDay(day: number | null, layer?): void | Promise<void>
 *     SET-4: a day 1–28 or null (Off), through the RPC set_settle_day; anything else throws (or rejects).
 *   Memory Api: MemoryTables gains `comments: CommentRow[]`; households carry `settle_day`.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, HID, JAE_ID, SAM_ID, storedComment, storedExpense, type CommentRow } from '../../tests/fixtures/couple';
import { DataProvider } from './DataProvider';
import * as hooksModule from './hooks';
import type { DataResult } from './hooks';
import * as dataIndex from './index';
import type { MemoryTables } from './memoryApi';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import { memoryStorage } from './storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
interface S5bMutations {
  addComment(expenseId: string, body: string, layer?: DataLayer): string;
  editComment(id: string, body: string, layer?: DataLayer): void;
  deleteComment(id: string, layer?: DataLayer): void;
  setSettleDay(day: number | null, layer?: DataLayer): void | Promise<void>;
}
interface S5bData { useComments(expenseId: string): DataResult<CommentRow[]> }
const m = { ...(mutations as object), ...(dataIndex as object) } as unknown as S5bMutations;
const data = { ...(hooksModule as object), ...(dataIndex as object) } as unknown as S5bData & typeof hooksModule;
type S5bTables = MemoryTables & { comments: CommentRow[]; households: (MemoryTables['households'][number] & { settle_day?: number | null })[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S5bTables;

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

const LAMP = storedExpense();
const SAMS = storedComment({ id: '00000000-0000-4000-8000-00000000cc01', created_at: '2026-11-12T18:00:00.000Z' });

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple({ expenses: [LAMP], comments: [SAMS], ...opts });
  open.push(c.layer);
  return c;
}

const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });

function watch(layer: DataLayer, expenseId = LAMP.id) {
  return renderHook(
    () => ({ comments: data.useComments(expenseId), sync: data.useSyncStatus(), household: data.useHousehold() }),
    { wrapper: wrapperFor(layer) },
  );
}

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

/** Whether calling `f` throws or returns a rejected promise (the functions must exist: a missing one isn't a refusal). */
async function refused(f: () => unknown): Promise<boolean> {
  for (const name of ['addComment', 'editComment', 'deleteComment', 'setSettleDay'] as const) expect(typeof m[name], name).toBe('function');
  try {
    await f();
    return false;
  } catch {
    return true;
  }
}

// ─────────────────────────────── ACT-4: reading ───────────────────────────────

describe('useComments (ACT-4)', () => {
  it('ACT-4: an entry\'s thread, oldest first, deleted ones kept (shown as "Deleted")', async () => {
    const mineOld = storedComment({ id: '00000000-0000-4000-8000-00000000cc02', author: JAE_ID, body: 'Yes, and the milk', created_at: '2026-11-12T19:00:00.000Z', deleted_at: '2026-11-13T08:00:00.000Z' });
    const other = storedComment({ id: '00000000-0000-4000-8000-00000000cc03', expense_id: '00000000-0000-4000-8000-00000000e999' });
    const c = household({ comments: [mineOld, SAMS, other] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.comments.data?.map((r) => r.id)).toEqual([SAMS.id, mineOld.id]); });
    expect(view.result.current.comments.data?.[1]?.deleted_at).not.toBeNull();
    view.unmount();
  });
});

// ─────────────────────────────── ACT-4: adding ───────────────────────────────

describe('addComment (ACT-4, OFF-2)', () => {
  it('ACT-4 OFF-2: offline, my comment shows at once, waits to sync, then is stored as mine', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.comments.data).toHaveLength(1); });
    let id = '';
    act(() => { id = m.addComment(LAMP.id, '  Yes, the big one  ', c.layer); });
    await waitFor(() => { expect(view.result.current.comments.data?.map((r) => r.id)).toEqual([SAMS.id, id]); });
    expect(view.result.current.comments.data?.[1]).toMatchObject({ body: 'Yes, the big one', author: JAE_ID, deleted_at: null });
    expect(view.result.current.sync.waiting).toBeGreaterThanOrEqual(1);
    expect(tablesOf(c).comments).toHaveLength(1);

    c.network.set(true);
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === id)).toMatchObject({
      id, household_id: HID, expense_id: LAMP.id, author: JAE_ID, body: 'Yes, the big one', deleted_at: null,
    });
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    view.unmount();
  });

  it('ACT-4 OFF-5: a comment typed offline survives a restart and syncs later', async () => {
    const storage = memoryStorage();
    // The phone has been online once (a phone that never was doesn't know its household yet), then the connection goes.
    const first = household({ storage });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    const id = m.addComment(LAMP.id, 'Was it on offer?', first.layer);
    await settle(first.layer);
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);

    const second = household({ storage, online: true });
    await second.layer.ready;
    await settle(second.layer);
    await waitFor(() => { expect(tablesOf(second).comments.some((r) => r.id === id && r.body === 'Was it on offer?')).toBe(true); });
  });

  it('ACT-4: 1–500 characters: blank or 501 is refused and nothing is queued; 500 is fine', async () => {
    const c = household();
    await c.layer.ready;
    expect(await refused(() => m.addComment(LAMP.id, '   ', c.layer))).toBe(true);
    expect(await refused(() => m.addComment(LAMP.id, 'x'.repeat(501), c.layer))).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).comments).toHaveLength(1);
    const id = m.addComment(LAMP.id, 'x'.repeat(500), c.layer);
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === id)?.body).toHaveLength(500);
  });
});

// ─────────────────────────────── ACT-4: editing and deleting ───────────────────────────────

describe('editComment and deleteComment (ACT-4)', () => {
  it('ACT-4: I edit my own comment; it shows at once and is stored', async () => {
    const mine = storedComment({ id: '00000000-0000-4000-8000-00000000cc04', author: JAE_ID, body: 'Big shop', created_at: '2026-11-13T09:00:00.000Z' });
    const c = household({ comments: [SAMS, mine] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.comments.data).toHaveLength(2); });
    act(() => { m.editComment(mine.id, 'The big shop, yes', c.layer); });
    await waitFor(() => { expect(view.result.current.comments.data?.find((r) => r.id === mine.id)?.body).toBe('The big shop, yes'); });
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === mine.id)?.body).toBe('The big shop, yes');
    view.unmount();
  });

  it('ACT-4: I delete my own comment softly: kept, marked deleted, still in the thread', async () => {
    const mine = storedComment({ id: '00000000-0000-4000-8000-00000000cc04', author: JAE_ID, body: 'Big shop', created_at: '2026-11-13T09:00:00.000Z' });
    const c = household({ comments: [SAMS, mine] });
    await c.layer.ready;
    const view = watch(c.layer);
    await waitFor(() => { expect(view.result.current.comments.data).toHaveLength(2); });
    act(() => { m.deleteComment(mine.id, c.layer); });
    await waitFor(() => { expect(view.result.current.comments.data?.find((r) => r.id === mine.id)?.deleted_at).toBeTruthy(); });
    await settle(c.layer);
    expect(tablesOf(c).comments).toHaveLength(2);
    expect(tablesOf(c).comments.find((r) => r.id === mine.id)?.deleted_at).toBeTruthy();
    view.unmount();
  });

  it('ACT-4: the partner\'s comment can\'t be edited or deleted from my phone', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    expect(await refused(() => { m.editComment(SAMS.id, 'Hijacked', c.layer); })).toBe(true);
    expect(await refused(() => { m.deleteComment(SAMS.id, c.layer); })).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).comments.find((r) => r.id === SAMS.id)).toMatchObject({ body: SAMS.body, deleted_at: null });
  });

  it('ACT-4: an edit is held to 1–500 characters too', async () => {
    const mine = storedComment({ id: '00000000-0000-4000-8000-00000000cc04', author: JAE_ID, body: 'Big shop' });
    const c = household({ comments: [mine] });
    await c.layer.ready;
    expect(await refused(() => { m.editComment(mine.id, '  ', c.layer); })).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).comments[0]?.body).toBe('Big shop');
  });

  it('ACT-4: Sam\'s phone edits Sam\'s comment (the author is whoever is signed in)', async () => {
    const c = household({ as: 'sam' });
    await c.layer.ready;
    m.editComment(SAMS.id, 'Was this the big shop, Jae?', c.layer);
    await settle(c.layer);
    expect(tablesOf(c).comments[0]).toMatchObject({ author: SAM_ID, body: 'Was this the big shop, Jae?' });
  });
});

// ─────────────────────────────── SET-4: settle day ───────────────────────────────

describe('setSettleDay (SET-4)', () => {
  it('SET-4: either of us sets the household\'s settle day; it shows on both phones\' household', async () => {
    const c = household();
    await c.layer.ready;
    const view = watch(c.layer);
    await act(async () => { await m.setSettleDay(15, c.layer); });
    await settle(c.layer);
    expect(tablesOf(c).households[0]?.settle_day).toBe(15);
    await waitFor(() => { expect((view.result.current.household.data as { settle_day?: number | null } | null | undefined)?.settle_day).toBe(15); });
    view.unmount();
  });

  it('SET-4: Off is null', async () => {
    const c = household({ as: 'sam', settleDay: 28 });
    await c.layer.ready;
    await act(async () => { await m.setSettleDay(null, c.layer); });
    await settle(c.layer);
    expect(tablesOf(c).households[0]?.settle_day).toBeNull();
  });

  it('SET-4: only a day 1–28: 0, 29 and 1.5 are refused and the day is kept', async () => {
    const c = household({ settleDay: 10 });
    await c.layer.ready;
    expect(await refused(() => m.setSettleDay(0, c.layer))).toBe(true);
    expect(await refused(() => m.setSettleDay(29, c.layer))).toBe(true);
    expect(await refused(() => m.setSettleDay(1.5, c.layer))).toBe(true);
    await settle(c.layer);
    expect(tablesOf(c).households[0]?.settle_day).toBe(10);
  });
});
