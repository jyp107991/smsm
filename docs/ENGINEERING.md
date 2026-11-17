# smsm: how it is built

The aim is to reach a version the owner and partner use every day quickly, and never to ship a version that gets the money wrong or needs redoing. Speed comes from order (thin working slices, real use early), from choosing well-trodden tools, and from finding mistakes within minutes of making them. It does not come from skipping checks.

## 1. Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| App | React + TypeScript (strict, `noUncheckedIndexedAccess`) + Vite | The most widely used and best documented combination; fewest surprises when code is written by an AI agent. Size is irrelevant once installed. |
| Styling | Tailwind with the design tokens as CSS variables (OKLCH, `light-dark()`) | Consistency by construction: components can only use tokens. |
| Behaviour primitives | Accessible headless components (Radix or Base UI) for dialog, popover, tabs, toggle group; `vaul` for bottom sheets; Motion for springs and gestures; View Transitions API for navigation | Focus handling, keyboard and screen-reader behaviour are the commonest UI bugs; don't hand-roll them. |
| Data on the phone | TanStack Query with a persisted cache (IndexedDB) and its offline mutation queue | Replaces a hand-built sync engine, the classic source of slow, buggy builds (`DATA_MODEL` §6). |
| Validation | zod at every boundary: server responses, AI replies, CSV rows, share-target input, stored cache | Wrong shapes are caught where they enter. |
| Backend | Supabase: Postgres with row-level security, Auth (email code), Realtime, Storage, Edge Functions, pg_cron | Same as MacroPy. |
| Types | Generated from the database (`supabase gen types`) and never written by hand | One source of truth for shapes. |
| PWA | `vite-plugin-pwa` (Workbox), prompt-to-update, manifest shortcuts and share target | |
| Charts | Hand-written SVG with `d3-scale` and `d3-shape` only | Small, and fully styled by the tokens. |
| Tests | Vitest, fast-check (property tests), Stryker (mutation tests on the money core), Playwright (end-to-end, visual snapshots), axe-core | |
| Hosting | Cloudflare Workers static assets, deployed by GitHub Actions after tests pass | A broken commit can never reach the phones. |
| AI | Cloudflare Workers AI through the app's own Worker, `POST /api/ai` (`docs/AI.md`) | |

Use the current stable version of each and pin it in the lockfile. **Library APIs change faster than an AI model's memory of them: before first use of any library or service API (Supabase, Gemini, Tailwind, TanStack Query, Workbox, wrangler), read the installed version's documentation or types, and record anything surprising in `docs/DECISIONS.md`.**

## 2. The spec is executable
- Every acceptance criterion in `docs/SPEC.md` has an id (`ADD-3`). Every id has at least one automated test with the id in its name, or a line in `docs/OPEN_ITEMS.md` saying why it is deferred.
- `npm run trace` lists ids without tests and fails CI if any are neither tested nor deferred. It also fails on a test that names an id that doesn't exist.
- Golden examples live as data, not prose: `tests/vectors/quickadd.json` (at least 80 phrases with expected readings), `split.json`, `recurring.json`, `balance.json`. The spec's worked examples are in them.

## 3. Structure: a pure core and a thin shell
```
src/core/      pure TypeScript, no React, no network, no clock: money, split, balance, dates, recurring,
               quickadd, categorise, analytics, recap, insights, itemise, fx, filters, csv
src/data/      Supabase client, queries, mutations, cache persistence, realtime (the only place that does I/O)
src/ui/        tokens, primitives, the avatar rig, charts
src/screens/   one folder per screen; screens call data hooks and core functions, and contain no money maths
supabase/      schema.sql, migrations/, functions/
content/       merchants.json (seed categories)
tests/         vectors/, sql/, e2e/, ai/
```
Rules: `src/core` imports nothing from the other folders and takes "today" as an argument. Screens never compute money. A lint rule enforces both.

## 4. Tests, in the order they catch things
1. **Types and lint** (seconds): strict TypeScript; no `any`, no `@ts-ignore`, no non-null `!` on data; the money lint rule; import boundaries.
2. **Core unit and property tests** (seconds): vectors plus properties: shares and paid always sum to the amount and are never negative; nets always sum to zero; swapping the two people negates the balance; adding then soft-deleting an entry leaves the balance unchanged; recurring dates from TypeScript equal the SQL function's for 500 random templates; quick-add never throws on arbitrary text.
3. **Mutation tests on `src/core/{money,split,balance,recurring}`**: Stryker score at least 85%. This checks the tests themselves: an AI-written test that can't fail is worth nothing.
4. **Database tests** (`npm run test:sql`): `scripts/test-sql.sh` against PostgreSQL 16 with the auth stub, as three different users. In CI the same checks also run against the real Supabase local stack.
5. **End-to-end, two users** (Playwright, two browser contexts, against the Supabase local stack in CI; fixed clock; seeded data): setup and join; identity lock and approval; add, edit, delete, undo; settle; recurring posted by both at once; offline entries on one phone converging on both; a full offline session (open with no network, add, edit, settle, restart the browser, reconnect); typing Korean with composition events; realtime. After every scenario: the balance on screen equals `core/balance` equals `member_net`.
6. **Visual snapshots** of the key screens at 390×800 in both themes, plus overflow checks at 320×568 and with the keyboard open. A snapshot change must be intended and mentioned in the commit.
7. **Accessibility**: axe on every screen in both themes; the token contrast test.
8. **AI contract tests** in CI and the live eval by hand (`docs/AI.md` §5).

`npm run verify` runs 1, 2 and 4 in under a minute and is run before every commit. CI runs everything.

## 5. How each slice is built (the protocol)
For every slice in `docs/BUILD_PLAN.md`:
1. **Brief.** Write `docs/slices/S<n>.md`: the criteria ids in scope, what is out, the screens touched, the data touched, the risks, and the test list. Commit it. If anything in the spec is unclear or contradictory, resolve it here: choose, record in `DECISIONS.md`, move on; ask the owner only if it changes a decision in the owner's table.
2. **Tests first, by someone else.** A subagent that is given the spec and the brief, and not the implementation, writes the failing tests for the slice's criteria. Tests written by the author of the code tend to repeat the code's mistakes.
3. **Build** on a short-lived branch, core first, then data, then screens. Small commits.
4. **Look at it.** Run the app in demo mode at 390×800, take screenshots of every touched screen in both themes, and compare them with `DESIGN.md` point by point. Fix what a person would notice.
5. **Fresh review.** A subagent with no memory of the build gets the diff, the brief and the spec, and is asked to find bugs, criteria not met, and anything in the diff that the brief did not ask for. Fix or justify each finding in the PR.
6. **Merge when CI is green.** The pipeline deploys. Smoke-check the live URL.
7. **Log.** Update `BUILD_LOG.md` (built, tested, failed, next), tick `OPEN_ITEMS.md`, record decisions.

Independent slices or modules (for example the pure core modules in S1, or the avatar rig alongside the pipeline in S0) may be built by parallel subagents on separate branches.

**Bugs** found later, by tests or by the owner: first write a failing test that reproduces it, then fix, then keep the test.

## 6. Rules that prevent the usual AI-build failures
- **Never make a failing test pass by weakening it.** Skipping, deleting or loosening a test needs a line in `DECISIONS.md` saying why the test was wrong.
- **No stubs presented as done.** A slice is done only when its criteria pass against the real database, with no mock data on any path the person can reach. Unfinished work sits behind a flag that is off.
- **No scope drift.** Nothing is added that the spec doesn't ask for; nothing in the spec is quietly dropped. Ideas go in `OPEN_ITEMS.md` under "Ideas".
- **No silent dependency.** Each new package is named in the slice brief with the reason; prefer none.
- **One way to do each thing.** One date module, one money module, one fetch layer, one sheet component. Before writing a helper, look for the existing one.
- **Database changes are expand-then-contract.** A migration must leave the currently deployed app working (add before use; remove only after no deployed app reads it). Applied migrations are never edited.
- **Main is always releasable.** Feature flags (build-time for unfinished screens, household-level for smart features) keep partial work out of sight.
- **Read errors from real use.** The app reports uncaught errors and failed writes to `client_errors` with version and route. Check the table at the start of every working session and treat any row as a bug to reproduce.

## 7. Pipeline
- **Pull request:** typecheck, lint, unit, property, trace, SQL, build, end-to-end, snapshots, axe. A preview of the built app in demo mode (seeded data, no backend) is uploaded as a Cloudflare preview URL so the owner can look at interface changes on a phone before they merge.
- **Main:** the same checks; then database migrations (`supabase db push`), Edge Functions, build, `wrangler deploy`; then a smoke test of the live URL (app shell loads, version matches the commit, service worker registers, the health RPC answers). Any failure stops the line; nothing half-deploys because migrations are backward-compatible (§6).
- **Rollback:** `wrangler rollback` restores the previous app in seconds; because of expand-then-contract it still works with the newer database.
- **Backups:** nightly JSON export to encrypted GitHub Actions artifacts, 30 kept (EXP-2); before any migration that rewrites data, the deploy job triggers an extra one. A restore drill runs in CI monthly against a scratch database.
- **Keep-alive:** a scheduled workflow touches the project every 2 days so the free plan never pauses it (DEPLOY §1).
- **Demo mode** (`?demo` or the preview build): the whole app running on an in-memory copy of a seeded, realistic 18-month household (`tests/fixtures/household.ts`). Used by previews, snapshots, the design gallery and the owner's review. It shares all code above `src/data`.

## 8. Definition of done (every slice)
- [ ] Every criterion in the brief has a passing test named with its id; `npm run trace` is clean.
- [ ] `npm run verify` and CI are green; mutation score held where the core changed.
- [ ] Works at 390×800 and 320 wide, both themes, offline as SPEC §11.1; composing keyboards (Hangul) behave; keyboard and back gesture behave.
- [ ] Screens compared with `DESIGN.md`; snapshots updated intentionally.
- [ ] Fresh-review findings fixed or answered.
- [ ] No new `any`, skipped tests, mock data on live paths, or unexplained dependencies.
- [ ] Deployed; smoke test passed; `client_errors` empty for the new version after trying it.
- [ ] `BUILD_LOG.md`, `OPEN_ITEMS.md`, `DECISIONS.md` updated.

## 9. Release QA (before v1.0)
- The whole end-to-end suite and the live AI eval.
- On two real phones: install, the daily loop for a day, airplane-mode entries, a settle-up through Monzo, a notification tapped, an update applied.
- An acceptance pass by a fresh subagent given only the deployed app in demo mode, `SPEC.md` and `DESIGN.md`: do the daily loop as each person, find anything confusing, ugly, slow or wrong, and try to make the balance wrong.
- A data-safety pass: export, wipe a test household, restore from the backup, compare.
