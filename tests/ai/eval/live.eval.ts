/**
 * The live eval (docs/AI.md §5): the receipts, loose-wording phrases and questions in tests/ai/eval/, sent to Cloudflare
 * Workers AI with the Worker's own prompts, models and fallbacks (worker/ai-core.ts), through the Cloudflare REST API.
 * Run by hand (`npm run eval:ai`, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set) or by the manual
 * "eval-ai" workflow. Prints the pass marks; writes them to tests/ai/eval/last-run.md and the job summary.
 * Pass marks: total exactly right ≥ 95%; date ≥ 90%; merchant ≥ 90%; item-level F1 ≥ 0.85; parse ≥ 90%; ask ≥ 90%.
 * What is scored is what the app would apply (24 Nov): a scan after the Worker's validation (printed amounts read by
 * code) and the phone's guards (src/core/itemise scanGuards: a low-confidence reply fills nothing); loose wording after
 * the phone's checks (src/core/loose readLoose: the amount the words give wins).
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParseReply, ScanReply } from '../../../src/core/aiReplies';
import { scanGuards } from '../../../src/core/itemise';
import { readLoose } from '../../../src/core/loose';
import { buildRequest, extractText, MODELS, validate, type TaskInput } from '../../../worker/ai-core';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const DIR = new URL('.', import.meta.url).pathname;
const TODAY = '2026-11-18';
const CATEGORIES = ['Groceries', 'Eating out', 'Going out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Travel', 'Gifts', 'Health', 'Other'];
const CHAPTERS = ['Japan trip', 'New sofa'];

/** Why calls failed (status and the start of the answer), counted, so a failed run says what went wrong. */
const failures = new Map<string, number>();
const failed = (why: string) => { failures.set(why, (failures.get(why) ?? 0) + 1); };

/** One task through the models in order, as the Worker does; the first valid reply wins. */
async function run(input: TaskInput): Promise<unknown> {
  for (const model of MODELS[input.task]) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildRequest(input, model)),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) { failed(`${model}: HTTP ${String(res.status)} ${(await res.text()).slice(0, 160)}`); continue; }
      const body = (await res.json()) as { result?: unknown };
      const text = extractText(body.result);
      if (text === null) { failed(`${model}: no text in ${JSON.stringify(body).slice(0, 160)}`); continue; }
      const out = validate(input.task, text);
      if (out.ok) return out.data;
      failed(`${model}: invalid reply ${text.slice(0, 120)}`);
    } catch (e) { failed(`${model}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)); }
  }
  return null;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pct = (n: number, d: number) => (d === 0 ? 100 : Math.round((100 * n) / d));
const report: string[] = ['# Live eval', '', `Run ${new Date().toISOString()}`, ''];

describe.skipIf(TOKEN === '' || ACCOUNT === '')('live eval (AI.md §5)', () => {
  it('receipts: total ≥ 95%, date ≥ 90%, merchant ≥ 90%, item F1 ≥ 0.85', { timeout: 30 * 60_000 }, async () => {
    const names = readdirSync(join(DIR, 'receipts')).filter((f) => f.endsWith('.json')).sort();
    let totals = 0; let dates = 0; let dated = 0; let merchants = 0; let named = 0; let tp = 0; let fp = 0; let fn = 0;
    const misses: string[] = [];
    const itemMisses: string[] = [];
    for (const name of names) {
      const want = JSON.parse(readFileSync(join(DIR, 'receipts', name), 'utf8')) as {
        merchant?: string; date?: string; total_pence: number; items: { label: string; pence: number }[];
      };
      const image = readFileSync(join(DIR, 'receipts', name.replace('.json', '.jpg'))).toString('base64');
      const reply = (await run({ task: 'scan', image, categories: CATEGORIES, today: TODAY, country: 'GB' })) as ScanReply | null;
      const got = reply === null ? null : scanGuards(reply, TODAY, CATEGORIES);
      if (got?.total_pence === want.total_pence) totals += 1; else misses.push(`${name}: total ${got === null ? (reply === null ? 'no valid reply' : 'nothing filled (low confidence)') : String(got.total_pence)} ≠ ${String(want.total_pence)}`);
      if (want.date) { dated += 1; if (got?.date === want.date) dates += 1; }
      if (want.merchant) { named += 1; if (got?.merchant && norm(got.merchant).includes(norm(want.merchant).split(' ')[0] ?? '')) merchants += 1; }
      const left = [...(got?.items ?? [])];
      const missed: string[] = [];
      for (const w of want.items) {
        const i = left.findIndex((g) => g.pence === w.pence && (norm(g.label).includes(norm(w.label).split(' ')[0] ?? '') || norm(w.label).includes(norm(g.label).split(' ')[0] ?? '')));
        if (i >= 0) { tp += 1; left.splice(i, 1); } else { fn += 1; missed.push(`${w.label} ${String(w.pence)}`); }
      }
      fp += left.length;
      if (missed.length > 0 || left.length > 0) {
        itemMisses.push(`${name}: missed [${missed.join('; ')}], extra [${left.map((g) => `${g.label} ${String(g.pence)}`).join('; ')}]`);
      }
    }
    const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
    report.push('## Receipts', '', `- ${String(names.length)} receipts`, `- Total exactly right: ${String(pct(totals, names.length))}% (pass ≥ 95%)`,
      `- Date: ${String(pct(dates, dated))}% of ${String(dated)} (pass ≥ 90%)`, `- Merchant: ${String(pct(merchants, named))}% of ${String(named)} (pass ≥ 90%)`,
      `- Item F1: ${String(Math.round(f1 * 100) / 100)} (pass ≥ 0.85)`, '', ...misses.map((m) => `  - ${m}`), '',
      'Items not matched (label and hundredths):', '', ...itemMisses.map((m) => `  - ${m}`), '');
    expect.soft(pct(totals, names.length)).toBeGreaterThanOrEqual(95);
    expect.soft(pct(dates, dated)).toBeGreaterThanOrEqual(90);
    expect.soft(pct(merchants, named)).toBeGreaterThanOrEqual(90);
    expect.soft(f1).toBeGreaterThanOrEqual(0.85);
  });

  it('loose wording: ≥ 90% read right (amount, category, who paid)', { timeout: 20 * 60_000 }, async () => {
    const cases = JSON.parse(readFileSync(join(DIR, 'parse.json'), 'utf8')) as { text: string; amount_pence: number; category: string; payer: string }[];
    let right = 0;
    const misses: string[] = [];
    for (const c of cases) {
      const reply = (await run({ task: 'parse', text: c.text, categories: CATEGORIES, chapters: CHAPTERS, today: TODAY })) as ParseReply | null;
      const got = reply === null ? null : readLoose(reply, c.text).reply;
      const ok = got?.amount_pence === c.amount_pence && got.category === c.category && (got.payer ?? 'A') === c.payer;
      if (ok) right += 1; else misses.push(`"${c.text}": ${JSON.stringify(got)}`);
    }
    report.push('## Loose wording', '', `- ${String(pct(right, cases.length))}% of ${String(cases.length)} (pass ≥ 90%)`, '', ...misses.map((m) => `  - ${m}`), '');
    expect.soft(pct(right, cases.length)).toBeGreaterThanOrEqual(90);
  });

  it('Ask smsm: ≥ 90% read into the right filter', { timeout: 20 * 60_000 }, async () => {
    const cases = JSON.parse(readFileSync(join(DIR, 'ask.json'), 'utf8')) as { question: string; expect: Record<string, unknown> }[];
    let right = 0;
    const misses: string[] = [];
    for (const c of cases) {
      const got = (await run({ task: 'ask', question: c.question, categories: CATEGORIES, chapters: CHAPTERS, countries: ['GB', 'JP', 'FR'], today: TODAY })) as Record<string, unknown> | null;
      const flat: Record<string, unknown> = got && 'unsupported' in got ? { unsupported: true } : { measure: got?.measure, group_by: got?.group_by, ...((got?.filters as object | undefined) ?? {}) };
      const ok = got !== null && Object.entries(c.expect).every(([k, v]) => JSON.stringify(flat[k]) === JSON.stringify(v));
      if (ok) right += 1; else misses.push(`"${c.question}": ${JSON.stringify(got)}`);
    }
    report.push('## Ask smsm', '', `- ${String(pct(right, cases.length))}% of ${String(cases.length)} (pass ≥ 90%)`, '', ...misses.map((m) => `  - ${m}`), '');
    expect.soft(pct(right, cases.length)).toBeGreaterThanOrEqual(90);
    report.push('## Why calls failed', '', ...[...failures].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([why, n]) => `- ${String(n)}× ${why}`), '');
    const text = `${report.join('\n')}\n`;
    writeFileSync(join(DIR, 'last-run.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    console.log(text);
  });
});
