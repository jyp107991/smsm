/**
 * What a smart-feature reply must look like (S6a; docs/AI.md rule 3: validated on the server and again on the phone).
 * Shared by the Worker's AI route and the data layer. Pure: zod only.
 */
import * as z from 'zod/mini';
import { MAX_RECEIPT_HUNDREDTHS, printedScan } from './itemise';

const pence = z.int().check(z.gte(0), z.lte(MAX_RECEIPT_HUNDREDTHS));
const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));

export const scanSchema = z.strictObject({
  merchant: z.nullable(z.string().check(z.maxLength(200))),
  date: z.nullable(day),
  currency: z.nullable(z.string().check(z.maxLength(3))),
  total_pence: z.nullable(pence),
  items: z.array(z.strictObject({ label: z.string().check(z.minLength(1), z.maxLength(200)), pence })).check(z.maxLength(200)),
  discount_pence: pence,
  service_pence: pence,
  tax_pence: z.optional(pence),
  category: z.nullable(z.string().check(z.maxLength(80))),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ScanReply = z.infer<typeof scanSchema>;

/**
 * Live eval, 24 Nov (docs/AI.md §3.1): what a model answers to the scan prompt (version 6): every amount as printed
 * (`total_text`, each line's `price_text`, `discount_text`, `service_text`, `tax_text`), which code reads with the
 * receipt's currency (core/money parsePrinted) into the ScanReply above. A model's whole-hundredths integers are still
 * accepted (an older prompt) and are used only where no printed text came with them.
 */
const printed = z.nullable(z.string().check(z.maxLength(40)));
export const scanModelSchema = z.strictObject({
  merchant: z.nullable(z.string().check(z.maxLength(200))),
  date: z.nullable(day),
  currency: z.nullable(z.string().check(z.maxLength(3))),
  total_pence: z.optional(z.nullable(pence)),
  total_text: z.optional(printed),
  items: z.array(z.strictObject({
    label: z.string().check(z.minLength(1), z.maxLength(200)),
    pence: z.optional(pence),
    price_text: z.optional(printed),
  })).check(z.maxLength(200)),
  discount_pence: z.optional(pence),
  discount_text: z.optional(printed),
  service_pence: z.optional(pence),
  service_text: z.optional(printed),
  tax_pence: z.optional(pence),
  tax_text: z.optional(printed),
  category: z.nullable(z.string().check(z.maxLength(80))),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ScanModelReply = z.infer<typeof scanModelSchema>;

export const parseSchema = z.strictObject({
  amount_pence: z.nullable(z.int()), // any whole number: the phone keeps only a positive one
  description: z.nullable(z.string().check(z.maxLength(200))),
  category: z.nullable(z.string().check(z.maxLength(80))),
  payer: z.nullable(z.enum(['A', 'B'])),
  split: z.nullable(z.strictObject({ mode: z.enum(['ratio', 'treat', 'for_other']), ratio: z.optional(z.nullable(z.int().check(z.gte(0), z.lte(100)))) })),
  date: z.nullable(day),
  tags: z.nullable(z.array(z.string().check(z.maxLength(40))).check(z.maxLength(10))),
  chapter: z.nullable(z.string().check(z.maxLength(80))),
});
export type ParseReply = z.infer<typeof parseSchema>;

export const categoriseSchema = z.strictObject({ category: z.nullable(z.string().check(z.maxLength(80))) });
export type CategoriseReply = z.infer<typeof categoriseSchema>;


/** S6b (INS-2): the recap's two sentences; the phone's wordingGuard checks every number in them. */
export const recapSchema = z.strictObject({ headline: z.string().check(z.minLength(1), z.maxLength(140)), aside: z.nullable(z.string().check(z.maxLength(140))) });
export type RecapReply = z.infer<typeof recapSchema>;

/** S6b (INS-9): a question as a filter, never a figure (a reply carrying one is invalid), or "can't answer that". */
const askQuery = z.strictObject({
  measure: z.enum(['total', 'count', 'average', 'largest']),
  filters: z.strictObject({
    categories: z.optional(z.array(z.string().check(z.maxLength(80))).check(z.maxLength(20))),
    chapters: z.optional(z.array(z.string().check(z.maxLength(80))).check(z.maxLength(20))),
    countries: z.optional(z.array(z.string().check(z.regex(/^[A-Z]{2}$/))).check(z.maxLength(20))),
    payer: z.optional(z.enum(['A', 'B'])),
    from: z.optional(day),
    to: z.optional(day),
    text: z.optional(z.string().check(z.maxLength(100))),
    tags: z.optional(z.array(z.string().check(z.maxLength(40))).check(z.maxLength(10))),
    mode: z.optional(z.array(z.enum(['ratio', 'exact', 'for_other', 'treat'])).check(z.maxLength(4))),
  }),
  // Live eval, 24 Nov: gpt-oss writes `"group_by": null` for no grouping; it means the same as leaving it out.
  group_by: z.optional(z.nullable(z.enum(['category', 'month', 'country', 'payer', 'chapter']))),
});
export const askSchema = z.union([askQuery, z.strictObject({ unsupported: z.literal(true) })]);
export type AskReply = z.infer<typeof askSchema>;

export const REPLY_SCHEMAS = { scan: scanSchema, parse: parseSchema, categorise: categoriseSchema, recap: recapSchema, ask: askSchema } as const;
export type ReplyTask = keyof typeof REPLY_SCHEMAS;

/**
 * The reply as its task's shape, or null (a string is read as JSON first). A scan is read as a model answers it
 * (scanModelSchema), its printed amounts turned into hundredths by code (core/itemise printedScan), then checked as a
 * ScanReply: the Worker and the phone read a scan the same way.
 */
export function checkReply<T extends ReplyTask>(task: T, json: unknown): z.infer<(typeof REPLY_SCHEMAS)[T]> | null {
  let value = json;
  if (typeof json === 'string') {
    try { value = JSON.parse(json); } catch { return null; }
  }
  if (task === 'scan') {
    const model = scanModelSchema.safeParse(value);
    if (!model.success) return null;
    value = printedScan(model.data);
  }
  const parsed = REPLY_SCHEMAS[task].safeParse(value);
  return parsed.success ? (parsed.data as z.infer<(typeof REPLY_SCHEMAS)[T]>) : null;
}
