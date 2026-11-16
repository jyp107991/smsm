# smsm: deploy

GitHub (`jyp107991/smsm`) → GitHub Actions runs the checks → Supabase (database, sign-in, functions) and Cloudflare Workers (the app). The owner does the one-time setup in §1–3; after that every merge to `main` deploys itself. Claude Code writes the workflow files in S0 and should replace this outline with exact, phone-friendly steps once they are proven.

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

## 2. Cloudflare
1. **API token:** `dash.cloudflare.com/profile/api-tokens` → Create Token → template **Edit Cloudflare Workers** → Use template → Account Resources: your account → Continue to summary → Create Token. Copy it (shown once).
2. **Account ID:** Workers & Pages overview, or the account's Overview page.
3. Nothing else: the pipeline creates and deploys the Worker (`wrangler.jsonc`: static assets from `dist/`, single-page fallback; `public/_headers`: no-cache for `sw.js` and `index.html`, security headers, as in MacroPy). The address is `https://smsm.<account>.workers.dev`.

(If the owner prefers MacroPy's arrangement, Cloudflare building directly from the repo, use build command `npm ci && npm run verify && npm run build` so a failing check still blocks the deploy; migrations and functions then deploy from GitHub Actions alone.)

## 3. GitHub repository secrets and variables
Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`.
Variables: `SUPABASE_PROJECT_REF`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, later `VITE_VAPID_PUBLIC_KEY`.
No secret is ever committed. The Supabase URL and publishable key are safe in the app; everything else lives only in GitHub secrets or Supabase secrets.

## 4. Phones
Open the address in Chrome → menu → Install app. Sign in, start the household, share the join code.

## 5. Gemini (S6)
1. Create an API key in Google AI Studio.
2. `supabase secrets set GEMINI_API_KEY=... GEMINI_MODEL=<current stable Flash-Lite id>` (or add them as GitHub secrets for the pipeline to set).
3. (Or add `GEMINI_API_KEY` as a GitHub secret now; the pipeline sets it in Supabase when S6 arrives.)
4. **Billing: off.** The owner has chosen the free tier (a private tool for one household). If the daily free limit ever gets in the way, turning billing on in Google AI Studio needs no code change.

## 6. Notifications (S8)
As MacroPy `docs/DEPLOY.md` §4: generate VAPID keys, `supabase secrets set`, deploy the function, schedule it.

## 7. Optional: let Claude Code see production health
Give the Claude Code environment a read-only database connection string (or a Supabase secret key) as an environment secret so it can read `client_errors` and `ai_usage` at the start of each session. Never commit it.
