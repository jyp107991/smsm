# smsm: decisions

## Decided by the owner (don't change without asking)
| # | Decision |
|---|---|
| D1 | Scope: shared spending and who owes whom only. No incomes, personal spending, budgets or savings goals. |
| D2 | Two people per household, equal rights. Pounds only. |
| D3 | Name **smsm** (lowercase). Logo: ㅅ stacked on ㅁ as a house. |
| D4 | Look: clean, highly intuitive, warm, intimate, modern but not clinical. Palette of natural, green and wood colours. Avatars: a simple cartoon cat and dog, appearing in many places, lightly animated, cheap to build. |
| D5 | Each person picks cat or dog and a name. Once set, fixed; changes need both people's approval. |
| D6 | Default split 50/50, customisable. |
| D7 | "Paid for the other" is included: in the balance, not in shared-spending figures. |
| D8 | Home shows whether you're all square or who owes whom, in a friendly way. |
| D9 | Gemini (the owner has a key) for AI features where they are useful: receipt scanning, auto-categorising, monthly summaries. |
| D10 | Location: entries are tagged with where they happened; the current country can be changed for a trip so holiday spending is easy to total; recurring entries always stay at home (UK). |
| D11 | One-off things (a wedding, a holiday) can be kept apart like a separate Splitwise group, or left in everyday spending. |
| D12 | Monzo: both people bank with Monzo. Live sync later; v1 keeps the door open. |
| D13 | Hosting as for MacroPy: GitHub → Cloudflare, Supabase for data and sign-in; independent of Claude. Claude Code builds; the spec comes first. |

## Proposed in the spec (owner may overrule; these are the ones to read)
| # | Proposal | Why |
|---|---|---|
| P1 | **Chapters** implement D11: a named trip or project with its own totals, one shared balance, and kept out of "your usual month". | Separate groups mean separate balances and settle-ups, which two people don't need. |
| P2 | **The plank**: the animals sit on a wooden plank that tilts with the balance. | One memorable picture that says "balance" without a chart. Falls back to a level shelf if disliked. |
| P3 | Colours were built from the brief because the reference page would not open; type and logo have three options each. All are chosen by the owner in the S0 gallery. | Decide by looking, once, before features depend on it. |
| P4 | **Joint account** as an optional third payer. | Common for couples; nearly free to support now, awkward to add later. Off by default. |
| P5 | **Money back** entries for refunds. | Otherwise refunds get entered as fake negative expenses and totals go wrong. |
| P6 | **Variable recurring bills** ask for their amount in the Inbox. | Energy and water aren't the same each month. |
| P7 | Settle-up opens **Monzo with the amount filled in** (monzo.me). Monzo's API cannot send payments. | The nearest thing to in-app payment that exists. |
| P8 | AI is optional, behind one switch, never computes money, never saves without a tap; people are sent as A/B. | Trust in the numbers. |
| P9 | **Decided by the owner (16 Nov 2026): use Gemini's free tier, no billing.** | The app is a private tool for one household of two, not a product offered to UK users. Free-tier limits are per project and can be low; every smart feature already falls back gracefully when a limit is hit. Billing can be switched on later without code changes. |
| P10 | Location is asked once and optional; positions are rounded to about 100 m; places come from a free reverse-geocoding service called from the phone. | Enough for "Kyoto"; not a tracking log. |
| P11 | Stack: React, Tailwind, TanStack Query (changed from Preact and a hand-built sync). | Fewer bugs when an AI writes the code; no custom sync engine to debug. |
| P12 | Deploys go through GitHub Actions so nothing ships unless every check passes; needs three secrets added once. | Quality gate. Alternative noted in `DEPLOY.md` §2. |
| P13 | Either person can edit or delete any entry without approval; everything is logged and undoable. Changing the household default split needs approval. | Daily use stays quick; trust comes from the history. |
| P14 | Rounding pennies go to the payer's own share. Balance sentences use names, never "you owe". | Fair and symmetrical. |
| P15 | Dropped from earlier drafts: multi-currency accounts (replaced by the other-currency helper), a separate "conflict" screen, Preact, Nunito-only, terracotta. | Simpler, and in line with the new brief. |

## Checked facts the design relies on (November 2026)
- Monzo developer API: read accounts (including joint), balances, transactions; webhooks on new transactions; receipts; pots. No payments to other people. Personal use, few users. Full history only in the first 5 minutes after approval, then 90 days. Pot-linked virtual-card spending not exposed.
- monzo.me links accept an amount and a description (`monzo.me/<name>/<amount>?d=<text>`) and open the Monzo app for Monzo users.
- Gemini API: Flash and Flash-Lite models have a free tier with daily limits that vary by project; UK-facing apps are required to use paid services; UK users get paid-service data terms either way.
- Android Chrome installed apps support manifest shortcuts, share target, push and icon badges.
- BigDataCloud offers a free, keyless reverse-geocoding endpoint for calls made from the user's device.
Re-check each at the slice that uses it.

## Made during the build
(Claude Code adds rows: date, decision, reason.)
