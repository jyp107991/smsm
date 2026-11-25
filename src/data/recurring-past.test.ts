/**
 * S9 review fix 1 (DECISIONS 23 Nov "S9: a regular payment started long ago"): "Start from Mon 30 Nov instead" for
 * rent on the 31st keeps the 31st. The phone saves the template paused with the start picked (`saveRecurring` with
 * `active: false`), then resumes it (`resumeRecurring`): the server skips every occurrence before today on the resume
 * (recurring_guard; tests/sql/recurring_past_test.sql), and so does the in-memory Api (the demo). Two writes, in
 * order, never merged into one. While they wait, the phone already shows the skip (the resume's row carries the
 * count the server will make), so the lists never show the past occurrences as due.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, type RecurringRow } from '../../tests/fixtures/couple';
import { occurrence, upcoming } from '../core/recurring';
import { pence } from '../core/money';
import type { MemoryTables } from './memoryApi';
import { pauseRecurring, resumeRecurring, saveRecurring } from './mutations';
import type { DataLayer } from './queryClient';
import { overlay } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open: DataLayer[] = [];
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });
function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const recurringOf = (c: { controls: { tables: MemoryTables } }) => (c.controls.tables as MemoryTables & { recurring: RecurringRow[] }).recurring;
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const rent = {
  description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even,
  frequency: 'monthly' as const, every: 1, startDate: '2026-01-31', endDate: null, amountVaries: false,
};
const sched = (r: RecurringRow) => ({ frequency: r.frequency as 'monthly', every: r.every, startDate: r.start_date, endDate: r.end_date });

describe('start from the next one, keeping the day (S9 review fix 1)', () => {
  it('saved paused then resumed: two writes in order; the in-memory Api skips the 10 past (31 Jan … 31 Oct) and keeps the 31st', async () => {
    const c = household(); // today Sat 14 Nov 2026
    await c.layer.ready;
    await settle(c.layer);
    const id = saveRecurring({ ...rent, active: false }, c.layer);
    expect(resumeRecurring(id, c.layer)).toBe(true);
    await settle(c.layer);
    await settle(c.layer);
    const writes = c.controls.calls.filter((x) => x.name === 'upsertRecurring');
    expect(writes).toHaveLength(2);
    expect(writes[0]?.arg).toMatchObject({ id, active: false, start_date: '2026-01-31' });
    expect(writes[1]?.arg).toMatchObject({ id, active: true });
    const t = recurringOf(c).find((r) => r.id === id);
    expect(t).toMatchObject({ start_date: '2026-01-31', active: true, posted_count: 10 });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === id)).toEqual([]);
    if (!t) throw new Error('no template');
    expect([occurrence(sched(t), t.posted_count), occurrence(sched(t), t.posted_count + 1), occurrence(sched(t), t.posted_count + 2)])
      .toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('a paused insert is never posted, even when the phone posts what is due between the two writes', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const id = saveRecurring({ ...rent, active: false }, c.layer);
    await settle(c.layer);
    await settle(c.layer);
    expect(recurringOf(c).find((r) => r.id === id)).toMatchObject({ active: false, posted_count: 0 });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === id)).toEqual([]);
    resumeRecurring(id, c.layer);
    await settle(c.layer);
    await settle(c.layer);
    expect(recurringOf(c).find((r) => r.id === id)).toMatchObject({ active: true, posted_count: 10 });
    expect(c.controls.tables.expenses.filter((e) => e.recurring_id === id)).toEqual([]);
  });

  it('while the writes wait (offline), the phone already shows the skip: nothing past is due, the next is 30 Nov', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = saveRecurring({ ...rent, active: false }, c.layer);
    resumeRecurring(id, c.layer);
    const shown = overlay<RecurringRow>([], c.layer.waiting(), 'recurring').find((r) => r.id === id);
    expect(shown).toMatchObject({ active: true, posted_count: 10, start_date: '2026-01-31' });
    if (!shown) throw new Error('no template');
    const due = upcoming([{ id, description: 'Rent', amount: pence(145000), amountVaries: false, active: true, postedCount: shown.posted_count, schedule: sched(shown) }], { to: '2026-12-31' });
    expect(due.map((d) => d.date)).toEqual(['2026-11-30', '2026-12-31']);
  });

  it('a plain resume shows the same skip the server makes (what fell due while paused)', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = saveRecurring({ ...rent, startDate: '2026-10-31' }, c.layer);
    pauseRecurring(id, c.layer);
    resumeRecurring(id, c.layer);
    const shown = overlay<RecurringRow>([], c.layer.waiting(), 'recurring').find((r) => r.id === id);
    expect(shown?.posted_count).toBe(1);
  });

  it('an edit never sends `active`, so `active: false` is only for a new template', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const id = saveRecurring({ ...rent, startDate: '2026-12-31' }, c.layer);
    await settle(c.layer);
    saveRecurring({ ...rent, id, startDate: '2026-12-31', description: 'Rent (flat)', active: false }, c.layer);
    await settle(c.layer);
    expect(recurringOf(c).find((r) => r.id === id)).toMatchObject({ description: 'Rent (flat)', active: true });
  });
});
