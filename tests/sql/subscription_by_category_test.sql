-- Owner, 25 Nov ("why do you still have a subscriptions category and a subscriptions switch"; DECISIONS 25 Nov "The
-- category alone decides what a subscription is"); REC-7. Written before the build. Runs after schema_test.sql. H and
-- I are a couple of their own.
--   1. recurring.is_subscription follows the category on insert, on update and on a category change, whatever a phone
--      sends: true exactly in the household's Subscriptions category (seed_key, so renamed it still is; a person's own
--      "Subscriptions" is not). Shared and own alike.
--   2. Deleting one whose stored column a stale phone holds otherwise still works (the rule runs before the guard).
--   3. The one-off backfill sets every existing row by the rule, unlogged and with no stamp moved.
\set H 'f2000000-0000-4000-8000-0000000000a1'
\set I 'f2000000-0000-4000-8000-0000000000a2'
\set NET 'd3000000-0000-4000-8000-000000000001'
\set GYM 'd3000000-0000-4000-8000-000000000002'
\set OWN 'd3000000-0000-4000-8000-000000000003'
\set APP 'd3000000-0000-4000-8000-000000000004'
reset role;
set request.jwt.claim.sub = '';
insert into auth.users values (:'H') on conflict do nothing;
insert into auth.users values (:'I') on conflict do nothing;
select (now() at time zone 'Europe/London')::date as uk_today \gset

set role authenticated;
set request.jwt.claim.sub = :'H';
select create_household() as hhid \gset
select join_code from households where id = :'hhid' \gset
set request.jwt.claim.sub = :'I';
select join_household(:'join_code') is not null as ok_rec7_cat_couple_joined;
set request.jwt.claim.sub = :'H';
select id as subs from categories where household_id = :'hhid' and seed_key = 'subscriptions' \gset
select id as health from categories where household_id = :'hhid' and seed_key = 'health' \gset
-- Renamed, the starting one is still the Subscriptions category; a person's own "Subscriptions" then isn't.
update categories set name = 'Streaming' where id = :'subs';
insert into categories(household_id, name, emoji, colour, sort) values (:'hhid', 'Subscriptions', '📰', 'plum', 13) returning id as mine \gset

-- ───────── 1. on insert ─────────
-- In Subscriptions, sent as false: it is one.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, category_id, is_subscription)
values (:'NET', :'hhid', 'Netflix', 1099, jsonb_build_object(:'H', 1099), jsonb_build_object(:'H', 550, :'I', 549), 'monthly',
        :'uk_today'::date + 3, :'subs', false)
returning is_subscription as ok_rec7_insert_in_subscriptions_is_one;
-- Elsewhere, sent as true: it isn't.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, category_id, is_subscription)
values (:'GYM', :'hhid', 'Gym', 3000, jsonb_build_object(:'H', 3000), jsonb_build_object(:'H', 1500, :'I', 1500), 'monthly',
        :'uk_today'::date + 3, :'health', true)
returning not is_subscription as ok_rec7_insert_elsewhere_is_not_one;
-- No category: not one.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, category_id, is_subscription)
values (:'APP', :'hhid', 'App', 199, jsonb_build_object(:'H', 199), jsonb_build_object(:'H', 100, :'I', 99), 'monthly',
        :'uk_today'::date + 3, null, true)
returning not is_subscription as ok_rec7_insert_no_category_is_not_one;
-- One person's own, in Subscriptions: one (sent without the column at all).
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, start_date, owner_id, category_id)
values (:'OWN', :'hhid', 'Own audiobooks', 899, jsonb_build_object(:'H', 899), 'treat', null, jsonb_build_object(:'H', 899), 'monthly',
        :'uk_today'::date + 3, :'H', :'subs')
returning is_subscription as ok_rec7_own_in_subscriptions_is_one;

-- ───────── 1. on update ─────────
-- A phone that writes the column (the deployed app's switch) changes nothing.
update recurring set is_subscription = false where id = :'NET';
select is_subscription as ok_rec7_update_cannot_switch_off from recurring where id = :'NET';
update recurring set is_subscription = true where id = :'GYM';
select not is_subscription as ok_rec7_update_cannot_switch_on from recurring where id = :'GYM';
-- An edit of something else leaves it by the rule.
update recurring set description = 'Netflix Premium' where id = :'NET';
select is_subscription as ok_rec7_other_edit_keeps_it from recurring where id = :'NET';

-- ───────── 1. on a category change ─────────
update recurring set category_id = :'subs' where id = :'GYM';
select is_subscription as ok_rec7_moved_into_subscriptions_is_one from recurring where id = :'GYM';
update recurring set category_id = :'health' where id = :'NET';
select not is_subscription as ok_rec7_moved_out_is_not_one from recurring where id = :'NET';
-- A person's own "Subscriptions" is not the Subscriptions category.
update recurring set category_id = :'mine' where id = :'GYM';
select not is_subscription as ok_rec7_own_named_subscriptions_is_not_it from recurring where id = :'GYM';
-- The category cleared: not one.
update recurring set category_id = :'subs' where id = :'APP';
update recurring set category_id = null where id = :'APP';
select not is_subscription as ok_rec7_category_cleared_is_not_one from recurring where id = :'APP';
-- Back in the (renamed) Subscriptions category: one again.
update recurring set category_id = :'subs' where id = :'NET';
select is_subscription as ok_rec7_renamed_category_still_decides from recurring where id = :'NET';
-- The category change is logged (the column's move goes with it).
select count(*) >= 1 as ok_rec7_category_change_logged from activity
where entity = 'recurring' and entity_id = :'NET' and action = 'edited' and summary ? 'category_id';

-- ───────── 2. a stale phone's delete ─────────
update recurring set active = false where id = :'APP';
update recurring set deleted_at = now(), is_subscription = true where id = :'APP';
select deleted_at is not null and not is_subscription as ok_rec7_stale_delete_still_deletes from recurring where id = :'APP';
reset role;

-- ───────── 3. the one-off backfill (as the owner, once) ─────────
-- Rows as a switch left them: wrong both ways, written with the rule's trigger off.
alter table recurring disable trigger recurring_category_subscription;
update recurring set is_subscription = false where id = :'NET';
update recurring set is_subscription = true where id = :'GYM';
alter table recurring enable trigger recurring_category_subscription;
select updated_at as net_stamp from recurring where id = :'NET' \gset
select count(*) as logged_before from activity where household_id = :'hhid' \gset
alter table recurring disable trigger user;
select subscription_follow_category() >= 2 as ok_rec7_backfill_set_rows;
alter table recurring enable trigger user;
select is_subscription as ok_rec7_backfill_subscriptions_on from recurring where id = :'NET';
select not is_subscription as ok_rec7_backfill_elsewhere_off from recurring where id = :'GYM';
select is_subscription as ok_rec7_backfill_own_kept from recurring where id = :'OWN';
select updated_at = :'net_stamp'::timestamptz as ok_rec7_backfill_no_stamp_moved from recurring where id = :'NET';
select count(*) = :'logged_before'::int as ok_rec7_backfill_not_logged from activity where household_id = :'hhid';
-- Run again, nothing is left to set; and every row anywhere follows the rule.
select subscription_follow_category() = 0 as ok_rec7_backfill_idempotent;
select bool_and(r.is_subscription = coalesce(c.seed_key = 'subscriptions', false)) as ok_rec7_every_row_follows_the_category
from recurring r left join categories c on c.id = r.category_id and c.household_id = r.household_id;
-- A phone can't run it.
set role authenticated;
set request.jwt.claim.sub = :'H';
select subscription_follow_category(); -- expect error: the owner's one-off
reset role;
