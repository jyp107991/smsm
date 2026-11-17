# smsm: build log

Newest first. Each entry: what was built, what was tested, what failed, what's next.

## 2026-11-17 ~18:15 UTC: S3 built (Bills, regular payments, Inbox, categories)
- Built directly (no agents), after the owner's instruction. Database: post_due_recurring by the UK date with row locks, varying bills to the Inbox, nightly job 01:17, no deletes; SQL 91/91, refused 30/30. Core: costs a month/year, upcoming, looks-monthly. Data: regular payments, Inbox decisions and categories through the offline queue.
- Screens: **Bills tab** (what home costs; this month as a calendar with its total; next 30 days; subscriptions with a year's total; paused or ended at the bottom); **regular payment sheet** (How often, Every, **Starts on the day you pick**, Ends, Amount varies, Subscription; Pause, Resume, End; history with price changes); **Repeat** in the Add sheet; **Inbox** on Home; **"looks monthly"** suggestion; **Settings → Categories** (rename, emoji, colour, order, archive, add).
- Tests: all 24 S3 screen tests, the full suite (1,356) and the 6 S3 browser tests (320/390 px, light and dark, accessibility-clean) pass. Next: full browser suite, CI, review of the money parts, screenshots to the owner, release.

## 2026-11-17 ~18:00 UTC: S3 builder had died at 15:48 — restarted as two builders with a stall watch
- The S3 builder stopped at 15:48 (its task vanished, likely a container restart) with only two draft migrations written; the idle check-ins didn't catch it. Owner was (rightly) frustrated at the wait.
- Salvaged its drafts as commit 09a913e on its worktree branch. Restarted as two builders in parallel: data (migrations, core, data layer, demo seed) and screens (Bills tab, regular payment sheet, Inbox, looks-monthly, categories), each committing every 15 min; a Monitor alerts on 25 min without a commit.
- Live meanwhile: "Check for updates" (PR #9). Plan change: no Splitwise import (owner).

## 2026-11-17 ~17:20 UTC: the app updates itself — LIVE
- Owner: the phone stayed on an old build (c9b1d3e): the old worker waited for every window to close and its Refresh prompt was hidden. Owner asked for an update check on launch with a progress bar.
- PR #8 merged (CI 44131224387 green, two-user 21/21); deploy 44133039790 green; live version.json e9bfdcf; live sw.js has skipWaiting.
- Now: the worker takes over at once; LaunchUpdate checks /version.json on launch (and on return after 10 min, no sheet open), shows "Updating smsm" with a progress bar, saves the queue and reloads once; never mid-use (the plugin's auto-reload is replaced by the prompt); toasts no longer slide over the tab bar.
- Owner's phones need one manual full close (old code); after that, updates are automatic.

## 2026-11-17 ~16:05 UTC: polish wave 2 LIVE; S3 building
- PR #7 merged (CI run 44117239902 all green, two-user 21/21); deploy run 44119135248 green; live version.json commit 1943cee. The owner said yes to the screenshots.
- Live now: the Add sheet (hero amount, sums inline, recent descriptions, in-app calendar, named splits incl. 70/30, More details), quick add Save in the box and tidy descriptions, Home "Recent", toasts that name things (Duplicate offers Undo — owner), the entry page "owes … for this" line and "came back" links, Activity grid/filters, Settings monzo check line, settle-up wording.
- S2 polish is complete. S3 (recurring, bills, inbox, categories): tests first done (8c65d18); builder running.

## 2026-11-17 ~14:30 UTC: polish wave 1b LIVE
- PR #6 merged (CI run 44100028955 all green, two-user 21/21); deploy run 44101794646 green; live version.json commit c4c8601.
- Live now: the owner-approved look (one toast layer with a visible update prompt; tonal selected states; warm scrim; Add button inside Quick add; centred tabs; sign-in with the plank and auto-submitting code; grounded plank; approval banner; offline pill), quick add cat/dog as ordinary words, the plain "sign-ups closed" message, the "Forget it" persistence fix, and the edit-mode discard question.
- On the way: CI failed once because closing sign-ups also closed them on the CI test stack (fixed: the two-user job opens them in its own workspace).
- Owner decision: lighter process for low-risk changes; small, frequent releases (DECISIONS).
- Running: wave 2 builder.

## 2026-11-17 ~13:45 UTC: sign-ups closed; 1b release blocked on one CI test; wave 2 building
- **Sign-ups closed** (owner yes): `enable_signup = false`, auth-config diff run 44095092073 (1 update), push run 44095233212; the live service now answers a new email with 422 signup_disabled. The app's message for it ("This email isn’t one of the two…") ships with the next release. Reopen = set true + auth-config push with the owner's approval.
- Both people have joined and are already adding real entries (owner's partner hit the hidden "Updated. Tap to refresh" prompt — fixed in 1b, Q-L1; workaround: fully close and reopen the app).
- A test account exists for the smsm Gmail address (from the email test this morning): no household, can't see data. Owner told how to delete it (Supabase → Authentication → Users).
- 1b: fresh-review blocker (toast over the tab bar after Save) + 8 more fixed (6dd1ed6); CI run 44092991657 then failed one demo e2e twice (polish1a.spec.ts:277, the banner's "Forget it" question comes back after reopening; passes locally). The 1b builder is diagnosing.
- Wave 2: tests written (worktree branch 3a62900); builder running.

## 2026-11-17: S2 polish 2 built (the Add sheet, Home and Activity); waiting for the owner's look
- **Add sheet:** the amount is the big written figure on a thin line, with "0.00" until you type and a sum's answer at the end of the same line; earlier descriptions are offered before you type; the split is one row that says who: "50/50 · Jae 60 · Sam 40 · Jae 40 · Sam 60 · Other · Exact · For Sam · My treat" (Other has − and + in 5 % steps), and its meaning never flips when you change who paid; money back reads "All Jae’s" / "All Sam’s"; the date is our own calendar in a small sheet (no days after today), and the chip then reads "Tue 10 Nov"; "More details" opens with a turning arrow.
- **Quick add:** a small Save appears in the box when the line is clear; the line under it keeps two lines' room so nothing jumps; with the keyboard up the box moves near the top; descriptions are tidied ("tesco" → "Tesco", "ikea" → "IKEA", Korean untouched).
- **Home:** "Recent" shows the last five entries and settle-ups by day (never a blank "nothing today"); square after a settle-up says "Settled up today" without changing height. **Toasts** say what happened ("Saved Tesco £42.50", "Removed Tesco", "Copied to today" with Open, "Money back saved") and never cover the new row.
- **Entry page:** "Sam owes Jae £21.25 for this"; "£20.00 came back · Today" links to the money back; history starts with "Jae added this".
- **Activity:** our own clear button in search; "Clear all" and "Clear filters"; "Last 7 days" and "Pick dates"; rows give the description the room, with the payer's head by the amount, and screen readers hear who paid; emoji on a small quiet disc.
- **Settings / Settle up:** "@jaepark" works and the line says "Sam will pay you at monzo.me/jaepark"; "Usual split" has its own section; opened by the person owed, Settle up reads "Sam paid Jae" / "Record Sam’s payment"; editing one says "Edit settle-up".
- **Tested:** all wave 2 tests-first tests pass; `npm run verify` green; both builds; demo browser tests all pass, the new file three times over. Two older tests now expect the tidied "Milk"/"Tesco", and three older browser tests had their locators or a pause updated for the new names and layout (DECISIONS); no check was loosened.
- **Not checked here:** the two-user suite (CI only); the locators it needs were updated by the tests-first commit.
- **Next:** fresh review, then the owner's yes on the before/after screenshots before wave 2 merges.

## 2026-11-17 ~13:00 UTC: wave 1b built and merged on the branch; owner reviewing screenshots
- Quick add: cat/dog never decide who paid (owner) — live after the next merge.
- Wave 1b (look) merged into the branch with 1a; 1149 unit tests, 68/68 demo e2e locally. Chosen-chip tint 28 % by night (14 % by day).
- Before/after screenshots sent to the owner (sign-in, Home, approval, offline, Add sheet, scrim, Activity filter, Settings). **Waiting for the owner's yes before 1b goes to main.** Then wave 2 tests-first.

## 2026-11-17 ~12:35 UTC: polish wave 1a LIVE
- PR #5 merged (CI run 44081702363 all green incl. two-user 21/21, mutation ≥85%); deploy run 44083075343 green; live version.json commit c9b1d3e.
- Live now: double taps record once (Save, Record it, Yes, Duplicate, Money back); future dates refused; Enter moves through the form; the Monzo question persists with a Home reminder; quick add reads "42,50" and cat/dog anywhere (unsure next to ordinary words); refunds of exact splits keep their proportion; the logo sits centred inside Android's safe zone.
- CI's one failure on the way (run 44076630487) was the test tapping "Yes" while its sheet was still sliding in; the test now waits for the button to settle. Fresh review: 10 findings, all fixed with tests.
- Running: wave 1b builder (look). Next: wave 1b screenshots to the owner → yes → merge; then wave 2 tests-first.

## 2026-11-17: S2 polish 1a: CI fix and fresh-review fixes
- **CI run 44076630487** failed one browser test ("Yes" tapped twice on "Did it go through?"): nothing was recorded and the quiet banner showed instead. The test measured where Yes was while the sheet could still be sliding up (it opens as the app starts), so both taps landed below the sheet, which put it away ("Not yet"). The test now waits until the button has stopped moving and really receives the tap before tapping. The app was right: a tap outside a sheet closes it, and the question was kept.
- **Review fixes:** the Monzo question now carries its own settle-up id and who asked, so answering it in the sheet, on the banner, after a restart or in another window records it once; a question from the other person or about someone outside the household is dropped; the banner waits for both names. Quick add: "hot dog stand", "dog and duck", "cat cafe", "dog walking" open the form to check (the cat/dog is still read as who paid); "for sam treat" too. A held Enter doesn't run on through the form. "0,00" is zero in an Exact share. Money back on huge exact splits is worked out in exact whole numbers. The double-tap guard only arms when a sheet really closes, and also ignores a long press's late click. Deleting or restoring twice shows no second message.
- **Tested:** a failing test first for each (except the huge-split one: no case where the old arithmetic actually gave a wrong penny was found in 500,000 random tries, so it is guarded by a property test against exact arithmetic); `npm run verify` green (1137 tests, trace clean, SQL 47/47); both builds; demo browser tests 39/39 with TZ=UTC and CI=1.

## 2026-11-17: S2 polish 1a built: money and input safety (Q-F1…Q-F5, Q-U1…Q-U3)
- **A double tap records once.** Save, Record it, "Yes", Duplicate and the Money back Save each make their entry's id once, so tapping twice (or holding Enter) saves one entry, one settle-up, one copy. A second tap at the same spot just after a sheet closes is ignored, so it can't switch you to Activity either.
- **No dates after today** in the form ("That date is after today."), as quick add already did.
- **Quick add reads better:** "70/30 for sam" no longer makes Sam the payer (it opens the form to check); "cat"/"dog" mean who paid anywhere in the line, except before words like food, litter, walker; "42,50" is £42.50 (also in the form's Amount); Enter with no amount says "Start with an amount, like 12.50."; the keyboard's key says send.
- **Enter moves on:** Amount → Description → saves; Exact shares step to the next and then to Save; Enter in Settle up's amount records nothing.
- **"Did it go through?" survives closing the app.** After "Not yet", a quiet banner on Home asks until you answer Yes (records it) or Forget it.
- **Money back on an exact split** starts in the same proportion, to the penny, so a partial refund saves at once. Deleting or restoring twice no longer adds a second history line.
- **Tested:** all 1a tests-first tests pass; `npm run verify` green (1100 unit/component tests, trace clean, SQL 47/47); production and demo builds; demo browser tests 39/39 (the 1a file 3 times over, 33/33). One test fix: the browser tests looked for the balance while a sheet covered it (a sheet correctly hides the page from screen readers); they now look past the sheet, with the same checks.
- **Not checked here:** the two-user suite (CI only); no accessible name it uses changed.
- **Next:** fresh review, then merge on green (1a doesn't wait for the screenshots checkpoint).

## 2026-11-17 ~16:00 UTC: S2 polish 1b built (the visual system and the chrome)
- **Built** (Q-L1…Q-L11, Q-U4): one way to show "chosen" (soft green fill and a tick; outlines only for the keyboard); a dark, warm shade behind sheets; Add expense now sits inside the Quick add box (no floating button); tabs grouped in the middle; toasts never cover the tab bar, Quick add or Save, and the update notice is one of them ("A new version is ready"); the tab bar hides only when the keyboard is really up; the plank stands on a ground, inset, and "All square" appears when it lands, in green; sign-in has the plank and the two animals, and the code signs in by itself; setup cards line up; the approval banner has the animal peeking over it; one "Offline · 1 waiting to sync" pill; Delete and Sign out on the margin; "Other" shows its dot; the gallery keeps only what's still open and previews sign-in, setup, an approval and offline. Kinder "curious" and "sheepish" faces.
- **Tested:** all of wave 1b's new tests pass (unit 1078, demo e2e 57 incl. polish-1b 29); `npm run verify` green. The two-user suite wasn't run here (needs the local Supabase); its sign-in helper no longer taps Sign in, since the code now signs in by itself.
- **For the owner:** before/after screenshots of every screen, both themes, 390 and 320 wide. One question: by night, a chosen chip inside a sheet is quite faint (see DECISIONS); a slightly stronger tint by night would fix it.
- **Next:** fresh review, then the owner's yes on the screenshots before 1b merges; wave 2.

## 2026-11-17 ~11:00 UTC: full QA pass → S2 polish; owner decisions
- Owner asked for a full QA (function, use, look; "top of the line and premium"). Three independent audits ran on the demo build; results triaged into `docs/slices/S2-polish.md` (waves 1a money/input safety, 1b visual system, 2 Add sheet/Home/Activity). Most serious: a double tap on Save/Record/Duplicate recorded twice (Q-F1).
- Local `node_modules` was stale (demo builds fell back to system fonts; live was fine). `npm ci` fixed it; CI now fails any build whose font paths don't resolve.
- Owner decisions: Quick add is the one way to add (box gets a full-form button; floating button removed); build order stays (S3 Bills next, S5 Insights later); **the owner won't enter real numbers until the app is fully ready**, so sign-ups stay open for now.
- Running: tests-first agents for waves 1a and 1b (worktrees). Next: builders, then 1a merges on green; 1b and 2 wait for the owner's yes on before/after screenshots.

## 2026-11-17 ~10:15 UTC: S2 LIVE — first-real-use checkpoint ★
- **PR #4 merged** (head 8acec62, all checks green incl. two-user 21/21); **deploy run 44060979111** green (migrations, app, demo, smoke). Live: https://smsm.jaexpark94.workers.dev (version.json commit 5778062). Opened as a phone (Pixel 7, dark): sign-in screen, no overflow, no errors.
- **Fresh review** of the final changes: no blockers; fixed with failing tests first: a sign-out isn't undone by the short session wait; a stale last-person note is cleared; docs. `auth-config` now proves the live emails carry the code (run 44059948621: both "yes", custom sender on).
- **Backup** run 44061902567 green (encrypted artifact, 3 KB: no household yet).
- **Owner next:** install on both phones, sign in, start/join. **Me next:** once both have joined, tell the owner, then `enable_signup = false` through `auth-config`. Then S3 per BUILD_PLAN.

## 2026-11-17 ~10:00 UTC: sign-in email live; two-user suite green
- **Two-user suite: 21/21 green** on CI run 44058300857 (commit 8124048), with all other checks.
- **Sign-in email applied** (owner said yes): `auth-config` push run 44058977473. Codes now go out from smsm's own Gmail account (address only in the secret), subject "Your smsm code". A test request to the live auth service for the smsm address returned 200 (it would fail if Gmail refused the login); the owner checks that inbox.
- **Backup key:** the nightly backup is now encrypted with the database password (owner: a separate passphrase "feels like bloat"). Nothing left for the owner to add.
- **Next:** fresh review of the latest changes (running) → fix findings → PR to main → deploy → owner and partner install and join → close sign-ups (tell the owner first).

## 2026-11-17: two-user suite, third run diagnosed and fixed
- **What happened** (CI run 44051517647, job 133930258318, commit af8f975): **19 of 21 passed; 2 failed on both tries.** Two separate causes, both found in the recorded browser traces.
- **1. "Saved" didn't appear after "Refund this"** (the entry-page scenario). Just before, Restore had shown "Restored Tesco". The new toast was made to wait until the old one had finished sliding away, and in the test browser that slide never finished: the test's fixed clock runs a few seconds ahead of the browser's animation clock after each page load (checked with a small page on its own: a 0.18 s fade that should end at once was still waiting 2 s later). On a real phone the two clocks agree, but the app shouldn't hang its feedback on an animation anyway. Fix: there is now one toast slot, and a new toast takes it at once; the old message and its Undo are gone the same moment. Only when nothing replaces it does a toast fade out. "Saved" now shows the instant you save, however quickly saves follow each other.
- **2. A blank screen for 25 s after reopening the app offline with an expired sign-in** (the full offline session, OFF-6). The app waited for the sign-in library to say who is signed in, and with an expired sign-in and no connection that library keeps retrying for up to 30 s before it answers. Fix: when the phone knows who was signed in, the app opens straight away offline (after at most 2 s online), as that person, with the sign-in refresh left to do when the connection is back. A definite "no" from the server (signed out elsewhere) still signs out, as before.
- **Tested:** each fix has unit tests that fail on the old code: the toast (a new toast shows at once, also while the last one is still leaving; Undo always belongs to the newest save; a leaving toast can't be tapped) and the session (offline it opens at once, checked also with the real sign-in library and no connection; online it waits only briefly; a late "no" still signs out; with nobody known it waits as before). The toast fix was also checked in a real browser on the suite's fixed clock: before the fix the second "Saved" never became tappable; after it, it showed in 11 ms. `npm run verify`, production build, demo browser tests green.
- **Not checked here:** the two-user suite itself (needs Docker; CI only). After the offline reopen the scenario goes on to reconnect and sync; that part is unchanged, but it hadn't been reached before.
- **Next:** push and let the two-user job run.

## 2026-11-17: remaining screens-review fixes done
- **Focus** comes back to whatever opened a sheet when it closes (Escape, Close, back, Save), or to the Quick add box when the opener has gone (the quick-add reading). The "Same as last time" menu now closes with back, like a sheet, and focus goes back to Add expense.
- **320×640:** Add expense steps aside while Quick add has focus, so it never sits over what you type; on Home the "Saved" toast sits above the button instead of over it.
- **Category chips** keep their size as the guess moves while a description is typed (the emoji sits where the tick appears; the suggestion dot has a fixed place). "Other" shows its colour dot, then a tick when chosen, never both.
- **Settle up:** typing more than is owed shows a quiet line ("That’s more than the £20.00 Sam owes Jae.") and still lets it be recorded; "Did it go through?" says what Yes will do ("Once Sam’s £20.00 to Jae has gone through in Monzo, tap Yes to record it.").
- **Words in one place (TXT-7):** the data layer returns codes; the screens word them; a test keeps it so.
- **Tested:** each with a failing test first (demo e2e: focus, back on the menu, button vs Quick add and toast at 320×640, chip sizes; component: the over-owed line is not a block; unit: data layer words nothing). Also fixed an occasional failure in the screens review tests (a closing sheet's history step landing in the next test). `npm run verify`, production build, all browser tests green. Screenshots before/after in `/tmp/claude-0/s2-fix-shots/`.
- **Next:** the two-user CI run; then PR to main.

## 2026-11-17: two-user suite, second run diagnosed and fixed
- **What happened** (CI run 44044915859, job 133908271892, commit 5d78d88): sign-in now works, and all 21 scenarios ran to the end (nothing stopped the run early): **16 passed, 2 passed only on the retry, 3 failed**. Three separate causes.
- **1. A test helper asked the database a wrong question** (2 failures: the entry page ADD-7/ACT-2/ACT-3, and settle-ups SET-3). The helper that reads the history log sorted by a column it hadn't fetched, so the database refused the query. Plainly a test bug, not the app: fixed by fetching that column (the order, oldest first, is what the tests always meant). No check was loosened.
- **2. Undo could undo the wrong thing** (1 failure: the offline session, OFF-1…). A real app bug. Right after an edit, a quick add replaced the edit's "Saved" toast, but for a moment the old toast was still on screen on its way out, with its Undo button live. Tapping Undo then undid the edit, not the new entry, so the offline balance read £45.00 instead of £44.20. A person tapping quickly could hit this too. Fix: a toast on its way out can't be tapped and isn't read out; Undo always belongs to the latest save. New unit test, which fails on the old code.
- **3. The first phone sometimes missed the partner joining** (the 2 retried scenarios, both the very first to start). Live updates (Realtime) can take a few seconds to start listening on a fresh server; the partner joined in that gap, and the first phone kept saying "Waiting for your partner" until its next refresh. Fix: the app now asks the server to confirm it is really listening before counting as connected, and fetches everything once when it starts listening, as it already did after a dropped connection. New unit test, which fails on the old code.
- Checked locally: unit tests, SQL checks, trace, production build, demo e2e. The two-user suite itself needs Docker, so only CI can run it.
- **Next:** push and let the two-user job run to the end. The two failed scenarios that stopped at the helper never reached their later steps, so new failures there are possible.

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
- 2026-11-17: owner created the smsm Gmail account (address deliberately not written here: the repo is public; it goes only into the SUPABASE_SMTP_USER secret). Next owner steps: 2-Step Verification → app password → two GitHub secrets.

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
