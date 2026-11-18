/**
 * S8 fresh-review fixes to the words (NOT-1, NOT-2): what a change changed; a variable bill tomorrow; a batch of the
 * partner's entry changes as one notification.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pence } from './money';
import { BATCH_FROM, batchText, ENTRY_KINDS, notificationText, type NotificationKind } from './notify';

const KIM = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000b1';
const NAMES = { [KIM]: 'Kim', [SAM]: 'Sam' };
const OWED = { [KIM]: pence(2450), [SAM]: pence(-2450) };
const ENTRY = '00000000-0000-4000-8000-00000000e001';
const base = { actor: KIM, ref: ENTRY, description: 'Tesco', amount: pence(4250), balance: OWED };

describe('entry_changed says what changed (NOT-1; review fix 9)', () => {
  it('NOT-1: the amount changed: "Kim changed Tesco to £42.50"', () => {
    expect(notificationText('entry_changed', { ...base, change: 'amount' }, NAMES).body).toBe('Kim changed Tesco to £42.50 · Sam owes Kim £24.50');
  });

  it('NOT-1: only the category changed: "Kim moved Tesco to Eating out"', () => {
    expect(notificationText('entry_changed', { ...base, change: 'category', category: 'Eating out' }, NAMES).body)
      .toBe('Kim moved Tesco to Eating out · Sam owes Kim £24.50');
  });

  it('NOT-1: something else changed: "Kim changed Tesco", no amount', () => {
    const { body } = notificationText('entry_changed', { ...base, change: 'details' }, NAMES);
    expect(body).toBe('Kim changed Tesco · Sam owes Kim £24.50');
    expect(notificationText('entry_changed', { ...base, change: 'category', category: null }, NAMES).body).toBe(body);
  });
});

describe('a variable bill tomorrow (NOT-1; review fix 6)', () => {
  it('NOT-1: "Energy is due tomorrow (usually £80.00)"', () => {
    expect(notificationText('bill_tomorrow', { actor: null, description: 'Energy', amount: pence(8000), varies: true }, NAMES).body)
      .toBe('Energy is due tomorrow (usually £80.00)');
    expect(notificationText('bill_tomorrow', { actor: null, description: 'Water', amount: pence(2874), varies: false }, NAMES).body)
      .toBe('Water £28.74 posts tomorrow');
  });
});

describe('a batch of the partner’s entry changes is one notification (NOT-1, NOT-2; review fix 2)', () => {
  it('NOT-1: all added: "Kim added 30 entries", with the balance; a tap opens Activity', () => {
    const t = batchText(Array<NotificationKind>(30).fill('entry_added'), { actor: KIM, balance: OWED }, NAMES);
    expect(t.body).toBe('Kim added 30 entries · Sam owes Kim £24.50');
    expect(t.path).toBe('/activity');
    expect(t.title).toBe('smsm');
  });

  it('NOT-1: all changed, deleted or restored say so; different kinds are "made N changes"', () => {
    expect(batchText(Array<NotificationKind>(4).fill('entry_changed'), { actor: KIM, balance: OWED }, NAMES).body).toBe('Kim changed 4 entries · Sam owes Kim £24.50');
    expect(batchText(Array<NotificationKind>(3).fill('entry_deleted'), { actor: KIM, balance: OWED }, NAMES).body).toBe('Kim deleted 3 entries · Sam owes Kim £24.50');
    expect(batchText(Array<NotificationKind>(3).fill('entry_restored'), { actor: KIM, balance: OWED }, NAMES).body).toBe('Kim restored 3 entries · Sam owes Kim £24.50');
    expect(batchText(['entry_added', 'entry_changed', 'entry_added', 'entry_deleted', 'entry_added', 'entry_added', 'entry_restored'], { actor: KIM, balance: OWED }, NAMES).body)
      .toBe('Kim made 7 changes · Sam owes Kim £24.50');
  });

  it('NOT-1: a batch starts at three, of the entry kinds only', () => {
    expect(BATCH_FROM).toBe(3);
    expect([...ENTRY_KINDS].sort()).toEqual(['entry_added', 'entry_changed', 'entry_deleted', 'entry_restored']);
  });

  it('NOT-1: any batch and names: one line, at most 180 characters, ending with the balance', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...ENTRY_KINDS), { minLength: 3, maxLength: 500 }),
      fc.constantFrom('Kim', '재', 'Maximiliana Alexandrovna'), fc.integer({ min: -100_000_000, max: 100_000_000 }),
      (kinds, name, net) => {
        const names = { [KIM]: name, [SAM]: 'Sam' };
        const t = batchText(kinds, { actor: KIM, balance: { [KIM]: pence(net + 0), [SAM]: pence(-net + 0) } }, names);
        expect(Array.from(t.body).length).toBeLessThanOrEqual(180);
        expect(t.body.startsWith(`${name} `)).toBe(true);
        expect(t.body).toContain(` ${String(kinds.length)} `);
      },
    ), { seed: 8101, numRuns: 200 });
  });
});
