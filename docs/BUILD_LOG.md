# smsm: build log

Newest first. Each entry: what was built, what was tested, what failed, what's next.

## 2026-11-17: S0 look and S1 core built (PR #2)
**Done**
- After the restart, I built the S1 core in the main thread (money, split, balance, dates, recurring, text, categorise + `content/merchants.json`, quick-add, filters) while four agents worked; all pushed as I went.
- Independent tests (S0 and S1 writers) merged: 911 tests pass, including 500 random recurring schedules matching PostgreSQL and the balance matching `member_net`. Four disagreements found by them, resolved in their favour (see DECISIONS).
- Mutation score 91.8% (in CI, fails below 85%).
- Tokens (OKLCH), 12 category colours, three type options, primitives (Button, Field, Chip, Sheet, Toast, Tabs, Segmented); the cat and dog rig and the plank; demo household; row validation (`src/data/rows.ts`).
- Gallery (demo build only; CI checks production never contains it): Logo, Type, Colour (both themes, fifth-colour choice), The plank, The cat and the dog, In use. Gallery e2e: axe clean, no overflow at 320, both themes, reduced motion.
- Logo redrawn from real Hangul letterforms after owner feedback ("does not resemble the two Korean characters enough").
- Migration 3 (S2 groundwork): 10 wrong join codes per hour per account.

**In progress**
- PR #2: CI and a fresh review. Then merge → deploy → the owner message.

**Next**
- Owner message: gallery link; the 4 Auth changes (DECISIONS / this log 16 Nov); sign-in email recommendation.
- While waiting: S2 tests-first agent from `docs/slices/S2.md` (after adding its interfaces), S2 data layer.

## 2026-11-16: S0 and S1 in progress (handoff)
**Done**
- Briefs: `docs/slices/S0.md`, `S1.md`, `S2.md` (S2 drafted).
- Repo skeleton, lint rules, trace, migrations, generated schema/types, workflows (see DECISIONS).
- GitHub Actions minutes ran out; the owner made the repo public (history checked first). Public logs: tool output goes through `scripts/redact.sh`.
- PR #1 (pipeline, database baseline, app shell) reviewed by a fresh agent (no blockers; 9 should-fix items fixed before merge: log redaction, deploy only from main, future functions closed to PUBLIC, SQL tests that can fail, smoke test checks content, error queue ids, SMTP not pushable until chosen, known risks recorded) and **merged; first deploy passed**: migrations applied to the live project, app and demo deployed, smoke test passed.
  - App: https://smsm.jaexpark94.workers.dev · Demo/gallery: https://smsm-demo.jaexpark94.workers.dev/gallery
- Auth diff (read-only, `auth-config.yml` mode diff, run 43956954065). A push of the current `config.toml` would change 4 settings: `site_url` http://localhost:3000 → the app address; `otp_length` 8 → 6; `otp_expiry` 3600 → 900 s; `secure_password_change` false → true. Not changed (not declared): TOTP MFA enroll/verify on, SMS confirmations on, pooler sizes, storage vector. With the SMTP block (still commented, waiting for the owner): custom SMTP on, sender "smsm", the code email template for both new and returning sign-ins, email rate limit 30/hour.

**In progress**
- Four agents: S0 tests and S1 tests (independent writers); S0 builders (animal rig/plank/logos; tokens/type options/primitives).
- 2026-11-17: the container restarted overnight and the first four agents were lost before committing; relaunched from `1c1a3a0` with instructions to commit work-in-progress every 20 minutes. If this happens again, check `git branch | grep worktree-agent` for their WIP commits before relaunching.

**Next**
- Merge agents' work; S1 core against its tests; gallery assembly and demo data; PR #2; then the owner message (gallery link, the auth changes above, sign-in email recommendation).

**Open questions for the owner**
- (to be sent together) logo/type/fifth colour; approve the Auth changes; how sign-in codes are sent.

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
