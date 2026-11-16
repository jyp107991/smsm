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
where n.nspname = 'public' and has_function_privilege('public', p.oid, 'execute');
select count(*) = 0 as ok_anon_executes_only_health
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'health';
select bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as ok_signed_in_rpcs_granted
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('my_household','create_household','join_household','set_identity',
  'set_monzo_me','request_change','decide_change','post_due_recurring','jsonb_pence_sum','health');
-- A function created later by the same owner is not executable by PUBLIC or anon unless granted.
create function public.zz_future_fn() returns int language sql as 'select 1';
select not has_function_privilege('public', 'public.zz_future_fn()', 'execute')
   and not has_function_privilege('anon', 'public.zz_future_fn()', 'execute') as ok_future_functions_closed;
drop function public.zz_future_fn();
-- The nightly job (no sign-in, no API role) may post for a named household.
set request.jwt.claim.sub = '';
select post_due_recurring((select id from households limit 1)) >= 0 as ok_nightly_job_can_post;
