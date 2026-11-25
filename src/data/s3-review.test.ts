/**
 * S3 fresh review (DECISIONS 2026-11-17): a template edit, a pause and resume, or a stale phone never writes a
 * run of back-dated entries, skips bills, or undoes the partner's change. The database's recurring_guard
 * trigger (migration 8, tests/sql/recurring_test.sql) and the in-memory Api behave the same.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID, storedInboxItem, storedRecurring, TODAY } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import type { InboxItemRow, RecurringRow } from './api';
import type { MemoryTables } from './memoryApi';
import { pauseRecurring, resumeRecurring, saveRecurring } from './mutations';
import type { DataLayer } from './queryClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type S3Tables = MemoryTables & { recurring: RecurringRow[]; inboxItems: InboxItemRow[] };
const open: DataLayer[] = [];
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });
async function settle(layer: DataLayer) { await act(async () => { await layer.idle(); }); }
function household(opts: Parameters<typeof couple>[0]) {
  const c = couple(opts);
  open.push(c.layer);
  return { ...c, tables: c.controls.tables as S3Tables };
}
const RENT = storedRecurring();
const rentDraft = {
  description: 'Rent', amount: pence(145000), categoryId: RENT.category_id, payer: JAE_ID,
  split: { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } }, notes: null,
  frequency: 'monthly' as const, every: 1, startDate: RENT.start_date, endDate: null, amountVaries: false,
};

describe('template edits after posting (fresh review blocker 1)', () => {
  it('a new rhythm applies from the next occurrence: nothing back-dated is posted', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    saveRecurring({ ...rentDraft, id: RENT.id, frequency: 'weekly' }, c.layer);
    await settle(c.layer);
    await settle(c.layer);
    expect(c.tables.expenses.filter((e) => e.recurring_id === RENT.id)).toHaveLength(0);
    expect(c.tables.recurring[0]).toMatchObject({ frequency: 'weekly', start_date: '2026-12-01', posted_count: 0 });
  });

  it('every 1 → every 2 doesn’t skip ahead either', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    saveRecurring({ ...rentDraft, id: RENT.id, every: 2 }, c.layer);
    await settle(c.layer);
    expect(c.tables.recurring[0]).toMatchObject({ every: 2, start_date: '2026-12-01', posted_count: 0 });
  });
});

describe('pause and resume (fresh review blocker 2)', () => {
  it('resuming skips what fell due while paused; it posts nothing back-dated', async () => {
    const paused = storedRecurring({ active: false, posted_count: 2 });
    const c = household({ recurring: [paused] });
    await c.layer.ready;
    resumeRecurring(paused.id, c.layer);
    await settle(c.layer);
    await settle(c.layer);
    expect(c.tables.expenses.filter((e) => e.recurring_id === paused.id)).toHaveLength(0);
    // 1 Jan … 1 Nov fell before today (14 Nov): skipped; the next to post is 1 Dec.
    expect(c.tables.recurring[0]).toMatchObject({ active: true, posted_count: 11 });
    expect(TODAY).toBe('2026-11-14');
  });
});

describe('a stale phone (fresh review should-fix 3)', () => {
  it('pausing writes only "active": the partner’s new price stays', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    // The partner raised the rent on the server after this phone last fetched.
    const server = c.tables.recurring[0] as RecurringRow;
    c.tables.recurring[0] = { ...server, amount_pence: 150000, paid: { [JAE_ID]: 150000 }, shares: { [JAE_ID]: 75000, [SAM_ID]: 75000 } };
    pauseRecurring(RENT.id, c.layer);
    await settle(c.layer);
    expect(c.tables.recurring[0]).toMatchObject({ active: false, amount_pence: 150000 });
  });

  it('an edit never un-pauses what the partner paused', async () => {
    const c = household({ recurring: [RENT] });
    await c.layer.ready;
    c.tables.recurring[0] = { ...(c.tables.recurring[0] as RecurringRow), active: false };
    saveRecurring({ ...rentDraft, id: RENT.id, description: 'Rent (flat)' }, c.layer);
    await settle(c.layer);
    expect(c.tables.recurring[0]).toMatchObject({ active: false, description: 'Rent (flat)' });
  });
});

describe('the Inbox (fresh review should-fix 4)', () => {
  it('an item can’t be marked kept with an entry that doesn’t exist (as the foreign key refuses)', async () => {
    const c = household({ recurring: [RENT], inboxItems: [storedInboxItem()] });
    await c.layer.ready;
    await expect(c.layer.api.patchInboxItem(storedInboxItem().id, { status: 'kept', expense_id: crypto.randomUUID() })).rejects.toThrow(/foreign key/);
    expect(c.tables.inboxItems[0]?.status).toBe('open');
  });
});
