/**
 * What a smart-feature reply must look like (S6a; docs/AI.md rule 3: validated on the server and again on the phone).
 * Shared by the Worker's AI route and the data layer. Pure: zod only.
 */
import { z } from 'zod';

const pence = z.number().int().min(0).max(100_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const scanSchema = z.object({
  merchant: z.string().max(200).nullable(),
  date: day.nullable(),
  currency: z.string().max(3).nullable(),
  total_pence: pence.nullable(),
  items: z.array(z.object({ label: z.string().min(1).max(200), pence }).strict()).max(200),
  discount_pence: pence,
  service_pence: pence,
  category: z.string().max(80).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();
export type ScanReply = z.infer<typeof scanSchema>;

export const parseSchema = z.object({
  amount_pence: z.number().int().nullable(), // any whole number: the phone keeps only a positive one
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


export const REPLY_SCHEMAS = { scan: scanSchema, parse: parseSchema, categorise: categoriseSchema } as const;
export type ReplyTask = keyof typeof REPLY_SCHEMAS;

/** The reply as its task's shape, or null (a string is read as JSON first). */
export function checkReply<T extends ReplyTask>(task: T, json: unknown): z.infer<(typeof REPLY_SCHEMAS)[T]> | null {
  let value = json;
  if (typeof json === 'string') {
    try { value = JSON.parse(json); } catch { return null; }
  }
  const parsed = REPLY_SCHEMAS[task].safeParse(value);
  return parsed.success ? (parsed.data as z.infer<(typeof REPLY_SCHEMAS)[T]>) : null;
}
