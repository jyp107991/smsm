/** S6a: a service charge over lines that are all £0 is shared equally, never lost (found by the property tests). */
import { describe, expect, it } from 'vitest';
import { itemise } from './itemise';
import { pence } from './money';

describe('itemise with £0 lines', () => {
  it('SCAN-2: a 1p service charge on one £0 line is that line’s; with two lines it goes to the first', () => {
    expect(itemise([{ label: 'Free', pence: pence(0) }], [true], pence(0), pence(1))).toEqual({ amount: 1, perLine: [1] });
    expect(itemise([{ label: 'A', pence: pence(0) }, { label: 'B', pence: pence(0) }], [true, true], pence(0), pence(3))).toEqual({ amount: 3, perLine: [2, 1] });
  });
});
