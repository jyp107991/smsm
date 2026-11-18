# smsm: smart features (Cloudflare Workers AI)

## 1. Rules
1. **Optional.** One switch in Settings. With it off, or the service slow, down or over its limit, every feature still works by hand or by rule. No screen waits on AI.
2. **AI reads, suggests and phrases. Code computes. People confirm.** No AI output writes a money row; it fills a form or a filter that a person sees and accepts. AI never does arithmetic that is shown as fact.
3. **Typed in, typed out.** Every call asks for JSON matching a schema and the reply is validated (zod) on the server and again on the phone. Anything that fails validation is discarded and the fallback is used.
4. **Least data.** Calls carry only what the task needs: the photo, or the typed text, plus the household's category names. People are sent as "A" and "B", never by name. Balances and histories are never sent. The recap sends that month's aggregate figures only.
5. **Content is data, not instructions.** Text on a receipt or in a shared screenshot is treated as untrusted; the system prompt says so, and since outputs only ever fill a form, the worst case is a wrong suggestion.

## 2. How it is wired
- **Cloudflare Workers AI through the app's own Worker** (owner, 17 Nov 2026: free, no API key, no new secret, as in MacroPy; this replaced the earlier Gemini plan). `POST /api/ai` with a `task` field: `scan`, `parse`, `categorise` (S6a), `recap`, `ask` (S6b). The Worker calls `env.AI.run` through the `AI` binding; the phone holds nothing.
- Models are asked in order, the next on error or when too slow (`MODELS` in `worker/ai-core.ts`; see `docs/slices/S6.md`). Image reading uses a vision model; JSON is asked for in the prompt (Workers AI's JSON mode covers only some text models) and every reply is validated.
- The route checks the caller's sign-in by counting the call through the `increment_ai_usage` RPC with the caller's own token, enforces daily caps from `ai_usage` (scan 30, parse 100, categorise 100, ask 50 per household per day; recap once per month), sets a time limit (scan 25 s across its models, others 8 s), validates, and returns either `{ok: true, data}` or `{ok: false, reason}` where reason is `off | limit | timeout | invalid | error`. The phone maps every `ok: false` to the fallback without an error dialog (a small "couldn't read that, fill it in by hand" line at most).
- Photos are downscaled on the phone to 1280 px on the long side, JPEG, before upload.
- Each call adds one to the day's count in `ai_usage`. No prompts, images or replies are logged.

### Cost
Free: the Cloudflare account's daily Workers AI allowance (10,000 Neurons; a receipt is roughly 100). On the Workers Free plan use past the allowance fails (error 4006, shown as the `limit` fallback) and is never billed.

## 3. Tasks

### 3.1 `scan`: receipt or screenshot → form
Input: one image, the category names, today's date, the home country.
Output schema:
```
{ merchant: string|null, date: "YYYY-MM-DD"|null, currency: "GBP"|string|null,
  total_pence: int|null,
  items: [{ label: string, pence: int }],          // may be empty
  discount_pence: int,                              // offers and vouchers taken off, 0 if none
  service_pence: int,                               // service charge or tip shown on the bill, 0 if none
  category: one of the given names | null,
  confidence: "high"|"medium"|"low" }
```
Guards in code: amounts are non-negative integers; the date is not in the future and within two years; if `items` are present and `sum(items) − discount_pence + service_pence` differs from `total_pence`, the form shows both figures and asks the person to set the amount (SCAN-3); when lines are unticked, discount and service are shared out in proportion; a non-GBP currency switches the form to "paid in another currency" (PLC-6); `low` confidence fills nothing but the photo.

### 3.2 `parse`: loose wording → form
Used only when the rule-based quick-add grammar can't read the text with confidence. Input: the text, category names, the two labels A/B and which is the speaker, today's date, current chapter names. Output: the same fields the grammar produces (`amount_pence`, `description`, `category`, `payer: A|B`, `split: {mode, ratio?}`, `date`, `tags`, `chapter`), each nullable. The form opens prefilled; nothing saves by itself.

### 3.3 `categorise`: description → category
Called after a save, only when steps 1–3 of CAT-2 found nothing. Input: the description and the category names. Output: `{category: name|null}`. If the person has not changed the category in the meantime, the entry's category is updated and marked as a guess; the result is stored in `category_memory` with `source = 'ai'` so the same description never costs a second call. A person's later choice overwrites it.

### 3.4 `recap`: figures → two sentences
Input: the month's computed `stats` JSON (totals, usual, top categories, the three chosen notes, who paid; people as A/B). Output: `{headline: string, aside: string|null}`, each at most 140 characters, plain and warm, no advice, no judgement about either person.
Guard: every number in the output must appear in the input (compared after normalising pounds formatting); otherwise the template wording is used. The names are substituted for A/B on the phone.

### 3.5 `ask`: question → filter
Input: the question, category names, chapter names, the list of countries present in the data, today's date. Output, from a closed schema:
```
{ measure: "total"|"count"|"average"|"largest",
  filters: { categories?: [name], chapters?: [name], countries?: [ISO2], payer?: "A"|"B",
             from?: date, to?: date, text?: string, tags?: [string], mode?: [split modes] },
  group_by?: "category"|"month"|"country"|"payer"|"chapter" }
```
The phone runs the filter with the same code as Activity and Insights, shows the figure, shows the filter as editable chips ("Eating out · Japan · all time"), and lists the matching entries. If the question can't be expressed, the reply is `{unsupported: true}` and the box says what it can answer.

## 4. Failure behaviour (all tested)
| Situation | What the person sees |
|---|---|
| Smart features off | No camera-reading, no Ask box; photo attach, rules and templates still work |
| Offline | Same as off; a scanned photo can be sent to the Inbox to read later |
| Timeout or error | The form stays as it was with the photo attached; one quiet line |
| Daily limit reached | Same, with "that's enough reading for today" |
| Invalid or low-confidence reply | Treated as no reply |

## 5. Testing
- **Contract tests (CI, no network):** recorded Workers AI replies, good and bad (wrong types, extra fields, prompt-injection text on a receipt, totals that don't add up, a future date), run through validation and guards. Every row of §4 has a test.
- **Live eval (`npm run eval:ai`, against the deployed `/api/ai`, run by hand before S6 is called done and before each release):** at least 30 receipts in `tests/ai/receipts/` with expected JSON: 10 real photos supplied by the owner (card digits covered) and 20 generated by a script that renders realistic UK receipts (supermarket, restaurant with service charge, pharmacy, a crumpled low-light photo, a long receipt, a foreign-currency one). Pass marks: total exactly right ≥ 95%; date ≥ 90%; merchant ≥ 90%; item-level F1 ≥ 0.85. Also 40 `parse` phrases and 30 `ask` questions with expected output, ≥ 90% each. Results are written to `docs/BUILD_LOG.md`. If a pass mark is missed, try another model order for that task before changing prompts.
- Prompts live in `worker/prompts/` as modules, versioned, each stating its JSON shape; the zod schemas are in `worker/ai-core.ts`.
