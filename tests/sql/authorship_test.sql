-- Checks for migration 20261117000200_authorship: who made a row comes from the sign-in, not the phone.
-- Runs after schema_test.sql (A and B share a household).
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
reset role;
set role authenticated;
set request.jwt.claim.sub = :'A';

-- A forged creator is overwritten with the person signed in.
insert into expenses(household_id, description, amount_pence, paid, shares, created_by, updated_by)
values (my_household(), 'Forged shop', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'B', :'B')
returning id as forged \gset
select created_by = :'A' and updated_by = :'A' as ok_forged_expense_creator_overwritten from expenses where id = :'forged';
-- What the new app sends: no created_by at all.
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Plain shop', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500))
returning id as plain \gset
select created_by = :'A' as ok_creator_defaults_to_signed_in from expenses where id = :'plain';
insert into settlements(household_id, from_user, to_user, amount_pence, created_by)
values (my_household(), :'A', :'B', 100, :'B') returning id as st \gset
select created_by = :'A' as ok_forged_settlement_creator_overwritten from settlements where id = :'st';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, created_by)
values (my_household(), 'Forged sub', 999, jsonb_build_object(:'A', 999), jsonb_build_object(:'A', 500, :'B', 499), 'monthly', current_date + 400, :'B')
returning id as rec \gset
select created_by = :'A' as ok_forged_recurring_creator_overwritten from recurring where id = :'rec';
insert into chapters(household_id, name, created_by) values (my_household(), 'Forged trip', :'B') returning id as chap \gset
select created_by = :'A' as ok_forged_chapter_creator_overwritten from chapters where id = :'chap';
insert into inbox_items(household_id, source, created_by) values (my_household(), 'share', :'B') returning id as inb \gset
select created_by = :'A' as ok_forged_inbox_creator_overwritten from inbox_items where id = :'inb';

-- An edit can't change who made a row; the person editing is recorded.
update expenses set created_by = :'B' where id = :'plain';
select created_by = :'A' as ok_creator_kept_on_own_edit from expenses where id = :'plain';
set request.jwt.claim.sub = :'B';
update expenses set description = 'Plain shop (renamed)', updated_by = :'A' where id = :'plain';
select created_by = :'A' and updated_by = :'B' as ok_partner_edit_keeps_creator_records_editor from expenses where id = :'plain';
update settlements set created_by = :'B' where id = :'st';
select created_by = :'A' as ok_settlement_creator_kept from settlements where id = :'st';

-- The nightly job (no sign-in) still posts, and what it writes is kept.
reset role;
set request.jwt.claim.sub = '';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, created_by)
select household_id, 'Nightly bill', 2000, jsonb_build_object(:'A', 2000), jsonb_build_object(:'A', 1000, :'B', 1000), 'monthly', current_date, :'B'
from members where user_id = :'A';
select created_by = :'B' as ok_job_keeps_what_it_writes from recurring where description = 'Nightly bill';
select post_due_recurring((select household_id from members where user_id = :'A')) >= 1 as ok_nightly_job_posts;
select count(*) = 1 and bool_and(created_by is null) as ok_nightly_post_has_no_person from expenses where description = 'Nightly bill';
