/**
 * What the smart features cost in Workers AI Neurons (docs/AI.md "Cost"), worked out from Cloudflare's published rates,
 * so the daily caps (ai-core capFor) can be checked against the account's free allocation, and the live eval can say
 * before it starts what a run will use. Pure: no Worker or browser APIs.
 *
 * Rates: developers.cloudflare.com/workers-ai/platform/pricing/, read 24 Nov 2026 ("Neurons per M input / output
 * tokens"). Re-read them whenever MODELS changes; worker/ai-budget.test.ts fails if a model in MODELS has no rate.
 */
import { buildRequest, capFor, MODELS, type Task, type TaskInput } from './ai-core';

/** Neurons per million input and output tokens, as Cloudflare's pricing page lists them (24 Nov 2026). */
export const NEURONS_PER_M: Readonly<Record<string, { input: number; output: number }>> = {
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 24545, output: 77273 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { input: 31876, output: 50488 },
  '@cf/qwen/qwen3.8-27b': { input: 40909, output: 290909 },
  '@cf/openai/gpt-oss-120b': { input: 31818, output: 68182 },
  '@cf/openai/gpt-oss-20b': { input: 18182, output: 27273 },
};

/** The account's free Workers AI allocation per day (resets 00:00 UTC), shared with MacroPy on the same account. */
export const DAILY_FREE_NEURONS = 10_000;
/** smsm's share of it: at most about 60%, leaving the rest for MacroPy and for the live eval. */
export const SMSM_SHARE = 0.6;

/**
 * Input tokens for one photo, an upper bound. Cloudflare does not publish how images are counted. A 1280 px photo is at
 * most 16 tiles of 336 px at 144 tokens each plus an overview for Llama 4 (2,448), and about 1,600 for Mistral
 * Small 3.1 and Qwen (16 or 14 px patches, merged 2 × 2); 2,500 covers all three.
 */
export const IMAGE_TOKENS = 2_500;
/** Characters per token, on the low side (English is about 4; JSON, digits and Korean are denser), so estimates run high. */
const CHARS_PER_TOKEN = 3;

/** What a reply usually takes, reasoning included (gpt-oss and Qwen think a little even at "low"); the ceiling is max_tokens. */
export const EXPECTED_OUTPUT: Readonly<Record<Task, number>> = { scan: 700, parse: 250, categorise: 120, recap: 200, ask: 250 };

/** The input tokens of a request as buildRequest makes it: its text, and IMAGE_TOKENS for each photo. */
export function inputTokens(request: Record<string, unknown>): number {
  let chars = 0;
  let images = 0;
  const messages = (request.messages ?? []) as { content: unknown }[];
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content as { type?: string; text?: string }[]) {
        if (part.type === 'image_url') images += 1;
        else chars += part.text?.length ?? 0;
      }
    }
    chars += 16; // the chat template's few tokens around each message
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

/** Neurons one call to one model uses: its input, and the reply at its usual length or at max_tokens. */
export function callNeurons(input: TaskInput, model: string, reply: 'expected' | 'max' = 'expected'): number {
  const rate = NEURONS_PER_M[model];
  if (!rate) throw new Error(`no published Neuron rate recorded for ${model} (worker/ai-budget.ts)`);
  const request = buildRequest(input, model);
  const output = reply === 'max' ? Number(request.max_tokens) : EXPECTED_OUTPUT[input.task];
  return (inputTokens(request) * rate.input + output * rate.output) / 1_000_000;
}

/** Neurons for a set of calls, each answered by its task's first model (what a run normally uses), and at max_tokens. */
export function estimate(inputs: readonly TaskInput[]): { expected: number; ceiling: number; calls: number } {
  let expected = 0;
  let ceiling = 0;
  for (const i of inputs) {
    const first = MODELS[i.task][0] ?? '';
    expected += callNeurons(i, first, 'expected');
    ceiling += callNeurons(i, first, 'max');
  }
  return { expected: Math.round(expected), ceiling: Math.round(ceiling), calls: inputs.length };
}

const CATEGORY_NAMES = ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other'];
/** A household with the twelve defaults and eight of its own (names of a typical length). */
const HOUSEHOLD = [...CATEGORY_NAMES, 'Pets', 'Car', 'Garden', 'Kids', 'Wedding fund', 'Charity', 'Hobbies', 'Clothes'];
const LONG = (n: number) => 'x'.repeat(n);

/** The largest call of each task a household can make, as the Worker accepts it (its length limits). */
export const LARGEST: Readonly<Record<Task, TaskInput>> = {
  scan: { task: 'scan', image: '', categories: HOUSEHOLD, today: '2026-11-24', country: 'GB' },
  parse: { task: 'parse', text: LONG(300), categories: HOUSEHOLD, chapters: ['Japan trip', 'New sofa', 'Wedding'], today: '2026-11-24' },
  categorise: { task: 'categorise', description: LONG(200), categories: HOUSEHOLD },
  recap: {
    task: 'recap',
    stats: {
      period: '2026-10', month: 'September', total: '£12,345.67', everyday: '£12,345.67', usual: '£12,345.67',
      comparison: { direction: 'more', amount: '£1,230' },
      bar: Array.from({ length: 5 }, () => ({ name: LONG(20), total: '£12,345.67' })),
      notes: Array.from({ length: 3 }, () => LONG(120)),
      paid: { A: '£12,345.67', B: '£12,345.67' },
    },
  },
  ask: { task: 'ask', question: LONG(300), categories: HOUSEHOLD, chapters: ['Japan trip', 'New sofa', 'Wedding'], countries: ['GB', 'JP', 'FR', 'KR', 'ES'], today: '2026-11-24' },
};

/**
 * One household's worst day at the caps: every task used up to its cap, each call the largest the Worker accepts,
 * answered by its first model at max_tokens. `fallThrough` is the same day if every call were also refused by each
 * earlier model with a billed reply and answered by the last (rare: most failures are errors or time-outs).
 */
export function worstCaseDay(): { byTask: Record<Task, number>; total: number; fallThrough: number } {
  const tasks = Object.keys(MODELS) as Task[];
  const byTask = {} as Record<Task, number>;
  let total = 0;
  let fallThrough = 0;
  for (const t of tasks) {
    const input = LARGEST[t];
    const first = callNeurons(input, MODELS[t][0] ?? '', 'max');
    const all = MODELS[t].reduce((s, m) => s + callNeurons(input, m, 'max'), 0);
    byTask[t] = Math.round(first * capFor(t));
    total += first * capFor(t);
    fallThrough += all * capFor(t);
  }
  return { byTask, total: Math.round(total), fallThrough: Math.round(fallThrough) };
}
