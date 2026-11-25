# smsm: open items

What is still to do before v1.0, and why. Done items are taken off with where they were done (BUILD_LOG, DECISIONS).
Last checked against the code and tests on 23 Nov 2026 (S9 engineering items).

## Slices
- [x] S0 pipeline and look
- [x] S1 money core
- [x] S2 daily loop → first real use
- [x] S3 recurring, bills, inbox
- [x] S4 chapters and places
- [x] S5 insights and recap
- [x] S6 smart features
- [x] S7 import and export
- [x] S8 notifications
- [ ] S9 hardening → v1.0.0. Done: performance pass (live, `docs/qa/S9-performance.md`), acceptance pass and its fixes (S9a, S9b, PR #19), the data-safety pass (`tests/unit/data-safety.test.ts`). Also done: the three S9 risks (Actions pinned to commits, a second keep-alive on the Worker, a regular payment started long ago asks first). Still to do: the rest of release QA (ENGINEERING §9: the whole browser suite with the live AI eval, and the two-phone day below), then tag `v1.0.0`.
- [ ] S10 personal regular payments (owner, 25 Nov; D19): built on its branch, tests green locally (`docs/slices/S10.md`); still to do: fresh review, CI, merge, deploy, smoke-check.

## Needs the owner
- [ ] Skim the remaining proposals in `docs/DECISIONS.md` (the main ones are confirmed).
- [ ] Release QA on two real phones (ENGINEERING §9): both install, both save a monzo.me name in Settings, then the daily loop for a day, entries in airplane mode, a settle-up through Monzo, a notification tapped, an update applied.
- [ ] Live AI eval: the Cloudflare token saved as `CLOUDFLARE_API_TOKEN` needs "Workers AI: Read" and "Workers AI: Edit", then run the `eval-ai` workflow (BUILD_LOG 18 Nov ~02:15; the app's own scanning works without it).
- [ ] A real Monzo CSV when convenient, to confirm the columns (S7; another header already falls back to the mapping step).

Done and taken off: Supabase project, account ids, tokens and GitHub secrets (DEPLOY §1–3, first deploy 16 Nov); how sign-in codes reach you both (Gmail, DECISIONS 17 Nov); logo C, type A and the fifth colour (DECISIONS 17 Nov); the eval receipts (found online at the owner's word, BUILD_LOG 18 Nov ~01:30).

## Known risks
- **`service_role` grants, when Monzo arrives live (SPEC §9, Later).** No server-side code writes money rows in v1: restore and import run as the signed-in person, the nightly job as the database owner. Code that does later must be able to run `check_money`'s helper and reach the tables it needs.
- **Quick add reads some ordinary words as categories** ("the other half" → Other, "house party" → Household). Pinned behaviour: the person always sees the reading before saving, and no one has reported it in real use. Revisit if the owner or partner does.
- **Larger screens, the rest of L2 (S9b deferral).** From 900 px Activity is two panes; Bills (list | bill), Inbox (list | item) and Settings (sections | section) are still one centred column, their forms opening as centred dialogs. Also: mark the row whose entry is open in the Activity pane (`aria-current`).
- **Demo only, cosmetic:** the seeded monthly settle-up date drifts when the demo starts after the 28th (`addMonths` chained from the start day). The trip's random categories were fixed in S9b (DECISIONS 23 Nov, "S9b: demo only").

Done and taken off: a regular payment started long ago now asks before adding its past payments (DECISIONS 23 Nov "S9: a regular payment started long ago"); the keep-alive that doesn't depend on GitHub (a Cron Trigger on the app's Worker calling `health()` daily: DEPLOY §1, DECISIONS 23 Nov "S9: a second keep-alive"); Actions pinned to commit SHAs (DECISIONS 23 Nov "S9: Actions pinned", `tests/unit/workflows-pinned.test.ts`); one notification per imported row (a batch of 3 or more is now one notification: DECISIONS 18 Nov, "S8 fresh-review fixes" (2)).

## Deferred criteria
Each line: ids, then where and why. `npm run trace` reads this list; remove an id once its tests exist.
- TXT-6: whole-character truncation and wrapping (`src/ui/text.test.ts`) and the Korean face on a real page (`tests/unit/fonts-korean.test.ts`, `tests/e2e/s9-perf.spec.ts`) are tested; not yet automated: a script none of the app's fonts draw (Japanese on a trip) falling back to the phone's own font, and the order of non-Latin names in lists. Closes with the two-phone release QA (S9) or a browser check.

Taken off on 23 Nov, each now tested under its own id: REC-1…REC-8, INB-1, INB-3, CAT-1 (S3: `src/core/bills.test.ts`, `src/data/bills.test.ts`, `src/screens/bills.test.tsx`, `tests/sql/recurring_test.sql`, `tests/e2e/bills.spec.ts`, `tests/e2e/recurring.spec.ts`); CHP-1…CHP-6, PLC-1…PLC-7 (S4: `src/{core,data,screens}/chapters.test.*`, `src/{data,screens}/places.test.*`, `tests/sql/chapters_test.sql`; PLC-5 by `src/screens/places.test.tsx` "regular payments abroad"); INS-1…INS-8, SET-4 (S5: `src/core/insights.test.ts`, `src/core/recap.test.ts`, `src/screens/insights.test.tsx`, `src/screens/recap.test.tsx`); ADD-8, ADD-9, SCAN-1…SCAN-5, INS-9, TXT-5 (S6: `src/core/itemise.test.ts`, `src/data/smart.test.ts`, `src/data/smart-s6b.test.ts`, `src/screens/smart.test.tsx`, `src/screens/smart-s6b.test.tsx`). INB-1's "later Monzo transactions" are SPEC §9, after v1 (BUILD_PLAN "Later"); a photo shared while offline reaches the Inbox through Sort it later (S6b brief, SCAN-4).

## Ideas (not in scope until promoted)
- A personal regular payment whose amount varies (S10 refuses it: its bill would wait in the shared Inbox). If wanted, an owner-only Inbox card.
- Personal one-off entries, typed or imported (S10 has own entries only from own regular payments).
- Joint account as a payer (data model ready).
- Push the itemised receipt onto the Monzo transaction (with live Monzo).
- A small seasonal prop for the animals.
- App lock with fingerprint.
