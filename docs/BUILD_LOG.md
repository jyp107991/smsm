# smsm: build log

Newest first. Each entry: what was built, what was tested, what failed, what's next.

## 2026-11-17: two-user suite, first run diagnosed and fixed
- **What went wrong** (CI run 44032201912): 20 of 21 scenarios stopped at the very first step, signing in. The app asked for a code and the local auth server said "sent" (it answered 200), and the email did reach the test mailbox, but it held only a sign-in link: the auth server's built-in email (GoTrue 2.198) no longer prints the 6-digit code. smsm signs in with the code only, so the tests had nothing to type. The one scenario that passed (OFF-4) never signs in. Nothing after sign-in was reached, so the run says nothing yet about the screens.
- **Fix:** the CI job now uses smsm's own code email (`supabase/templates/code.html`, the one already proposed for the live project) on the local test stack only. The committed `config.toml` and the live project are unchanged. Checked by sending both emails through the same Mailpit version the stack uses and reading them with the suite's own mail reader (link-only email: no code, the exact CI error; code email: code read). New unit test `tests/unit/sign-in-email.test.ts` keeps the CI job and the mail reader in step.
- **For the owner:** this confirms the live project needs the code email too before real use: the built-in email sends a link only. That is the open question of who sends the sign-in email (owner answers still outstanding, below); nothing changes there without your approval.
- **Next:** push and let the two-user job run to the end; any later failures (setup, screens, sync) only show up once sign-in works.

## 2026-11-17 (resumed): two-user failures being diagnosed; backup built
- An agent is diagnosing and fixing the two-user suite's failures from CI run 44032201912 (branch `worktree-agent-aa04c1aaf3ed66e75`).
- EXP-2 built: `.github/workflows/backup.yml` (nightly 02:23 UTC; data-only export of public + auth users, gzip, gpg AES-256 with the `BACKUP_PASSPHRASE` secret, 30-day Actions artifact) and `scripts/restore-backup.sh` (pauses triggers so history isn't duplicated); restore drill test `tests/unit/backup-restore.test.ts` passes (balances and history identical, wrong passphrase refused). Needs the owner to add `BACKUP_PASSPHRASE` (DEPLOY §1b).
- Next: merge the two-user fixes → push → let the two-user job run undisturbed; then the remaining screens-review fixes (listed in the entry below); then PR to main.

## 2026-11-17 ~08:00 UTC: STOPPED BY THE ACCOUNT'S WEEKLY USAGE LIMIT (resets 22 Nov, 16:00 UTC) — exact handoff
**Where things stand**
- `main` (live): S0, S1, the gallery with owner feedback round 1 (deploy 3). Untouched since; safe.
- Branch `ccr-d34ab85d-b429dn` (not merged): the whole of S2 so far — data layer + review fixes, all S2 screens, the two-user e2e suite and its CI job, and most of the screens-review fixes. Locally: 1,040 unit tests, 47 SQL checks, production build clean.
- Screens-review fixes DONE (with tests): duplicating a money-back keeps it money-back; Monzo offered only to the person who owes; Undo of an edit; no swipes on deleted rows; plain-word errors; sign-out forgets a pending "Did it go through?"; refunds dated today; the "Next one’s on" apostrophe aligned in specs/docs; setup-join spec goes Home before checking the sentence.
- Screens-review fixes NOT DONE: focus returns to the opener when a sheet/long-press menu closes (and the menu registers with the history coordinator); the Add button overlapping Quick add at 320×640 and the Saved toast covering it; category chips shifting (pass `c.colour`, fixed slot for the suggested dot; "Other" shows tick + "•"); settle-up "more than is owed" line; reword "…went through in Monzo, it’s recorded here"; Exact/validation messages into `strings.ts`.
- Two-user suite, first full CI run (run 44032201912, job 133866629629, traces in artifact 14306161676): **1 passed, ~19 failed in 11 min**. Not yet diagnosed. So many failing together suggests one shared cause early in the flow (sign-in via Mailpit, setup, or app wiring against the local stack).

**Next actions, in order (new session: "Continue from docs/BUILD_LOG.md")**
1. Read the first failing scenario's error in the job log (or download the artifact) and fix the shared cause; push and let the two-user job run WITHOUT pushing again until it finishes (a push cancels the running job).
2. Finish the open screens-review fixes above (failing test first).
3. PR to main when CI (incl. two-user) is green → deploy → smoke.
4. Nightly off-site backup (EXP-2) needs a private destination (the repo is public): propose a private `smsm-backups` repo or Cloudflare R2 to the owner.
5. Owner answers still outstanding: logo A/B/C, type A/B/C, fifth colour A/B, approve the 4 Auth changes, the sign-in email sender (recommended: a new Gmail account just for smsm, app password as two GitHub secrets). The sign-in email is the only thing that truly blocks first real use.

## 2026-11-17 (evening): S2 screens built
**Done** (branch `worktree-agent-a6a2472cb41b4d544`): every S2 screen on the real data layer: sign-in (email → one code field drawn as six boxes, paste accepted), setup (start or join, name, the animals as cards with the taken one saying whose), Home (the plank with moods, the sentence with names, "Next one's on …", Settle up, quick add with its live reading, today's entries, changes waiting, offline, waiting for your partner with Share invite, approvals, refused entries to fix), the add / edit / money-back sheet, the entry page with history, Activity (search, filters, days, settle-ups, swipes), settle up with the Monzo handoff and the all-square moment, Settings (names and animals with Request a change, the usual split, monzo.me name, join code, backup download, theme, version, sign out). Learning categories and splits (`category_memory`). One history coordinator for back and sheets; one live region for toasts. The demo build now shows the working app at `/` (gallery still at `/gallery`). The `two-users` CI job added.
**Tested:** unit and screen tests (wording, quick add, the form, history, category memory, backup, screens over the in-memory server); demo e2e tour of every screen at 390 and 320, both themes, axe clean, plus the daily loop; screenshots in both themes at both sizes looked at and fixed (Add expense pill at 320, filter row wrapping, category chips without the extra dot).
**Not verified here:** the two-user suite (needs the Supabase local stack, i.e. Docker; it runs in CI).
**Next:** fresh review of the screens; CI's first two-user run; the nightly backup (EXP-2); then PR → deploy.

## 2026-11-17 (later): owner feedback round 1; S2 started
**Owner feedback** (after the gallery): dog's nose a smaller black dot; no white background, both themes variants of the green-and-wood palette; logo symmetric; font, wording, headings and terminology felt generic ("Claude-y").
**Done:** nose; light theme now sage linen / wool / deeper sage with contrast re-measured (DESIGN §3.1, DECISIONS); symmetric logo (icons re-rendered). On the branch preview: https://ccr-d34ab85d-b429dn-smsm-demo.jaexpark94.workers.dev/gallery
**In progress (agents, each commits WIP to its `worktree-agent-*` branch every 20 min):**
- Type, voice and headings rework (new type options incl. Korean-made families with Latin; gallery/shell copy in smsm's voice; ledger-like headings).
- S2 tests-first writer (two-user e2e on the local Supabase stack, data-layer unit tests, CI job proposal in `docs/slices/S2-ci.md`).
- S2 data layer builder (query client + IndexedDB persistence, ordered offline queue, optimistic writes with rollback, realtime, stale-app check, demo-mode data).
**Done (cont.):** type, voice and headings reworked (Korean-made type options; copy in smsm's voice; ledger-rule headings); PR #3 merged; deploying.
- Gallery live with feedback round 1 (deploy 3).
- S2 tests written (branch `worktree-agent-a5ac2d3b30ba4fa1a`, sha f27cf4ec): two-user e2e on the local stack (Mailpit), data-layer unit tests with a fake client, CI proposal in `docs/slices/S2-ci.md` (on that branch). Not merged yet: they need the data layer.
- Data-layer builder told to satisfy those tests' contracts (createStore, createSessionKeeper, version checks).
- S2 data layer merged with the S2 tests (store over Supabase with an ordered, persisted offline queue; session keeper that never signs out offline; version check; realtime incl. migration 4; demo store). 965 unit tests, 35 SQL checks, 13 browser tests pass.
- Fresh review of the data layer: 1 blocker (two windows on one phone both own the queue: a queued write can be lost or a stale replay overwrite a newer amount), 5 should-fix (non-money edits rebuilding money on joint/odd rows; discarded writes still sent; sign-out dropping refused entries; database trusting `created_by`; pre-join entries' shares in the balance), nits. A fixer agent is on it, failing test first for each (branch `worktree-agent-ad173f31a533e67d6`). Nothing goes to main until fixed.
- Data-layer review fixes merged (1857663): one window owns the queue (Web Locks), non-money edits keep money as stored, discarded writes never sent, refused entries count at sign-out, migration 5 makes the database record who created and edited rows, pre-join shares correct in the balance; plus nits. 984 unit tests, 47 SQL checks.
- S2 screens merged (3b93358): every S2 screen on the real data layer; demo build shows the working app; the `two-users` CI job added. Branch preview: https://ccr-d34ab85d-b429dn-smsm-demo.jaexpark94.workers.dev/
- Fresh review of the screens: 3 blockers (duplicating a money-back saved an expense; apostrophe mismatch with the two-user specs; one spec checking the wrong page), 6 should-fix (Monzo offered to the person owed; focus return; raw server text; Add button over Quick add at 320; chip layout shift; Monzo question surviving sign-out), nits. A fixer is on it (failing test first).
**In progress:** screens review fixes; first CI run of the two-user suite + the `two-users` CI job (branch `worktree-agent-a6a2472cb41b4d544`, WIP every 20 min).
**Next:** review fixes; merge screens; first CI run of the two-user suite; PR → deploy; then the owner's answers unlock the live sign-in email.
**If restarted:** `git branch | grep worktree-agent` and `git log` each; relaunch any agent whose final commit is missing, from its last WIP commit, with the same instructions (see this log's 17 Nov entries).

## 2026-11-17: S0 look and S1 core built (PR #2)
**Done**
- After the restart, I built the S1 core in the main thread (money, split, balance, dates, recurring, text, categorise + `content/merchants.json`, quick-add, filters) while four agents worked; all pushed as I went.
- Independent tests (S0 and S1 writers) merged: 911 tests pass, including 500 random recurring schedules matching PostgreSQL and the balance matching `member_net`. Four disagreements found by them, resolved in their favour (see DECISIONS).
- Mutation score 91.8% (in CI, fails below 85%).
- Tokens (OKLCH), 12 category colours, three type options, primitives (Button, Field, Chip, Sheet, Toast, Tabs, Segmented); the cat and dog rig and the plank; demo household; row validation (`src/data/rows.ts`).
- Gallery (demo build only; CI checks production never contains it): Logo, Type, Colour (both themes, fifth-colour choice), The plank, The cat and the dog, In use. Gallery e2e: axe clean, no overflow at 320, both themes, reduced motion.
- Logo redrawn from real Hangul letterforms after owner feedback ("does not resemble the two Korean characters enough").
- Migration 3 (S2 groundwork): 10 wrong join codes per hour per account.

- PR #2 reviewed by a fresh agent (no blockers; fixes in DECISIONS 17 Nov) and **merged; deploy 2 passed** (migration 3 applied, smoke test passed). Gallery: https://smsm-demo.jaexpark94.workers.dev/gallery
- S0 and S1 done. Remaining from the review, scheduled into S2: sheet history coordinator, toast live region (OPEN_ITEMS).
- Owner message sent (17 Nov, ~04:20 UTC): gallery choices, the Auth changes, sign-in email recommendation.

**Next (doesn't need the owner's answers)**
- S2 brief: add interfaces (routes, accessible names, data hooks) to `docs/slices/S2.md`; launch the S2 tests-first agent.
- S2 data layer: TanStack Query + IndexedDB persistence, offline mutation queue, realtime, stale-app check (new packages named in the brief first).
- Second keep-alive via a Cloudflare Cron Trigger (OPEN_ITEMS known risk).

**Waiting on the owner**
- Logo A/B/C, type A/B/C, fifth colour A/B.
- Approve the 4 Auth changes (site address, 6-digit codes, 15-minute expiry, secure password change).
- Sign-in email: recommended a new Gmail account just for smsm with an app password (two GitHub secrets: SUPABASE_SMTP_USER, SUPABASE_SMTP_PASS). Then uncomment the SMTP block in `supabase/config.toml`, run `auth-config` diff, then push.

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
