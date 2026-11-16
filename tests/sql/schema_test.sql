-- Run after tests/sql/auth_stub.sql and supabase/schema.sql on a scratch PostgreSQL 16 database:
--   psql -v ON_ERROR_STOP=0 -f tests/sql/schema_test.sql
-- Each check prints ok_* = t. Lines marked "expect error" must print an ERROR.
grant all on all tables in schema public to authenticated;
set role authenticated;
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'

-- household + join
set request.jwt.claim.sub = :'A';
select create_household() is not null as ok_created;
select count(*) = 12 as ok_default_categories from categories;
select join_code from households \gset
set request.jwt.claim.sub = :'B';
select join_household(lower(:'join_code')) is not null as ok_joined_case_insensitive;
set request.jwt.claim.sub = :'C';
select join_household(:'join_code');                                   -- expect error: already two people
select count(*) = 0 as ok_outsider_sees_nothing from categories;

-- identity: set once, unique animal, then locked
set request.jwt.claim.sub = :'A';
select set_identity('Jae', 'dog');
set request.jwt.claim.sub = :'B';
select set_identity('Sam', 'dog');                                     -- expect error: partner has the dog
select set_identity('Sam', 'cat');
select set_identity('Samantha', 'cat');                                -- expect error: already set
update members set display_name = 'X' where user_id = :'B';            -- no policy: updates 0 rows
select display_name = 'Sam' as ok_direct_edit_blocked from members where user_id = :'B';

-- identity change needs the partner
select request_change('identity', jsonb_build_object('user_id', :'B', 'display_name', 'Sammy', 'animal', 'dog')) as rid \gset
select decide_change(:'rid', true);                                    -- expect error: requester cannot approve
set request.jwt.claim.sub = :'A';
select decide_change(:'rid', true);
select string_agg(display_name || ':' || animal, ',' order by display_name) = 'Jae:cat,Sammy:dog' as ok_swap_applied from members;

-- default ratio needs the partner
update households set default_ratio = '{"x":1}';                       -- expect error: needs both
select request_change('default_ratio', jsonb_build_object('ratio', jsonb_build_object(:'A', 60, :'B', 40))) as rid2 \gset
set request.jwt.claim.sub = :'B';
select decide_change(:'rid2', true);
select (default_ratio->>:'A')::int = 60 as ok_ratio_applied from households;

-- expenses and share rules
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid_by, split_mode, shares)
values (my_household(), 'Tesco', 4251, :'A', 'ratio', jsonb_build_object(:'A', 2126, :'B', 2125)) returning id as e1 \gset
insert into expenses(household_id, description, amount_pence, paid_by, split_mode, shares)
values (my_household(), 'Bad', 100, :'A', 'ratio', jsonb_build_object(:'A', 60));            -- expect error: sum
insert into expenses(household_id, description, amount_pence, paid_by, split_mode, shares)
values (my_household(), 'Bad', 100, :'A', 'for_other', jsonb_build_object(:'A', 50, :'B', 50)); -- expect error
insert into expenses(household_id, description, amount_pence, paid_by, split_mode, shares)
values (my_household(), 'Haircut', 3000, :'A', 'for_other', jsonb_build_object(:'A', 0, :'B', 3000));
insert into expenses(household_id, description, amount_pence, paid_by, split_mode, shares)
values (my_household(), 'Dinner treat', 6000, :'B', 'treat', jsonb_build_object(:'B', 6000));
delete from expenses where id = :'e1';                                 -- no delete policy: 0 rows
select count(*) = 1 as ok_hard_delete_blocked from expenses where id = :'e1';
update expenses set amount_pence = 4400, shares = jsonb_build_object(:'A', 2200, :'B', 2200) where id = :'e1';
update expenses set deleted_at = now() where id = :'e1';
update expenses set deleted_at = null where id = :'e1';

-- balance (B owes A): A paid 4400 (B's share 2200) + haircut 3000 = 5200; treat adds nothing
select sum(case when paid_by = :'A' then (shares->>:'B')::bigint else -(shares->>:'A')::bigint end) = 5200 as ok_balance
from expenses where deleted_at is null;

-- recurring: idempotent from both phones
insert into recurring(household_id, description, amount_pence, paid_by, split_mode, shares, frequency, start_date, is_subscription)
values (my_household(), 'Rent', 150000, :'A', 'ratio', jsonb_build_object(:'A', 75000, :'B', 75000), 'monthly', current_date - 75, false);
select post_due_recurring() = 3 as ok_posted_three;
set request.jwt.claim.sub = :'B';
select post_due_recurring() = 0 as ok_second_phone_posts_nothing;
select count(*) = 3 as ok_three_rents from expenses where description = 'Rent';
select post_due_recurring(gen_random_uuid());                           -- expect error: not your household

-- activity log: readable, not writable
select count(*) filter (where action = 'edited') >= 1 and count(*) filter (where action = 'deleted') = 1
   and count(*) filter (where action = 'restored') = 1 and count(*) filter (where action = 'approved') = 2 as ok_activity
from activity;
insert into activity(household_id, entity, action) values (my_household(), 'expense', 'forged');   -- expect error: no policy
set request.jwt.claim.sub = :'C';
select count(*) = 0 as ok_outsider_no_activity from activity;
select count(*) = 0 as ok_outsider_no_expenses from expenses;
