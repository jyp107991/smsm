/**
 * The `ai` function's pure parts (S6a; docs/AI.md): the request to Gemini's Interactions API, the reply's text,
 * validation of what came back (zod), and the caps and timeouts. No Deno or browser APIs, so Vitest runs it and
 * the phone reuses the same validation (AI.md rule 3: validated on the server and again on the phone).
 */
import { z } from 'zod';
import * as categorisePrompt from './prompts/categorise.ts';
import * as parsePrompt from './prompts/parse.ts';
import * as scanPrompt from './prompts/scan.ts';

export type Task = 'scan' | 'parse' | 'categorise';
export type Reason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: Reason };

export const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** AI.md §2: per household per day. */
export function capFor(task: Task): number {
  return task === 'scan' ? 30 : 100;
}
/** AI.md §2: scan 10 s, the others 4 s. */
export function timeoutFor(task: Task): number {
  return task === 'scan' ? 10_000 : 4_000;
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

/** JSON Schemas for Gemini (only the keywords it enforces; lengths are checked by zod above). */
const nullable = (t: string) => ({ type: [t, 'null'] });
export const JSON_SCHEMAS: Record<Task, object> = {
  scan: {
    type: 'object',
    properties: {
      merchant: nullable('string'), date: nullable('string'), currency: nullable('string'), total_pence: nullable('integer'),
      items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, pence: { type: 'integer', minimum: 0 } }, required: ['label', 'pence'], additionalProperties: false } },
      discount_pence: { type: 'integer', minimum: 0 }, service_pence: { type: 'integer', minimum: 0 },
      category: nullable('string'), confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['merchant', 'date', 'currency', 'total_pence', 'items', 'discount_pence', 'service_pence', 'category', 'confidence'],
    additionalProperties: false,
  },
  parse: {
    type: 'object',
    properties: {
      amount_pence: nullable('integer'), description: nullable('string'), category: nullable('string'),
      payer: { type: ['string', 'null'], enum: ['A', 'B', null] },
      split: { type: ['object', 'null'], properties: { mode: { type: 'string', enum: ['ratio', 'treat', 'for_other'] }, ratio: nullable('integer') }, required: ['mode'], additionalProperties: false },
      date: nullable('string'), tags: { type: ['array', 'null'], items: { type: 'string' } }, chapter: nullable('string'),
    },
    required: ['amount_pence', 'description', 'category', 'payer', 'split', 'date', 'tags', 'chapter'],
    additionalProperties: false,
  },
  categorise: {
    type: 'object', properties: { category: nullable('string') }, required: ['category'], additionalProperties: false,
  },
};

const PROMPTS: Record<Task, { system: string; version: number }> = { scan: scanPrompt, parse: parsePrompt, categorise: categorisePrompt };

export type TaskInput =
  | { task: 'scan'; image: string; mimeType: string; categories: readonly string[]; today: string; homeCountry: string }
  | { task: 'parse'; text: string; categories: readonly string[]; chapters: readonly string[]; today: string }
  | { task: 'categorise'; description: string; categories: readonly string[] };

/** The Interactions API request body for a task (AI.md rule 4: only what the task needs; people as A and B). */
export function buildRequest(input: TaskInput, model: string): Record<string, unknown> {
  const prompt = PROMPTS[input.task];
  const facts: string[] = [];
  let parts: unknown[];
  switch (input.task) {
    case 'scan':
      facts.push(`Categories: ${JSON.stringify(input.categories)}`, `Today: ${input.today}`, `Home country: ${input.homeCountry}`);
      parts = [{ type: 'text', text: facts.join('\n') }, { type: 'image', data: input.image, mime_type: input.mimeType }];
      break;
    case 'parse':
      facts.push(`Categories: ${JSON.stringify(input.categories)}`, `Chapters: ${JSON.stringify(input.chapters)}`, `Today: ${input.today}`,
        `Note from A: ${JSON.stringify(input.text)}`);
      parts = [{ type: 'text', text: facts.join('\n') }];
      break;
    case 'categorise':
      facts.push(`Categories: ${JSON.stringify(input.categories)}`, `Description: ${JSON.stringify(input.description)}`);
      parts = [{ type: 'text', text: facts.join('\n') }];
      break;
  }
  return {
    model,
    system_instruction: prompt.system,
    input: parts,
    response_format: { type: 'text', mime_type: 'application/json', schema: JSON_SCHEMAS[input.task] },
    generation_config: { max_output_tokens: input.task === 'scan' ? 4096 : 512 },
    store: false,
  };
}

/** The reply's text: `output_text` when present, else the model_output step's text parts; null when not completed. */
export function extractText(reply: unknown): string | null {
  if (!reply || typeof reply !== 'object') return null;
  const r = reply as { status?: unknown; output_text?: unknown; steps?: unknown };
  if (r.status !== undefined && r.status !== 'completed') return null;
  if (typeof r.output_text === 'string') return r.output_text;
  if (!Array.isArray(r.steps)) return null;
  const texts: string[] = [];
  for (const step of r.steps as unknown[]) {
    if (!step || typeof step !== 'object' || (step as { type?: unknown }).type !== 'model_output') continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content as unknown[]) {
      if (c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string') {
        texts.push((c as { text: string }).text);
      }
    }
  }
  return texts.length > 0 ? texts.join('') : null;
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
