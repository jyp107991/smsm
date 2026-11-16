# smsm: QA

## Automated (all must pass before a milestone commit)
- `npm run typecheck`, `npm test` (Vitest, including property tests), `npm run test:sql` (runs `tests/sql/` against PostgreSQL 16 with the auth stub), `npm run e2e` (Playwright).
- **Playwright matrix:** 390×800 light and dark, 1280×800 light, plus overflow checks at 320×568 and 390×400 (keyboard open). Fail on horizontal overflow, console errors, or layout shift > 0.05.
- **Two-user e2e:** two browser contexts as the two people; covers setup, join, identity lock, approval, add, edit, delete and undo, settle, recurring posting from both at once, offline edits and convergence, and realtime updates.
- **Accessibility:** axe-core on every screen, both themes; contrast of all token pairs.
- **Money invariants:** after every e2e scenario, the balance from `balance.ts` must equal the `household_balance` view.

## Manual on a real phone (each release)
- Install from the Cloudflare URL in Chrome on Android; icon legible on the home screen; opens offline.
- Add 10 expenses with quick add only; check every reading in the preview.
- Airplane mode: add 3 expenses, settle up, reconnect; the partner's phone shows everything.
- Notifications arrive and open the right screen.

## Independent review (M9)
A fresh reviewer (a subagent that has not seen the code) is given the built app, `docs/SPEC.md` and `docs/DESIGN.md` only, at phone size, in both themes, and asked to (1) do the daily loop as each person, (2) find anything confusing, ugly, slow or wrong, and (3) try to make the balance wrong. Fix everything a user would notice. Record the results in `docs/BUILD_LOG.md`.
