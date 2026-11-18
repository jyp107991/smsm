# smsm: deploy

GitHub (`jyp107991/smsm`, public) → GitHub Actions runs the checks → Supabase (database, sign-in, functions) and Cloudflare Workers (the app). The owner did the one-time setup in §1–3; every merge to `main` now deploys itself (proven 16 Nov 2026, deploy run 1).

**Live:** app https://smsm.jaexpark94.workers.dev · demo and gallery https://smsm-demo.jaexpark94.workers.dev/gallery

**What runs where (`.github/workflows/`)**
| Workflow | When | What |
|---|---|---|
| `ci` | every push to a branch other than main | checks (types, lint, tests, trace, SQL, generated files, build, browser tests); `remote-check` proves the secrets work (project link, migration dry run, Cloudflare token status); a preview of the demo build for that branch |
| `deploy` | push to main (or by hand, main only) | the same checks → build → `supabase db push` (migrations only) → Edge Functions → the push function's one-time set-up (`?init=1`) → `wrangler deploy` of `smsm` and `smsm-demo` → smoke test of the live app (version matches the commit, service worker and manifest served, database health check answers, the push keys are there) |
| `keepalive` | every 2 days | calls `health()` so the free project never pauses |
| `auth-config` | by hand only | `mode=diff` shows exactly what a sign-in settings push would change (read-only); `mode=push` applies them, only after the owner approves |

**If something fails:** the run's log names the step. A missing or malformed secret or variable is reported by name by `scripts/check-deploy-settings.sh`; fix it under GitHub → the repo → Settings → Secrets and variables → Actions. Logs are public: tool output passes through `scripts/redact.sh`, and no step prints a secret.

**Rollback:** `npx wrangler rollback` (app) restores the previous version in seconds; migrations are expand-then-contract, so the older app still works with the newer database.

## 1. Supabase (done by hand, verified against Supabase's docs 16 Nov 2026)
The owner has created the project `smsm` (West Europe (London); Data API on; automatic table exposure off; automatic RLS on). By hand, the owner only collects:
1. **Project URL and publishable key:** the project's **Connect** dialog, or **Settings → API Keys** (publishable key starts `sb_publishable_`).
2. **Project ref:** the code after `/project/` in the dashboard's web address.
3. **Personal access token:** `supabase.com/dashboard/account/tokens` → Generate new token. Scope it to the `smsm` project with read and write on everything offered; expiry long enough to finish the build (or none). Starts `sbp_`. Shown once.

**Everything else about Supabase is configured from the repo by Claude Code**, not by clicking: `supabase/config.toml` plus the CLI with `SUPABASE_ACCESS_TOKEN` (scoped tokens work with `--token` or that variable; `supabase whoami` does not). Claude Code must:
- Read the current CLI and Auth docs before touching remote config. CLI v3 (pinned 3.2.0) pushes only what `config.toml` declares and leaves everything else unchanged; `supabase config diff` previews. (The CLI v2 behaviour, which overwrote undeclared settings with defaults such as a localhost `site_url`, no longer applies; see `DECISIONS.md`.) Declare every Auth setting the app depends on, show the owner the diff before the first push (`auth-config.yml`, mode `diff`), and record the result in `DECISIONS.md`.
- Settle how sign-in codes reach both people before building sign-in (S2), and propose it to the owner. Facts to start from: the built-in email sender only delivers to members of the Supabase organisation; on the free plan, templates (needed to put `{{ .Token }}`, the 6-digit code, in the email) can only be changed with custom SMTP; SMTP can be declared in `config.toml` with the password held as a secret. Candidates: Gmail SMTP with an app password; a transactional email service's free tier; another sign-in method. Choose the one with the fewest owner steps that delivers to both addresses, and test it end to end.
- Leave "Allow new users to sign up" on until both people have joined, then turn it off (in config).
- Manually changed dashboard settings so far (to be captured in config): Confirm email may have been left on; the Magic Link template could not be edited. Treat config as the source of truth.

**Staying on the free plan.** Supabase's free plan (checked November 2026: 500 MB database, 1 GB file storage, 5 GB transfer a month, two active projects) is far more than two people need: years of entries take a few tens of megabytes. Two things are handled by the pipeline so the plan never gets in the way:
- **Pausing.** Free projects pause after 7 days without activity. A scheduled GitHub Actions job (`keepalive.yml`) makes a small authenticated request every 2 days, so the project never goes quiet, even if you're both away. If it ever does pause, the phones keep working offline and sync once it is un-paused from the dashboard.
- **No built-in backups on free.** A nightly GitHub Actions job exports the household's data and keeps the last 30 copies as encrypted files in the private repo's Actions artifacts (or a private `smsm-backups` repo), outside Supabase. Restoring is a documented script.
Receipt photos are compressed to about 200 KB each, so 1 GB holds roughly 5,000; the Settings screen shows storage used, and a warning appears at 80%.

The schema, migrations, storage buckets, scheduled jobs and functions are applied by the pipeline, not by hand.

## 1b. Nightly backups (EXP-2)
`.github/workflows/backup.yml` exports the household's data every night (02:23 UTC), encrypts it (AES-256) and keeps it 30 days as a downloadable file in the repo's Actions. The repo is public, so the file is encrypted before it is stored. The key is the **database password** (the `SUPABASE_DB_PASSWORD` secret, set when the project was made): no extra secret is needed, and whoever has that password can read the live data anyway. Keep the database password in a password manager; if it is ever reset, backups made before the reset still open with the old one. (An optional `BACKUP_PASSPHRASE` secret, if added, is used instead.) Restore: `BACKUP_PASSPHRASE=<the database password> scripts/restore-backup.sh <file> <database URL>` (tested in CI by `tests/unit/backup-restore.test.ts`).

## 2. Cloudflare
1. **API token:** `dash.cloudflare.com/profile/api-tokens` → Create Token → template **Edit Cloudflare Workers** → Use template → Account Resources: your account → Continue to summary → Create Token. Copy it (shown once).
2. **Account ID:** Workers & Pages overview, or the account's Overview page.
3. Nothing else: the pipeline creates and deploys the Worker (`wrangler.jsonc`: static assets from `dist/`, single-page fallback; `public/_headers`: no-cache for `sw.js` and `index.html`, security headers, as in MacroPy). The address is `https://smsm.<account>.workers.dev`.

(If the owner prefers MacroPy's arrangement, Cloudflare building directly from the repo, use build command `npm ci && npm run verify && npm run build` so a failing check still blocks the deploy; migrations and functions then deploy from GitHub Actions alone.)

## 3. GitHub repository secrets and variables
Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`.
Variables: `SUPABASE_PROJECT_REF`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. (Notifications need none: S8 keeps its keys in the database, §6.)
No secret is ever committed. The Supabase URL and publishable key are safe in the app; everything else lives only in GitHub secrets or Supabase secrets.

## 4. Phones
Open the address in Chrome → menu → Install app. Sign in, start the household, share the join code.

## 5. Smart features (S6)
Nothing to set up: they run on Cloudflare Workers AI through the app's own Worker (the `AI` binding in `wrangler.jsonc`), on the free daily allowance of the Cloudflare account the app is deployed to. No API key, no secret. The deploy passes the Supabase URL and the public publishable key to the Worker as vars (from the repository's existing variables). If a deploy ever reports that the Cloudflare token can't use Workers AI, add "Workers AI: Read" to that token's permissions in the Cloudflare dashboard.

## 6. Notifications (S8)
Nothing to set up, no new secret (owner, 17 Nov). The pipeline does it all:
- The migration makes `push_config` with a random token the database makes for itself, the outbox, the triggers, and two pg_cron jobs (`smsm-push` every minute, `smsm-notify-daily` at 07:07 and 08:07 UTC, which does its work only at 08:07 London time). It enables pg_net.
- `supabase functions deploy` deploys `supabase/functions/push` with JWT verification off (`supabase/config.toml` `[functions.push]`): the database calls it with its token, which the function checks.
- The deploy then calls the function once with `?init=1` (step "Set up notifications"): the first time, it makes the VAPID key pair (Web Crypto, P-256) and records its own address in `push_config`; afterwards it changes nothing. It reads `push_config` with the secret key Supabase gives every function.
- The smoke test checks `health()` says `"push": true` (the public key is there, so phones' `push_public_key()` answers).
If the keys ever had to be replaced (they never need to be), clear `vapid_public` and `vapid_private` in `push_config` and run the deploy again: phones re-subscribe with the new key the next time the app opens.

## 7. Optional: let Claude Code see production health
Give the Claude Code environment a read-only database connection string (or a Supabase secret key) as an environment secret so it can read `client_errors` and `ai_usage` at the start of each session. Never commit it.
