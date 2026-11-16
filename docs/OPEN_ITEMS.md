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
- [ ] S6: Gemini key; ten receipt photos for the eval.
- [ ] S7: Splitwise export (if you want your history) and a Monzo CSV.

## Deferred criteria
Each line: ids, then where and why. `npm run trace` reads this list; remove an id once its tests exist.
- BAL-3, TXT-6, TXT-7, DAT-5: S0 (in progress): the plank component, font fallback and truncation, the strings file and pinned dependencies.
- BAL-1, SPL-1, SPL-2, SPL-3, SPL-5, ADD-1, ADD-5, MB-3, CAT-2, CAT-3, CAT-4, REC-2, TXT-3, TXT-4, DAT-1, DAT-3, DAT-4: S1 builds and tests the pure core; the screens that use it arrive in S2 (REC-2 posting in S3).
- BAL-2, BAL-4, BAL-5, BAL-6, ADD-2, ADD-3, ADD-4, ADD-6, ADD-7, SPL-4, MB-1, MB-2, SET-1, SET-2, SET-3, SET-5: S2, the daily loop.
- ACT-1, ACT-2, ACT-3, ACT-5, PPL-1, PPL-2, PPL-3, PPL-4, PPL-5: S2, the daily loop.
- OFF-1, OFF-2, OFF-3, OFF-4, OFF-5, OFF-6, OFF-7, TXT-1, TXT-2, DAT-2, EXP-2: S2, offline, text, dates and the off-site backup.
- REC-1, REC-3, REC-4, REC-5, REC-6, REC-7, REC-8, INB-1, INB-2, INB-3, CAT-1: S3, recurring, bills, inbox, categories.
- CHP-1, CHP-2, CHP-3, CHP-4, CHP-5, CHP-6, PLC-1, PLC-2, PLC-3, PLC-4, PLC-5, PLC-6, PLC-7: S4, chapters and places.
- INS-1, INS-2, INS-3, INS-4, INS-5, INS-6, INS-7, INS-8, SET-4, ACT-4: S5, insights, recap, settle day, comments.
- ADD-8, ADD-9, SCAN-1, SCAN-2, SCAN-3, SCAN-4, SCAN-5, INS-9, TXT-5: S6, smart features, share target and shortcuts.
- IMP-1, IMP-2, IMP-3, EXP-1, EXP-3: S7, import and export (the JSON backup download part of EXP-1 lands in S2).
- NOT-1, NOT-2, NOT-3: S8, notifications.

## Ideas (not in scope until promoted)
- Joint account as a payer (data model ready).
- Push the itemised receipt onto the Monzo transaction (with live Monzo).
- A small seasonal prop for the animals.
- App lock with fingerprint.
