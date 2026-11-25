-- S10 fresh review, finding 1 (migration 20261125000100_personal_guards.sql; DECISIONS 25 Nov "S10 review: a regular
-- payment's day is taken only by its own posting or its Inbox bill"). Written before the fix.
-- A regular payment posts each day once (the unique index on recurring_id + occurrence_date, `on conflict do nothing`),
-- so an entry that takes a day first stops the real one from posting. The database now says:
--   * an own (personal) entry exists only as a posting of its owner's own regular payment (or a restored backup): a
--     phone never inserts one, typed or otherwise (SPEC S10 "Out": own one-off entries);
--   * outside the posting and a restore, an entry takes a regular payment's day only from that day's bill in the Inbox,
--     as a shared entry (an Inbox bill is always a shared bill); never by insert, update or an upsert's update;
--   * an Inbox item names a regular payment's day only when the posting made it: a phone never writes one;
--   * the Inbox's Keep, its replay and Undo-then-Keep-again, the posting (a phone's or the nightly job's) and the
--     owner's own edits all still work.
-- Runs last (after personal_test.sql): A and B share a household.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set RENT 'd3200000-0000-4000-8000-000000000001'
\set GYM 'd3200000-0000-4000-8000-000000000002'
\set OWNNOW 'd3200000-0000-4000-8000-000000000003'
\set WATER 'd3200000-0000-4000-8000-000000000004'
\set FLIPW 'd3200000-0000-4000-8000-000000000005'
\set KEEP1 'd3200000-0000-4000-8000-0000000000e1'
\set KEEP2 'd3200000-0000-4000-8000-0000000000e2'
\set HIJ1 'd3200000-0000-4000-8000-0000000000f1'
\set HIJ2 'd3200000-0000-4000-8000-0000000000f2'
\set HIJ3 'd3200000-0000-4000-8000-0000000000f3'
\set HIJ4 'd3200000-0000-4000-8000-0000000000f4'
\set ONEOFF 'd3200000-0000-4000-8000-0000000000f5'
\set FAKEBILL 'd3200000-0000-4000-8000-0000000000f6'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
select (:'uk_today'::date + 1) as tomorrow \gset
select net_pence as net_a0 from member_net where user_id = :'A' \gset

-- B's shared rent (monthly, first due tomorrow) and A's own gym (monthly, first due tomorrow).
set role authenticated;
set request.jwt.claim.sub = :'B';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, start_date)
values (:'RENT', :'hid', 'Slot rent', 120000, jsonb_build_object(:'B', 120000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50),
        jsonb_build_object(:'A', 60000, :'B', 60000), 'monthly', :'tomorrow');
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'GYM', :'hid', 'Slot gym', 4000, jsonb_build_object(:'A', 4000), 'treat', jsonb_build_object(:'A', 4000), 'monthly', :'tomorrow', :'A');

-- ───────── 1a: an own entry is never inserted by a phone (only its own regular payment posts one) ─────────
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id)
values (:'ONEOFF', :'hid', 'Own coffee', 350, :'uk_today', jsonb_build_object(:'A', 350), 'treat', jsonb_build_object(:'A', 350), :'A'); -- expect error: an own one-off entry
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id)
values (:'ONEOFF', :'hid', 'Own coffee', 350, :'uk_today', jsonb_build_object(:'A', 350), 'treat', jsonb_build_object(:'A', 350), :'A')
on conflict (id) do update set description = excluded.description;                            -- expect error: an own one-off entry by upsert
select count(*) = 0 as ok_rec10_no_own_one_off_entry from expenses where id = :'ONEOFF';

-- ───────── 1b: A can't take tomorrow's shared rent with a 1p entry of her own, nor a shared one ─────────
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id, source, recurring_id, occurrence_date)
values (:'HIJ1', :'hid', 'Mine now', 1, :'tomorrow', jsonb_build_object(:'A', 1), 'treat', jsonb_build_object(:'A', 1), :'A', 'recurring', :'RENT', :'tomorrow'); -- expect error: an own entry on the shared rent's day
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, source, recurring_id, occurrence_date)
values (:'HIJ1', :'hid', 'Cheap rent', 1, :'tomorrow', jsonb_build_object(:'A', 1), 'treat', jsonb_build_object(:'A', 1), 'recurring', :'RENT', :'tomorrow'); -- expect error: a shared entry on the rent's day, no bill in the Inbox
select count(*) = 0 as ok_rec12_nobody_took_the_rents_day from expenses where recurring_id = :'RENT';
-- ... nor B A's own gym day, shared or as his own.
set request.jwt.claim.sub = :'B';
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, source, recurring_id, occurrence_date)
values (:'HIJ2', :'hid', 'Gym, shared', 1, :'tomorrow', jsonb_build_object(:'B', 1), 'treat', jsonb_build_object(:'B', 1), 'recurring', :'GYM', :'tomorrow'); -- expect error: a shared entry on A's own payment's day
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id, source, recurring_id, occurrence_date)
values (:'HIJ2', :'hid', 'Gym, mine', 1, :'tomorrow', jsonb_build_object(:'B', 1), 'treat', jsonb_build_object(:'B', 1), :'B', 'recurring', :'GYM', :'tomorrow'); -- expect error: his own entry on A's own payment's day
select count(*) = 0 as ok_rec11_nobody_took_the_gyms_day from expenses where recurring_id = :'GYM';

-- ───────── 1b: the same by update, and by an upsert's update ─────────
-- A shared entry of B's, and an own entry of A's posted by the database (her own payment, due today).
insert into expenses(id, household_id, description, amount_pence, date, paid, shares)
values (:'HIJ3', :'hid', 'Takeaway', 2400, :'uk_today', jsonb_build_object(:'B', 2400), jsonb_build_object(:'A', 1200, :'B', 1200));
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'OWNNOW', :'hid', 'Own swim', 600, jsonb_build_object(:'A', 600), 'treat', jsonb_build_object(:'A', 600), 'weekly', :'uk_today', :'A');
-- Her phone posts what is due (the posting post_due_recurring does, for this one alone): her own entry, today.
select recurring_post_due_one(:'OWNNOW') = 1 as ok_rec10_a_phone_still_posts_her_own;
select id as own_entry from expenses where recurring_id = :'OWNNOW' and occurrence_date = :'uk_today' \gset
select owner_id = :'A' as ok_rec10_the_posting_made_it_hers from expenses where id = :'own_entry';
update expenses set occurrence_date = :'tomorrow', date = :'tomorrow' where id = :'own_entry';    -- expect error: her own entry moved onto another day
update expenses set recurring_id = :'RENT', occurrence_date = :'tomorrow' where id = :'own_entry'; -- expect error: her own entry onto the shared rent's day
update expenses set recurring_id = :'GYM', occurrence_date = :'tomorrow', source = 'recurring' where id = :'HIJ3'; -- expect error: a shared entry onto her own gym's day
update expenses set recurring_id = :'RENT', occurrence_date = :'tomorrow', source = 'recurring' where id = :'HIJ3'; -- expect error: a shared entry onto the rent's day
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'HIJ3', :'hid', 'Takeaway', 2400, :'uk_today', jsonb_build_object(:'B', 2400), jsonb_build_object(:'A', 1200, :'B', 1200), 'recurring', :'RENT', :'tomorrow')
on conflict (id) do update set recurring_id = excluded.recurring_id, occurrence_date = excluded.occurrence_date; -- expect error: the rent's day by an upsert's update
select recurring_id is null and occurrence_date is null as ok_rec12_the_shared_entry_took_no_day from expenses where id = :'HIJ3';
select recurring_id = :'OWNNOW' and occurrence_date = :'uk_today' as ok_rec12_her_entry_kept_its_day from expenses where id = :'own_entry';
-- Her own edit of her own entry, by the phone's upsert (the id is there: an update, checked as one), still saves.
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id, source, recurring_id, occurrence_date)
values (:'own_entry', :'hid', 'Own swim, lanes', 600, :'uk_today', jsonb_build_object(:'A', 600), 'treat', jsonb_build_object(:'A', 600), :'A', 'recurring', :'OWNNOW', :'uk_today')
on conflict (id) do update set description = excluded.description
returning description = 'Own swim, lanes' as ok_rec10_owner_edits_her_own_by_upsert;
with u as (update expenses set notes = 'lanes' where id = :'own_entry' returning 1) select count(*) = 1 as ok_rec10_owner_edits_her_own_by_update from u;

-- ───────── 1b: an Inbox item names a regular payment's day only when the posting made it ─────────
insert into inbox_items(id, household_id, source, recurring_id, occurrence_date, payload)
values (:'FAKEBILL', :'hid', 'bill', :'RENT', :'tomorrow', '{}'::jsonb);                       -- expect error: a phone's own "bill" for the rent's day
insert into inbox_items(id, household_id, source, payload) values (:'FAKEBILL', :'hid', 'scan', '{}'::jsonb)
returning recurring_id is null as ok_inb2_a_receipt_to_sort_still_goes_in;
update inbox_items set recurring_id = :'RENT', occurrence_date = :'tomorrow' where id = :'FAKEBILL'; -- expect error: a receipt made into the rent's bill
select count(*) = 0 as ok_inb2_no_bill_for_the_rents_day from inbox_items where recurring_id = :'RENT';

-- ───────── the rent and the gym still post tomorrow, each as it is ─────────
-- (Moved to today by the database owner, checks off, so "tomorrow" is due now; then the nightly job's own posting.)
reset role;
set request.jwt.claim.sub = '';
alter table recurring disable trigger user;
update recurring set start_date = :'uk_today' where id in (:'RENT', :'GYM');
alter table recurring enable trigger user;
select recurring_post_due_one(:'RENT') = 1 and recurring_post_due_one(:'GYM') = 1 as ok_rec2_the_job_posts_them;
update recurring set posted_count = 1 where id in (:'RENT', :'GYM');
select count(*) = 1 and bool_and(owner_id is null and amount_pence = 120000 and shares = jsonb_build_object(:'A', 60000, :'B', 60000))
   as ok_rec12_the_shared_rent_posted_whole from expenses where recurring_id = :'RENT';
select count(*) = 1 and bool_and(owner_id = :'A' and amount_pence = 4000)
   as ok_rec10_her_gym_posted_as_hers from expenses where recurring_id = :'GYM';

-- ───────── INB-2: Keep still works: a shared bill, its replay, Undo and Keep again ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, amount_varies, paid, split_mode, split_params, shares, frequency, start_date)
values (:'WATER', :'hid', 'Slot water', 3000, true, jsonb_build_object(:'A', 3000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50),
        jsonb_build_object(:'A', 1500, :'B', 1500), 'weekly', :'uk_today'::date - 7);
select recurring_post_due_one(:'WATER') = 2 as ok_rec3_the_posting_puts_bills_in_the_inbox;
select id as water_item, occurrence_date as water_day from inbox_items where recurring_id = :'WATER' order by occurrence_date limit 1 \gset
select id as water_item2, occurrence_date as water_day2 from inbox_items where recurring_id = :'WATER' order by occurrence_date desc limit 1 \gset
select :'water_day' <> :'water_day2' as ok_rec3_two_bills_waiting;
set request.jwt.claim.sub = :'B';
-- Kept as an own entry: refused (an Inbox bill is shared, and a phone never adds an own entry).
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id, source, recurring_id, occurrence_date)
values (:'KEEP1', :'hid', 'Slot water', 2874, :'water_day', jsonb_build_object(:'B', 2874), 'treat', jsonb_build_object(:'B', 2874), :'B', 'recurring', :'WATER', :'water_day'); -- expect error: an Inbox bill kept as his own
-- Kept shared (as the phone sends it: an upsert), then the same write again (a replay): one entry.
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'KEEP1', :'hid', 'Slot water', 2874, :'water_day', jsonb_build_object(:'B', 2874), jsonb_build_object(:'A', 1437, :'B', 1437), 'recurring', :'WATER', :'water_day')
on conflict (id) do update set amount_pence = excluded.amount_pence
returning recurring_id = :'WATER' as ok_inb2_keep_saves_the_bill;
update inbox_items set status = 'kept', expense_id = :'KEEP1' where id = :'water_item';
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'KEEP1', :'hid', 'Slot water', 2874, :'water_day', jsonb_build_object(:'B', 2874), jsonb_build_object(:'A', 1437, :'B', 1437), 'recurring', :'WATER', :'water_day')
on conflict (id) do update set amount_pence = excluded.amount_pence
returning recurring_id = :'WATER' as ok_inb2_a_replayed_keep_still_saves;
-- Undo (the entry deleted, the bill open again), then Keep again: the same entry comes back.
update expenses set deleted_at = now() where id = :'KEEP1';
update inbox_items set status = 'open' where id = :'water_item';
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'KEEP1', :'hid', 'Slot water', 2900, :'water_day', jsonb_build_object(:'B', 2900), jsonb_build_object(:'A', 1450, :'B', 1450), 'recurring', :'WATER', :'water_day')
on conflict (id) do update set amount_pence = excluded.amount_pence, paid = excluded.paid, shares = excluded.shares
returning amount_pence = 2900 as ok_inb2_keep_again_after_undo;
with u as (update expenses set deleted_at = null where id = :'KEEP1' returning 1) select count(*) = 1 as ok_inb2_kept_entry_back from u;
update inbox_items set status = 'kept', expense_id = :'KEEP1' where id = :'water_item';
-- A day with no bill in the Inbox (next week's) can't be kept.
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'HIJ4', :'hid', 'Slot water', 100, :'uk_today'::date + 7, jsonb_build_object(:'B', 100), jsonb_build_object(:'A', 50, :'B', 50), 'recurring', :'WATER', :'uk_today'::date + 7); -- expect error: no bill for that day
-- The other bill, kept by plain insert, still saves.
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'KEEP2', :'hid', 'Slot water', 3100, :'water_day2', jsonb_build_object(:'B', 3100), jsonb_build_object(:'A', 1550, :'B', 1550), 'recurring', :'WATER', :'water_day2')
returning owner_id is null as ok_inb2_the_second_bill_keeps;

-- ───────── INB-2 REC-11: a varying shared bill made someone's own: the bill already due is still kept, shared ─────────
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, amount_varies, paid, split_mode, split_params, shares, frequency, start_date)
values (:'FLIPW', :'hid', 'Slot energy', 5000, true, jsonb_build_object(:'A', 5000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50),
        jsonb_build_object(:'A', 2500, :'B', 2500), 'monthly', :'uk_today');
update recurring set amount_varies = false, owner_id = :'A', split_mode = 'treat', split_params = null, shares = jsonb_build_object(:'A', 5000)
 where id = :'FLIPW' returning owner_id = :'A' as ok_rec11_made_hers;
select count(*) = 1 as ok_rec11_the_day_due_went_to_the_inbox_first from inbox_items where recurring_id = :'FLIPW' and occurrence_date = :'uk_today';
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (:'hid', 'Slot energy', 5320, :'uk_today', jsonb_build_object(:'B', 5320), jsonb_build_object(:'A', 2660, :'B', 2660), 'recurring', :'FLIPW', :'uk_today')
returning owner_id is null as ok_inb2_a_bill_due_while_shared_keeps_shared;

-- ───────── the balance: only the shared bills moved it ─────────
reset role;
set request.jwt.claim.sub = '';
-- Rent (A owes 60000), takeaway (A owes 1200), water kept twice (A owes 1450 + 1550), energy (A owes 2660).
select net_pence = :net_a0 - 60000 - 1200 - 1450 - 1550 - 2660 as ok_bal1_only_shared_entries_moved_the_balance from member_net where user_id = :'A';

-- ───────── tidy: nothing here posts again ─────────
update recurring set active = false where id in (:'RENT', :'GYM', :'OWNNOW', :'WATER', :'FLIPW');
