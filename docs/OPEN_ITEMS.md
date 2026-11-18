# smsm: open items

## Slices
- [ ] S0 pipeline and look
- [ ] S1 money core
- [ ] S2 daily loop → first real use
- [ ] S3 recurring, bills, inbox
- [ ] S4 chapters and places
- [ ] S5 insights and recap
- [ ] S6 smart features
- [ ] S7 import and export
- [ ] S8 notifications
- [ ] S9 hardening → v1.0.0

## Needs the owner
- [ ] Skim the remaining proposals in `docs/DECISIONS.md` (the main ones are confirmed).
- [x] Supabase project created.
- [ ] Collect Supabase URL, publishable key, project ref, access token; Cloudflare token and account ID; add all to GitHub (`docs/DEPLOY.md` §1–3).
- [ ] S2: approve Claude Code's proposal for how sign-in codes reach both of you.
- [ ] S0: on the gallery, choose the logo variant and the type option; confirm the palette, including the fifth colour (read as `#D6D9C7`, partly hidden in the screenshot).
- [ ] S2: both install; both save a monzo.me name in Settings.
- [ ] S6: ten receipt photos for the eval (no key needed).
- [ ] S7: a Monzo CSV.

## Known risks
- **Keep-alive stops if the repo goes quiet.** GitHub disables scheduled workflows in public repos after 60 days without activity; Supabase would then pause 7 days later. S2 adds a second keep-alive that doesn't depend on GitHub (a Cloudflare Cron Trigger calling `health()`).
- **Actions pinned by tag, not commit.** `actions/checkout@v5` etc. Pin to commit SHAs in S9 hardening.
- **`service_role` grants.** When server-side code first writes money rows (S2 backup restore, S7 import), check it can run `check_money`'s helper and the tables it needs.
- **`post_due_recurring` has no upper bound per call.** A template started years ago back-posts every occurrence. Decide in S3 (probably: confirm before back-posting more than a few).

- **From the S0/S1 review, still open:** demo household: trip descriptions get random categories and the monthly settle date drifts (cosmetic). (Fixed in S2: the Sheet's history entry, through one history coordinator `src/ui/history.ts`; toasts through one persistent live region; `errors.ts` reports with an unserialisable reason.)
- **A bank import notifies once per kept row** (S8). NOT-1 says each change is sent at once, so importing 40 rows sends the partner 40 notifications (each its own tag). If that is noisy in real use, group one import into a single "Sam imported 40 entries" notification.
- **Quick add reads some ordinary words as categories** ("the other half" → Other, "house party" → Household). Pinned behaviour for now; revisit with real use in S2 (the person always sees the reading before saving).

## Deferred criteria
Each line: ids, then where and why. `npm run trace` reads this list; remove an id once its tests exist.
- TXT-6: grapheme truncation and wrapping are tested (S0) and the screens use them; the Hangul font fallback on real screens is checked by eye (screenshots), not yet by an automated test (S9 visual snapshots).
- REC-2: the TypeScript and SQL schedules agree (S1); posting by the database arrives in S3.
- REC-1, REC-3, REC-4, REC-5, REC-6, REC-7, REC-8, INB-1, INB-3, CAT-1: S3, recurring, bills, inbox, categories.
- CHP-1, CHP-2, CHP-3, CHP-4, CHP-5, CHP-6, PLC-1, PLC-2, PLC-3, PLC-4, PLC-5, PLC-6, PLC-7: S4, chapters and places.
- INS-1, INS-2, INS-3, INS-4, INS-5, INS-6, INS-7, INS-8, SET-4: S5, insights, recap, settle day, comments.
- ADD-8, ADD-9, SCAN-1, SCAN-2, SCAN-3, SCAN-4, SCAN-5, INS-9, TXT-5: S6, smart features, share target and shortcuts.

## Ideas (not in scope until promoted)
- Joint account as a payer (data model ready).
- Push the itemised receipt onto the Monzo transaction (with live Monzo).
- A small seasonal prop for the animals.
- App lock with fingerprint.
