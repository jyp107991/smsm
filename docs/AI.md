# smsm: smart features (Cloudflare Workers AI)

## 1. Rules
1. **Optional.** One switch in Settings. With it off, or the service slow, down or over its limit, every feature still works by hand or by rule. No screen waits on AI.
2. **AI reads, suggests and phrases. Code computes. People confirm.** No AI output writes a money row; it fills a form or a filter that a person sees and accepts. AI never does arithmetic that is shown as fact.
3. **Typed in, typed out.** Every call asks for JSON matching a schema and the reply is validated (zod) on the server and again on the phone. Anything that fails validation is discarded and the fallback is used.
4. **Least data.** Calls carry only what the task needs: the photo, or the typed text, plus the household's category names. People are sent as "A" and "B", never by name. Balances and histories are never sent. The recap sends that month's aggregate figures only.
5. **Content is data, not instructions.** Text on a receipt or in a shared screenshot is treated as untrusted; the system prompt says so, and since outputs only ever fill a form, the worst case is a wrong suggestion.

## 2. How it is wired
- **Cloudflare Workers AI through the app's own Worker** (owner, 17 Nov 2026: free, no API key, no new secret, as in MacroPy; this replaced the earlier Gemini plan). `POST /api/ai` with a `task` field: `scan`, `parse`, `categorise` (S6a), `recap`, `ask` (S6b). The Worker calls `env.AI.run` through the `AI` binding; the phone holds nothing.
- Models are asked in order, the next on error or when too slow (`MODELS` in `worker/ai-core.ts`; see `docs/slices/S6.md`). Text tasks (categorise, parse, recap, ask) ask a gpt-oss model first and `@cf/qwen/qwen3.8-27b` second (reasoning effort low); `@cf/qwen/qwen3-30b-a3b-fp8` was retired by Cloudflare on 20 Nov 2026 and is no longer asked. A model Cloudflare has retired (HTTP 410, "deprecated") is skipped like any failing one, and the Worker logs one plain line naming it (`ai: <model> is retired …`), nothing else about the call; check the Worker's logs and the model pages (developers.cloudflare.com/workers-ai/models) before each release. Image reading uses a vision model; JSON is asked for in the prompt (Workers AI's JSON mode covers only some text models) and every reply is validated.
- The route checks the caller's sign-in by counting the call through the `increment_ai_usage` RPC with the caller's own token, enforces daily caps from `ai_usage` (scan 10, parse 25, categorise 40, ask 15 and recap 3 per household per day, a month's recap being asked once; lowered on 24 Nov to fit the free allowance, see Cost), sets a time limit (scan 25 s across its models, others 8 s), validates, and returns either `{ok: true, data}` or `{ok: false, reason}` where reason is `off | limit | timeout | invalid | error`. The phone maps every `ok: false` to the fallback without an error dialog (a small "couldn't read that, fill it in by hand" line at most).
- Photos are downscaled on the phone to 1280 px on the long side, JPEG, before upload.
- Each call adds one to the day's count in `ai_usage`. No prompts, images or replies are logged.

### Cost
Free: the Cloudflare account's daily Workers AI allowance, **10,000 Neurons a day, reset at 00:00 UTC, shared with MacroPy on the same account** (and with the live eval). On the Workers Free plan use past the allowance fails (HTTP 429, error 4006, "you have used up your daily free allocation of 10,000 neurons"), shown as the `limit` fallback, and is never billed. On 24 Nov three full live-eval runs used it all up and the smart features rested until midnight UTC; they fell back as designed.

What a call costs, from Cloudflare's published rates (developers.cloudflare.com/workers-ai/platform/pricing/, read 24 Nov 2026; kept in `worker/ai-budget.ts`, Neurons per million input / output tokens): llama-4-scout 24,545 / 77,273; mistral-small-3.1 31,876 / 50,488; gpt-oss-120b 31,818 / 68,182; gpt-oss-20b 18,182 / 27,273; qwen3.8-27b 40,909 / 290,909. A photo is counted as at most 2,500 input tokens (Cloudflare doesn't publish image counts; that bounds Llama 4's 336 px tiles and the others' patches for a 1280 px photo) and text as one token per 3 characters, so estimates run high. The largest call of each task the Worker accepts, answered by its first model with the reply at its `max_tokens`: a receipt about 240 Neurons (about 140 at a usual reply length), loose wording 65, an Ask question 53, a recap 40, a category guess 16.

**The caps keep one household within 60% of the allowance** (`worker/ai-budget.test.ts` fails otherwise). At the old caps (scan 30, parse 100, categorise 100, ask 50, recap 3) one household's worst day was about 18,100 Neurons, nearly twice the whole allowance. At the caps now (scan 10, parse 25, categorise 40, ask 15, recap 3) it is about 5,600: scans 2,420, loose wording 1,620, Ask 790, guesses 650, recap 120 (about 3,800 at usual reply lengths). That is a ceiling for a day spent at every cap; a real day uses a fraction. Not bounded by the caps: a call whose first model gives a billed but unusable reply and is then answered by the next (the second text model, qwen3.8-27b, costs about four times as much per reply); if every call did that the day would be about 26,900. Such fall-throughs are rare (most failures are timeouts or capacity errors), and the allowance running out only ever means the `limit` fallback. Re-check the rates, and `worker/ai-budget.ts`, whenever `MODELS` changes.

## 3. Tasks

### 3.1 `scan`: receipt or screenshot → form
Input: one image, the category names, today's date, the home country.
What the model is asked for (`worker/prompts/scan.md`, version 6): every amount **copied as printed**, as text, never converted:
```
{ merchant: string|null, date: "YYYY-MM-DD"|null, currency: "GBP"|string|null,
  total_text: string|null,                          // "377,859", "60.000", "12.34", "1.234,56"
  items: [{ label: string, price_text: string }],   // may be empty
  discount_text, service_text, tax_text: string|null,
  category: one of the given names | null,
  confidence: "high"|"medium"|"low" }
```
**Code works out the figures** (live eval, 24 Nov: 17 of 20 Indonesian receipts were wrong by a power of ten when the model did it). `core/money` `parsePrinted(text, currency)` reads each printed amount into whole hundredths of the receipt's currency (£12.34 is 1234, ¥648 is 64800, Rp 60.000 is 6000000): with both "." and "," the last is the decimal point; one mark before exactly three digits groups thousands (except in a three-decimal currency such as KWD, or "0.500"); before one or two digits it is the decimal point; spaces and apostrophes only group; groups after the first must be three digits. Text that isn't one readable amount gives no figure (no total, the line left out), never the model's own integer instead. `core/itemise` `printedScan` applies this to the whole reply; the Worker (`validate`) and the phone (`checkReply`) read a scan the same way, and what the phone is sent is the reply below, in whole hundredths, with no printed text. A model's integers (an older prompt) are still accepted and used only where no printed text came with them.
The reply the phone gets:
```
{ merchant, date, currency, total_pence: int|null,
  items: [{ label: string, pence: int }],
  discount_pence: int, service_pence: int, tax_pence?: int,   // 0 if none
  category, confidence }
```
Amounts are at most 10¹² hundredths (10 billion units, so a bill in rupiah, dong or won reads); a printed amount above that gives no figure.
Guards in code: amounts are non-negative integers; the date is not in the future and within two years; if `items` are present and `sum(items) − discount_pence + service_pence` differs from `total_pence`, the form shows both figures and asks the person to set the amount (SCAN-3); when lines are unticked, discount and service are shared out in proportion; a non-GBP currency switches the form to "paid in another currency" (PLC-6); `low` confidence fills nothing but the photo.

### 3.2 `parse`: loose wording → form
Used only when the rule-based quick-add grammar can't read the text with confidence. Input: the text, category names, the two labels A/B and which is the speaker, today's date, current chapter names. Output: the same fields the grammar produces (`amount_pence`, `description`, `category`, `payer: A|B`, `split: {mode, ratio?}`, `date`, `tags`, `chapter`), each nullable. The form opens prefilled; nothing saves by itself.
Checks in code before the form fills (`core/loose` `readLoose`, live eval 24 Nov):
- **The amount comes from the words when they give one.** If exactly one word of the note is an amount as quick add reads amounts (`parseAmount`: "189", "22.40", "£64", "1,200"), that amount is used; the AI's is used only when the words give none ("twenty five quid") or several ("2 x 38"). When the two differ, the phone reports "ai amount disagreed" to `client_errors` (no words, no amounts).
- **The split needs words that say so.** "B paid", "B got", "B bought" only name the payer. A treat is kept only with words such as "treat", "on me", "on B", "my shout"; paid for the other only with "for B", "for me", "for them", "B's"; a percentage only with "60/40", "70%", "half". Otherwise the split is the household's usual one. The words are English, as quick add's command words are (TXT-4): in another language the person picks a split that isn't the usual one.
- The prompt (`worker/prompts/parse.md`, version 4) says the same, and describes the app's default category names in a few words each (a kettle is Household, a TV licence Rent & bills, the vet and haircuts Other); a household's own or renamed categories go by their names alone.

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
  group_by?: "category"|"month"|"country"|"payer"|"chapter"|null }   // null or absent: not grouped
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
| A model retired by Cloudflare (HTTP 410) | Nothing: the next model answers; if none can, the same as an error |

## 5. Testing
- **Contract tests (CI, no network):** recorded Workers AI replies, good and bad (wrong types, extra fields, prompt-injection text on a receipt, totals that don't add up, a future date), run through validation and guards. Every row of §4 has a test.
- **Live eval (`npm run eval:ai`, against the deployed `/api/ai`, run by hand before S6 is called done and before each release):** **By default a run sends a stratified sample, the same cases every time** (`tests/ai/eval/plan.ts`): 4 UK and 4 CORD receipts, 10 loose wordings, 10 questions, 10 category descriptions (6 English, 2 Korean, 2 with no right guess) and 4 recap months (one each of no comparison, less, more and about the same, including a chapter month and money back), about 2,200 Neurons by the estimate (at most about 3,300). **The full set** (the eval-ai workflow's "full" box, or `EVAL_FULL=true`) is about 9,400 by the estimate, most of the shared daily allowance (the estimate runs high: on 24 Nov two full runs of the older, smaller set and MacroPy's use together fit in 10,000), so **it may only be run on a quiet day**, when neither the household nor MacroPy needs the allowance, and never twice in a day. Before its first call a run prints its Neuron estimate in the summary; at the first answer saying the allocation is used up it stops with "Stopped early: the daily free allocation is used up", sends nothing more and judges no pass mark. The pass marks below are the same for a sample; each score states its sample size beside it. The cases: at least 30 receipts in `tests/ai/receipts/` with expected JSON: 10 real photos supplied by the owner (card digits covered) and 20 generated by a script that renders realistic UK receipts (supermarket, restaurant with service charge, pharmacy, a crumpled low-light photo, a long receipt, a foreign-currency one). Pass marks: total exactly right ≥ 95%; date ≥ 90%; merchant ≥ 90%; item-level F1 ≥ 0.85. Also 40 `parse` phrases and 30 `ask` questions with expected output, ≥ 90% each. Also (24 Nov) 47 `categorise` descriptions in `tests/ai/eval/categorise.json` (UK shops, bills and services, 9 in Korean, 6 with no right guess such as "PAYPAL *EBAY" or the vet), each sent whatever the built-in list would say, and scored as `guessCategory` applies the reply (a household category by name; Other counts as no guess, since an unsorted entry already sits there): **right ≥ 85% and confident wrong guesses ≤ 5%** (a wrong guess is worse than none; the report also gives the list-first, AI-second figure). And 12 finished months of `recap` figures (`tests/ai/eval/recap-months.ts`: a seeded year of one household's spending put through `recapOf` and `recapStats`, worded on the 3rd of the next month; less, more and about the same as usual, two months with no comparison, three chapter months, two with money back), scored after `wordingGuard`: **guarded and accepted ≥ 80%** (a rejected reply shows the template headline, which is fine but counts against the mark), and **no accepted reply may carry a figure that isn't one of the month's own** (checked again outside the guard). `worker/ai-eval-cases.test.ts` checks these cases without the network. Results are written to `docs/BUILD_LOG.md`. If a pass mark is missed, try another model order for that task before changing prompts. What is scored is what the app would apply: a scan after the Worker's validation and the phone's guards (a low-confidence reply fills nothing, so it scores nothing), loose wording after `readLoose`. The report lists each receipt's unmatched lines.
- Prompts live in `worker/prompts/` as modules, versioned, each stating its JSON shape; the zod schemas are in `worker/ai-core.ts`.
