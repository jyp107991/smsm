# smsm: deploy

GitHub (`jyp107991/smsm`) → GitHub Actions runs the checks → Supabase (database, sign-in, functions) and Cloudflare Workers (the app). The owner does the one-time setup in §1–3; after that every merge to `main` deploys itself. Claude Code writes the workflow files in S0 and should replace this outline with exact, phone-friendly steps once they are proven.

## 1. Supabase (a new project, separate from MacroPy's)
1. supabase.com → New project `smsm`, region London. Save the database password.
2. Auth → Providers → Email: on; "Confirm email" off. Auth → Email Templates → Magic Link: the body must contain `{{ .Token }}` (sign-in is by 6-digit code).
3. **Email delivery to the partner.** Supabase's built-in email only reaches members of the Supabase organisation. Either invite the partner's email to the organisation, or set custom SMTP (Auth → SMTP; for example Resend's free tier). Without one of these the partner never receives a code.
4. Database → Extensions: enable `pg_cron` and `pg_net`.
5. Account → Access Tokens: create one for the pipeline.
6. Note the project ref, the project URL and the anon key (Project Settings → API).

The schema, migrations, storage buckets, scheduled jobs and functions are applied by the pipeline, not by hand.

## 2. Cloudflare
1. Create an API token with permission to edit Workers for the account; note the account id.
2. Nothing else: the pipeline creates and deploys the Worker (`wrangler.jsonc`: static assets from `dist/`, single-page fallback; `public/_headers`: no-cache for `sw.js` and `index.html`, security headers, as in MacroPy). The address is `https://smsm.<account>.workers.dev`.

(If the owner prefers MacroPy's arrangement, Cloudflare building directly from the repo, use build command `npm ci && npm run verify && npm run build` so a failing check still blocks the deploy; migrations and functions then deploy from GitHub Actions alone.)

## 3. GitHub repository secrets and variables
Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`.
Variables: `SUPABASE_PROJECT_REF`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, later `VITE_VAPID_PUBLIC_KEY`.
No secret is ever committed. The Supabase URL and anon key are safe in the app; everything else lives only in GitHub secrets or Supabase secrets.

## 4. Phones
Open the address in Chrome → menu → Install app. Sign in, start the household, share the join code.

## 5. Gemini (S6)
1. Create an API key in Google AI Studio.
2. `supabase secrets set GEMINI_API_KEY=... GEMINI_MODEL=<current stable Flash-Lite id>` (or add them as GitHub secrets for the pipeline to set).
3. **Billing: off.** The owner has chosen the free tier (a private tool for one household). If the daily free limit ever gets in the way, turning billing on in Google AI Studio needs no code change.

## 6. Notifications (S8)
As MacroPy `docs/DEPLOY.md` §4: generate VAPID keys, `supabase secrets set`, deploy the function, schedule it.

## 7. Optional: let Claude Code see production health
Give the Claude Code environment a read-only database connection string (or the service-role key) as an environment secret so it can read `client_errors` and `ai_usage` at the start of each session. Never commit it.
