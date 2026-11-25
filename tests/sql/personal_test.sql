-- S10 personal regular payments (owner, 25 Nov; DECISIONS 25 Nov "Personal regular payments"; SPEC REC-9…REC-12).
-- Written before the build. The database is the authority:
--   * recurring.owner_id / expenses.owner_id: null = shared; a member = that person's own (REC-9);
--   * both members read a personal row; only its owner writes it (row-level security; the partner's write is refused);
--   * a personal row is all its owner's (paid and shares the whole amount), an expense in no chapter, never money back
--     and never refunded; a personal template has a fixed amount;
--   * what a personal template posts is a personal entry, and no notification is queued for it (REC-10, REC-12);
--   * member_net and member_net_on never count a personal entry (BAL-1, REC-12);
--   * whose a template is changes from the next payment on: what is already due posts as it was first, an entry's owner
--     never changes, only you make a template yours, only its owner makes it shared again, never handed over (REC-11);
--   * comments are for shared entries; restore_backup keeps whose each row was (people mapped).
-- Runs after schema_test.sql (A and B share a household) and import_export_test.sql (F and G share another).
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set F '77777777-7777-7777-7777-777777777777'
\set G '88888888-8888-8888-8888-888888888888'
\set GYM 'd3100000-0000-4000-8000-000000000001'
\set PHONE 'd3100000-0000-4000-8000-000000000002'
\set FLIP 'd3100000-0000-4000-8000-000000000003'
\set BAD 'd3100000-0000-4000-8000-000000000004'
\set STRAY 'd3100000-0000-4000-8000-000000000005'
\set SHAREDX 'd3100000-0000-4000-8000-000000000006'
\set TOMORROW 'd3100000-0000-4000-8000-000000000007'
\set TOMSHARED 'd3100000-0000-4000-8000-000000000008'
\set POSTEDP 'd3100000-0000-4000-8000-000000000009'
\set POSTEDS 'd3100000-0000-4000-8000-00000000000a'
\set X1 'd3100000-0000-4000-8000-0000000000a1'
\set X2 'd3100000-0000-4000-8000-0000000000a2'
\set BR1 'd3100000-0000-4000-8000-0000000000b1'
\set BE1 'd3100000-0000-4000-8000-0000000000b2'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select household_id as fhid from members where user_id = :'F' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset

-- ───────── REC-9: the columns ─────────
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring'
               and column_name = 'owner_id' and data_type = 'uuid' and is_nullable = 'YES')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'expenses'
               and column_name = 'owner_id' and data_type = 'uuid' and is_nullable = 'YES')
   as ok_rec9_owner_columns_nullable;
select count(*) = 0 as ok_rec9_existing_rows_stay_shared from recurring where owner_id is not null;
select net_pence as net_a0 from member_net where user_id = :'A' \gset

-- ───────── REC-9: A adds her own gym; only she may write it ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, start_date, owner_id, is_subscription)
values (:'GYM', :'hid', 'Own gym', 3500, jsonb_build_object(:'A', 3500), 'treat', null, jsonb_build_object(:'A', 3500), 'monthly',
        (:'uk_today'::date - interval '2 months')::date, :'A', true)
returning owner_id = :'A' as ok_rec9_owner_adds_her_own;
-- The shape: all the owner's, by a person, a fixed amount.
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, start_date, owner_id)
values (:'BAD', :'hid', 'Half mine', 3000, jsonb_build_object(:'A', 3000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50),
        jsonb_build_object(:'A', 1500, :'B', 1500), 'monthly', :'uk_today', :'A');                -- expect error: a personal payment's shares are all the owner's
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'BAD', :'hid', 'Paid by B', 3000, jsonb_build_object(:'B', 3000), 'treat', jsonb_build_object(:'B', 3000), 'monthly', :'uk_today', :'A'); -- expect error: paid by someone else
insert into recurring(id, household_id, description, amount_pence, amount_varies, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'BAD', :'hid', 'Own energy', 3000, true, jsonb_build_object(:'A', 3000), 'treat', jsonb_build_object(:'A', 3000), 'monthly', :'uk_today', :'A'); -- expect error: a personal one has a fixed amount
-- B can't add one for A, or one for someone outside the household.
set request.jwt.claim.sub = :'B';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'BAD', :'hid', 'For A', 3000, jsonb_build_object(:'A', 3000), 'treat', jsonb_build_object(:'A', 3000), 'monthly', :'uk_today', :'A'); -- expect error: only the owner adds her own
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'BAD', :'hid', 'Stranger', 3000, jsonb_build_object(:'B', 3000), 'treat', jsonb_build_object(:'B', 3000), 'monthly', :'uk_today', :'F'); -- expect error: not her own
select count(*) = 0 as ok_rec9_refused_adds_added_nothing from recurring where id = :'BAD';
-- B reads it (both of you can see them) ...
select count(*) = 1 as ok_rec9_partner_reads_it from recurring where id = :'GYM' and owner_id = :'A';
-- ... but never writes it: an update finds nothing to change, an upsert is refused.
with u as (update recurring set description = 'B renamed it' where id = :'GYM' returning 1) select count(*) = 0 as ok_rec9_partner_update_changes_nothing from u;
with u as (update recurring set active = false where id = :'GYM' returning 1) select count(*) = 0 as ok_rec9_partner_cant_pause_it from u;
with u as (update recurring set end_date = :'uk_today' where id = :'GYM' returning 1) select count(*) = 0 as ok_rec9_partner_cant_end_it from u;
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, owner_id)
values (:'GYM', :'hid', 'B took it', 3500, jsonb_build_object(:'B', 3500), 'treat', jsonb_build_object(:'B', 3500), 'monthly', :'uk_today', :'B')
on conflict (id) do update set description = excluded.description;                            -- expect error: the partner's upsert of a personal template
select description = 'Own gym' and active and end_date is null as ok_rec9_partners_writes_changed_nothing from recurring where id = :'GYM';
-- A can pause, resume and end her own.
set request.jwt.claim.sub = :'A';
with u as (update recurring set active = false where id = :'GYM' returning 1) select count(*) = 1 as ok_rec9_owner_pauses_her_own from u;
with u as (update recurring set active = true where id = :'GYM' returning 1) select count(*) = 1 as ok_rec9_owner_resumes_her_own from u;

-- ───────── REC-10: posting makes the owner's own entries ─────────
reset role;
set request.jwt.claim.sub = '';
-- (Resuming skipped what fell due while paused; start it again from scratch so its months post. This template alone:
-- the nightly job's own posting, recurring_post_due_one, so nothing else in the household moves.)
update recurring set posted_count = 0 where id = :'GYM';
select recurring_post_due_one(:'GYM') as gym_n \gset
update recurring set posted_count = :gym_n where id = :'GYM';
select :gym_n >= 3 as ok_rec10_nightly_job_runs;
select count(*) >= 2 as ok_rec10_personal_entries_posted from expenses where recurring_id = :'GYM';
select bool_and(owner_id = :'A' and split_mode = 'treat' and paid = jsonb_build_object(:'A', 3500) and shares = jsonb_build_object(:'A', 3500)
                and kind = 'expense' and chapter_id is null and source = 'recurring')
   as ok_rec10_posted_entries_are_hers_whole from expenses where recurring_id = :'GYM';
select count(*) = 0 as ok_rec10_no_notification_for_a_personal_bill
from notification_outbox o join expenses e on e.id = o.ref_id where e.recurring_id = :'GYM';
select net_pence = :net_a0 as ok_bal1_balance_unchanged_by_personal_entries from member_net where user_id = :'A';
select id as gym_entry from expenses where recurring_id = :'GYM' order by date limit 1 \gset

-- ───────── REC-12: never in the balance, even a row shaped wrongly (the view filters by whose, not by luck) ─────────
-- With the checks off (the database owner), a personal row that would move the balance if it were counted.
alter table expenses disable trigger user;
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id)
values (:'STRAY', :'hid', 'Stray personal', 9900, :'uk_today', jsonb_build_object(:'A', 9900), 'for_other', jsonb_build_object(:'B', 9900), :'A');
alter table expenses enable trigger user;
select net_pence = :net_a0 as ok_rec12_member_net_leaves_out_personal_entries from member_net where user_id = :'A';
select member_net_on(:'hid', :'A', :'uk_today') = (select net_pence from member_net where user_id = :'A')
   as ok_rec12_member_net_on_leaves_them_out_too;
-- The same row shared would count (control).
alter table expenses disable trigger user;
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares)
values (:'SHAREDX', :'hid', 'Shared control', 9900, :'uk_today', jsonb_build_object(:'A', 9900), 'for_other', jsonb_build_object(:'B', 9900));
alter table expenses enable trigger user;
select net_pence = :net_a0 + 9900 as ok_rec12_a_shared_row_counts from member_net where user_id = :'A';
alter table expenses disable trigger user;
update expenses set deleted_at = now() where id in (:'STRAY', :'SHAREDX');
alter table expenses enable trigger user;
select net_pence = :net_a0 as ok_rec12_back_to_before from member_net where user_id = :'A';

-- ───────── REC-10: the entries are the owner's to change; never the partner's; never someone else's ─────────
set role authenticated;
set request.jwt.claim.sub = :'B';
with u as (update expenses set deleted_at = now() where id = :'gym_entry' returning 1) select count(*) = 0 as ok_rec10_partner_cant_delete_her_entry from u;
with u as (update expenses set amount_pence = 100, paid = jsonb_build_object(:'A', 100), shares = jsonb_build_object(:'A', 100) where id = :'gym_entry' returning 1)
  select count(*) = 0 as ok_rec10_partner_cant_edit_her_entry from u;
insert into expenses(household_id, description, amount_pence, date, paid, split_mode, shares, owner_id)
values (:'hid', 'B adds for A', 500, :'uk_today', jsonb_build_object(:'A', 500), 'treat', jsonb_build_object(:'A', 500), :'A'); -- expect error: only the owner adds her own
set request.jwt.claim.sub = :'A';
with u as (update expenses set amount_pence = 3600, paid = jsonb_build_object(:'A', 3600), shares = jsonb_build_object(:'A', 3600) where id = :'gym_entry' returning 1)
  select count(*) = 1 as ok_rec10_owner_edits_her_entry from u;
update expenses set paid = jsonb_build_object(:'B', 3600), shares = jsonb_build_object(:'A', 3600) where id = :'gym_entry'; -- expect error: still all hers
update expenses set split_mode = 'ratio', split_params = jsonb_build_object(:'A', 50, :'B', 50), shares = jsonb_build_object(:'A', 1800, :'B', 1800) where id = :'gym_entry'; -- expect error: never split
update expenses set owner_id = null where id = :'gym_entry';                                    -- expect error: whose an entry is never changes
insert into chapters(household_id, name, kind) values (:'hid', 'Own trip', 'trip') returning id as own_trip \gset
update expenses set chapter_id = :'own_trip' where id = :'gym_entry';                          -- expect error: never in a chapter
select id as some_shared from expenses where household_id = :'hid' and owner_id is null and deleted_at is null and kind = 'expense' and recurring_id is null order by created_at limit 1 \gset
update expenses set owner_id = :'A' where id = :'some_shared';                                  -- expect error: a shared entry never becomes someone's
select owner_id is null as ok_rec11_shared_entry_stayed_shared from expenses where id = :'some_shared';
-- Money back is never for a personal entry; comments are for shared entries.
insert into expenses(household_id, kind, description, amount_pence, date, paid, split_mode, shares, refund_of)
values (:'hid', 'money_back', 'Gym refund', 1000, :'uk_today', jsonb_build_object(:'A', 1000), 'treat', jsonb_build_object(:'A', 1000), :'gym_entry'); -- expect error: money back for a personal entry
insert into expenses(household_id, kind, description, amount_pence, date, paid, split_mode, shares, owner_id)
values (:'hid', 'money_back', 'Own refund', 1000, :'uk_today', jsonb_build_object(:'A', 1000), 'treat', jsonb_build_object(:'A', 1000), :'A'); -- expect error: a personal entry is an expense
insert into comments(household_id, expense_id, author, body) values (:'hid', :'gym_entry', :'A', 'note to self'); -- expect error: comments are for shared entries
-- A soft-deletes her own entry; it is still never in the balance.
with u as (update expenses set deleted_at = now() where id = :'gym_entry' returning 1) select count(*) = 1 as ok_rec10_owner_deletes_her_entry from u;
with u as (update expenses set deleted_at = null where id = :'gym_entry' returning 1) select count(*) = 1 as ok_rec10_owner_restores_her_entry from u;
reset role;
-- Her own edit, delete and restore are never a notification.
select count(*) = 0 as ok_rec12_no_notification_for_her_own_edit_delete_or_restore from notification_outbox where ref_id = :'gym_entry';
select net_pence = :net_a0 as ok_bal1_balance_still_unchanged from member_net where user_id = :'A';

-- ───────── REC-11: shared → hers → shared, from the next payment on ─────────
-- A shared weekly bill from 3 weeks ago, nothing posted yet (added offline, say): 3 or 4 days are due.
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, start_date)
values (:'FLIP', :'hid', 'Flip cleaner', 2000, jsonb_build_object(:'A', 2000), 'ratio', jsonb_build_object(:'A', 50, :'B', 50),
        jsonb_build_object(:'A', 1000, :'B', 1000), 'weekly', :'uk_today'::date - 21);
-- B can't make it A's (nor his own on A's behalf: only "mine").
set request.jwt.claim.sub = :'B';
update recurring set owner_id = :'A', split_mode = 'treat', split_params = null, shares = jsonb_build_object(:'A', 2000) where id = :'FLIP'; -- expect error: only you make it yours
-- A makes it hers: the days already due post first, shared, as they were; then nothing more is due.
set request.jwt.claim.sub = :'A';
update recurring set owner_id = :'A', split_mode = 'treat', split_params = null, shares = jsonb_build_object(:'A', 2000) where id = :'FLIP'
returning owner_id = :'A' as ok_rec11_owner_makes_it_hers;
reset role;
select count(*) = 4 and bool_and(owner_id is null and shares = jsonb_build_object(:'A', 1000, :'B', 1000))
   as ok_rec11_what_was_due_posted_shared_first from expenses where recurring_id = :'FLIP';
select posted_count = 4 as ok_rec11_counted_from_there from recurring where id = :'FLIP';
select count(*) = 1 as ok_rec11_history_line_for_whose
from activity where entity = 'recurring' and entity_id = :'FLIP' and action = 'edited' and actor = :'A'
  and summary -> 'owner_id' = jsonb_build_object('before', null, 'after', :'A');
-- The next one posts as hers (moved 10 days earlier by the database owner, checks off, so one more is due now).
alter table recurring disable trigger user;
update recurring set start_date = start_date - 10 where id = :'FLIP';
alter table recurring enable trigger user;
select recurring_post_due_one(:'FLIP') = 5 as ok_rec11_job_runs_again;
update recurring set posted_count = 5 where id = :'FLIP';
select count(*) = 1 and bool_and(owner_id = :'A' and shares = jsonb_build_object(:'A', 2000))
   as ok_rec11_next_posts_as_hers from expenses where recurring_id = :'FLIP' and owner_id is not null;
select count(*) = 4 as ok_rec11_past_entries_unchanged from expenses where recurring_id = :'FLIP' and owner_id is null;
-- Never handed over; only she hands it back to shared.
set role authenticated;
set request.jwt.claim.sub = :'A';
update recurring set owner_id = :'B', paid = jsonb_build_object(:'B', 2000), shares = jsonb_build_object(:'B', 2000) where id = :'FLIP'; -- expect error: never handed to the other person
set request.jwt.claim.sub = :'B';
with u as (update recurring set owner_id = null, split_mode = 'ratio', split_params = jsonb_build_object(:'A', 50, :'B', 50),
                                shares = jsonb_build_object(:'A', 1000, :'B', 1000) where id = :'FLIP' returning 1)
  select count(*) = 0 as ok_rec11_partner_cant_make_hers_shared from u;
set request.jwt.claim.sub = :'A';
update recurring set owner_id = null, split_mode = 'ratio', split_params = jsonb_build_object(:'A', 50, :'B', 50),
       shares = jsonb_build_object(:'A', 1000, :'B', 1000) where id = :'FLIP'
returning owner_id is null as ok_rec11_owner_makes_it_shared_again;
reset role;
select count(*) = 1 as ok_rec11_history_line_back_to_shared
from activity where entity = 'recurring' and entity_id = :'FLIP' and action = 'edited' and actor = :'A'
  and summary -> 'owner_id' = jsonb_build_object('before', :'A', 'after', null);
select count(*) = 1 as ok_rec11_her_entry_stays_hers from expenses where recurring_id = :'FLIP' and owner_id = :'A';
select net_pence = :net_a0 + 4 * 1000 as ok_rec11_only_the_shared_days_moved_the_balance from member_net where user_id = :'A';

-- ───────── REC-12: the daily job never tells anyone about a personal bill ─────────
-- (A day of its own in 2024, 08:30 London; one shared and one personal of each kind.)
insert into recurring(id, household_id, description, amount_pence, paid, split_mode, shares, frequency, start_date, posted_count, ever_posted, owner_id)
values (:'TOMORROW', :'hid', 'Own magazine', 500, jsonb_build_object(:'A', 500), 'treat', jsonb_build_object(:'A', 500), 'monthly', '2024-03-06', 0, false, :'A'),
       (:'TOMSHARED', :'hid', 'Shared magazine', 500, jsonb_build_object(:'A', 500), 'treat', jsonb_build_object(:'A', 500), 'monthly', '2024-03-06', 0, false, null);
alter table expenses disable trigger user;
insert into expenses(id, household_id, description, amount_pence, date, paid, split_mode, shares, owner_id, recurring_id, occurrence_date, source)
values (:'POSTEDP', :'hid', 'Own bill today', 700, '2024-03-05', jsonb_build_object(:'A', 700), 'treat', jsonb_build_object(:'A', 700), :'A', :'TOMORROW', '2024-03-05', 'recurring'),
       (:'POSTEDS', :'hid', 'Shared bill today', 700, '2024-03-05', jsonb_build_object(:'A', 700), 'treat', jsonb_build_object(:'A', 700), null, :'TOMSHARED', '2024-03-05', 'recurring');
alter table expenses enable trigger user;
select queue_daily_notifications('2024-03-05 08:30:00 Europe/London'::timestamptz) >= 0 as ok_rec12_daily_job_runs;
select count(*) = 0 as ok_rec12_no_bill_tomorrow_for_a_personal_bill from notification_outbox where kind = 'bill_tomorrow' and ref_id = :'TOMORROW';
select count(*) = 2 as ok_rec12_shared_bill_tomorrow_still_told from notification_outbox where kind = 'bill_tomorrow' and ref_id = :'TOMSHARED';
select count(*) = 0 as ok_rec12_no_bill_posted_for_a_personal_bill from notification_outbox where kind = 'bill_posted' and ref_id = :'POSTEDP';
select count(*) = 2 as ok_rec12_shared_bill_posted_still_told from notification_outbox where kind = 'bill_posted' and ref_id = :'POSTEDS';
update recurring set active = false where id in (:'TOMORROW', :'TOMSHARED');
delete from notification_outbox where ref_id in (:'TOMORROW', :'TOMSHARED', :'POSTEDP', :'POSTEDS');

-- ───────── REC-9: a restored backup keeps whose each row was (people mapped) ─────────
select jsonb_build_object(
  'recurring', jsonb_build_array(jsonb_build_object('id', :'BR1', 'household_id', :'X1', 'description', 'Own phone', 'amount_pence', 1200,
     'paid', jsonb_build_object(:'X2', 1200), 'split_mode', 'treat', 'shares', jsonb_build_object(:'X2', 1200), 'frequency', 'monthly', 'every', 1,
     'start_date', '2025-01-03', 'posted_count', 1, 'active', true, 'owner_id', :'X2')),
  'expenses', jsonb_build_array(jsonb_build_object('id', :'BE1', 'household_id', :'X1', 'kind', 'expense', 'description', 'Own phone', 'amount_pence', 1200,
     'date', '2025-01-03', 'paid', jsonb_build_object(:'X2', 1200), 'split_mode', 'treat', 'shares', jsonb_build_object(:'X2', 1200), 'country', 'GB',
     'recurring_id', :'BR1', 'occurrence_date', '2025-01-03', 'source', 'recurring', 'owner_id', :'X2', 'created_by', :'X2'))
)::text as pbackup \gset
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(jsonb_build_object(:'X1', :'F', :'X2', :'G'), :'pbackup'::jsonb) -> 'added' = jsonb_build_object(
  'categories', 0, 'chapters', 0, 'recurring', 1, 'expenses', 1, 'settlements', 0, 'comments', 0, 'category_memory', 0, 'import_rules', 0)
  as ok_rec9_restore_adds_the_personal_rows;
reset role;
select count(*) = 1 as ok_rec9_restored_template_is_still_theirs from recurring where household_id = :'fhid' and description = 'Own phone' and owner_id = :'G'
  and shares = jsonb_build_object(:'G', 1200);
select count(*) = 1 as ok_rec9_restored_entry_is_still_theirs from expenses where household_id = :'fhid' and description = 'Own phone' and owner_id = :'G'
  and paid = jsonb_build_object(:'G', 1200);

-- ───────── tidy: nothing here posts again for later files ─────────
update recurring set active = false where id in (:'GYM', :'FLIP');
select not has_table_privilege('authenticated', 'public.recurring', 'DELETE')
   and not has_table_privilege('authenticated', 'public.expenses', 'DELETE') as ok_rec9_still_no_hard_deletes;
