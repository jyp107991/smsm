# smsm: build log

Newest first. Each entry: what was built, what was tested, what failed, what's next.

## 2026-11-16: S0 and S1 in progress (handoff)
**Done**
- `docs/slices/S0.md` and `docs/slices/S1.md` (briefs, with the exact interfaces the tests are written against).
- Repo skeleton: Vite 8, React 19, TypeScript 6 strict, Tailwind 4 on tokens, PWA (update prompt), ESLint (money rule, pure core, import boundaries), Vitest 5, Playwright 1.65, `npm run verify`, `npm run trace` (all 108 criteria deferred to their slices in `OPEN_ITEMS.md`).
- Database: `schema.sql` is now the first migration; a second migration stops signed-out callers running database functions and adds `health()`. SQL tests: 26 checks pass, 23 forbidden actions refused. `schema.sql` and the TypeScript types are generated from the migrations; CI fails if stale.
- Workflows: `ci` (every branch: checks; secrets dry run; preview of the demo), `deploy` (main: checks, migrations, functions, build, Cloudflare, smoke test), `keepalive` (every 2 days), `auth-config` (manual; diff by default, push only after approval).
- GitHub Actions minutes ran out; the owner made the repo public (checked first: no secrets or personal details in history). Logs are public, so no workflow prints account details.

**In progress**
- First CI run on the branch after going public.
- Four agents in parallel: S0 tests and S1 tests (independent writers, from the briefs only); S0 builders for the animal rig/plank/logos and for tokens/type options/primitives.

**Next**
- Merge the agents' work; build the S1 core against its tests; gallery and demo data; merge to main so the pipeline deploys; run `auth-config` (diff only).
- Then one message to the owner: gallery link, the Auth settings the first config push would change, and how sign-in codes should reach both people.

**Open questions for the owner**
- None right now (sign-in email delivery will be asked with the gallery).

## 2026-11-16: owner decisions
- Palette set to the owner's "Forest Green and Walnut" (contrast re-measured); chapters, the plank and free editing confirmed; no joint account (not built in v1); Gemini on the free tier.
- Next: S0.

## 2026-11-16: design v2
- Spec rewritten around the daily loop with acceptance-criteria ids; added chapters, places and trips, money back, joint payer, variable bills, the Inbox, the recap, comments, Monzo handoff, and the Gemini features (`docs/AI.md`).
- Design rewritten: forest, wood and paper palette (contrast measured), the plank, the avatar rig.
- Engineering approach written (`docs/ENGINEERING.md`): executable spec, pure core, tests-first by a separate agent, fresh review, gated deploys, demo mode.
- `supabase/schema.sql` v2 written and tested on PostgreSQL 16 with the auth stub: 24 checks pass, 15 forbidden actions refused (`scripts/test-sql.sh`).
- Next: owner reads `DECISIONS.md` proposals; then S0.

## 2026-11-16: design v1
- First spec and schema (superseded).
