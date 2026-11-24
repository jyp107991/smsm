/**
 * The live eval's misses (run 45367987613, 24 Nov 2026) where the phone applies a reply (docs/AI.md §3.1, §3.2):
 * - parseLoose: the words' own amount (core/loose wordsAmount) wins over the AI's, a disagreement is reported to
 *   client_errors without the words or the amounts, and a treat the words don't mention becomes the default split.
 * - readReceipt: a reply carrying printed amounts is read by code, the same way as on the Worker.
 * Recorded replies: tests/ai/replies/eval-misses-parse.json and eval-misses-scan.json.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couple, JAE_ID, SAM_ID } from '../../tests/fixtures/couple';
import { fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, type AiResult } from '../../tests/fixtures/smart';
import { parseLoose, readReceipt, setSmartFeatures } from './index';
import type { DataLayer } from './queryClient';

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), 'tests/ai/replies', `${name}.json`), 'utf8'));
type ParseCase = { text: string; reply: Record<string, unknown>; want: { amount_pence: number; split: unknown } };
type ScanCase = { receipt: string; reply: Record<string, unknown>; want: { total_pence: number; items: unknown[] } };
const parses = (fixture('eval-misses-parse') as { cases: ParseCase[] }).cases;
const scans = (fixture('eval-misses-scan') as { cases: ScanCase[] }).cases;
const ok = (d: unknown): AiResult => ({ ok: true, data: d });

const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });

function household(ai: ReturnType<typeof fakeAi>, report = vi.fn()) {
  const c = couple({ ai, photos: memoryPhotos(), downscale: fakeDownscale(), report });
  open.push(c.layer);
  act(() => { setSmartFeatures(true); });
  return { ...c, report };
}
const miss = (text: string) => {
  const c = parses.find((p) => p.text === text);
  if (!c) throw new Error(text);
  return c;
};

describe('parseLoose applies code-checked amounts and splits (ADD-9; AI.md §3.2)', () => {
  it('ADD-9: "B paid for the hotel in bath, 189": £189.00 from the words (not 189p), Sam paid, the household’s default split', async () => {
    const c = miss('B paid for the hotel in bath, 189');
    const h = household(fakeAi({ parse: ok(c.reply) }));
    await h.layer.ready;
    const r = await parseLoose('Sam paid for the hotel in bath, 189', h.layer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ amount: 18900, payer: SAM_ID, split: null });
  });

  it('ADD-9: "birthday present for B\'s sister 35": the AI found no amount; the words give £35.00, and "B\'s" keeps "for Sam"', async () => {
    const c = miss("birthday present for B's sister 35");
    const h = household(fakeAi({ parse: ok(c.reply) }));
    await h.layer.ready;
    const r = await parseLoose("birthday present for Sam's sister 35", h.layer);
    expect(r.ok && r.data).toMatchObject({ amount: 3500, payer: JAE_ID, split: { mode: 'for_other' } });
  });

  it('ADD-9: a disagreement between the words and the AI is reported, with neither the words nor the amounts', async () => {
    const c = miss('B paid for the hotel in bath, 189');
    const h = household(fakeAi({ parse: ok(c.reply) }));
    await h.layer.ready;
    await parseLoose('Sam paid for the hotel in bath, 189', h.layer);
    expect(h.report).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify((h.report.mock.calls[0] as unknown[] | undefined)?.map((x) => (x instanceof Error ? x.message : x)));
    expect(sent).toMatch(/ai amount disagreed/);
    for (const s of ['hotel', 'bath', '189', '18900', 'Sam']) expect(sent).not.toContain(s);
  });

  it('ADD-9: when they agree, or the words give no amount ("twenty five quid"), nothing is reported', async () => {
    for (const text of ['vet for the cat, 72 pounds, B paid', 'haircut for B, twenty five quid']) {
      const c = miss(text);
      const h = household(fakeAi({ parse: ok(c.reply) }));
      await h.layer.ready;
      const r = await parseLoose(text, h.layer);
      expect(r.ok && r.data.amount, text).toBe(c.want.amount_pence);
      expect(h.report, text).not.toHaveBeenCalled();
    }
  });

  it('ADD-9: "B got wine and cheese for friday, 22.40": a treat the words never mention is dropped', async () => {
    const c = miss('B got wine and cheese for friday, 22.40');
    const h = household(fakeAi({ parse: ok(c.reply) }));
    await h.layer.ready;
    const r = await parseLoose('Sam got wine and cheese for friday, 22.40', h.layer);
    expect(r.ok && r.data).toMatchObject({ amount: 2240, payer: SAM_ID, split: null });
  });
});

describe('readReceipt reads printed amounts with code (SCAN-1; AI.md §3.1)', () => {
  it('SCAN-1: a reply with printed rupiah ("377,859") fills Rp 377,859 (37785900 hundredths), whatever the model’s integer', async () => {
    const c = scans.find((s) => s.receipt === 'cord-19');
    const h = household(fakeAi({ scan: ok(c?.reply) }));
    await h.layer.ready;
    const r = await readReceipt(receiptPhoto(), h.layer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.total_pence).toBe(c?.want.total_pence);
    expect(r.data.items).toEqual(c?.want.items);
    expect(Object.keys(r.data).some((k) => k.endsWith('_text'))).toBe(false);
  });
});
