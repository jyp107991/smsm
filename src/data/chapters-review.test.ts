/**
 * S4a fresh review (DECISIONS 2026-11-17): a stale phone never undoes the partner's chapter edit; a duplicate is a
 * new entry (this phone's current chapter, never the closed one it came from); a chapter closed on the other phone
 * stops being current here and stays forgotten if it is reopened.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedChapter, storedExpense } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import { duplicateDraft } from '../screens/entry/form';
import type { ChapterRow } from './api';
import { DataProvider } from './DataProvider';
import { useCurrentChapter } from './hooks';
import type { MemoryTables } from './memoryApi';
import { addExpense, closeChapter, currentChapterId, saveChapter, setCurrentChapter } from './mutations';
import type { DataLayer } from './queryClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tables = MemoryTables & { chapters: ChapterRow[] };
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });
async function settle(layer: DataLayer) { await act(async () => { await layer.idle(); }); }
function household(opts: Parameters<typeof couple>[0]) {
  const c = couple(opts);
  open.push(c.layer);
  return { ...c, tables: c.controls.tables as Tables };
}
const JAPAN = storedChapter();
const PEOPLE = [{ id: JAE_ID, name: 'Jae', animal: 'dog' as const }, { id: SAM_ID, name: 'Sam', animal: 'cat' as const }];

describe('a stale phone (review 1)', () => {
  it('changing the emoji writes only the emoji: the partner’s rename and close stay', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    c.tables.chapters[0] = { ...JAPAN, name: 'Japan 2026', closed: true };
    saveChapter({ id: JAPAN.id, name: 'Japan', emoji: '🍣', kind: 'trip', country: 'JP', startDate: JAPAN.start_date, endDate: JAPAN.end_date }, c.layer);
    await settle(c.layer);
    expect(c.tables.chapters[0]).toMatchObject({ name: 'Japan 2026', closed: true, emoji: '🍣' });
  });

  it('reopening writes only "closed": a rename made meanwhile stays', async () => {
    const c = household({ chapters: [{ ...JAPAN, closed: true }] });
    await c.layer.ready;
    c.tables.chapters[0] = { ...JAPAN, closed: true, name: 'Japan 2026' };
    closeChapter(JAPAN.id, false, c.layer);
    await settle(c.layer);
    expect(c.tables.chapters[0]).toMatchObject({ name: 'Japan 2026', closed: false });
  });
});

describe('duplicate (review 2)', () => {
  it('a copy of an entry in a closed chapter goes into this phone’s current chapter (here, everyday), not the closed one', async () => {
    const ramen = storedExpense({ description: 'Ramen', amount_pence: 1200, paid: { [JAE_ID]: 1200 }, shares: { [JAE_ID]: 600, [SAM_ID]: 600 }, chapter_id: JAPAN.id });
    const c = household({ chapters: [{ ...JAPAN, closed: true }], expenses: [ramen] });
    await c.layer.ready;
    const draft = duplicateDraft(ramen, PEOPLE, '2026-11-14');
    if (!draft) throw new Error('the copy could not be read back');
    expect(draft.amount).toBe(pence(1200));
    const id = addExpense(draft, c.layer);
    await settle(c.layer);
    expect(c.tables.expenses.find((e) => e.id === id)?.chapter_id).toBeNull();
  });
});

describe('closed on the other phone (review 7)', () => {
  it('stops being current here and is forgotten, so reopening it later doesn’t send entries back into it', async () => {
    const c = household({ chapters: [JAPAN] });
    await c.layer.ready;
    setCurrentChapter(JAPAN.id);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer: c.layer, children });
    const view = renderHook(() => useCurrentChapter(), { wrapper });
    await waitFor(() => { expect(view.result.current).toBe(JAPAN.id); });
    c.tables.chapters[0] = { ...JAPAN, closed: true };
    await act(async () => { await c.layer.refresh(); });
    await waitFor(() => { expect(view.result.current).toBeNull(); });
    expect(currentChapterId()).toBeNull();
  });
});
