/** S6a fresh review: names never reach the AI in a guess; photos that can't be redrawn are refused; a photo refusal is said plainly. */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID, TODAY } from '../../tests/fixtures/couple';
import { fakeAi } from '../../tests/fixtures/smart';
import { pence } from '../core/money';
import { addExpense } from './mutations';
import { PhotoUnreadableError, shrink } from './photos';
import { refusalReason } from './problems';
import type { DataLayer } from './queryClient';
import { guessCategory, setSmartFeatures } from './smartActions';

const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });
async function settle(layer: DataLayer) { await act(async () => { await layer.idle(); }); }

describe('privacy (review 6)', () => {
  it('CAT-2: a guess sends the people as A and B, never by name', async () => {
    const ai = fakeAi({ categorise: { ok: true, data: { category: null } } });
    const c = couple({ ai });
    open.push(c.layer);
    await c.layer.ready;
    await settle(c.layer);
    setSmartFeatures(true);
    const id = addExpense({
      description: 'Zzyzx with Sam and jae', amount: pence(1800), date: TODAY, categoryId: null, payer: JAE_ID,
      split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } },
    }, c.layer);
    await settle(c.layer);
    await guessCategory(id, c.layer);
    const [sent] = ai.categorise.mock.calls[0] ?? [];
    expect(String(sent)).toBe('Zzyzx with B and A');
  });

  it('SCAN-1: a photo the phone can’t redraw is refused, never sent as it is (its EXIF could say where it was taken)', async () => {
    await expect(shrink(new Blob(['not an image'], { type: 'image/heic' }))).rejects.toBeInstanceOf(PhotoUnreadableError);
  });
});

describe('a photo that couldn’t go up (review 10)', () => {
  it('OFF-5: it is reported as the photo, in plain words, not as the entry', () => {
    expect(refusalReason('the photo is no longer on this phone', 'photo-missing')).toBe('photo');
    expect(refusalReason('mime type image/png is not supported', '')).toBe('photo');
  });
});
