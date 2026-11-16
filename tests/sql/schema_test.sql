-- Run after tests/sql/auth_stub.sql and supabase/schema.sql on a scratch PostgreSQL 16 database:
--   psql -f tests/sql/schema_test.sql
-- Every check prints ok_* = t. Lines tagged as expected errors must print an ERROR. scripts/test-sql.sh counts both.
-- No extra grants here: the schema's own grants are what is tested.
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
update members set display_name = 'X' where user_id = :'B';            -- expect error: no update privilege
select display_name = 'Sam' as ok_direct_edit_blocked from members where user_id = :'B';
select set_monzo_me('sam-b');
select set_monzo_me('not a name!');                                    -- expect error: bad monzo.me name
select monzo_me = 'sam-b' as ok_monzo_me from members where user_id = :'B';

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

-- expenses: paid and shares rules
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Tesco', 4251, jsonb_build_object(:'A', 4251), jsonb_build_object(:'A', 2126, :'B', 2125)) returning id as e1 \gset
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Bad', 100, jsonb_build_object(:'A', 100), jsonb_build_object(:'A', 60));            -- expect error: shares sum
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Bad', 100, jsonb_build_object(:'A', 90), jsonb_build_object(:'A', 50, :'B', 50));   -- expect error: paid sum
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Bad', 100, jsonb_build_object(:'C', 100), jsonb_build_object(:'A', 50, :'B', 50));  -- expect error: non-member
insert into expenses(household_id, description, amount_pence, paid, split_mode, shares)
values (my_household(), 'Bad', 100, jsonb_build_object(:'A', 100), 'for_other', jsonb_build_object(:'A', 50, :'B', 50)); -- expect error
insert into expenses(household_id, description, amount_pence, paid, split_mode, shares)
values (my_household(), 'Haircut', 3000, jsonb_build_object(:'A', 3000), 'for_other', jsonb_build_object(:'A', 0, :'B', 3000));
insert into expenses(household_id, description, amount_pence, paid, split_mode, shares)
values (my_household(), 'Dinner treat', 6000, jsonb_build_object(:'B', 6000), 'treat', jsonb_build_object(:'B', 6000));
insert into expenses(household_id, description, amount_pence, paid, split_mode, shares)
values (my_household(), 'Bad treat', 6000, jsonb_build_object(:'B', 6000), 'treat', jsonb_build_object(:'A', 6000));  -- expect error
select count(*) = 1 as ok_hard_delete_blocked from expenses where id = :'e1';
update expenses set amount_pence = 4400, paid = jsonb_build_object(:'A', 4400), shares = jsonb_build_object(:'A', 2200, :'B', 2200) where id = :'e1';
update expenses set deleted_at = now() where id = :'e1';
update expenses set deleted_at = null where id = :'e1';

-- balance: A paid 4400 (B's share 2200) + haircut 3000 → A is owed 5200; the treat adds nothing
select (select net_pence from member_net where user_id = :'A') = 5200
   and (select net_pence from member_net where user_id = :'B') = -5200 as ok_balance;

-- joint account: paid 50/50 from joint, split 70/30 → A owes B 2000 of a 10000 bill
insert into expenses(household_id, description, amount_pence, paid, paid_via, shares)
values (my_household(), 'Sofa', 10000, jsonb_build_object(:'A', 5000, :'B', 5000), 'joint', jsonb_build_object(:'A', 7000, :'B', 3000));
select (select net_pence from member_net where user_id = :'A') = 3200 as ok_joint_payer;

-- money back: A receives a £20 refund that belongs to both → A now holds £10 of B's money
insert into expenses(household_id, kind, description, amount_pence, paid, shares)
values (my_household(), 'money_back', 'Tesco refund', 2000, jsonb_build_object(:'A', 2000), jsonb_build_object(:'A', 1000, :'B', 1000));
select (select net_pence from member_net where user_id = :'A') = 2200 as ok_money_back;

-- settle up: B pays A 2200 → all square, and the two nets always sum to zero
insert into settlements(household_id, from_user, to_user, amount_pence, method) values (my_household(), :'B', :'A', 2200, 'monzo');
select bool_and(net_pence = 0) and sum(net_pence) = 0 as ok_all_square from member_net;

-- chapters and places
insert into chapters(household_id, name, emoji, kind, country, start_date) values (my_household(), 'Japan', '🗾', 'trip', 'JP', current_date - 3) returning id as ch \gset
insert into expenses(household_id, description, amount_pence, paid, shares, chapter_id, country, place, lat, lng)
values (my_household(), 'Ramen', 1800, jsonb_build_object(:'A', 1800), jsonb_build_object(:'A', 900, :'B', 900), :'ch', 'JP', 'Kyoto', 35.0116, 135.7681);
select lat = 35.012 and country = 'JP' as ok_place_rounded from expenses where description = 'Ramen';

-- recurring: idempotent from both phones, always home, never in a chapter
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Rent', 150000, jsonb_build_object(:'A', 150000), jsonb_build_object(:'A', 75000, :'B', 75000), 'monthly', current_date - 75);
insert into recurring(household_id, description, amount_pence, amount_varies, paid, shares, frequency, start_date)
values (my_household(), 'Energy', 9000, true, jsonb_build_object(:'B', 9000), jsonb_build_object(:'A', 4500, :'B', 4500), 'monthly', current_date - 40);
select post_due_recurring() = 5 as ok_posted_five;
set request.jwt.claim.sub = :'B';
select post_due_recurring() = 0 as ok_second_phone_posts_nothing;
select count(*) = 3 and bool_and(country = 'GB' and chapter_id is null) as ok_three_rents_at_home from expenses where description = 'Rent';
select count(*) = 2 and bool_and(status = 'open') as ok_variable_bills_wait_in_inbox from inbox_items where source = 'bill';
select count(*) = 0 as ok_variable_bills_are_not_money from expenses where description = 'Energy';
select post_due_recurring(gen_random_uuid());                           -- expect error: not your household

-- comments: only your own
insert into comments(household_id, expense_id, author, body) values (my_household(), :'e1', :'B', 'Was this the big shop?');
insert into comments(household_id, expense_id, author, body) values (my_household(), :'e1', :'A', 'forged');   -- expect error: not you
select count(*) = 1 as ok_comment from comments;

-- history: readable, not writable
select count(*) filter (where action = 'edited') >= 1 and count(*) filter (where action = 'deleted') = 1
   and count(*) filter (where action = 'restored') = 1 and count(*) filter (where action = 'approved') = 2 as ok_activity
from activity;
insert into activity(household_id, entity, action) values (my_household(), 'expense', 'forged');   -- expect error: read-only

-- operations tables
insert into client_errors(message, app_version) values ('boom', '0.1.0');
select count(*) from client_errors;                                    -- expect error: write-only
select value = '"0.0.0"'::jsonb as ok_config_readable from app_config where key = 'min_client_version';
insert into ai_usage(household_id, day, kind, calls) values (my_household(), current_date, 'scan', 1);   -- expect error: read-only

-- privileges: deletes of money rows are not even granted; anon can read nothing
delete from expenses where id = :'e1';                                 -- expect error: no delete privilege
reset role; set role anon;
select count(*) from categories;                                       -- expect error: anon has no access
reset role; set role authenticated;

-- outsider sees nothing
set request.jwt.claim.sub = :'C';
select (select count(*) from activity) + (select count(*) from expenses) + (select count(*) from chapters)
     + (select count(*) from inbox_items) + (select count(*) from comments) + (select count(*) from member_net) = 0 as ok_outsider_sees_no_data;
