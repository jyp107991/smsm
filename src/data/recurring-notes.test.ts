/**
 * Owner's reports, 24 Nov (DECISIONS "Notes on regular payments", "One meaning for subscription"), the data layer over
 * the in-memory Api, which does what the database does (migration 20261124000100; tests/sql/subscription_key_notes_test.sql).
 *
 *   saveRecurring({ ...draft, notes })   a template's notes go through the queue (offline too) and are logged; an edit
 *                                        sends notes only when the form changed them from what it opened with (as
 *                                        How often, Every, Starts and Ends), so a stale phone never writes back an old
 *                                        note over the partner's; clearing them clears them
 *   posting                              a fixed one's entries carry the notes it has when each posts; an "amount
 *                                        varies" one's Inbox bill carries them in its payload; what posted before keeps
 *                                        its notes
 *   categories.seed_key                  the server's: a new household's starting categories have it; a rename keeps it
 *   backup and restore                   a template's notes go in the file and come back
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedRecurring, TODAY, type RecurringRow } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import type { CategoryRow } from './api';
import { backupJson } from './backup';
import { defaultPeopleMap, restoreBackup, restorePlan } from './imports';
import * as data from './index';
import { createMemoryApi } from './memoryApi';
import { keys } from './keys';
import type { DataLayer } from './queryClient';
import { overlay } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open: DataLayer[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});
function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}

const ID = storedRecurring().id;
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const rent = (over: Partial<Parameters<typeof data.saveRecurring>[0]> = {}) => ({
  description: 'Rent', amount: pence(145000), categoryId: categoryId('Rent & bills'), payer: JAE_ID, split: even,
  frequency: 'monthly' as const, every: 1, startDate: '2026-01-01', endDate: null, amountVaries: false,
  ...over,
});
const server = (c: ReturnType<typeof household>, id = ID) => c.controls.tables.recurring.find((r) => r.id === id);
const editsOf = (c: ReturnType<typeof household>, id = ID) => c.controls.tables.activity
  .filter((a) => a.entity === 'recurring' && a.entity_id === id && a.action === 'edited')
  .map((a) => a.summary as Record<string, { before: unknown; after: unknown }>);

describe('a regular payment’s notes (REC-1, REC-6)', () => {
  it('REC-1 OFF-2: a new one’s notes, saved offline: waiting at once, then stored', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = data.saveRecurring({ ...rent({ startDate: '2026-12-01' }), notes: 'Account 1234' }, c.layer);
    expect(c.layer.waiting().length).toBe(1);
    expect(server(c, id)).toBeUndefined();
    c.network.set(true);
    await settle(c.layer);
    expect(server(c, id)?.notes).toBe('Account 1234');
  });

  it('REC-6: notes added on an edit are stored and logged as a notes change', async () => {
    const c = household({ recurring: [storedRecurring()] });
    await c.layer.ready;
    await settle(c.layer);
    data.saveRecurring({ id: ID, ...rent(), notes: 'Account 1234' }, c.layer);
    await settle(c.layer);
    expect(server(c)?.notes).toBe('Account 1234');
    expect(editsOf(c).map((e) => e.notes)).toEqual([{ before: null, after: 'Account 1234' }]);
  });

  it('REC-6: clearing the notes on an edit clears them', async () => {
    const c = household({ recurring: [storedRecurring({ notes: 'Account 1234' })] });
    await c.layer.ready;
    await settle(c.layer);
    data.saveRecurring({ id: ID, ...rent(), notes: null }, c.layer);
    await settle(c.layer);
    expect(server(c)?.notes).toBeNull();
  });

  it('REC-6: an edit that leaves the notes as they were never writes them back over the partner’s newer ones', async () => {
    const c = household({ recurring: [storedRecurring({ notes: 'Account 1234' })] });
    await c.layer.ready;
    await settle(c.layer);
    // Sam changes the notes on the other phone; this phone hasn't heard yet.
    const stored = server(c) as RecurringRow;
    stored.notes = 'Account 5678';
    data.saveRecurring({ id: ID, ...rent({ amount: pence(150000) }), notes: 'Account 1234' }, c.layer);
    await settle(c.layer);
    expect(server(c)).toMatchObject({ amount_pence: 150000, notes: 'Account 5678' });
  });

  it('REC-6: the form’s own opening notes say what changed, even when this phone has heard of a newer note since', async () => {
    const c = household({ recurring: [storedRecurring({ notes: 'Account 5678' })] });
    await c.layer.ready;
    await settle(c.layer);
    const opened = { frequency: 'monthly' as const, every: 1, startDate: '2026-01-01', endDate: null, notes: 'Account 1234' };
    data.saveRecurring({ id: ID, ...rent({ amount: pence(150000) }), notes: 'Account 1234', opened }, c.layer);
    await settle(c.layer);
    expect(server(c)).toMatchObject({ amount_pence: 150000, notes: 'Account 5678' });
    // Changed in the form: sent.
    data.saveRecurring({ id: ID, ...rent({ amount: pence(150000) }), notes: 'Account 9999', opened }, c.layer);
    await settle(c.layer);
    expect(server(c)?.notes).toBe('Account 9999');
  });
});

describe('what a regular payment posts carries its notes from then on (REC-2, REC-3, REC-6)', () => {
  it('REC-2 REC-6: a fixed one’s entry has the notes it has when it posts; what posted before keeps its own', async () => {
    // Monthly from 14 Sep, nothing posted yet: 14 Sep, 14 Oct and 14 Nov post now, with the note.
    const t = storedRecurring({ start_date: '2026-09-14', posted_count: 0, notes: 'Account 1234', end_date: '2026-10-31' });
    const c = household({ recurring: [t] });
    await c.layer.ready;
    await c.layer.api.postDueRecurring();
    const posted = () => c.controls.tables.expenses.filter((e) => e.recurring_id === ID).sort((a, b) => (a.date < b.date ? -1 : 1));
    expect(posted().map((e) => [e.date, e.notes])).toEqual([['2026-09-14', 'Account 1234'], ['2026-10-14', 'Account 1234']]);
    const stored = server(c) as RecurringRow;
    stored.notes = 'Account 5678';
    stored.end_date = null;
    await c.layer.api.postDueRecurring();
    expect(posted().map((e) => [e.date, e.notes])).toEqual([
      ['2026-09-14', 'Account 1234'], ['2026-10-14', 'Account 1234'], [TODAY, 'Account 5678'],
    ]);
  });

  it('REC-3: an "amount varies" one’s Inbox bill carries the notes in its payload (none: null)', async () => {
    const water = storedRecurring({ id: '00000000-0000-4000-8000-00000000d0a1', description: 'Water', amount_varies: true, start_date: TODAY, posted_count: 0, notes: 'Meter 42' });
    const energy = storedRecurring({ id: '00000000-0000-4000-8000-00000000d0a2', description: 'Energy', amount_varies: true, start_date: TODAY, posted_count: 0 });
    const c = household({ recurring: [water, energy] });
    await c.layer.ready;
    await c.layer.api.postDueRecurring();
    const payload = (id: string) => c.controls.tables.inboxItems.find((i) => i.recurring_id === id)?.payload as Record<string, unknown>;
    expect(payload(water.id)).toMatchObject({ description: 'Water', notes: 'Meter 42' });
    expect(payload(energy.id)).toMatchObject({ description: 'Energy', notes: null });
  });
});

describe('the starting categories’ key (REC-7, CAT-1)', () => {
  it('REC-7 CAT-1: a new household’s starting categories each have their key; Subscriptions is "subscriptions"', async () => {
    const { api, controls } = createMemoryApi({}, { user: { userId: JAE_ID, email: null } });
    await api.createHousehold();
    const keys = controls.tables.categories.map((cat) => [cat.name, cat.seed_key]);
    expect(keys).toHaveLength(12);
    expect(keys).toContainEqual(['Subscriptions', 'subscriptions']);
    expect(keys).toContainEqual(['Other', 'other']);
    expect(new Set(keys.map(([, k]) => k)).size).toBe(12);
  });

  it('REC-7 CAT-1: renamed on this phone, it keeps its key (the waiting copy and the server’s)', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    data.saveCategory({ id: categoryId('Subscriptions'), name: 'Streaming', emoji: '📺', colour: 'plum' }, c.layer);
    const shown = overlay(c.layer.client.getQueryData<CategoryRow[]>(keys.categories(JAE_ID)) ?? [], c.layer.waiting(), 'categories');
    expect(shown.find((r) => r.id === categoryId('Subscriptions'))).toMatchObject({ name: 'Streaming', seed_key: 'subscriptions' });
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.categories.find((r) => r.id === categoryId('Subscriptions'))).toMatchObject({ name: 'Streaming', seed_key: 'subscriptions' });
  });
});

describe('backup and restore keep a regular payment’s notes (EXP-1)', () => {
  it('EXP-1: the backup has the notes; restored into a new household they come back', async () => {
    const c = household({ recurring: [storedRecurring({ notes: 'Account 1234' })] });
    await c.layer.ready;
    await settle(c.layer);
    const file = backupJson({ appVersion: 'test' }, c.layer);
    const parsed = JSON.parse(file) as { recurring: RecurringRow[]; categories: { name: string; seed_key: string | null }[] };
    expect(parsed.recurring[0]?.notes).toBe('Account 1234');
    expect(parsed.categories.find((x) => x.name === 'Subscriptions')?.seed_key).toBe('subscriptions');

    // The same file into a fresh household (the same two people).
    const d = household();
    await d.layer.ready;
    await settle(d.layer);
    const plan = restorePlan(file, d.layer);
    if ('error' in plan) throw new Error(plan.error);
    const people = defaultPeopleMap(plan, d.layer.members().map((x) => ({ id: x.user_id, name: x.display_name ?? '' })));
    await restoreBackup(plan, people, d.layer);
    await settle(d.layer);
    expect(d.controls.tables.recurring.map((r) => r.notes)).toEqual(['Account 1234']);
  });
});
