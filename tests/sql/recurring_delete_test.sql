-- S10 (owner: "can you add deleting paused or ended regular payments?"; DECISIONS 24 Nov "Deleting a regular
-- payment"). Delete is a soft delete: deleted_at is set through the app's own write (PostgREST's update of that column
-- alone), logged like an entry's, and Undo clears it. The database is the authority (recurring_guard):
--   * a deleted template is never running: deleting one that is active and not ended (its end after today) is
--     refused, and so is resuming a deleted one or moving its end after today;
--   * deleting and restoring change deleted_at alone (Undo brings back exactly what was deleted; a restore can't
--     resume it in the same write);
--   * a deleted template never posts (post_due_recurring); what it posted stays, with its recurring_id, in the balance;
--   * members only (row-level security), and still no hard DELETE.
-- Runs after schema_test.sql (A and B share a household). E is a person with a household of their own.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set E 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee010'
\set GYM 'd1000000-0000-4000-8000-000000000001'
\set WINDOW 'd1000000-0000-4000-8000-000000000002'
\set TODAYS 'd1000000-0000-4000-8000-000000000003'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
insert into auth.users values (:'E') on conflict do nothing;
select not has_table_privilege('authenticated', 'public.recurring', 'DELETE') as ok_s10_delete_still_not_granted;
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recurring'
               and column_name = 'deleted_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES')
   as ok_s10_recurring_has_deleted_at;

-- A monthly gym from 3 months ago, posted up to date by the nightly job.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date) values
  (:'GYM', :'hid', 'Delete gym', 3000, jsonb_build_object(:'A', 3000), jsonb_build_object(:'A', 1500, :'B', 1500),
   'monthly', (:'uk_today'::date - interval '3 months')::date);
select post_due_recurring_all() >= 0 as ok_s10_gym_posted;
select count(*) as gym_posted, md5(string_agg(to_jsonb(e)::text, ',' order by e.occurrence_date)) as gym_rows
from expenses e where recurring_id = :'GYM' \gset
select net_pence as net_a_before from member_net where user_id = :'A' \gset

set role authenticated;
set request.jwt.claim.sub = :'A';
-- ───────── Running: refused (pause or end it first) ─────────
update recurring set deleted_at = now() where id = :'GYM';                                 -- expect error: still running
update recurring set end_date = :'uk_today'::date + 5 where id = :'GYM';
update recurring set deleted_at = now() where id = :'GYM';                                 -- expect error: it ends after today, so it is still running
update recurring set end_date = null where id = :'GYM';
select deleted_at is null as ok_s10_running_template_not_deleted from recurring where id = :'GYM';

-- ───────── Paused, then deleted: logged, posts nothing, what it posted stays ─────────
update recurring set active = false where id = :'GYM';
update recurring set deleted_at = now() where id = :'GYM' returning (deleted_at is not null and not active) as ok_s10_paused_template_deleted;
select count(*) = 1 as ok_s10_delete_logged_as_deleted_with_who
from activity where entity = 'recurring' and entity_id = :'GYM' and action = 'deleted' and actor = :'A'
  and summary = jsonb_build_object('description', 'Delete gym', 'amount_pence', 3000);
select count(*) = :gym_posted and md5(string_agg(to_jsonb(e)::text, ',' order by e.occurrence_date)) = :'gym_rows'
   as ok_s10_posted_entries_stay_exactly_with_their_recurring_id
from expenses e where recurring_id = :'GYM';
select net_pence = :net_a_before as ok_s10_balance_unchanged_by_delete from member_net where user_id = :'A';
-- It can't be resumed, or resumed in the same write as its restore.
update recurring set active = true where id = :'GYM';                                      -- expect error: a deleted payment can't be resumed
update recurring set deleted_at = null, active = true where id = :'GYM';                   -- expect error: restore changes nothing else
select deleted_at is not null and not active as ok_s10_still_deleted_and_paused from recurring where id = :'GYM';
-- Deleting again (the partner's phone, which hadn't heard) keeps when it was first deleted, and logs nothing more.
select deleted_at as gym_deleted_at from recurring where id = :'GYM' \gset
set request.jwt.claim.sub = :'B';
update recurring set deleted_at = now() + interval '1 minute' where id = :'GYM' returning (deleted_at = :'gym_deleted_at'::timestamptz) as ok_s10_second_delete_keeps_the_first_time;
select count(*) = 0 as ok_s10_second_delete_logs_nothing_more from activity where entity = 'recurring' and entity_id = :'GYM' and action in ('deleted', 'edited') and actor = :'B';

-- ───────── Undo: deleted_at cleared, nothing else; logged as restored; still paused ─────────
set request.jwt.claim.sub = :'A';
update recurring set deleted_at = null where id = :'GYM' returning (deleted_at is null and not active) as ok_s10_undo_restores_it_paused;
select count(*) = 1 as ok_s10_restore_logged_as_restored
from activity where entity = 'recurring' and entity_id = :'GYM' and action = 'restored' and actor = :'A';
-- A delete must not carry another change either.
update recurring set deleted_at = now(), description = 'Something else' where id = :'GYM';  -- expect error: delete changes nothing else
select description = 'Delete gym' and deleted_at is null as ok_s10_mixed_delete_changed_nothing from recurring where id = :'GYM';
update recurring set deleted_at = now() where id = :'GYM' returning (deleted_at is not null) as ok_s10_deleted_again_after_undo;

-- ───────── Ended (its end before today), with a day never posted: deleted, it never posts ─────────
-- Weekly from 14 days ago, ended yesterday, added through the app and not posted yet (14 and 7 days ago are due).
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, end_date) values
  (:'WINDOW', :'hid', 'Delete window cleaner', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500),
   'weekly', :'uk_today'::date - 14, :'uk_today'::date - 1);
update recurring set deleted_at = now() where id = :'WINDOW' returning (deleted_at is not null and active) as ok_s10_ended_template_deleted;
select post_due_recurring() >= 0 as ok_s10_post_after_deleting_an_ended_one;
reset role;
set request.jwt.claim.sub = '';
select post_due_recurring_all() >= 0 as ok_s10_nightly_job_after_deleting;
select count(*) = 0 as ok_s10_deleted_template_never_posts from expenses where recurring_id = :'WINDOW';
select count(*) = 0 as ok_s10_deleted_template_never_fills_the_inbox from inbox_items where recurring_id = :'WINDOW';
select posted_count = 0 as ok_s10_deleted_template_keeps_its_count from recurring where id = :'WINDOW';
set role authenticated;
set request.jwt.claim.sub = :'A';
-- Moving its end after today would make a deleted payment run again: refused.
update recurring set end_date = null where id = :'WINDOW';                                 -- expect error: a deleted payment never runs again
-- Its other details can still be written (an older phone's queued edit lands): it stays deleted, and never runs.
update recurring set notes = 'The old flat' where id = :'WINDOW' returning (deleted_at is not null and notes = 'The old flat') as ok_s10_deleted_template_edit_keeps_it_deleted;

-- ───────── Ended today counts as ended (Bills lists it under "Paused or ended") ─────────
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date) values
  (:'TODAYS', :'hid', 'Delete ends today', 2000, jsonb_build_object(:'A', 2000), jsonb_build_object(:'A', 1000, :'B', 1000),
   'monthly', :'uk_today'::date + 3);
update recurring set end_date = :'uk_today' where id = :'TODAYS';
update recurring set deleted_at = now() where id = :'TODAYS' returning (deleted_at is not null) as ok_s10_ended_today_can_be_deleted;

-- ───────── Members only; no hard delete ─────────
set request.jwt.claim.sub = :'E';
select create_household() is not null as ok_s10_e_has_a_household_of_their_own;
update recurring set deleted_at = null where id = :'GYM';
update recurring set deleted_at = now() where id = :'TODAYS';
select count(*) = 0 as ok_s10_outsider_sees_no_templates from recurring where household_id = :'hid';
delete from recurring where id = :'GYM';                                                    -- expect error: no delete, whoever asks
set request.jwt.claim.sub = :'A';
delete from recurring where id = :'GYM';                                                    -- expect error: soft delete only, even for a deleted one
reset role;
select deleted_at is not null as ok_s10_outsider_could_not_restore from recurring where id = :'GYM';
select count(*) = 0 as ok_s10_outsider_left_no_history from activity where entity = 'recurring' and actor = :'E';
select count(*) = 3 as ok_s10_deleted_templates_are_still_there from recurring where id in (:'GYM', :'WINDOW', :'TODAYS');
-- A deleted template is never running, whatever wrote it (the invariant the bill-tomorrow notice relies on).
select count(*) = 0 as ok_s10_no_deleted_template_is_running
from recurring where deleted_at is not null and active and (end_date is null or end_date > :'uk_today'::date);
-- Even the owner (the restore of a backup, a script) can't store a deleted template that runs.
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, deleted_at) values
  (:'hid', 'Deleted but running', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500),
   'monthly', :'uk_today', now());                                                         -- expect error: a deleted payment never runs
