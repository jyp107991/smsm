# smsm: build plan

Work through the milestones in order. Each ends with: tests green, a commit and push to `main`, and an entry in `docs/BUILD_LOG.md` (what was built, what was tested, what failed, what's next). Tick `docs/OPEN_ITEMS.md` as you go.

## M0: skeleton and pipeline
- Vite + TypeScript + Preact PWA (`vite-plugin-pwa`, Workbox), Node 22 (`.node-version`), strict TS.
- `wrangler.jsonc` for Cloudflare Workers static assets with a single-page fallback, and `public/_headers` (no-cache for `sw.js` and `index.html`, security headers), the same as MacroPy (`jyp107991/macropy`: `wrangler.jsonc`, `public/_headers`, `docs/DEPLOY.md`).
- Vitest and Playwright wired up; GitHub Actions CI: typecheck, unit, SQL tests (PostgreSQL service container running `tests/sql/`), build, e2e.
- Design tokens (`src/styles/tokens.css`), Nunito, both themes, the tab bar and empty screens.
- Logo: 3 SVG variants of ㅅ over ㅁ (DESIGN §2.2), rendered at 48 px into `docs/logo/`; pick one and record it in `docs/DECISIONS.md`. Generate icons and the manifest.
- Cat and dog avatars with four expressions each (DESIGN §2.3), plus a gallery page (`/dev/avatars`, dev builds only) for review.
- **Done when:** the empty app installs on a phone from the Cloudflare URL and works offline.

## M1: money core (pure TypeScript, no UI)
- `money.ts` (parse and format), `split.ts` (ratio, exact, for_other, treat, with largest-remainder rounding), `balance.ts`, `recurring.ts` (occurrence dates, matching the SQL), `quickadd.ts` (SPEC §3.1 grammar), `analytics.ts` (DATA_MODEL §5), `itemise.ts`, `fx.ts`.
- Unit tests, including property tests (fast-check): shares always sum to the amount, never negative; balance is antisymmetric (swap people → negated balance); recurring dates match the SQL function's dates for 500 random templates.
- Quick-add: at least 60 example phrases with expected readings, in `tests/vectors/quickadd.json`.
- **Done when:** coverage ≥ 95% on `src/lib/`.

## M2: backend, sign-in, setup
- Supabase project; `supabase/schema.sql` applied; `household_balance` view plus `updated_at` on every synced table as migrations; SQL tests extended.
- Email one-time-code sign-in (as in MacroPy). Start or join a household, pick name and animal, locked identity, change requests with an approval banner.
- **Done when:** two test accounts can create, join, pick animals and approve a change, end to end against a real Supabase project.

## M3: local-first sync
- IndexedDB store, outbox with retries, pull by `updated_at`, Realtime subscription, conflict notice, offline indicator (DATA_MODEL §6).
- **Done when:** e2e passes for: two browsers, one goes offline, both edit, reconnect, and both converge with the right balance.

## M4: the daily loop
- Home (balance card with avatar states, quick add with live preview, this month, recent).
- Add/edit sheet, expense detail with history, duplicate, soft delete with undo.
- Activity list with search and filters. Settle up, with the hop animation.
- **Done when:** the whole daily loop works at 390×800 in both themes, offline and online.

## M5: recurring and extras
- Recurring templates (create from the add sheet via "Repeat", edit, pause, end); `post_due_recurring` on open; pg_cron job.
- Bills tab: This month, Upcoming, Subscriptions.
- Categories editor, category default ratios, the household default ratio via approval.
- Tags, notes, receipt photo (compression, private bucket, storage policies), itemised bills, foreign currency.

## M6: insights
- Insights tab: overview, by category, trend, who paid, fairness, insight cards, year in review. Every figure with its ⓘ definition.

## M7: import and export
- CSV import (Monzo plus generic with mapping), inbox, rules, hashed ignores. Check the Monzo column names against a real export and record them.
- Export: CSV, monthly PDF statement, full JSON backup.

## M8: notifications
- Web push: subscriptions, prefs, Edge Function on cron (port from MacroPy's `remind`), the four notification types (SPEC §4.5).

## M9: release QA
- Full `docs/QA.md` pass, an independent review, fixes, and a version tag `v1.0.0`.

**Later (not v1):** live Monzo sync (SPEC §5).
