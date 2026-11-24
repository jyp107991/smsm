-- S10 (owner: "make start dates for recurring payments editable after you upload one"; DECISIONS 24 Nov "A new start
-- after one has posted"). A regular payment that has posted can take a new start (the same rhythm). recurring_guard
-- makes the database the authority: the new start is the anchor (REC-2), and every occurrence of the new schedule on
-- or before the UK today counts as done, so the change itself posts nothing, back-dates nothing and never posts a
-- day twice; nothing already posted moves. The writes are the app's own: PostgREST's update of the columns that
-- changed (start_date alone), as Jae, signed in. Runs after schema_test.sql (A and B share a household); uses the
-- real UK date, so each expectation is worked out here from the same date rule (start + step × k), not hand-written.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set FWD 'c1000000-0000-4000-8000-000000000001'
\set BACK 'c1000000-0000-4000-8000-000000000002'
\set LAST 'c1000000-0000-4000-8000-000000000003'
\set EARLY 'c1000000-0000-4000-8000-000000000004'
\set TODAYS 'c1000000-0000-4000-8000-000000000005'
\set LATE 'c1000000-0000-4000-8000-000000000006'
\set RESTED 'c1000000-0000-4000-8000-000000000007'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
-- 31 Jan last year: always 10 or more months back.
select make_date(extract(year from :'uk_today'::date)::int - 1, 1, 31) as jan31 \gset

-- The occurrences of a schedule on or before a day (what the guard counts as done), and the first one after it.
create or replace function pg_temp.through(p_start date, p_frequency text, p_every int, p_day date) returns int
language sql as $$
  select count(*)::int from generate_series(0, 20000) k where (p_start + recurring_step(p_frequency, p_every) * k)::date <= p_day
$$;
create or replace function pg_temp.next_of(p_id uuid) returns date
language sql as $$
  select (start_date + recurring_step(frequency, every) * posted_count)::date from recurring where id = p_id
$$;
-- Every entry a template posted, exactly as stored (to prove the change moves, removes and re-posts nothing).
create or replace function pg_temp.posted(p_id uuid) returns text
language sql as $$
  select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(e)::text, ',' order by e.occurrence_date), ''))
  from expenses e where e.recurring_id = p_id
$$;

-- Four monthly templates and two weekly ones, each posted up to date by the nightly job (no one signed in).
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date) values
  (:'FWD', :'hid', 'Restart forward', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000),
   'monthly', (:'uk_today'::date - interval '3 months')::date),
  (:'BACK', :'hid', 'Restart back', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500),
   'monthly', (:'uk_today'::date - interval '3 months')::date),
  (:'LAST', :'hid', 'Restart 31st', 6000, jsonb_build_object(:'A', 6000), jsonb_build_object(:'A', 3000, :'B', 3000),
   'monthly', (:'uk_today'::date - interval '4 months')::date),
  (:'EARLY', :'hid', 'Restart early', 7000, jsonb_build_object(:'A', 7000), jsonb_build_object(:'A', 3500, :'B', 3500),
   'weekly', :'uk_today'::date - 30),
  (:'TODAYS', :'hid', 'Restart today', 8000, jsonb_build_object(:'A', 8000), jsonb_build_object(:'A', 4000, :'B', 4000),
   'weekly', :'uk_today'::date - 25),
  (:'LATE', :'hid', 'Restart late', 9000, jsonb_build_object(:'A', 9000), jsonb_build_object(:'A', 4500, :'B', 4500),
   'weekly', :'uk_today'::date - 20);
select post_due_recurring_all() >= 0 as ok_s10_restart_templates_posted;
select bool_and(posted_count > 0) as ok_s10_each_has_posted from recurring where description like 'Restart %';
select pg_temp.posted(:'FWD') as fwd_before, pg_temp.posted(:'BACK') as back_before, pg_temp.posted(:'LAST') as last_before,
       pg_temp.posted(:'EARLY') as early_before, pg_temp.posted(:'TODAYS') as todays_before, pg_temp.posted(:'LATE') as late_before \gset
select net_pence as net_a_before from member_net where user_id = :'A' \gset

-- What each new start should count as done, worked out before anyone signs in.
select (:'uk_today'::date - interval '3 months')::date + 10 as fwd_start, (:'uk_today'::date - interval '3 months')::date - 10 as back_start,
       :'uk_today'::date - 30 - 364 as early_start, (:'uk_today'::date - interval '8 months')::date + 3 as rested_start \gset
select pg_temp.through(:'fwd_start', 'monthly', 1, :'uk_today') as fwd_done, pg_temp.through(:'back_start', 'monthly', 1, :'uk_today') as back_done,
       pg_temp.through(:'jan31', 'monthly', 1, :'uk_today') as last_done, pg_temp.through(:'early_start', 'weekly', 1, :'uk_today') as early_done,
       pg_temp.through(:'rested_start', 'monthly', 1, :'uk_today') as rested_done \gset

set role authenticated;
set request.jwt.claim.sub = :'A';

-- ───────── Forward: ten days later in the month ─────────
update recurring set start_date = :'fwd_start' where id = :'FWD'
returning (start_date = :'fwd_start'::date and posted_count = :fwd_done) as ok_s10_forward_keeps_the_day_picked_and_counts_what_is_past;
select post_due_recurring() >= 0 as ok_s10_post_after_forward;

-- ───────── Backward: ten days earlier ─────────
update recurring set start_date = :'back_start' where id = :'BACK'
returning (start_date = :'back_start'::date and posted_count = :back_done) as ok_s10_backward_counts_every_new_day_on_or_before_today;
select post_due_recurring() >= 0 as ok_s10_post_after_backward;

-- ───────── To the 31st (of January last year) ─────────
update recurring set start_date = :'jan31' where id = :'LAST'
returning (start_date = :'jan31'::date and posted_count = :last_done) as ok_s10_to_the_31st_counts_what_is_past;
select post_due_recurring() >= 0 as ok_s10_post_after_the_31st;

-- ───────── To before the first posting: a year before it started ─────────
update recurring set start_date = :'early_start' where id = :'EARLY'
returning (start_date = :'early_start'::date and posted_count = :early_done) as ok_s10_before_the_first_counts_the_whole_new_past;
select post_due_recurring() >= 0 as ok_s10_post_after_moving_before_the_first;

-- ───────── A new day that falls today does not post today (the change itself is never money) ─────────
-- Weekly from 25 days ago posted 25, 18, 11 and 4 days ago; from 14 days ago the new days are 14 and 7 days ago and today.
update recurring set start_date = :'uk_today'::date - 14 where id = :'TODAYS'
returning (posted_count = 3) as ok_s10_today_counts_as_done;
select post_due_recurring() >= 0 as ok_s10_post_after_a_start_that_falls_today;

-- ───────── Made offline, synced later: the server's today decides, whatever the phone saw ─────────
-- The phone picked its own today, 9 days ago, while offline; meanwhile the nightly job posted 20, 13 and 6 days
-- ago. The queued write arrives now: the new days 9 and 2 days ago are past by now and never post.
update recurring set start_date = :'uk_today'::date - 9 where id = :'LATE'
returning (start_date = :'uk_today'::date - 9 and posted_count = 2) as ok_s10_late_sync_counts_by_the_server_today;
select post_due_recurring() >= 0 as ok_s10_post_after_the_late_sync;
-- The queue sends it again (its answer was lost): nothing changes, nothing posts.
update recurring set start_date = :'uk_today'::date - 9 where id = :'LATE'
returning (posted_count = 2) as ok_s10_replayed_start_keeps_the_count;
-- An older phone sends the whole form (every column the sheet owns), the same start: still nothing.
update recurring set description = 'Restart late', amount_pence = 9000, amount_varies = false, category_id = null,
       paid = jsonb_build_object(:'A', 9000), paid_via = 'person', split_mode = 'ratio', split_params = null,
       shares = jsonb_build_object(:'A', 4500, :'B', 4500), is_subscription = false, frequency = 'weekly', every = 1,
       start_date = :'uk_today'::date - 9, end_date = null, notes = null
where id = :'LATE' returning (posted_count = 2) as ok_s10_full_form_replay_keeps_the_count;
select post_due_recurring() >= 0 as ok_s10_post_after_the_replays;
-- A phone still can't set the count, with the start or without.
update recurring set start_date = :'uk_today'::date - 8, posted_count = 0 where id = :'LATE';   -- expect error: posted_count is the server's

-- ───────── What the changes did, read back as the owner ─────────
reset role;
set request.jwt.claim.sub = '';
select pg_temp.next_of(:'FWD') > :'uk_today'::date
       and pg_temp.next_of(:'FWD') = (:'fwd_start'::date + make_interval(months => :fwd_done))::date
   as ok_s10_forward_next_is_the_first_new_day_after_today;
select pg_temp.posted(:'FWD') = :'fwd_before' as ok_s10_forward_posts_nothing_and_moves_nothing;
select pg_temp.next_of(:'BACK') > :'uk_today'::date as ok_s10_backward_next_is_after_today;
select pg_temp.posted(:'BACK') = :'back_before' as ok_s10_backward_back_posts_nothing;
select pg_temp.posted(:'LAST') = :'last_before' as ok_s10_to_the_31st_posts_nothing_now;
-- From now on the 31st, or the month's last day when it is shorter (30 Nov, then 31 Dec).
select bool_and(extract(day from d) = 31 or d = (date_trunc('month', d) + interval '1 month - 1 day')::date)
       and count(*) filter (where extract(day from d) = 31) >= 7 and min(d) > :'uk_today'::date
   as ok_s10_the_31st_anchor_is_kept_from_now_on
from (select (r.start_date + recurring_step(r.frequency, r.every) * (r.posted_count + j))::date as d
      from recurring r, generate_series(0, 13) j where r.id = :'LAST') as next_dates;
select pg_temp.posted(:'EARLY') = :'early_before' as ok_s10_before_the_first_back_posts_nothing;
select count(*) = 0 as ok_s10_nothing_dated_before_the_old_start
from expenses where recurring_id = :'EARLY' and occurrence_date < :'uk_today'::date - 30;
select pg_temp.next_of(:'EARLY') > :'uk_today'::date as ok_s10_before_the_first_next_is_after_today;
select pg_temp.posted(:'TODAYS') = :'todays_before' as ok_s10_today_does_not_post_because_of_the_change;
select count(*) = 0 as ok_s10_nothing_dated_today_from_the_change from expenses where recurring_id = :'TODAYS' and occurrence_date = :'uk_today'::date;
select pg_temp.next_of(:'TODAYS') = :'uk_today'::date + 7 as ok_s10_next_after_today_is_a_week_on;
select pg_temp.posted(:'LATE') = :'late_before' as ok_s10_late_sync_posts_nothing_into_the_past_or_twice;
select pg_temp.next_of(:'LATE') = :'uk_today'::date + 5 as ok_s10_late_sync_next_is_after_today;
-- The nightly job, run again, posts none of them.
select post_due_recurring_all() >= 0 as ok_s10_nightly_job_after_new_starts;
select pg_temp.posted(:'FWD') = :'fwd_before' and pg_temp.posted(:'BACK') = :'back_before' and pg_temp.posted(:'LAST') = :'last_before'
       and pg_temp.posted(:'EARLY') = :'early_before' and pg_temp.posted(:'TODAYS') = :'todays_before' and pg_temp.posted(:'LATE') = :'late_before'
   as ok_s10_nightly_job_posts_nothing_for_new_starts;
select net_pence = :net_a_before as ok_s10_balance_untouched_by_new_starts from member_net where user_id = :'A';

-- ───────── Paused when the start moves, then resumed: no backlog, nothing twice ─────────
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date) values
  (:'RESTED', :'hid', 'Restart rested', 3000, jsonb_build_object(:'A', 3000), jsonb_build_object(:'A', 1500, :'B', 1500),
   'monthly', (:'uk_today'::date - interval '6 months')::date);
select post_due_recurring_all() >= 0 as ok_s10_rested_posted;
select pg_temp.posted(:'RESTED') as rested_before \gset
select net_pence as net_a_rested from member_net where user_id = :'A' \gset
set role authenticated;
set request.jwt.claim.sub = :'B';
update recurring set active = false where id = :'RESTED';
update recurring set start_date = :'rested_start' where id = :'RESTED'
returning (not active and posted_count = :rested_done) as ok_s10_paused_start_change_counts_too;
update recurring set active = true where id = :'RESTED' returning (posted_count = :rested_done) as ok_s10_resume_after_a_new_start_skips_nothing_more;
select post_due_recurring() >= 0 as ok_s10_post_after_resume;
reset role;
select pg_temp.posted(:'RESTED') = :'rested_before' and pg_temp.next_of(:'RESTED') > :'uk_today'::date
   as ok_s10_resume_after_a_new_start_posts_nothing;

-- ───────── The history says the start changed (not the count); the balance never moved ─────────
select count(*) = 1 as ok_s10_start_change_logged_before_and_after
from activity where entity = 'recurring' and entity_id = :'FWD' and action = 'edited' and actor = :'A'
  and summary ? 'start_date' and not summary ? 'posted_count'
  and (summary->'start_date'->>'after')::date = :'fwd_start'::date;
select net_pence = :net_a_rested as ok_s10_balance_untouched_by_a_paused_restart from member_net where user_id = :'A';
select count(*) = 0 as ok_s10_no_entry_twice_for_one_day
from (select recurring_id, occurrence_date from expenses where recurring_id is not null group by 1, 2 having count(*) > 1) x;

-- ───────── A start change that arrives before the day's posting: the old day's bill posts first, exactly once ─────────
-- Between UK midnight and the nightly post (01:17), on a day nobody has opened the app, a template can have a day
-- due today (or earlier) that hasn't posted yet. recurring_guard posts the OLD schedule's due days first (the same
-- posting as post_due_recurring, so exactly once), and only then counts the new schedule's days on or before today.
\set DUE 'c1000000-0000-4000-8000-000000000008'
\set BEHIND 'c1000000-0000-4000-8000-000000000009'
\set HELD 'c1000000-0000-4000-8000-00000000000a'
reset role;
set request.jwt.claim.sub = '';
-- Weekly from 7 days ago, its first day posted (as the nightly job would have), today's not yet.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, posted_count) values
  (:'DUE', :'hid', 'Restart due today', 1100, jsonb_build_object(:'A', 1100), jsonb_build_object(:'A', 550, :'B', 550), 'weekly', :'uk_today'::date - 7, 1);
insert into expenses(household_id, description, amount_pence, date, paid, shares, country, source, recurring_id, occurrence_date)
values (:'hid', 'Restart due today', 1100, :'uk_today'::date - 7, jsonb_build_object(:'A', 1100), jsonb_build_object(:'A', 550, :'B', 550), 'GB', 'recurring', :'DUE', :'uk_today'::date - 7);
-- Weekly from 14 days ago, only its first day posted: 7 days ago and today are both still to post (posting fell behind).
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, posted_count) values
  (:'BEHIND', :'hid', 'Restart behind', 1200, jsonb_build_object(:'A', 1200), jsonb_build_object(:'A', 600, :'B', 600), 'weekly', :'uk_today'::date - 14, 1);
-- Paused, with today's day not posted: a paused one posts nothing (as post_due_recurring), start change or not.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, posted_count, active) values
  (:'HELD', :'hid', 'Restart held', 1300, jsonb_build_object(:'A', 1300), jsonb_build_object(:'A', 650, :'B', 650), 'weekly', :'uk_today'::date - 7, 1, false);
select net_pence as net_a_due from member_net where user_id = :'A' \gset

set role authenticated;
set request.jwt.claim.sub = :'A';
-- Moved to 3 days ago: the new days are 3 days ago (done) and then 4 days from now.
update recurring set start_date = :'uk_today'::date - 3 where id = :'DUE'
returning (start_date = :'uk_today'::date - 3 and posted_count = 1) as ok_s10_due_today_then_new_start_counts_the_new_schedule;
update recurring set start_date = :'uk_today'::date - 3 where id = :'BEHIND'
returning (posted_count = 1) as ok_s10_behind_then_new_start_counts_the_new_schedule;
update recurring set start_date = :'uk_today'::date - 3 where id = :'HELD'
returning (posted_count = 1 and not active) as ok_s10_paused_new_start_counts_the_new_schedule;
-- Both phones and the nightly job post again: nothing more.
select post_due_recurring() >= 0 as ok_s10_post_after_due_start_change;
reset role;
set request.jwt.claim.sub = '';
select post_due_recurring_all() >= 0 as ok_s10_nightly_after_due_start_change;
select count(*) = 1 and bool_and(occurrence_date = :'uk_today'::date - 7)
   as ok_s10_due_first_day_untouched
from expenses where recurring_id = :'DUE' and occurrence_date < :'uk_today'::date;
select count(*) = 1 and bool_and(date = :'uk_today'::date and amount_pence = 1100 and source = 'recurring' and deleted_at is null)
   as ok_s10_old_day_due_today_posted_exactly_once
from expenses where recurring_id = :'DUE' and occurrence_date = :'uk_today'::date;
select count(*) = 2 as ok_s10_due_has_its_two_old_days_and_nothing_from_the_new from expenses where recurring_id = :'DUE';
select pg_temp.next_of(:'DUE') = :'uk_today'::date + 4 as ok_s10_due_next_follows_the_new_start;
select array_agg(occurrence_date order by occurrence_date) = array[:'uk_today'::date - 7, :'uk_today'::date]
   as ok_s10_behind_old_days_each_posted_once
from expenses where recurring_id = :'BEHIND' and occurrence_date >= :'uk_today'::date - 7;
select count(*) = 0 as ok_s10_behind_nothing_from_the_new_start from expenses where recurring_id = :'BEHIND' and occurrence_date = :'uk_today'::date - 3;
select pg_temp.next_of(:'BEHIND') = :'uk_today'::date + 4 as ok_s10_behind_next_follows_the_new_start;
select count(*) = 0 as ok_s10_paused_old_day_not_posted_by_a_start_change from expenses where recurring_id = :'HELD';
-- Jae paid both; Sam's shares of today's 11.00, and of 7 days ago's and today's 12.00, are owed to Jae.
select net_pence = :net_a_due + 550 + 600 + 600 as ok_s10_balance_moves_by_exactly_the_old_days from member_net where user_id = :'A';
select count(*) = 1 as ok_s10_old_day_logged_once
from activity where entity = 'expense' and action = 'created'
  and entity_id in (select id from expenses where recurring_id = :'DUE' and occurrence_date = :'uk_today'::date);
