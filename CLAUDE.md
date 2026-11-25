# smsm: project instructions for Claude Code

smsm is an installable phone app (PWA) for two people who share a home. It records shared spending and keeps one running answer to "who owes whom". Two people, pounds only.

Read before writing any code, in this order: `docs/SPEC.md` (what, with acceptance-criteria ids), `docs/DESIGN.md` (look, feel, the avatar rig), `docs/DATA_MODEL.md` (tables, money rules, keeping phones in step), `docs/AI.md` (Gemini features and their guards), `docs/ENGINEERING.md` (stack, structure, tests, the slice protocol, definition of done), `docs/BUILD_PLAN.md` (slices), `docs/DECISIONS.md`, `docs/DEPLOY.md`. `supabase/schema.sql` with `tests/sql/` and `scripts/test-sql.sh` is the tested database baseline.

## Non-negotiables
1. **Scope.** Shared spending and the debt between two people. Nothing about either person's own finances, except personal regular payments (owner, 25 Nov), kept out of every shared figure. If a change needs individual finances, it's out; ask.
2. **Money is exact.** Integer pence everywhere. `paid` and `shares` each sum to the amount, enforced in TypeScript and in the database. One pure function computes the balance; tests prove it equals the database view.
3. **Code computes, people decide.** AI never calculates a shown figure and never writes money without a person's tap. Every smart feature has a working fallback.
4. **The database is the authority.** Row-level security on every table. Locked identity and the default split change only through approved requests. No hard deletes of money rows. Every change is logged.
5. **Nothing blocks adding.** Saving is instant, offline or online.
6. **The spec is executable.** Every criterion id has a test or an explicit deferral; `npm run trace` enforces it.
7. **Warm, quiet, exact** (`docs/DESIGN.md`): tokens only, both themes, WCAG AA, 44 px targets, no overflow at 320 px, no layout shift, reduced motion respected. The cat and dog are original drawings built as one SVG rig.
8. **Secrets never enter the repo.**
9. **Monzo-ready.** Never assume typing is the only source of entries.

## Working style
- Follow the slice protocol in `docs/ENGINEERING.md` §5 exactly: brief → tests first by a separate subagent → build → look at it → fresh review → merge on green → log. Use the definition of done (§8) as a checklist, not a summary.
- Work autonomously. Where the docs are silent, choose what best fits the non-negotiables, record it in `docs/DECISIONS.md`, continue. Ask the owner only about scope, about anything in the owner's decisions table, or at the ★ checkpoints in the build plan.
- Before first use of any library or service API, read its current documentation; do not rely on memory for versions, model ids or request shapes.
- Never weaken, skip or delete a failing test to get to green. Never present a stub as done. Add nothing the spec doesn't ask for.
- Main is always releasable; work on short branches; `npm run verify` before every commit; keep `docs/BUILD_LOG.md` current, since it is how the owner follows progress.
- The owner is not a developer and reads on a phone: explain choices in plain language, give setup steps one at a time, and send the preview link when there is something to look at.
- UI copy is part of the design: plain, sentence case, names not "you owe".
