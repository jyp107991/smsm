/**
 * The AI route's pure parts (S6a; docs/AI.md): the request to Cloudflare Workers AI (through the app's own Worker:
 * no key anywhere, the account's free daily allowance), the reply's text, validation of what came back (zod), the
 * caps, timeouts and the models asked in order. No Worker or browser APIs, so Vitest runs it, and the phone reuses
 * the same validation (AI.md rule 3: validated on the server and again on the phone).
 */
import { z } from 'zod';
import * as categorisePrompt from './prompts/categorise.ts';
import * as parsePrompt from './prompts/parse.ts';
import * as scanPrompt from './prompts/scan.ts';

export type Task = 'scan' | 'parse' | 'categorise';
export type Reason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: Reason };

/**
 * The models each task asks, in order; the next is tried when one fails or is too slow (owner, 17 Nov: "use free
 * ones that macropy is using"). Scan needs a model that reads images; JSON is asked for in the prompt and checked
 * here (Workers AI's JSON mode covers only some text models, none that read images).
 */
export const MODELS: Record<Task, readonly string[]> = {
  scan: ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/qwen/qwen3.8-27b'],
  parse: ['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3-30b-a3b-fp8'],
  categorise: ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/openai/gpt-oss-20b'],
};
/** Options a model needs (thinking off or low where a model thinks; MacroPy's settings). */
export const MODEL_OPTIONS: Record<string, Record<string, unknown>> = {
  '@cf/qwen/qwen3-30b-a3b-fp8': { chat_template_kwargs: { enable_thinking: false } },
  '@cf/qwen/qwen3.8-27b': { chat_template_kwargs: { enable_thinking: false } },
  '@cf/openai/gpt-oss-120b': { reasoning_effort: 'low' },
  '@cf/openai/gpt-oss-20b': { reasoning_effort: 'low' },
};

/** The free daily allowance is used up (Workers AI error 4006). */
export function isDailyLimit(message: string): boolean {
  return /4006|daily free allocation|neurons/i.test(message);
}

/** AI.md §2: per household per day. */
export function capFor(task: Task): number {
  return task === 'scan' ? 30 : 100;
}
/** The whole time a task may take, across its models (Workers AI's image models are slower than AI.md's 10 s). */
export function timeoutFor(task: Task): number {
  return task === 'scan' ? 25_000 : 8_000;
}

const pence = z.number().int().min(0).max(100_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const scanSchema = z.object({
  merchant: z.string().max(200).nullable(),
  date: day.nullable(),
  currency: z.string().max(3).nullable(),
  total_pence: pence.nullable(),
  items: z.array(z.object({ label: z.string().min(1).max(200), pence })).max(200),
  discount_pence: pence,
  service_pence: pence,
  category: z.string().max(80).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();
export type ScanReply = z.infer<typeof scanSchema>;

export const parseSchema = z.object({
  amount_pence: pence.nullable(),
  description: z.string().max(200).nullable(),
  category: z.string().max(80).nullable(),
  payer: z.enum(['A', 'B']).nullable(),
  split: z.object({ mode: z.enum(['ratio', 'treat', 'for_other']), ratio: z.number().int().min(0).max(100).nullable().optional() }).strict().nullable(),
  date: day.nullable(),
  tags: z.array(z.string().max(40)).max(10).nullable(),
  chapter: z.string().max(80).nullable(),
}).strict();
export type ParseReply = z.infer<typeof parseSchema>;

export const categoriseSchema = z.object({ category: z.string().max(80).nullable() }).strict();
export type CategoriseReply = z.infer<typeof categoriseSchema>;

const SCHEMAS = { scan: scanSchema, parse: parseSchema, categorise: categoriseSchema } as const;

const PROMPTS: Record<Task, { system: string; version: number }> = { scan: scanPrompt, parse: parsePrompt, categorise: categorisePrompt };

export type TaskInput =
  | { task: 'scan'; image: string; mimeType: string; categories: readonly string[]; today: string; homeCountry: string }
  | { task: 'parse'; text: string; categories: readonly string[]; chapters: readonly string[]; today: string }
  | { task: 'categorise'; description: string; categories: readonly string[] };

/** The `env.AI.run` input for a task and model (AI.md rule 4: only what the task needs; people as A and B). */
export function buildRequest(input: TaskInput, model: string): Record<string, unknown> {
  const prompt = PROMPTS[input.task];
  let user: unknown;
  switch (input.task) {
    case 'scan':
      user = [
        { type: 'text', text: [`Categories: ${JSON.stringify(input.categories)}`, `Today: ${input.today}`, `Home country: ${input.homeCountry}`].join('\n') },
        { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.image}` } },
      ];
      break;
    case 'parse':
      user = [`Categories: ${JSON.stringify(input.categories)}`, `Chapters: ${JSON.stringify(input.chapters)}`, `Today: ${input.today}`,
        `Note from A: ${JSON.stringify(input.text)}`].join('\n');
      break;
    case 'categorise':
      user = [`Categories: ${JSON.stringify(input.categories)}`, `Description: ${JSON.stringify(input.description)}`].join('\n');
      break;
  }
  return {
    messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: user }],
    max_tokens: input.task === 'scan' ? 2048 : 400,
    temperature: 0,
    ...(MODEL_OPTIONS[model] ?? {}),
  };
}

/** Unwraps a ```json fence a model sometimes puts round its answer. */
function unfence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (m?.[1] ?? text).trim();
}

/**
 * The reply's answer: Workers AI gives `{response: string}` (or the object itself) for most models and
 * `{choices: [{message: {content}}]}` for OpenAI-style ones. A string comes back unfenced; an object as it is.
 */
export function extractText(reply: unknown): string | Record<string, unknown> | null {
  if (!reply || typeof reply !== 'object') return null;
  const r = reply as { response?: unknown; choices?: unknown };
  if (typeof r.response === 'string') return r.response.trim() === '' ? null : unfence(r.response);
  if (r.response && typeof r.response === 'object' && !Array.isArray(r.response)) return r.response as Record<string, unknown>;
  if (Array.isArray(r.choices)) {
    const content = (r.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (typeof content === 'string' && content.trim() !== '') return unfence(content);
  }
  return null;
}

/** AI.md rule 3: JSON that matches the task's schema, or `invalid`. */
export function validate(task: 'scan', json: unknown): Outcome<ScanReply>;
export function validate(task: 'parse', json: unknown): Outcome<ParseReply>;
export function validate(task: 'categorise', json: unknown): Outcome<CategoriseReply>;
export function validate(task: Task, json: unknown): Outcome<ScanReply | ParseReply | CategoriseReply>;
export function validate(task: Task, json: unknown): Outcome<ScanReply | ParseReply | CategoriseReply> {
  let value = json;
  if (typeof json === 'string') {
    try { value = JSON.parse(json); } catch { return { ok: false, reason: 'invalid' }; }
  }
  const parsed = SCHEMAS[task].safeParse(value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: 'invalid' };
}

/** The whole reading of a Gemini reply for a task: completed, text, JSON, schema; else `invalid`. */
export function readReply(task: Task, reply: unknown): Outcome<ScanReply | ParseReply | CategoriseReply> {
  const text = extractText(reply);
  if (text === null) return { ok: false, reason: 'invalid' };
  return validate(task, text);
}
