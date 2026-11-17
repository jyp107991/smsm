/** The screens' wording (DESIGN §5): sentences with names, history lines, requests. */
import { describe, expect, it } from 'vitest';
import { pence } from '../../core/money';
import { balanceWords, entrySentence, historyLine, requestWords, splitWords, whenWords, type Person } from './words';

const J = 'j';
const S = 's';
const people: Person[] = [{ id: J, name: 'Jae', animal: 'cat' }, { id: S, name: 'Sam', animal: 'dog' }];
const name = (id: string | null | undefined) => people.find((p) => p.id === id)?.name ?? '';

describe('balance and entries', () => {
  it('BAL-2: names, never "you owe"; the amount drawn apart', () => {
    expect(balanceWords({ kind: 'square' }, name)).toEqual({ words: 'All square', amount: null });
    const w = balanceWords({ kind: 'owes', debtor: S, creditor: J, amount: pence(2450) }, name);
    expect(`${w.words}${w.amount ?? ''}`).toBe('Sam owes Jae £24.50');
  });

  it('ACT-2 SPL-1 MB-1: the entry page sentence for each kind of split', () => {
    const base = { kind: 'expense', split_mode: 'ratio', paid: { [J]: 4250, [S]: 0 }, shares: { [J]: 2125, [S]: 2125 } };
    expect(entrySentence(base, people)).toBe('Jae paid. Jae £21.25, Sam £21.25');
    expect(entrySentence({ ...base, split_mode: 'for_other', paid: { [S]: 900 }, shares: { [J]: 900 } }, people)).toBe('Sam paid, all of it for Jae.');
    expect(entrySentence({ ...base, split_mode: 'treat', shares: { [J]: 4250 } }, people)).toBe('Jae paid. Jae’s treat.');
    expect(entrySentence({ ...base, kind: 'money_back', paid: { [J]: 1000 }, shares: { [J]: 500, [S]: 500 } }, people)).toBe('Jae got it back. Jae £5.00, Sam £5.00');
  });

  it('ADD-2: the split from the payer\'s side', () => {
    expect(splitWords({ mode: 'ratio', ratio: { [J]: 60, [S]: 40 } }, J, people)).toBe('60/40');
    expect(splitWords({ mode: 'ratio', ratio: { [J]: 60, [S]: 40 } }, S, people)).toBe('40/60');
    expect(splitWords({ mode: 'treat' }, S, people)).toBe('Sam’s treat');
    expect(splitWords({ mode: 'for_other' }, J, people)).toBe('for Sam');
  });
});

describe('history (ACT-2)', () => {
  const at = '2026-11-13T18:02:00Z';
  it('ACT-2: "Sam changed £42.50 to £45.20, yesterday 18:02"', () => {
    const line = historyLine(
      { actor: S, action: 'edited', at, summary: { amount_pence: { before: 4250, after: 4520 }, shares: { before: {}, after: {} }, paid: { before: { [J]: 4250 }, after: { [J]: 4520 } } } },
      people, '2026-11-14', 'Europe/London',
    );
    expect(line).toBe('Sam changed £42.50 to £45.20, yesterday 18:02');
  });

  it('ACT-2 ACT-3: added, deleted, restored, and other changes in words', () => {
    expect(historyLine({ actor: J, action: 'created', at, summary: {} }, people, '2026-11-13', 'Europe/London')).toBe('Jae added it, today 18:02');
    expect(historyLine({ actor: J, action: 'deleted', at, summary: {} }, people, '2026-11-20', 'Europe/London')).toBe('Jae deleted it, Fri 13 Nov 18:02');
    expect(historyLine({ actor: S, action: 'restored', at, summary: {} }, people, '2026-11-14', 'Europe/London')).toMatch(/^Sam restored it/);
    const both = historyLine(
      { actor: J, action: 'edited', at, summary: { description: { before: 'a', after: 'b' }, category_id: { before: 'x', after: 'y' } } },
      people, '2026-11-14', 'Europe/London',
    );
    expect(both).toBe('Jae changed the description and the category, yesterday 18:02');
    expect(historyLine({ actor: null, action: 'created', at, summary: {} }, people, '2026-11-14', 'Europe/London')).toMatch(/^Posted automatically/);
  });

  it('DAT-1: the time is the phone\'s own day and clock', () => {
    // 23:30 in London is already the next morning in Tokyo.
    expect(whenWords('2026-11-14T23:30:00Z', '2026-11-15', 'Asia/Tokyo')).toBe('today 08:30');
    expect(whenWords('2026-11-14T23:30:00Z', '2026-11-15', 'Europe/London')).toBe('yesterday 23:30');
  });
});

describe('change requests (PPL-4, PPL-5)', () => {
  const ask = (payload: object, by = S) => ({ requested_by: by, kind: 'identity', payload });
  it('PPL-5: the partner reads what was asked, with names', () => {
    expect(requestWords(ask({ user_id: S, display_name: 'Sammy', animal: 'dog' }), people, J)).toBe('Sam asked to change their name to Sammy');
    expect(requestWords(ask({ user_id: S, display_name: 'Sam', animal: 'cat' }), people, J)).toBe('Sam asked to be the cat');
    expect(requestWords(ask({ user_id: S, display_name: 'Sammy', animal: 'cat' }), people, J)).toBe('Sam asked to change their name to Sammy and be the cat');
    expect(requestWords({ requested_by: J, kind: 'default_ratio', payload: { ratio: { [J]: 60, [S]: 40 } } }, people, S)).toBe('Jae asked to make the usual split Jae 60%, Sam 40%');
  });
  it('PPL-5: the requester reads it as theirs', () => {
    expect(requestWords(ask({ user_id: S, display_name: 'Sammy', animal: 'dog' }), people, S)).toBe('You asked to change your name to Sammy.');
  });
});
