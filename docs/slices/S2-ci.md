# S2: the two-user suite in CI (proposal)

Written by the S2 tests-first writer. The workflow itself is not edited here; the builder adds the job below to `.github/workflows/ci.yml` (and so to the deploy gate, which calls `ci.yml`).

## What the suite needs
- The **Supabase local stack** (CLI 3.2.0, pinned in `package.json`), started from this repo's `supabase/` folder. `supabase start` applies every file in `supabase/migrations/` to a fresh database on first start, so the tests run against exactly the migrations that will be pushed.
- The **mail catcher**: CLI 3.2.0 runs **Mailpit** (`axllent/mailpit:v1.31.3`, the `[local_smtp]` section of `config.toml`, web/API port 54324 by default; our `config.toml` declares no `[local_smtp]`, so the default, enabled, applies). `supabase status -o env` prints its address as `MAILPIT_URL` (`INBUCKET_URL` is accepted as an old alias). The suite reads sign-in codes from Mailpit's HTTP API (`tests/e2e/two-users/mail.ts`):
  - `GET  $MAILPIT_URL/api/v1/search?query=to:"<address>"` → `{ messages: [{ ID, To, Subject, Created }] }`, newest first
  - `GET  $MAILPIT_URL/api/v1/message/<ID>` → `{ Text, HTML, … }`; the 6-digit code is taken from `supabase/templates/code.html` (the code alone in a large paragraph) or from "…enter the code: 123456"
  - `DELETE $MAILPIT_URL/api/v1/search?query=…` after each test
  (Checked against Mailpit's own `swagger.json` at v1.31.3 and the CLI binary's `status` output names.)
- `psql` (preinstalled on `ubuntu-latest`) for `member_net` and `auth.users` lookups; the service key for row fetches through REST.
- A **production build** of the app pointed at the local stack (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`), served by `vite preview` on port 4174. This build must never be uploaded or deployed; it lives only inside this job.
- Playwright's Chromium. Every phone is a persistent Chromium profile (so "restart the browser" keeps IndexedDB, Cache Storage and the service worker).

## Rate limits
`config.toml` sets `[auth.rate_limit] sign_in_sign_ups = 30` and `token_verifications = 30` (per 5 minutes per IP). The suite signs in about 30 people from one IP (2 per scenario, plus a third person, plus retries). The job raises these **in the CI workspace only**, before `supabase start`; the committed file and the live project are untouched. (`email_sent` applies only with custom SMTP, which the local stack doesn't use.) Every person has a unique address per run, so `max_frequency = "60s"` never bites.

## The sign-in email
The local auth server (GoTrue 2.198 in CLI 3.2.0) sends, by default, a sign-in email that holds **only a link, no code** ("Your sign-in link … Sign in"); its old "Alternatively, enter the code" line is gone. The app signs in with the 6-digit code only, so with the defaults no scenario could get past sign-in (CI run 44032201912: 20 of 21 scenarios failed with "No sign-in code reached … within 30000 ms" although `/auth/v1/otp` answered 200). The job therefore turns on, **in the CI workspace only**, the app's own code email for both new and returning sign-ins (`[auth.email.template.magic_link]` and `[auth.email.template.confirmation]` with `content_path = "./supabase/templates/code.html"`, the block `config.toml` already proposes for the live project). CLI 3.2.0 reads a template's `content_path` from the project root and serves it to the local auth server through the gateway; no SMTP is needed locally. The committed `config.toml` and the live project are untouched: the live project gets this template only through the owner-approved auth push.

## The job
```yaml
  two-users:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Local sign-in settings for the suite (CI workspace only, never committed)
        run: |
          sed -i -E 's/^(sign_in_sign_ups|token_verifications) = .*/\1 = 1000/' supabase/config.toml
          # The local auth server's own sign-in email (GoTrue 2.198) holds only a link, no code, so the suite
          # could never read one (CI run 44032201912). Send the app's code email instead: the template that
          # config.toml proposes for the live project, still commented there until the owner approves it.
          cat >> supabase/config.toml <<'EOF'

          [auth.email.template.magic_link]
          subject = "Your smsm code"
          content_path = "./supabase/templates/code.html"

          [auth.email.template.confirmation]
          subject = "Your smsm code"
          content_path = "./supabase/templates/code.html"
          EOF
          git diff --stat supabase/config.toml
      - name: Supabase local stack (applies supabase/migrations)
        run: npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta
      - name: Stack addresses and keys for the tests and the app build
        run: |
          # `status -o env` prints NAME="value"; GITHUB_ENV wants NAME=value. The local stack's keys are its
          # fixed development keys, but are masked anyway because logs are public.
          npx supabase status -o env | sed -E 's/^([A-Z_]+)="(.*)"$/\1=\2/' > stack.env
          while IFS='=' read -r name value; do
            case "$name" in *KEY*|*SECRET*) echo "::add-mask::$value";; esac
            echo "$name=$value" >> "$GITHUB_ENV"
          done < stack.env
          rm stack.env
      - name: App build points at the local stack
        run: |
          echo "VITE_SUPABASE_URL=$API_URL" >> "$GITHUB_ENV"
          echo "VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY" >> "$GITHUB_ENV"
      - name: Install Playwright's Chromium
        run: npx playwright install --with-deps chromium
      - name: Two-user end-to-end (two phones, fixed clock, real database)
        run: npx playwright test -c tests/e2e/two-users/playwright.config.ts
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report-two-users
          path: |
            playwright-report/two-users
            test-results/two-users
          retention-days: 7
      - name: Stop the stack
        if: always()
        run: npx supabase stop --no-backup
```
Variables the suite reads (`tests/e2e/two-users/env.ts`): `API_URL`, `SECRET_KEY` (or `SERVICE_ROLE_KEY`), `PUBLISHABLE_KEY` (or `ANON_KEY`), `DB_URL`, `MAILPIT_URL`; optionally `TWO_USERS_PORT` / `TWO_USERS_APP_URL`. The `-x` names come from `npx supabase start --help` for 3.2.0. The main e2e config now ignores `tests/e2e/two-users/**`, so `npm run test:e2e` (demo build) is unchanged.

Locally: `npx supabase start`, export the same variables (`set -a; eval "$(npx supabase status -o env)"; set +a`, then `VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY`), then the same `npx playwright test -c …` command.

## Names the tests rely on beyond the brief
The brief's "Interfaces" are used as written. These are the extra choices the tests make; change them only together with the tests.
- **Sign-in:** a wrong code shows `role=alert` in plain words (no error codes). Offline, "Send code" answers with an alert or status mentioning the connection (OFF-4).
- **Setup:** the "Join code" field submits on **Enter** (a form). A wrong code: alert "No household has that code". A full household: alert containing "already has two people". The taken animal's radio is disabled and the radiogroup contains "Jae is the cat". A name over 24 characters or blank can't be saved (maxlength or refusal) and nothing is locked.
- **Waiting for the partner (BAL-6):** the banner says "Waiting for your partner…" (the partner's name isn't known yet; SPEC wording). An entry added before the partner joins is a normal shared entry once they join (household default 50/50: "Sam owes Jae £21.25").
- **Home:** the offline mark is **inside** region "Balance" (BAL-5: "marked offline"). "Saved" and the sync count are `role=status`; Undo is a button inside the "Saved" status and disappears after about 5 s. Quick add clears after saving. Live reading wording: `£42.50 · Tesco · Groceries · Jae paid · 50/50` — the description as typed, then category, "<name> paid", the split as `50/50`, `60/40`, `70/30`.
- **Add/edit sheet:** "Who paid" radios are named by the people's names; the split radio for the other person is "For <their name>"; Exact uses textboxes "Jae's share" / "Sam's share", shows the remainder live (e.g. "£5.00"), and an unbalanced Save shows `role=alert` inside the dialog and saves nothing. Category chips are buttons with `aria-pressed`. Notes appear after "More".
- **Long-press "Add expense":** offers "Same as last time" (menuitem or button), which opens dialog "Add expense" prefilled with the last entry.
- **Entry page:** "Duplicate" saves at once (today's date, same amount, split and category) and shows "Saved". "Delete" soft-deletes at once with Undo in a status; History lines read "<name> changed £42.50 to £45.20…", "<name> deleted…", "<name> restored…". "Refund this" opens dialog "Money back" with textbox "Amount".
- **Settle-ups:** tapping a settle-up row in Activity opens `/entry/<settlement id>` with heading "Sam paid Jae £20.00" and buttons "Edit" (opens dialog "Settle up"; saves with "Save" or "Record it") and "Delete". The Settle up Amount is prefilled as `21.25` (a leading £ is tolerated). "Pay with Monzo" opens `https://monzo.me/<name>/21.25?d=smsm` (two decimals; `10` or `10.00` accepted for whole pounds) and "Did it go through?" appears when the person comes back (visibilitychange/focus, or at once). At zero, "Settle up" is hidden.
- **Settings:** "monzo.me name" saves on Enter (or blur). "Request a change" opens dialog "Request a change" with textbox "Your name", radiogroup "Your animal" and button "Send request". The requester sees "Waiting for <partner>" and a button "Cancel request". The partner sees "<name> asked to change their name to <new>" (any "<name> asked to…" for an animal swap) on Home and in Settings, with "Approve" and "Decline". The join code is shown as text exactly as stored (6 characters) until the household is full.
- **Activity:** rows show the description as its own text; day headings are `role=heading` worded by `core/dates.formatDay` ("Today", "Yesterday", "Sun 15 Nov"); filter buttons open options picked by name (Who paid → "Sam", Category → "Groceries", Type → an option matching /settle/i); filters reset when Activity is opened again.
- **Plank:** exactly one `[data-tilt]` inside region "Balance"; the `role=img` label from `strings.rig.plank` ("The plank tilts: the cat sits higher than the dog").
- **Session storage:** supabase-js keeps its session in `localStorage` under its default key `sb-<ref>-auth-token` (the tests expire it locally to simulate a long time offline).
- **OFF-1:** the app calls `navigator.storage.persist()` on open.

## Data-layer contracts (unit tests in `src/data/`)
Pinned as TypeScript interfaces at the top of each test file; the implementation's types must be assignable to them.
- `src/data/store.ts`: `createStore({ client, storage, network, appVersion, today, onStale? })` → `Store` with `ready`, `idle()`, `refresh()`, `dispose()`, `me()`, `householdId()`, `entries()`, `settlements()`, `balance()`, `pendingCount()`, `refused()`, `addExpense()` (returns the phone-made id synchronously), `editExpense()`, `deleteExpense()`, `restoreExpense()`, `addSettlement()`. `storage` is idb-keyval-shaped (`getItem/setItem/removeItem`, async); `network` is `{ online, subscribe }`. The hooks named in the brief (`useEntries()`, …) wrap this.
- `src/data/session.ts`: `createSessionKeeper({ client, storage, network })` → `{ ready, state(), subscribe(), dispose() }`, state `{ status: 'signed-in', userId, refreshPending } | { status: 'signed-out' }`.
- `src/data/version.ts`: `compareVersions`, `isStale`, `checkClientVersion(client, appVersion)` → `'current' | 'stale' | 'unknown'`.
- The fake (`tests/fixtures/fake-supabase.ts`) answers like supabase-js 2.119 and throws "fake supabase: … not supported" for anything it doesn't model (`or()`, `not()`, `filter()`, offset ranges, other RPCs), so a gap is a clear failure rather than a silent pass.

## Ambiguities resolved
- **Rollback vs "kept to fix" (DATA_MODEL §6 vs OFF-5):** a refused change leaves the phone's copy and the balance (rolled back) and is kept in `refused()` with a plain message and the original input, across restarts; the rest of the queue still goes through.
- **A lost answer is not a refusal:** a network failure (status 0) keeps the change queued and resends it with the same id; one row results.
- **Stale app offline:** the version check needs the server; offline it is "unknown" and never blocks saving on the phone; nothing is sent until the check passes.
- **Pending count** counts changes made (an add and its edit are two).
- **Undo of a save** may soft-delete or never send, but never hard-deletes.
- **Money back's receiver** isn't fixed by the spec; the tests accept either person and check the balance moves the opposite way to an expense accordingly.
- **Fixed clock:** every phone starts at 22:00 on Sat 14 Nov 2026 in London (07:00 Sun 15 Nov in Tokyo) and runs on from there (`clock.install`), so timers, Undo and Realtime behave normally while "today" is fixed; a restart carries the clock on. Server timestamps (History) stay real, so History is checked for its words, not its time.
- **Dates filter** in Activity is checked for presence only in the end-to-end suite; its ranges are core-tested (`src/core/filters.test.ts`).
- **Default split approval (PPL-5)** is covered at the database level end to end (a direct change is refused); its Settings screen has no names in the brief yet.
