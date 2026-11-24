/**
 * The live eval (docs/AI.md §5): the receipts, loose-wording phrases, questions, category descriptions and recap months
 * in tests/ai/eval/, sent to Cloudflare Workers AI with the Worker's own prompts, models and fallbacks
 * (worker/ai-core.ts), through the Cloudflare REST API. Run by hand (`npm run eval:ai`, with CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID set) or by the manual "eval-ai" workflow. Prints the pass marks; writes them to
 * tests/ai/eval/last-run.md and the job summary.
 *
 * Every call draws on the account's free 10,000 Neurons a day, which the live app and MacroPy share (24 Nov: three full
 * runs used them all up, and the app's smart features rested until 00:00 UTC). So by default a run sends a stratified
 * sample (tests/ai/eval/plan.ts: 4 UK and 4 CORD receipts, 10 loose wordings, 10 questions, 10 category descriptions,
 * 4 recap months); EVAL_FULL=true (the workflow's "full" input) sends every case, only on a quiet day. Before the
 * first call it prints its Neuron estimate (worker/ai-budget.ts, Cloudflare's published rates); at the first answer
 * saying the allocation is used up it stops, says so, and sends nothing more. Each score states its sample size.
 *
 * Pass marks: total exactly right ≥ 95%; date ≥ 90%; merchant ≥ 90%; item-level F1 ≥ 0.85; parse ≥ 90%; ask ≥ 90%;
 * categorise right ≥ 85% with confident wrong guesses ≤ 5%; recap wording guarded and accepted ≥ 80%, with no accepted
 * wording carrying a figure that isn't the month's own.
 * What is scored is what the app would apply (24 Nov): a scan after the Worker's validation (printed amounts read by
 * code) and the phone's guards (src/core/itemise scanGuards: a low-confidence reply fills nothing); loose wording after
 * the phone's checks (src/core/loose readLoose: the amount the words give wins); a category guess as guessCategory
 * applies it (src/data/smartActions: only one of the household's categories, matched by name; Other is where an
 * unsorted entry already is, so it counts as no guess); recap wording after wordingGuard (src/core/wording), the
 * template headline otherwise.
 */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CategoriseReply, ParseReply, RecapReply, ScanReply } from '../../../src/core/aiReplies';
import { suggest } from '../../../src/core/categorise';
import { scanGuards } from '../../../src/core/itemise';
import { readLoose } from '../../../src/core/loose';
import { normaliseKey } from '../../../src/core/text';
import { wordingGuard } from '../../../src/core/wording';
import { DAILY_FREE_NEURONS, estimate } from '../../../worker/ai-budget';
import { buildRequest, extractText, MODELS, recapStatsSchema, validate, type TaskInput } from '../../../worker/ai-core';
import seedList from '../../../content/merchants.json';
import { isAllocationError, sampleCategorise, sampleReceipts, sampleRecap, sampleSpread, SAMPLE } from './plan';
import { NAMES, numbersIn, ownNumbers, recapMonths } from './recap-months';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const FULL = ['1', 'true', 'yes'].includes((process.env.EVAL_FULL ?? '').toLowerCase());
const DIR = new URL('.', import.meta.url).pathname;
const TODAY = '2026-11-18';
const CATEGORIES = ['Groceries', 'Eating out', 'Going out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Travel', 'Gifts', 'Health', 'Other'];
const CHAPTERS = ['Japan trip', 'New sofa'];
const COUNTRIES = ['GB', 'JP', 'FR'];

// ───────── the cases this run sends (a sample unless EVAL_FULL) ─────────
type Receipt = { merchant?: string; date?: string; total_pence: number; items: { label: string; pence: number }[] };
type ParseCase = { text: string; amount_pence: number; category: string; payer: string };
type AskCase = { question: string; expect: Record<string, unknown> };
type CategoriseCase = { description: string; category: string | null };
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const allReceipts = readdirSync(join(DIR, 'receipts')).filter((f) => f.endsWith('.json')).sort();
const allParse = readJson('parse.json') as ParseCase[];
const allAsk = readJson('ask.json') as AskCase[];
const allCategorise = readJson('categorise.json') as CategoriseCase[];
const allMonths = recapMonths();
const receipts = sampleReceipts(allReceipts, FULL);
const parseCases = sampleSpread(allParse, SAMPLE.parse, FULL);
const askCases = sampleSpread(allAsk, SAMPLE.ask, FULL);
const categoriseCases = sampleCategorise(allCategorise, FULL);
const months = sampleRecap(allMonths, FULL);
const image = (name: string) => readFileSync(join(DIR, 'receipts', name.replace('.json', '.jpg'))).toString('base64');
const scanInput = (img: string): TaskInput => ({ task: 'scan', image: img, categories: CATEGORIES, today: TODAY, country: 'GB' });
const parseInput = (c: ParseCase): TaskInput => ({ task: 'parse', text: c.text, categories: CATEGORIES, chapters: CHAPTERS, today: TODAY });
const askInput = (c: AskCase): TaskInput => ({ task: 'ask', question: c.question, categories: CATEGORIES, chapters: CHAPTERS, countries: COUNTRIES, today: TODAY });
const categoriseInput = (c: CategoriseCase): TaskInput => ({ task: 'categorise', description: c.description, categories: CATEGORIES });

/** "8 (sample; full set 40)" or "40 (full set)": beside every score. */
const size = (n: number, all: number) => (n === all ? `${String(n)} (full set)` : `${String(n)} (sample; full set ${String(all)})`);

/** Why calls failed (status and the start of the answer), counted, so a failed run says what went wrong. */
const failures = new Map<string, number>();
const failed = (why: string) => { failures.set(why, (failures.get(why) ?? 0) + 1); };
let calls = 0;
/** Set at the first answer saying the free daily allocation is used up: nothing more is sent. */
let stopped: string | null = null;

/** One task through the models in order, as the Worker does; the first valid reply wins. */
async function run(input: TaskInput): Promise<unknown> {
  for (const model of MODELS[input.task]) {
    if (stopped !== null) return null;
    try {
      calls += 1;
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildRequest(input, model)),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const text = await res.text();
        failed(`${model}: HTTP ${String(res.status)} ${text.slice(0, 160)}`);
        // The same allocation serves every model: asking the next one, or the next case, only adds failures.
        if (isAllocationError(text)) { stopped = `HTTP ${String(res.status)} from ${model} after ${String(calls)} calls`; return null; }
        continue;
      }
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

/** After the allocation ran out: the section says how far it got and judges no pass mark (its scores would be noise). */
function stoppedHere(section: string, done: number, of: number): boolean {
  if (stopped === null) return false;
  report.push(`## ${section}`, '', `- Not scored: the daily allocation was reached (${stopped}); ${String(done)} of ${String(of)} cases were scored before it.`, '');
  expect.soft(stopped, `Daily allocation reached: ${stopped}. Nothing more was sent; run again after 00:00 UTC.`).toBeNull();
  return true;
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pct = (n: number, d: number) => (d === 0 ? 100 : Math.round((100 * n) / d));
const report: string[] = ['# Live eval', '', `Run ${new Date().toISOString()}, ${FULL ? 'the full set (EVAL_FULL)' : 'the stratified sample (the default; EVAL_FULL=true for the full set)'}`, ''];

describe.skipIf(TOKEN === '' || ACCOUNT === '')('live eval (AI.md §5)', () => {
  beforeAll(() => {
    const inputs: TaskInput[] = [
      ...receipts.map((n) => scanInput(image(n))), ...parseCases.map(parseInput), ...askCases.map(askInput),
      ...categoriseCases.map(categoriseInput), ...months.map((m) => ({ task: 'recap' as const, stats: m.stats })),
    ];
    const e = estimate(inputs);
    const line = `Estimated Neurons: about ${String(e.expected)} (at most ${String(e.ceiling)} if every reply ran to its max_tokens), for ${String(e.calls)} cases, `
      + `each answered by its first model; a case its first model fails costs more. The account's free allocation is ${DAILY_FREE_NEURONS.toLocaleString('en-GB')} a day (00:00 UTC), `
      + 'shared with the live app and MacroPy. Rates: Cloudflare\'s pricing page, 24 Nov 2026 (worker/ai-budget.ts); the estimate runs high.';
    report.push(line, '');
    console.log(line);
  });

  it('receipts: total ≥ 95%, date ≥ 90%, merchant ≥ 90%, item F1 ≥ 0.85', { timeout: 30 * 60_000 }, async () => {
    let totals = 0; let dates = 0; let dated = 0; let merchants = 0; let named = 0; let tp = 0; let fp = 0; let fn = 0; let done = 0;
    const misses: string[] = [];
    const itemMisses: string[] = [];
    for (const name of receipts) {
      const want = readJson(join('receipts', name)) as Receipt;
      const reply = (await run(scanInput(image(name)))) as ScanReply | null;
      if (stopped !== null) break;
      done += 1;
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
    if (stoppedHere('Receipts', done, receipts.length)) return;
    const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
    report.push('## Receipts', '', `- ${size(receipts.length, allReceipts.length)} receipts`, `- Total exactly right: ${String(pct(totals, receipts.length))}% of ${String(receipts.length)} (pass ≥ 95%)`,
      `- Date: ${String(pct(dates, dated))}% of ${String(dated)} (pass ≥ 90%)`, `- Merchant: ${String(pct(merchants, named))}% of ${String(named)} (pass ≥ 90%)`,
      `- Item F1: ${String(Math.round(f1 * 100) / 100)} over ${String(receipts.length)} receipts (pass ≥ 0.85)`, '', ...misses.map((m) => `  - ${m}`), '',
      'Items not matched (label and hundredths):', '', ...itemMisses.map((m) => `  - ${m}`), '');
    expect.soft(pct(totals, receipts.length)).toBeGreaterThanOrEqual(95);
    expect.soft(pct(dates, dated)).toBeGreaterThanOrEqual(90);
    expect.soft(pct(merchants, named)).toBeGreaterThanOrEqual(90);
    expect.soft(f1).toBeGreaterThanOrEqual(0.85);
  });

  it('loose wording: ≥ 90% read right (amount, category, who paid)', { timeout: 20 * 60_000 }, async () => {
    let right = 0; let done = 0;
    const misses: string[] = [];
    for (const c of parseCases) {
      const reply = (await run(parseInput(c))) as ParseReply | null;
      if (stopped !== null) break;
      done += 1;
      const got = reply === null ? null : readLoose(reply, c.text).reply;
      const ok = got?.amount_pence === c.amount_pence && got.category === c.category && (got.payer ?? 'A') === c.payer;
      if (ok) right += 1; else misses.push(`"${c.text}": ${JSON.stringify(got)}`);
    }
    if (stoppedHere('Loose wording', done, parseCases.length)) return;
    report.push('## Loose wording', '', `- ${String(pct(right, parseCases.length))}% of ${size(parseCases.length, allParse.length)} (pass ≥ 90%)`, '', ...misses.map((m) => `  - ${m}`), '');
    expect.soft(pct(right, parseCases.length)).toBeGreaterThanOrEqual(90);
  });

  it('Ask smsm: ≥ 90% read into the right filter', { timeout: 20 * 60_000 }, async () => {
    let right = 0; let done = 0;
    const misses: string[] = [];
    for (const c of askCases) {
      const got = (await run(askInput(c))) as Record<string, unknown> | null;
      if (stopped !== null) break;
      done += 1;
      const flat: Record<string, unknown> = got && 'unsupported' in got ? { unsupported: true } : { measure: got?.measure, group_by: got?.group_by, ...((got?.filters as object | undefined) ?? {}) };
      const ok = got !== null && Object.entries(c.expect).every(([k, v]) => JSON.stringify(flat[k]) === JSON.stringify(v));
      if (ok) right += 1; else misses.push(`"${c.question}": ${JSON.stringify(got)}`);
    }
    if (stoppedHere('Ask smsm', done, askCases.length)) return;
    report.push('## Ask smsm', '', `- ${String(pct(right, askCases.length))}% of ${size(askCases.length, allAsk.length)} (pass ≥ 90%)`, '', ...misses.map((m) => `  - ${m}`), '');
    expect.soft(pct(right, askCases.length)).toBeGreaterThanOrEqual(90);
  });

  it('category guess: right ≥ 85%, confident wrong guesses ≤ 5%', { timeout: 20 * 60_000 }, async () => {
    const household = CATEGORIES.map((name) => ({ id: name, name }));
    /** What guessCategory would set (src/data/smartActions byName): a household category by name, else nothing. */
    const applied = (reply: CategoriseReply | null): string | null => {
      const name = reply?.category ?? null;
      if (name === null) return null;
      const hit = household.find((c) => c.name === name) ?? household.find((c) => normaliseKey(c.name) === normaliseKey(name));
      // Other is where an entry with no category already sits (guessCategory treats it as unset): no guess.
      return hit === undefined || hit.name === 'Other' ? null : hit.name;
    };
    let right = 0; let wrong = 0; let listed = 0; let endToEnd = 0; let done = 0;
    const misses: string[] = [];
    for (const c of categoriseCases) {
      // Sent whatever the built-in list says, so the AI is scored on every case; the list's own answer is reported too.
      const reply = (await run(categoriseInput(c))) as CategoriseReply | null;
      if (stopped !== null) break;
      done += 1;
      const got = applied(reply);
      const fromList = suggest(c.description, { memory: new Map(), history: [], seed: seedList, categories: household }).categoryId;
      if (fromList !== null) listed += 1;
      if ((fromList ?? got) === c.category) endToEnd += 1;
      if (got === c.category) right += 1;
      else {
        if (got !== null) wrong += 1;
        misses.push(`"${c.description}": ${got === null ? 'no guess' : `${got} (confident, wrong)`}, wanted ${c.category ?? 'no guess'}`);
      }
    }
    if (stoppedHere('Category guess', done, categoriseCases.length)) return;
    const n = categoriseCases.length;
    report.push('## Category guess', '', `- ${size(n, allCategorise.length)} descriptions`, `- Right: ${String(pct(right, n))}% of ${String(n)} (pass ≥ 85%)`,
      `- Confident and wrong: ${String(pct(wrong, n))}% of ${String(n)} (${String(wrong)}; pass ≤ 5%)`,
      `- For reference: the built-in list answers ${String(listed)} of them before the AI is asked; list first, then the AI, ${String(pct(endToEnd, n))}% right`,
      '', ...misses.map((m) => `  - ${m}`), '');
    expect.soft(pct(right, n)).toBeGreaterThanOrEqual(85);
    expect.soft(pct(wrong, n)).toBeLessThanOrEqual(5);
  });

  it('recap wording: ≥ 80% guarded and accepted; no accepted wording with a figure that isn’t the month’s', { timeout: 20 * 60_000 }, async () => {
    let accepted = 0; let foreign = 0; let done = 0;
    const lines: string[] = [];
    for (const m of months) {
      // The Worker refuses figures that aren't exactly the recap's keys; these are what the phone sends.
      expect(recapStatsSchema.safeParse(m.stats).success, m.month).toBe(true);
      const reply = (await run({ task: 'recap', stats: m.stats })) as RecapReply | null;
      if (stopped !== null) break;
      done += 1;
      const shown = reply === null ? null : wordingGuard(m.stats, reply, NAMES);
      const label = `${m.month} (${m.scenario}${m.chapter ? ', chapter' : ''}${m.moneyBack ? ', money back' : ''})`;
      if (reply === null) { lines.push(`  - ${label}: no valid reply; template "${m.recap.headline}"`); continue; }
      const said = `"${reply.headline}"${reply.aside === null ? '' : ` / "${reply.aside}"`}`;
      if (shown === null) { lines.push(`  - ${label}: rejected by the guard, template used. It said ${said}`); continue; }
      accepted += 1;
      const own = ownNumbers(m.stats);
      const stray = numbersIn(`${shown.headline} ${shown.aside ?? ''}`).filter((x) => !own.has(x));
      if (stray.length > 0) foreign += 1;
      lines.push(`  - ${label}: accepted${stray.length > 0 ? ` WITH A FIGURE NOT THE MONTH'S (${stray.join(', ')})` : ''}: ${said}`);
    }
    if (stoppedHere('Recap wording', done, months.length)) return;
    report.push('## Recap wording', '', `- ${size(months.length, allMonths.length)} months`,
      `- Guarded and accepted: ${String(pct(accepted, months.length))}% of ${String(months.length)} (pass ≥ 80%; the rest show the template headline)`,
      `- Accepted with a figure that isn't the month's own: ${String(foreign)} (pass: 0)`, '', ...lines, '');
    expect.soft(pct(accepted, months.length)).toBeGreaterThanOrEqual(80);
    expect.soft(foreign).toBe(0);
  });

  afterAll(() => {
    if (stopped !== null) {
      report.splice(4, 0, `**Stopped early: the daily free allocation is used up** (${stopped}). Nothing more was sent. The app's smart features fall back until 00:00 UTC; run again after that.`, '');
    }
    report.push(`Calls sent: ${String(calls)}.`, '');
    report.push('## Why calls failed', '', ...[...failures].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([why, n]) => `- ${String(n)}× ${why}`), '');
    const text = `${report.join('\n')}\n`;
    writeFileSync(join(DIR, 'last-run.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    console.log(text);
  });
});
