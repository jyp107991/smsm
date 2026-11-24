/**
 * The misses of the first live eval (run 45367987613 on main c6b7c69, 24 Nov 2026), as recorded replies run through
 * what the app does with them: the Worker's validation (worker/ai-core validate, which reads printed amounts with
 * src/core/money parsePrinted), the phone's guards (src/core/itemise scanGuards, checkTotal) and the loose-wording
 * checks (src/core/loose readLoose). Each asserts the result the app applies, not what the model said.
 * Fixtures: tests/ai/replies/eval-misses-scan.json and eval-misses-parse.json (their "source" says where each came from).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanSchema } from '../src/core/aiReplies';
import { checkTotal, scanGuards } from '../src/core/itemise';
import { readLoose } from '../src/core/loose';
import { pence } from '../src/core/money';
import { buildRequest, MODELS, validate } from './ai-core';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/ai/replies/${name}.json`, import.meta.url), 'utf8'));
const TODAY = '2026-11-18';
// The app's default categories, as a new household gets them (supabase/schema.sql create_household).
const CATEGORIES = ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other'];

type ScanCase = { receipt: string; reply: Record<string, unknown>; want: { total_pence: number; items: { label: string; pence: number }[] } };
type ParseCase = { text: string; reply: Record<string, unknown>; want: { amount_pence: number; category: string; payer: string; split: { mode: string; ratio: null } | null } };
const scans = (fixture('eval-misses-scan') as { cases: ScanCase[] }).cases;
const parses = (fixture('eval-misses-parse') as { cases: ParseCase[] }).cases;

describe('receipts in a currency that groups thousands with a dot or comma (SCAN-1, SCAN-3; AI.md §3.1)', () => {
  for (const c of scans) {
    it(`SCAN-1: ${c.receipt}: the printed amounts, read by code, win over the model's integers`, () => {
      const v = validate('scan', JSON.stringify(c.reply));
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      // What the Worker sends the phone is the phone's own shape, unchanged: no printed text, whole hundredths.
      expect(scanSchema.safeParse(v.data).success).toBe(true);
      expect(Object.keys(v.data).some((k) => k.endsWith('_text'))).toBe(false);
      const guarded = scanGuards(v.data, TODAY, CATEGORIES);
      expect(guarded?.total_pence).toBe(c.want.total_pence);
      expect(guarded?.items).toEqual(c.want.items);
      expect(guarded?.currency).toBe('IDR');
    });
  }

  it('SCAN-3: the lines read from print add up to the printed total (service, tax and discount read the same way)', () => {
    for (const name of ['cord-03', 'cord-08', 'cord-19', 'cord-05']) {
      const c = scans.find((s) => s.receipt === name);
      const v = validate('scan', c?.reply);
      if (!v.ok) throw new Error(name);
      const g = v.data;
      const items = g.items.map((l) => ({ label: l.label, pence: pence(l.pence) }));
      expect(checkTotal(items, pence(g.discount_pence), pence(g.service_pence), g.total_pence === null ? null : pence(g.total_pence), pence(g.tax_pence ?? 0)).adds, name).toBe(true);
    }
  });

  it('SCAN-3: a printed total that the lines don’t make is flagged, and the person sets the amount', () => {
    const c = scans.find((s) => s.receipt === 'cord-19');
    const misread = { ...c?.reply, total_text: '377,059' };
    const v = validate('scan', misread);
    if (!v.ok) throw new Error('invalid');
    expect(v.data.total_pence).toBe(37_705_900);
    const items = v.data.items.map((l) => ({ label: l.label, pence: pence(l.pence) }));
    expect(checkTotal(items, pence(0), pence(v.data.service_pence), pence(37_705_900), pence(v.data.tax_pence ?? 0))).toEqual({ adds: false, lines: 37_785_900 });
  });

  it('SCAN-5: printed text that isn’t one amount gives no figure (never the model’s integer instead)', () => {
    const c = scans.find((s) => s.receipt === 'cord-01');
    const v = validate('scan', { ...c?.reply, total_text: '60.000 2', items: [{ label: '-TICKET CP', pence: 6000, price_text: '2 x 60.000' }] });
    if (!v.ok) throw new Error('invalid');
    expect(v.data.total_pence).toBeNull();
    expect(v.data.items).toEqual([]);
  });

  it('SCAN-1: a reply without printed text (an older prompt, or a model that leaves it out) is read as before', () => {
    const v = validate('scan', { merchant: 'Tesco', date: '2026-11-12', currency: 'GBP', total_pence: 1399, items: [{ label: 'Milk', pence: 120 }], discount_pence: 0, service_pence: 0, category: 'Groceries', confidence: 'high' });
    expect(v).toEqual({ ok: true, data: { merchant: 'Tesco', date: '2026-11-12', currency: 'GBP', total_pence: 1399, items: [{ label: 'Milk', pence: 120 }], discount_pence: 0, service_pence: 0, category: 'Groceries', confidence: 'high' } });
  });

  it('SCAN-1: large amounts in currencies with small units still read (Rp 1.250.000, ₫ 2.500.000)', () => {
    const v = validate('scan', { merchant: null, date: null, currency: 'VND', total_text: '2.500.000', items: [{ label: 'Phở', price_text: '2.500.000' }], discount_text: null, service_text: null, category: null, confidence: 'high' });
    expect(v.ok && v.data.total_pence).toBe(250_000_000);
  });

  it('SCAN-1: the scan prompt asks for every amount as printed and leaves the arithmetic to code', () => {
    const req = buildRequest({ task: 'scan', image: 'x', categories: CATEGORIES, today: TODAY, country: 'GB' }, MODELS.scan[0] ?? '');
    const system = (req.messages as { content: string }[])[0]?.content ?? '';
    for (const key of ['total_text', 'price_text', 'discount_text', 'service_text', 'tax_text']) expect(system).toContain(key);
    expect(system).toMatch(/exactly as printed/i);
    expect(system).not.toMatch(/hundredths/i);
  });
});

describe('loose wording (ADD-9; AI.md §3.2)', () => {
  for (const c of parses) {
    it(`ADD-9: "${c.text}": the amount and split the app applies are right`, () => {
      const v = validate('parse', JSON.stringify(c.reply));
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      const { reply } = readLoose(v.data, c.text);
      expect(reply.amount_pence).toBe(c.want.amount_pence);
      expect(reply.payer ?? 'A').toBe(c.want.payer);
      expect(reply.split).toEqual(c.want.split);
    });
  }

  it('ADD-9: the parse prompt says "B paid" or "B got" names the payer only, and what makes a treat or "for B"', () => {
    const req = buildRequest({ task: 'parse', text: 'x', categories: CATEGORIES, chapters: [], today: TODAY }, MODELS.parse[0] ?? '');
    const system = (req.messages as { content: string }[])[0]?.content ?? '';
    expect(system).toMatch(/"B paid"[^.]*only[^.]*payer|only[^.]*payer[^.]*"B paid"/i);
    expect(system).toMatch(/my treat/);
    expect(system).toMatch(/for B/);
  });

  it('ADD-9: the parse prompt describes the app’s default categories, so a kettle is Household, a TV licence Rent & bills and the vet Other', () => {
    const req = buildRequest({ task: 'parse', text: 'x', categories: CATEGORIES, chapters: [], today: TODAY }, MODELS.parse[0] ?? '');
    const system = (req.messages as { content: string }[])[0]?.content ?? '';
    const hint = (name: string) => new RegExp(`${name.replace(/[&]/g, '\\$&')}: [^\\n]+`).exec(system)?.[0] ?? '';
    for (const name of CATEGORIES) expect(hint(name), name).not.toBe('');
    expect(hint('Household')).toMatch(/kettle/);
    expect(hint('Rent & bills')).toMatch(/TV licence/);
    expect(hint('Groceries')).toMatch(/wine and cheese/);
    expect(hint('Other')).toMatch(/vet/);
    expect(hint('Other')).toMatch(/haircut/);
    expect(hint('Health')).not.toMatch(/vet|haircut/);
  });
});
