# smsm: project instructions for Claude Code

smsm is an installable phone app (PWA) for two people who share a home. It records shared spending and keeps one running answer to "who owes whom". It replaces Splitwise and Tricount for a couple.

Read these before writing any code, in this order: `docs/SPEC.md` (what to build), `docs/DESIGN.md` (how it looks and feels), `docs/DATA_MODEL.md` (tables, money rules, sync), `docs/DECISIONS.md` (the owner's decisions and the spec's assumptions), `docs/BUILD_PLAN.md` (milestones), `docs/QA.md`, `docs/DEPLOY.md`. `supabase/schema.sql` and `tests/sql/` are the tested starting point for the database: extend them with migrations, don't rewrite them.

## Non-negotiables

1. **Scope rule.** Shared spending and debts between the two people only. Nothing about either person's own finances: no incomes, personal spending, budgets or savings goals. If a change needs individual finances, it's out of scope; ask.
2. **Money is exact.** Integer pence everywhere; no floating-point money. Shares always sum to the amount, enforced in TypeScript and in the database. The balance is computed by one pure function and cross-checked against the database view in tests.
3. **The database is the authority.** Row-level security on every table, keyed to the household via `my_household()`. Locked identity and the default ratio change only through approved change requests. No hard deletes of money rows. Every change is logged in `activity`.
4. **Phone-first and offline-capable.** Everything works on a 390×800 Android phone in Chrome and as an installed app; local-first with an outbox; nothing breaks offline.
5. **Warm, clean, intuitive** (`docs/DESIGN.md`): both themes, WCAG AA, tap targets ≥ 44 px, no horizontal overflow at 320 px, no layout shift, keyboard-aware sheets, reduced motion respected. The cat and dog are original drawings.
6. **Secrets never enter the repo.** Supabase URL and anon key come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time (local dev: gitignored `public/config.js`, with `config.example.js` committed). Server secrets (VAPID private key, later Monzo tokens) live only in Supabase secrets.
7. **Monzo-ready.** Don't assume manual entry is the only source of expenses (SPEC §5).

## Working style

- Work autonomously through `docs/BUILD_PLAN.md` milestone by milestone. Where the docs are silent, choose the option most consistent with the non-negotiables, record it in `docs/DECISIONS.md` ("Made during the build"), and continue. Ask the owner only about scope or about anything that changes a decision in the "Decided by the owner" table.
- Commit and push to `main` at least once per completed milestone step; keep `docs/BUILD_LOG.md` current (what was built, what was tested, what failed, what's next).
- Tests: `npm test` (Vitest), `npm run test:sql`, `npm run e2e` (Playwright). All must pass before a commit that claims a milestone.
- UI copy: plain language, sentence case, active verbs, no jargon, no ALL-CAPS labels. Copy is part of the design.

## Stack (decided)

Preact + TypeScript (strict) + Vite PWA (`vite-plugin-pwa`, Workbox), IndexedDB via `idb`, Supabase JS (auth, Postgres, Realtime, Storage, Edge Functions with pg_cron), Vitest + fast-check + Playwright + axe-core, Lucide icons, Nunito via `@fontsource`, Cloudflare Workers static assets from this repo. The hosting, sign-in and push setup mirror `jyp107991/macropy`; reuse its patterns.
