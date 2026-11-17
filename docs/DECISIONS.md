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
| D14 | **Chapters** for trips and one-offs: separate totals, one shared balance, kept out of "your usual month". (Confirmed 16 Nov.) |
| D15 | **The plank**: the cat and dog sit on a wooden plank that tilts with the balance. (Confirmed 16 Nov.) |
| D16 | Either person can edit or delete any entry without approval; everything is logged and undoable. (Confirmed 16 Nov.) |
| D17 | Palette: "Forest Green and Walnut" — `#3E4938`, `#57664A`, `#6F5138`, `#AA9071`, and a fifth read as `#D6D9C7` (to confirm in the gallery). |
| D18 | No joint account. Gemini on the free tier, no billing. |

## Proposed in the spec (owner may overrule; these are the ones to read)
| # | Proposal | Why |
|---|---|---|
| P3 | Type and logo have three options each, chosen by the owner in the S0 gallery; the palette's derived steps and the fifth colour are confirmed there too. | Decide by looking, once, before features depend on it. |
| P4 | Joint-account payer: not built in v1 (the owner has none); the data model keeps `paid` as a map so it can be added without redesign. | Cheap to keep the door open. |
| P5 | **Money back** entries for refunds. | Otherwise refunds get entered as fake negative expenses and totals go wrong. |
| P6 | **Variable recurring bills** ask for their amount in the Inbox. | Energy and water aren't the same each month. |
| P7 | Settle-up opens **Monzo with the amount filled in** (monzo.me). Monzo's API cannot send payments. | The nearest thing to in-app payment that exists. |
| P8 | AI is optional, behind one switch, never computes money, never saves without a tap; people are sent as A/B. | Trust in the numbers. |
| P10 | Location is asked once and optional; positions are rounded to about 100 m; places come from a free reverse-geocoding service called from the phone. | Enough for "Kyoto"; not a tracking log. |
| P11 | Stack: React, Tailwind, TanStack Query (changed from Preact and a hand-built sync). | Fewer bugs when an AI writes the code; no custom sync engine to debug. |
| P12 | Deploys go through GitHub Actions so nothing ships unless every check passes; needs three secrets added once. | Quality gate. Alternative noted in `DEPLOY.md` §2. |
| P13 | Changing the household default split needs both people's approval. | It changes every future split. |
| P14 | Rounding pennies go to the payer's own share. Balance sentences use names, never "you owe". | Fair and symmetrical. |
| P15 | Dropped from earlier drafts: multi-currency accounts (replaced by the other-currency helper), a separate "conflict" screen, Preact, Nunito-only, terracotta. | Simpler, and in line with the new brief. |

## Checked facts the design relies on (November 2026)
- Monzo developer API: read accounts (including joint), balances, transactions; webhooks on new transactions; receipts; pots. No payments to other people. Personal use, few users. Full history only in the first 5 minutes after approval, then 90 days. Pot-linked virtual-card spending not exposed.
- monzo.me links accept an amount and a description (`monzo.me/<name>/<amount>?d=<text>`) and open the Monzo app for Monzo users.
- Gemini API: Flash and Flash-Lite models have a free tier with daily limits that vary by project; UK-facing apps are required to use paid services; UK users get paid-service data terms either way.
- Android Chrome installed apps support manifest shortcuts, share target, push and icon badges.
- BigDataCloud offers a free, keyless reverse-geocoding endpoint for calls made from the user's device.
- Supabase free plan: 500 MB database, 1 GB files, 5 GB transfer, pauses after 7 days idle, no backups; hence the keep-alive and off-site backups.
- Supabase: the `anon` and `service_role` keys are being retired at the end of 2026; use the publishable key in the app and secret keys on the server.
Re-check each at the slice that uses it.

## Made during the build
| Date | Decision | Reason |
|---|---|---|
| 2026-11-16 | **Repository is public** (owner's choice). | GitHub Actions minutes for private repos were used up; public repos have unlimited free minutes. Checked first: no secrets, keys, project ids or personal emails anywhere in the history (all commits use a no-reply identity). Consequences: Actions logs are public, so workflows never print account emails, SMTP users or any secret (no `wrangler whoami`; token checks print only "active"); the nightly backup (EXP-2) will not use this repo's artifacts but a private destination chosen in S2. |
| 2026-11-16 | Supabase CLI pinned at 3.2.0. In v3, `config push` sends only what `config.toml` declares and leaves the rest unchanged (v2 overwrote undeclared settings with defaults); `config diff` previews without changing anything. | Read from the CLI's own `--help`. The `DEPLOY.md` §1 warning was about v2. Auth settings are still pushed only by hand (`auth-config.yml`), after the owner approves the diff. |
| 2026-11-16 | TypeScript 6.0 (not 7). | typescript-eslint 8.73 supports TypeScript below 6.1; TS 7 (the native port) has no lint support yet. |
| 2026-11-16 | Hardening migration: functions are no longer executable by `public`/`anon`; `health()` added for the smoke test and keep-alive. | PostgreSQL grants EXECUTE to PUBLIC by default, so the publishable key could call the RPCs; `post_due_recurring(uuid)` skipped its household check without a sign-in. Tests in `tests/sql/hardening_test.sql`. |
| 2026-11-16 | `supabase/schema.sql` and `src/data/database.types.ts` are generated from the migrations by `npm run db:generate` (types via the CLI against a scratch PostgreSQL, no Docker needed); CI fails if either is stale. | One source of truth: the migrations. |
| 2026-11-16 | Two Workers: `smsm` (the app) and `smsm-demo` (demo build with the gallery, plus a preview version per branch). | The gallery and previews never touch real data, and the production bundle never contains the gallery. |
| 2026-11-16 | Secrets and variables are checked on every branch push (link, migration dry run, token status) before anything can reach main. | A wrong secret is found and named before a deploy, not during one. |
| 2026-11-17 | Rounding: largest remainder, **ties** to the payer (DATA_MODEL §3's formula), rather than "the leftover penny always goes to the payer" (SPEC SPL-3's short wording). | The two agree for 50/50 and every even split; they differ only for an uneven split of an odd amount (e.g. 60/40 of £1.01), by one penny. The data model's formula is the precise statement of largest remainder. |
| 2026-11-17 | Tailwind `@theme inline`, and tokens re-declared on `[data-scheme]` elements. | `light-dark()` resolves where a variable is declared; without these, a part of the page can't show the other theme (the gallery's side-by-side panels), and later a forced theme on one subtree wouldn't work. |
| 2026-11-17 | The demo switch is the build-time constant `__APP_DEMO__` wherever code is demo-only; CI fails if gallery or demo data reach the production bundle. | Through an imported object the bundler kept a lazy gallery chunk in production, which the service worker would have downloaded to the phones. |
