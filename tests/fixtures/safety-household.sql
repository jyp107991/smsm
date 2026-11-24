-- S9 data-safety drill (ENGINEERING §9; SPEC EXP-1, EXP-2, BAL-1): a realistic household, written the way the two phones
-- write it (signed in as each person, under row-level security, through the RPCs), for tests/unit/data-safety.test.ts.
-- Every split mode; money back linked to an original and money back with none; an original deleted with its money back;
-- a deleted entry and a restored one; an edited one; a trip abroad with places and the other currency; regular payments
-- active, paused, ended (and deleted, S10) and "amount varies" (posted by post_due_recurring); a year of everyday spending (more than one
-- restore call's 500 rows); settle-ups; comments, one deleted; categories of the household's own with emoji, one
-- archived; a closed trip and an open project; change requests approved, declined and pending; the settle day; each
-- person's notification switches; remembered categories and a keep rule. Prints the household's id last.
-- Run with psql -v A=<first person> -v B=<second person> (both already in auth.users).
\set ON_ERROR_STOP 1
set role authenticated;
set request.jwt.claim.sub = :'A';
select create_household() as hid \gset
select set_identity('Jae', 'cat');
select set_monzo_me('jaetest');
select join_code as code from households where id = :'hid' \gset
set request.jwt.claim.sub = :'B';
select join_household(:'code') is not null;
select set_identity('Sam', 'dog');
-- default split 60/40, approved; a pending one for 70/30; an identity change said no to
set request.jwt.claim.sub = :'A';
select request_change('default_ratio', jsonb_build_object('ratio', jsonb_build_object(:'A', 60, :'B', 40))) as rq1 \gset
set request.jwt.claim.sub = :'B';
select decide_change(:'rq1', true);
select request_change('identity', jsonb_build_object('user_id', :'B', 'display_name', 'Sammy', 'animal', 'dog')) as rq2 \gset
set request.jwt.claim.sub = :'A';
select decide_change(:'rq2', false);
select request_change('default_ratio', jsonb_build_object('ratio', jsonb_build_object(:'A', 70, :'B', 30)));
select set_settle_day(15);
select set_notification_prefs(jsonb_build_object('balance', true, 'balance_threshold_pence', 5000)) is not null;
set request.jwt.claim.sub = :'B';
select set_notification_prefs(jsonb_build_object('entries', false, 'bills_tomorrow', true)) is not null;

-- categories: two of the household's own, one archived
set request.jwt.claim.sub = :'A';
insert into categories(household_id, name, emoji, colour, sort) values (:'hid', 'Pets', '🐾', 'moss', 13) returning id as pets \gset
insert into categories(household_id, name, emoji, colour, sort, default_ratio) values (:'hid', 'Wedding', '💍', 'berry', 14, jsonb_build_object(:'A', 50, :'B', 50)) returning id as wedding \gset
update categories set archived = true where id = :'wedding';
select id as groceries from categories where household_id = :'hid' and name = 'Groceries' \gset
select id as eating from categories where household_id = :'hid' and name = 'Eating out' \gset
select id as rent_cat from categories where household_id = :'hid' and name = 'Rent & bills' \gset
select id as household_cat from categories where household_id = :'hid' and name = 'Household' \gset

-- chapters: a closed trip and an open project
insert into chapters(household_id, name, emoji, kind, country, start_date, end_date) values (:'hid', 'Japan', '🗾', 'trip', 'JP', '2026-04-01', '2026-04-10') returning id as japan \gset
insert into chapters(household_id, name, emoji, kind) values (:'hid', 'Kitchen', '🔨', 'project') returning id as kitchen \gset

-- regular payments: active, paused, ended, amount varies, a subscription
insert into recurring(household_id, description, amount_pence, category_id, paid, split_mode, split_params, shares, frequency, every, start_date, active)
values (:'hid', 'Rent', 145000, :'rent_cat', jsonb_build_object(:'A', 145000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 72500, :'B', 72500), 'monthly', 1, '2026-08-01', true) returning id as rent \gset
insert into recurring(household_id, description, amount_pence, paid, split_mode, shares, frequency, every, start_date, active, is_subscription)
values (:'hid', 'Netflix', 1099, jsonb_build_object(:'B', 1099), 'treat', jsonb_build_object(:'B', 1099), 'monthly', 1, '2026-09-05', true, true) returning id as netflix \gset
insert into recurring(household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, every, start_date, end_date, active)
values (:'hid', 'Gym', 4000, jsonb_build_object(:'A', 4000), 'exact', jsonb_build_object(:'A', 2500, :'B', 1500), jsonb_build_object(:'A', 2500, :'B', 1500), 'monthly', 1, '2026-07-10', '2026-09-30', true) returning id as gym \gset
insert into recurring(household_id, description, amount_pence, amount_varies, paid, split_mode, split_params, shares, frequency, every, start_date, active)
values (:'hid', 'Energy', 9000, true, jsonb_build_object(:'B', 9000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 4500, :'B', 4500), 'monthly', 1, '2026-10-03', true) returning id as energy \gset
select post_due_recurring() > 0;
update recurring set active = false where id = :'netflix';
-- S10: the ended gym deleted (soft); its posted entries stay, with their recurring_id.
update recurring set deleted_at = now() where id = :'gym';

-- entries in every split mode
insert into expenses(household_id, description, amount_pence, date, category_id, paid, split_mode, split_params, shares, tags, notes)
values (:'hid', 'Tesco', 4251, '2026-11-02', :'groceries', jsonb_build_object(:'A', 4251), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 2126, :'B', 2125), '{weekly}', 'The big shop') returning id as tesco \gset
insert into expenses(household_id, description, amount_pence, date, paid, split_mode, shares)
values (:'hid', 'Haircut', 3000, '2026-11-03', jsonb_build_object(:'A', 3000), 'for_other', jsonb_build_object(:'A', 0, :'B', 3000)) returning id as haircut \gset
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, description, amount_pence, date, category_id, paid, split_mode, shares, tags)
values (:'hid', 'Dinner', 6000, '2026-11-04', :'eating', jsonb_build_object(:'B', 6000), 'treat', jsonb_build_object(:'B', 6000), '{anniversary,date night}') returning id as dinner \gset
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, date, category_id, chapter_id, paid, split_mode, split_params, shares)
values (:'hid', 'Sofa', 10000, '2026-10-20', :'household_cat', :'kitchen', jsonb_build_object(:'A', 10000), 'exact', jsonb_build_object(:'A', 7000, :'B', 3000), jsonb_build_object(:'A', 7000, :'B', 3000)) returning id as sofa \gset
-- a trip abroad, with places and the other currency
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, description, amount_pence, date, category_id, chapter_id, paid, split_mode, split_params, shares, country, place, lat, lng, original_amount, original_currency, fx_rate)
values (:'hid', 'Ichiran ramen', 1263, '2026-04-02', :'eating', :'japan', jsonb_build_object(:'B', 1263), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 631, :'B', 632), 'JP', 'Shibuya, Tokyo', 35.660, 139.700, 2400, 'JPY', 0.005263) returning id as ramen \gset
insert into expenses(household_id, description, amount_pence, date, chapter_id, paid, split_mode, shares, country, place, lat, lng)
values (:'hid', 'Shinkansen', 15800, '2026-04-05', :'japan', jsonb_build_object(:'B', 15800), 'exact', jsonb_build_object(:'A', 7900, :'B', 7900), 'JP', 'Kyoto Station', 34.985, 135.758) returning id as train \gset
update chapters set closed = true where id = :'japan';
set request.jwt.claim.sub = :'A';
-- money back linked to an original, and money back with none
insert into expenses(household_id, kind, description, amount_pence, date, paid, split_mode, split_params, shares, refund_of)
values (:'hid', 'money_back', 'Sofa refund', 2000, '2026-10-25', jsonb_build_object(:'A', 2000), 'exact', jsonb_build_object(:'A', 1400, :'B', 600), jsonb_build_object(:'A', 1400, :'B', 600), :'sofa') returning id as sofa_back \gset
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, kind, description, amount_pence, date, paid, split_mode, split_params, shares)
values (:'hid', 'money_back', 'Sold the old TV', 5000, '2026-10-28', jsonb_build_object(:'B', 5000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 2500, :'B', 2500)) returning id as tv \gset
-- an original deleted with its money back; an entry deleted; an entry deleted and restored; an edited entry
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, date, paid, split_mode, split_params, shares)
values (:'hid', 'Lamp', 4000, '2026-11-05', jsonb_build_object(:'A', 4000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 2000, :'B', 2000)) returning id as lamp \gset
insert into expenses(household_id, kind, description, amount_pence, date, paid, split_mode, split_params, shares, refund_of)
values (:'hid', 'money_back', 'Lamp refund', 1500, '2026-11-06', jsonb_build_object(:'A', 1500), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 750, :'B', 750), :'lamp') returning id as lamp_back \gset
update expenses set deleted_at = now() where id = :'lamp';
insert into expenses(household_id, description, amount_pence, date, paid, split_mode, shares)
values (:'hid', 'Gum', 100, '2026-11-06', jsonb_build_object(:'A', 100), 'treat', jsonb_build_object(:'A', 100)) returning id as gum \gset
update expenses set deleted_at = now() where id = :'gum';
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, description, amount_pence, date, paid, split_mode, split_params, shares)
values (:'hid', 'Pizza', 2500, '2026-11-07', jsonb_build_object(:'B', 2500), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 1250, :'B', 1250)) returning id as pizza \gset
update expenses set deleted_at = now() where id = :'pizza';
set request.jwt.claim.sub = :'A';
update expenses set deleted_at = null where id = :'pizza';
insert into expenses(household_id, description, amount_pence, date, category_id, paid, split_mode, split_params, shares, tags)
values (:'hid', 'Vet', 3000, '2026-11-08', :'pets', jsonb_build_object(:'A', 3000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 1500, :'B', 1500), '{vet,pets}') returning id as vet \gset
set request.jwt.claim.sub = :'B';
update expenses set amount_pence = 3500, shares = jsonb_build_object(:'A', 1750, :'B', 1750), paid = jsonb_build_object(:'A', 3500), notes = 'Jabs too' where id = :'vet';
-- a year of everyday spending (more than one restore call's 500 rows)
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, date, category_id, paid, split_mode, split_params, shares)
select :'hid', 'Shop ' || i, 1000 + i, ('2025-11-01'::date + (i % 360)), :'groceries',
       jsonb_build_object(case when i % 2 = 0 then :'A' else :'B' end, 1000 + i), 'ratio', jsonb_build_object(:'A', 60, :'B', 40),
       jsonb_build_object(:'A', (1000 + i) - ((1000 + i) * 40 / 100), :'B', (1000 + i) * 40 / 100)
  from generate_series(1, 520) i;
-- settle-ups: by Monzo, one deleted, one with a note
set request.jwt.claim.sub = :'B';
insert into settlements(household_id, from_user, to_user, amount_pence, date, method) values (:'hid', :'B', :'A', 2000, '2026-11-09', 'monzo') returning id as s1 \gset
set request.jwt.claim.sub = :'A';
insert into settlements(household_id, from_user, to_user, amount_pence, date) values (:'hid', :'A', :'B', 500, '2026-11-10') returning id as s2 \gset
update settlements set deleted_at = now() where id = :'s2';
insert into settlements(household_id, from_user, to_user, amount_pence, date, note) values (:'hid', :'B', :'A', 1000, '2026-11-11', 'For the vet') returning id as s3 \gset
-- comments, one deleted
set request.jwt.claim.sub = :'B';
insert into comments(household_id, expense_id, author, body) values (:'hid', :'tesco', :'B', 'Was this the big shop?');
set request.jwt.claim.sub = :'A';
insert into comments(household_id, expense_id, author, body) values (:'hid', :'tesco', :'A', 'Yes, with the party food 🎉') returning id as c2 \gset
insert into comments(household_id, expense_id, author, body) values (:'hid', :'sofa', :'A', 'Typo') returning id as c3 \gset
update comments set deleted_at = now() where id = :'c3';
-- what the household has taught the app, and a keep rule
insert into category_memory(household_id, key, category_id, split_mode, split_params, uses, source) values (:'hid', 'tesco', :'groceries', 'ratio', jsonb_build_object(:'A', 50, :'B', 50), 4, 'user');
insert into import_rules(household_id, match_text, decision, category_id, split_mode) values (:'hid', 'pret', 'keep', :'eating', 'treat');
reset role;
select :'hid' as household;
