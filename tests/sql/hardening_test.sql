-- Checks for migration 20261116000100_hardening. Runs after schema_test.sql in the same database.
reset role;
set role anon;
set request.jwt.claim.sub = '';
select (health()->>'ok')::boolean as ok_health_for_anon;
select create_household();                                             -- expect error: anon cannot execute
select post_due_recurring(gen_random_uuid());                          -- expect error: anon cannot execute
select my_household();                                                 -- expect error: anon cannot execute
reset role;
set role authenticated;
set request.jwt.claim.sub = '';
select post_due_recurring(gen_random_uuid());                          -- expect error: signed-in check
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select post_due_recurring() = 0 as ok_no_household_posts_nothing;
reset role;
select count(*) = 0 as ok_no_function_executable_by_public
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('public', p.oid, 'execute')
  and p.proname not in (select unnest(array['health']));
