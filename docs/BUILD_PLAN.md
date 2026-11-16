# smsm: build plan (v2)

Ten slices. Each ends deployed, with the app better and still fully working. The owner and partner start using it for real at the end of **S2**; everything after that is added to an app already in daily use, which is the fastest way to find what matters. Each slice follows the protocol in `docs/ENGINEERING.md` §5 and its definition of done (§8).

Owner checkpoints are marked ★. Nothing else needs the owner.

## S0: the pipeline and the look
- Repo skeleton (ENGINEERING §3), strict TypeScript, lint rules, Vitest, Playwright, `npm run verify`, `npm run trace`.
- CI and deploy pipeline end to end: checks → migrations → functions → Cloudflare; preview builds; smoke test. Deploy an empty installable app.
- Supabase project connected; `schema.sql` applied through the pipeline; generated types.
- Design tokens, both themes, the paper grain; primitives (button, field, chip, sheet, toast, tabs).
- The avatar rig: both animals, all moods and poses, motion. The plank at any balance.
- Demo mode with the seeded 18-month household.
- **The gallery** (DESIGN §7), deployed.
- Error reporting to `client_errors`; version and build shown; update prompt.
- ★ Owner: one-time accounts and secrets (`DEPLOY.md` §1–3); then look at the gallery on a phone and choose logo, type and any colour changes.

## S1: the money core
Pure `src/core`: money, split (all modes; `paid` as a map so a joint payer can be added later), balance, dates, recurring dates, quick-add grammar, categorise (memory + seed list), filters. Vectors, property tests, mutation score ≥ 85%. No screens. Can run in parallel with S0's interface work.

## S2: the daily loop → **first real use**
- Sign-in by emailed code; start or join; name and animal; identity lock; approvals.
- Home: the plank, the sentence, whose turn; quick add with live reading; recent.
- Add/edit sheet (amount, description, category, payer, split, date, notes); entry page with history; undo; duplicate; money back.
- Activity with search and basic filters.
- Settle up, with the Monzo handoff and the all-square moment.
- Persisted cache, optimistic writes, offline queue, realtime, stale-app check.
- Full JSON backup download, the nightly off-site backup and the keep-alive job (so real data is safe from the first day).
- Two-user end-to-end suite.
- ★ Owner and partner install it and start using it. From here, a short "what annoyed us this week" note from the owner goes into `OPEN_ITEMS.md` and is triaged at the start of each slice.

## S3: recurring, bills, inbox
Templates (fixed and "amount varies"), database posting and the nightly job, suggestions to make something recurring, price-change history; Bills tab (month, upcoming, subscriptions, what home costs); the Inbox with variable bills; categories editor and learned defaults; default-split approval.

## S4: chapters and places
Chapters (create, current chapter, page, close); country on entries, current country, location permission and place capture, trip suggestions and "welcome home"; other-currency helper; filters by chapter, country, place. Everyday-versus-chapter rule in all figures.

## S5: insights and the recap
Month-so-far on Home; Insights tab and charts; notes; fairness; standing-order hint; the monthly recap with template wording; settle day; year in review; on this day; comments.

## S6: smart features
The `ai` function with caps and guards; scan and itemise; loose-wording parse; category guesses; recap wording; Ask smsm; photo attachments and the receipts bucket; share target and app shortcuts. Contract tests in CI; the live eval run and logged.
- ★ Owner: add the Gemini key (`DEPLOY.md` §5) and drop ten receipt photos into the eval folder.

## S7: import and export
Splitwise import with the balance cross-check; Monzo CSV and generic CSV through the Inbox with rules and hashed ignores; CSV export; PDF statement; restore from backup.
- ★ Owner: a Splitwise export (if history is wanted) and a real Monzo CSV to confirm the columns.

## S8: notifications
Push subscriptions and preferences; the Edge Function on a schedule; the five notification types; deep links; icon badge.

## S9: hardening → v1.0
Release QA (ENGINEERING §9); performance pass on a mid-range phone profile; larger-screen layout; fix everything found; tag `v1.0.0`.

## Later
Monzo, live (SPEC §9).

## Order and cutting
The order is by value and by risk: money first, then the loop, then everything else. If time presses, slices S5–S8 are independent of one another and can be reordered or trimmed without touching the core; S0–S2 cannot be shortened.
