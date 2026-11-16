# smsm: decisions

## Decided by the owner (don't change without asking)
| # | Decision |
|---|---|
| D1 | Scope: shared spending and who owes whom only. No incomes, personal spending, budgets or savings goals. |
| D2 | Two people per household, equal rights. |
| D3 | Name **smsm** (lowercase). Logo: ㅅ stacked on ㅁ as a house. |
| D4 | Look: clean, highly intuitive, warm. Avatars: a simple cartoon cat and dog. |
| D5 | Each person picks cat or dog and a name in Settings. Once set, it's fixed; changes need both people's approval. |
| D6 | Default split 50/50, customisable (per expense, per category, and the household default). |
| D7 | "Paid for the other" is included: counts in the balance, excluded from shared-spending analytics. |
| D8 | Home shows whether you're all square or who owes whom, in a friendly way. |
| D9 | No AI receipt scanning. A receipt photo is kept as a plain attachment. |
| D10 | v1 = everything in SPEC §3–4. Live Monzo sync comes later; v1 keeps the data fields it needs. Both people bank with Monzo. |
| D11 | Hosting as for MacroPy: GitHub `jyp107991/smsm` → Cloudflare Workers static assets; Supabase for data and sign-in. Independent of Claude. |

## Assumed in the spec (the owner may overrule; flag if you disagree)
| # | Assumption | Why |
|---|---|---|
| A1 | Changing the **household default ratio** also needs both people to approve. Category defaults and per-expense splits don't. | It changes every future split, so it's like identity. |
| A2 | Either person can edit or delete any expense without approval; everything is logged and undoable. | Approvals on every edit would make daily use slow; the history gives trust. |
| A3 | Leftover rounding pennies go to the payer's own share. | The other person is never charged a rounding penny. |
| A4 | Balance wording uses names ("Sam owes Jae £24.50"), never "You owe". | Lighter, and the same on both phones. |
| A5 | Partner-activity notifications on by default; settle-up nudge off by default. | Keeps both in sync without nagging. |
| A6 | UI framework: **Preact** + TypeScript + Vite (MacroPy uses vanilla TS). | smsm is form- and list-heavy; Preact (≈4 KB) keeps the UI code much smaller. Build tooling, tests and hosting stay the same as MacroPy. |
| A7 | Typeface Nunito; terracotta, cream and sage palette (DESIGN §3). | Warm and rounded, and legible for numbers. |
| A8 | A new Supabase project, separate from MacroPy's. | Separate data and auth; the free tier allows two projects. |
| A9 | Discarded import rows are kept only as a hash of the transaction ID. | Keeps the scope rule (no personal spending stored) while stopping re-imports from showing them again. |

## Made during the build
(Claude Code adds rows here: date, decision, reason.)
