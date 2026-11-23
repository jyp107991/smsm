-- S9b review 7: the one-off "Other" emoji update touches only an untouched starting "Other": made with its household
-- (logged at that moment, or from before categories were logged) and never renamed, re-emojied (clearing an emoji stores
-- the same dot), recoloured or archived by a person. Moving it in the order doesn't count. Runs as the owner.
\set A '11111111-1111-1111-1111-111111111111'
reset role;

-- Seeded with its household (the same moment), never touched.
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000001');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Other', '•', 'stone', 12);
commit;
-- Seeded before categories were logged (no 'created' entry).
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000002');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Other', '•', 'stone', 12);
commit;
delete from activity where entity_id = 'c0000000-0000-4000-8000-000000000002';
-- Seeded, then only moved in the order by a person.
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000003');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'Other', '•', 'stone', 12);
commit;
insert into activity(household_id, actor, entity, entity_id, action, summary)
values ('a0000000-0000-4000-8000-000000000003', :'A', 'category', 'c0000000-0000-4000-8000-000000000003', 'edited', '{"sort": {"before": 12, "after": 0}}');
-- A person's own "Other", added after the household was made.
insert into households(id) values ('a0000000-0000-4000-8000-000000000004');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 'Other', '•', 'stone', 13);
-- Seeded, but its emoji cleared on purpose by a person (stored as the same dot).
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000005');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', 'Other', '•', 'stone', 12);
commit;
insert into activity(household_id, actor, entity, entity_id, action, summary)
values ('a0000000-0000-4000-8000-000000000005', :'A', 'category', 'c0000000-0000-4000-8000-000000000005', 'edited', '{"emoji": {"before": "🧩", "after": "•"}}');
-- Seeded, archived.
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000006');
insert into categories(id, household_id, name, emoji, colour, sort, archived) values ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', 'Other', '•', 'stone', 12, true);
commit;
-- Seeded, recoloured.
begin;
insert into households(id) values ('a0000000-0000-4000-8000-000000000007');
insert into categories(id, household_id, name, emoji, colour, sort) values ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000007', 'Other', '•', 'plum', 12);
commit;

select give_other_its_emoji() = 3 as ok_cat1_other_emoji_three_untouched;
select array_agg(right(id::text, 1) order by id) = array['1', '2', '3'] as ok_cat1_other_emoji_only_the_untouched
from categories where id::text like 'c0000000-0000-4000-8000-00000000000%' and emoji = '📦';
select count(*) = 4 as ok_cat1_other_emoji_others_left_alone
from categories where id::text like 'c0000000-0000-4000-8000-00000000000%' and emoji = '•';
-- The change is in the history, with no actor.
select count(*) = 3 as ok_cat1_other_emoji_logged from activity
where entity = 'category' and entity_id::text like 'c0000000-0000-4000-8000-00000000000%' and action = 'edited' and actor is null
  and summary->'emoji'->>'after' = '📦';
-- Not callable by a person.
set role authenticated;
set request.jwt.claim.sub = :'A';
select give_other_its_emoji(); -- expect error: not allowed
reset role;
