# smsm: deploy

GitHub (`jyp107991/smsm`) → GitHub Actions runs the checks → Supabase (database, sign-in, functions) and Cloudflare Workers (the app). The owner does the one-time setup in §1–3; after that every merge to `main` deploys itself. Claude Code writes the workflow files in S0 and should replace this outline with exact, phone-friendly steps once they are proven.

## 1. Supabase (a new project, separate from MacroPy's)
1. supabase.com → New project `smsm`, region West Europe (London). Leave GitHub blank. Generate the database password and save it. Under Security: **Enable Data API** on; **Automatically expose new tables** off (the schema grants exactly what the app needs); **Enable automatic RLS** on (a second safety net; the schema turns it on for every table anyway).
2. Authentication → Sign In / Providers: Email enabled; **Confirm email off**; Allow new users to sign up **on until both people have joined, then off**.
3. **Custom SMTP (required).** Supabase's built-in email only reaches the organisation's members and, since 2026, its templates can't be edited without custom SMTP; the default Magic Link email contains only a link, and smsm needs the 6-digit code. Use Gmail with an app password (free, no domain needed):
   - Google Account → Security → turn on 2-Step Verification if it isn't → App passwords → create one named `smsm` → copy the 16-character password.
   - Supabase → Authentication → Emails → Set up SMTP: host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the app password, sender email = the same Gmail address, sender name `smsm`. Save.
   - Then Authentication → Emails → Magic link or OTP → Source: subject `Your smsm code`, body `<h2>Your smsm code</h2><p>{{ .Token }}</p>`. Save.
   - Test: sign-in codes should arrive for both email addresses.
4. Database → Extensions: enable `pg_cron` and `pg_net`.
5. Account → Access Tokens: create one for the pipeline.
6. Note the project ref, the project URL and the **publishable key** (Settings → API Keys; it starts `sb_publishable_`). Supabase is retiring the older `anon` and `service_role` keys at the end of 2026, so smsm uses the publishable key in the app and a secret key (`sb_secret_`) only inside Edge Functions.

**Staying on the free plan.** Supabase's free plan (checked November 2026: 500 MB database, 1 GB file storage, 5 GB transfer a month, two active projects) is far more than two people need: years of entries take a few tens of megabytes. Two things are handled by the pipeline so the plan never gets in the way:
- **Pausing.** Free projects pause after 7 days without activity. A scheduled GitHub Actions job (`keepalive.yml`) makes a small authenticated request every 2 days, so the project never goes quiet, even if you're both away. If it ever does pause, the phones keep working offline and sync once it is un-paused from the dashboard.
- **No built-in backups on free.** A nightly GitHub Actions job exports the household's data and keeps the last 30 copies as encrypted files in the private repo's Actions artifacts (or a private `smsm-backups` repo), outside Supabase. Restoring is a documented script.
Receipt photos are compressed to about 200 KB each, so 1 GB holds roughly 5,000; the Settings screen shows storage used, and a warning appears at 80%.

The schema, migrations, storage buckets, scheduled jobs and functions are applied by the pipeline, not by hand.

## 2. Cloudflare
1. Create an API token with permission to edit Workers for the account; note the account id.
2. Nothing else: the pipeline creates and deploys the Worker (`wrangler.jsonc`: static assets from `dist/`, single-page fallback; `public/_headers`: no-cache for `sw.js` and `index.html`, security headers, as in MacroPy). The address is `https://smsm.<account>.workers.dev`.

(If the owner prefers MacroPy's arrangement, Cloudflare building directly from the repo, use build command `npm ci && npm run verify && npm run build` so a failing check still blocks the deploy; migrations and functions then deploy from GitHub Actions alone.)

## 3. GitHub repository secrets and variables
Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`.
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
