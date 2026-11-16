# smsm: build log

Newest first. Each entry covers what was built, what was tested, what failed, and what's next.

## 2026-11-16: design
- Spec, design, data model, build plan, QA and deploy docs written.
- `supabase/schema.sql` drafted and tested on PostgreSQL 16 with an auth stub: 15 checks pass and 9 forbidden actions are refused (`tests/sql/schema_test.sql`).
- Next: M0 (skeleton and pipeline).
