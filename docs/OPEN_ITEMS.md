# smsm: open items

## Milestones
- [ ] M0 skeleton and pipeline
- [ ] M1 money core
- [ ] M2 backend, sign-in, setup
- [ ] M3 local-first sync
- [ ] M4 daily loop
- [ ] M5 recurring and extras
- [ ] M6 insights
- [ ] M7 import and export
- [ ] M8 notifications
- [ ] M9 release QA → v1.0.0

## Needs the owner
- [ ] Create the Supabase project and Cloudflare Worker (`docs/DEPLOY.md`), and put the build variables in Cloudflare.
- [ ] Partner email delivery: invite the partner to the Supabase org, or set up custom SMTP.
- [ ] Pick the logo variant (M0) and approve the avatars (M0 gallery).
- [ ] Provide a real Monzo CSV export (personal rows can be deleted first) to confirm the column mapping (M7).
- [ ] Review the assumptions A1–A9 in `docs/DECISIONS.md`.
