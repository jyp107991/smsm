-- Owner's reports, 24 Nov (DECISIONS "One meaning for subscription", "Notes on regular payments"); REC-1, REC-3, REC-7,
-- CAT-1. Written before the build. Runs after schema_test.sql. F and G are a couple of their own.
--   1. Each starting category knows which one it is (seed_key), set by create_household; a phone can't set or change
--      it; a renamed one keeps it; a category a person adds never has one; a restored backup brings none.
--   2. Existing households are keyed once: a category made with its household takes the key of the starting name it
--      had first (renamed or not); a person's own later "Subscriptions" doesn't.
--   3. A regular payment's notes: written by a phone, logged when changed, copied onto what it posts from then on (an
--      entry, or an "amount varies" bill's Inbox payload); what was posted before keeps its notes.
\set F 'f1000000-0000-4000-8000-0000000000f1'
\set G 'f1000000-0000-4000-8000-0000000000f2'
\set NOTED 'd2000000-0000-4000-8000-000000000001'
\set WATER 'd2000000-0000-4000-8000-000000000002'
reset role;
set request.jwt.claim.sub = '';
insert into auth.users values (:'F') on conflict do nothing;
insert into auth.users values (:'G') on conflict do nothing;
select (now() at time zone 'Europe/London')::date as uk_today \gset

-- ───────── 1. the starting categories' key ─────────
set role authenticated;
set request.jwt.claim.sub = :'F';
select create_household() as fhid \gset
select join_code from households where id = :'fhid' \gset
set request.jwt.claim.sub = :'G';
select join_household(:'join_code') is not null as ok_rec7_second_person_joined;
select count(*) = 12 and count(distinct seed_key) = 12 as ok_cat1_every_starting_category_has_its_key
from categories where household_id = :'fhid';
select seed_key = 'subscriptions' as ok_rec7_subscriptions_keyed from categories where household_id = :'fhid' and name = 'Subscriptions';
select seed_key = 'other' as ok_cat1_other_keyed from categories where household_id = :'fhid' and name = 'Other';
select id as subs from categories where household_id = :'fhid' and seed_key = 'subscriptions' \gset
-- Renamed, it is still the Subscriptions category.
update categories set name = 'Streaming' where id = :'subs';
select seed_key = 'subscriptions' as ok_rec7_renamed_keeps_its_key from categories where id = :'subs';
-- A person's own category never has a key; a phone can't set or move one.
insert into categories(household_id, name, emoji, colour, sort) values (:'fhid', 'Subscriptions', '📰', 'plum', 13) returning id as own \gset
select seed_key is null as ok_rec7_own_subscriptions_has_no_key from categories where id = :'own';
insert into categories(household_id, name, emoji, colour, sort, seed_key) values (:'fhid', 'Fake', '•', 'stone', 14, 'travel'); -- expect error: the key is the server's
update categories set seed_key = 'subscriptions' where id = :'own';   -- expect error: the key is the server's
update categories set seed_key = null where id = :'subs';             -- expect error: the key is the server's
select seed_key = 'subscriptions' as ok_rec7_key_unmoved from categories where id = :'subs';
-- A rename's history says nothing of the key.
select count(*) = 0 as ok_cat1_key_not_in_history from activity where entity = 'category' and entity_id = :'subs' and summary ? 'seed_key';
-- A restored backup's category (a renamed starting one, say) brings no key: the household's own are its own.
select restore_backup(jsonb_build_object(:'F', :'F', :'G', :'G'), jsonb_build_object('categories', jsonb_build_array(
  jsonb_build_object('id', 'c3000000-0000-4000-8000-000000000001', 'name', 'Telly and apps', 'emoji', '📺', 'colour', 'plum',
                     'sort', 20, 'seed_key', 'subscriptions')))) is not null as ok_cat1_restored;
select seed_key is null as ok_cat1_restored_category_has_no_key from categories where household_id = :'fhid' and name = 'Telly and apps';
select count(*) = 1 as ok_rec7_one_subscriptions_key_per_household from categories where household_id = :'fhid' and seed_key = 'subscriptions';
reset role;

-- ───────── 2. keying existing households (as the owner, once) ─────────
-- Made with its household, never renamed.
begin;
insert into households(id) values ('a1000000-0000-4000-8000-000000000001');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Subscriptions', '📺', 'plum', 6);
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Other', '📦', 'stone', 12);
commit;
-- Made with its household, then renamed by a person.
begin;
insert into households(id) values ('a1000000-0000-4000-8000-000000000002');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'Streaming', '📺', 'plum', 6);
commit;
insert into activity(household_id, actor, entity, entity_id, action, summary)
values ('a1000000-0000-4000-8000-000000000002', :'F', 'category', 'c1000000-0000-4000-8000-000000000003', 'edited', '{"name": {"before": "Subscriptions", "after": "Telly"}}'),
       ('a1000000-0000-4000-8000-000000000002', :'F', 'category', 'c1000000-0000-4000-8000-000000000003', 'edited', '{"name": {"before": "Telly", "after": "Streaming"}}');
-- From before categories were logged (no 'created' entry).
begin;
insert into households(id) values ('a1000000-0000-4000-8000-000000000003');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'Subscriptions', '📺', 'plum', 6);
commit;
delete from activity where entity_id = 'c1000000-0000-4000-8000-000000000004';
-- The starting one renamed, and a person's own "Subscriptions" added later.
begin;
insert into households(id) values ('a1000000-0000-4000-8000-000000000004');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000004', 'Apps', '📺', 'plum', 6);
commit;
insert into activity(household_id, actor, entity, entity_id, action, summary)
values ('a1000000-0000-4000-8000-000000000004', :'F', 'category', 'c1000000-0000-4000-8000-000000000005', 'edited', '{"name": {"before": "Subscriptions", "after": "Apps"}}');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000004', 'Subscriptions', '📰', 'plum', 13);

select key_starting_categories() >= 5 as ok_rec7_existing_households_keyed;  -- other files' households too
select array_agg(right(id::text, 1) || ':' || seed_key order by id) = array['1:subscriptions', '2:other', '3:subscriptions', '4:subscriptions', '5:subscriptions']
  as ok_rec7_keyed_by_first_name from categories where id::text like 'c1000000-0000-4000-8000-00000000000%' and seed_key is not null;
select seed_key is null as ok_rec7_later_own_subscriptions_not_keyed from categories where id = 'c1000000-0000-4000-8000-000000000006';
select key_starting_categories() = 0 as ok_rec7_keying_once;
set role authenticated;
set request.jwt.claim.sub = :'F';
select key_starting_categories(); -- expect error: not callable by a person
reset role;

-- ───────── 3. a regular payment's notes ─────────
set role authenticated;
set request.jwt.claim.sub = :'F';
-- Monthly from two months ago, with a note, ended yesterday for now: its two past days post, each with the note.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, end_date, notes) values
  (:'NOTED', :'fhid', 'Council tax', 15000, jsonb_build_object(:'F', 15000), jsonb_build_object(:'F', 7500, :'G', 7500),
   'monthly', (:'uk_today'::date - interval '2 months')::date, :'uk_today'::date - 1, 'Account 1234');
select post_due_recurring() >= 2 as ok_rec2_noted_posted;
select count(*) = 2 and bool_and(notes = 'Account 1234') as ok_rec1_posted_entries_carry_the_note
from expenses where recurring_id = :'NOTED';
-- A changed note is logged, and goes only with what posts from now on (today's, once it runs on).
update recurring set notes = 'Account 5678' where id = :'NOTED';
select count(*) = 1 as ok_rec6_note_change_logged from activity
where entity = 'recurring' and entity_id = :'NOTED' and action = 'edited' and actor = :'F'
  and summary->'notes'->>'before' = 'Account 1234' and summary->'notes'->>'after' = 'Account 5678';
update recurring set end_date = null where id = :'NOTED';
select post_due_recurring() >= 1 as ok_rec2_noted_posted_today;
select count(*) = 2 as ok_rec6_past_entries_keep_their_note
from expenses where recurring_id = :'NOTED' and occurrence_date < :'uk_today'::date and notes = 'Account 1234';
select notes = 'Account 5678' as ok_rec6_next_entry_has_the_new_note
from expenses where recurring_id = :'NOTED' and occurrence_date = :'uk_today'::date;
-- An "amount varies" one: its Inbox bill carries the note it had on the day it was due.
insert into recurring(id, household_id, description, amount_pence, amount_varies, paid, shares, frequency, start_date, notes) values
  (:'WATER', :'fhid', 'Water', 3000, true, jsonb_build_object(:'F', 3000), jsonb_build_object(:'F', 1500, :'G', 1500),
   'monthly', :'uk_today'::date, 'Meter 42');
select post_due_recurring() >= 0 as ok_rec3_water_posted;
select payload->>'notes' = 'Meter 42' as ok_rec3_bill_payload_carries_the_note
from inbox_items where recurring_id = :'WATER' and occurrence_date = :'uk_today'::date;
select count(*) = 0 as ok_rec3_bill_not_money from expenses where recurring_id = :'WATER';
-- No note: the payload says so (null), so the bill has none.
update recurring set notes = null where id = :'WATER';
select payload->>'notes' = 'Meter 42' as ok_rec3_bill_keeps_the_note_it_was_posted_with
from inbox_items where recurring_id = :'WATER' and occurrence_date = :'uk_today'::date;
reset role;
