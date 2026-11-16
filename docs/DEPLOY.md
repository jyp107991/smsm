# smsm: deploy

The same setup as MacroPy: Cloudflare Workers static assets from this GitHub repo, plus Supabase.

## 1. Supabase (new project, separate from MacroPy's)
1. supabase.com → New project `smsm` (free tier), region London.
2. SQL editor: run `supabase/schema.sql`, then each file in `supabase/migrations/` in order.
3. Auth → Providers → Email: enabled; "Confirm email" off. Auth → Email Templates → Magic Link: the body must contain `{{ .Token }}` (sign-in is by 6-digit code).
4. **Email delivery for your partner.** Supabase's built-in email only reaches the project's team members. Either invite your partner's email to the Supabase organisation as a member, or set up custom SMTP (Auth → SMTP, e.g. Resend's free tier). Without one of these, your partner never receives a code.
5. Database → Extensions: enable `pg_cron` (and `pg_net` for M8), then schedule recurring posting (commented line at the end of `schema.sql`).
6. Storage: create a private bucket `receipts` (M5) and apply the storage policies migration.
7. Project Settings → API: copy the project URL and anon key.

## 2. Cloudflare
1. Workers & Pages → Create → Import a repository → GitHub → `jyp107991/smsm` only.
2. Build command `npm ci && npm run build`; deploy command `npx wrangler deploy`; preview builds off.
3. Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and `VITE_VAPID_PUBLIC_KEY` from M8).
4. Every push to `main` deploys. The URL is `https://smsm.<account>.workers.dev`.

## 3. Phones
Open the URL in Chrome → ⋮ → Install app. Sign in, start the household, then share the join code with your partner.

## 4. Notifications (M8)
As in MacroPy `docs/DEPLOY.md` §4: VAPID keys, `supabase secrets set`, deploy the function, schedule it with pg_cron.
