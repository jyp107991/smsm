-- S10 (owner: "make start dates for recurring payments editable after you upload one"; DECISIONS 24 Nov "A new start
-- after one has posted", and the fresh review's fixes). A regular payment that has posted can take a new start (the
-- same rhythm). recurring_guard makes the database the authority:
--   * "has posted" is ever_posted, kept by the server, never posted_count (which a start moved into the future resets);
--   * the next payment is the new schedule's occurrence nearest to D, the old schedule's first day not yet posted (a
--     tie takes the later one); everything before it counts as done; it and what follows post as normal, so one on or
--     before today posts at once, on its own date, exactly once; nothing already posted moves.
-- The writes are the app's own: PostgREST's update of the columns that changed, as Jae, signed in. Runs after
-- schema_test.sql (A and B share a household); uses the real UK date, so each expectation is worked out here
-- independently (the nearest occurrence by sorting every candidate), not by the database's own function.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set FWD 'c1000000-0000-4000-8000-000000000001'
\set BACK 'c1000000-0000-4000-8000-000000000002'
\set LAST 'c1000000-0000-4000-8000-000000000003'
\set EARLY 'c1000000-0000-4000-8000-000000000004'
\set SOONER 'c1000000-0000-4000-8000-000000000005'
\set LATE 'c1000000-0000-4000-8000-000000000006'
\set RESTED 'c1000000-0000-4000-8000-000000000007'
\set LATER 'c1000000-0000-4000-8000-000000000008'
\set TIE 'c1000000-0000-4000-8000-000000000009'
\set FUTURE 'c1000000-0000-4000-8000-00000000000a'
\set DUE 'c1000000-0000-4000-8000-00000000000b'
\set HELD 'c1000000-0000-4000-8000-00000000000c'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
-- 31 Jan last year: always 10 or more months back.
select make_date(extract(year from :'uk_today'::date)::int - 1, 1, 31) as jan31 \gset

-- The next day a template posts (its first not yet posted).
create or replace function pg_temp.next_of(p_id uuid) returns date
language sql as $$
  select (start_date + recurring_step(frequency, every) * posted_count)::date from recurring where id = p_id
$$;
-- The index of the new schedule's occurrence nearest to p_d, a tie to the later: every candidate, sorted.
create or replace function pg_temp.nearest(p_start date, p_frequency text, p_every int, p_d date) returns int
language sql as $$
  select k from generate_series(0, 20000) k
  order by abs((p_start + recurring_step(p_frequency, p_every) * k)::date - p_d), k desc limit 1
$$;
create or replace function pg_temp.occ(p_start date, p_frequency text, p_every int, p_k int) returns date
language sql as $$ select (p_start + recurring_step(p_frequency, p_every) * p_k)::date $$;
-- A template's entries dated before a day, exactly as stored (to prove nothing already posted moves or doubles).
create or replace function pg_temp.kept(p_id uuid, p_before date) returns text
language sql as $$
  select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(e)::text, ',' order by e.occurrence_date), ''))
  from expenses e where e.recurring_id = p_id and e.occurrence_date < p_before
$$;
-- From the new next day on: exactly the new schedule's days up to today, each once.
create or replace function pg_temp.new_ok(p_id uuid, p_start date, p_frequency text, p_every int, p_k int, p_today date) returns boolean
language sql as $$
  select (select array_agg(occurrence_date order by occurrence_date) from expenses
           where recurring_id = p_id and occurrence_date >= pg_temp.occ(p_start, p_frequency, p_every, p_k))
         is not distinct from
         (select array_agg(d order by d) from (select pg_temp.occ(p_start, p_frequency, p_every, j) d
            from generate_series(p_k, p_k + 2000) j) s where d <= p_today)
$$;

-- Templates, each posted up to date by the nightly job (no one signed in).
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, every, start_date) values
  (:'FWD', :'hid', 'Restart forward', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000), 'monthly', 1, (:'uk_today'::date - interval '3 months')::date),
  (:'BACK', :'hid', 'Restart back', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), 'monthly', 1, (:'uk_today'::date - interval '3 months')::date),
  (:'LAST', :'hid', 'Restart 31st', 6000, jsonb_build_object(:'A', 6000), jsonb_build_object(:'A', 3000, :'B', 3000), 'monthly', 1, (:'uk_today'::date - interval '4 months')::date),
  (:'EARLY', :'hid', 'Restart early', 7000, jsonb_build_object(:'A', 7000), jsonb_build_object(:'A', 3500, :'B', 3500), 'weekly', 1, :'uk_today'::date - 30),
  (:'SOONER', :'hid', 'Restart sooner', 8000, jsonb_build_object(:'A', 8000), jsonb_build_object(:'A', 4000, :'B', 4000), 'weekly', 1, :'uk_today'::date - 12),
  (:'LATER', :'hid', 'Restart later', 8100, jsonb_build_object(:'A', 8100), jsonb_build_object(:'A', 4050, :'B', 4050), 'weekly', 1, :'uk_today'::date - 12),
  (:'TIE', :'hid', 'Restart tie', 8200, jsonb_build_object(:'A', 8200), jsonb_build_object(:'A', 4100, :'B', 4100), 'weekly', 2, :'uk_today'::date - 12),
  (:'LATE', :'hid', 'Restart late', 9000, jsonb_build_object(:'A', 9000), jsonb_build_object(:'A', 4500, :'B', 4500), 'weekly', 1, :'uk_today'::date - 20),
  (:'FUTURE', :'hid', 'Restart future', 9100, jsonb_build_object(:'A', 9100), jsonb_build_object(:'A', 4550, :'B', 4550), 'monthly', 1, (:'uk_today'::date - interval '11 months')::date);
select post_due_recurring_all() >= 0 as ok_s10_restart_templates_posted;
select bool_and(posted_count > 0 and ever_posted) as ok_s10_each_has_posted from recurring where description like 'Restart %';
select net_pence as net_a_before from member_net where user_id = :'A' \gset
create temp table before_ids as select id from expenses;

-- What each new start should do, worked out before anyone signs in: D (the old next day), the nearest new occurrence
-- to it (k, and its date), and the entries dated before that day as they are now.
select (:'uk_today'::date - interval '3 months')::date + 10 as fwd_start, (:'uk_today'::date - interval '3 months')::date - 10 as back_start,
       :'uk_today'::date - 30 - 364 as early_start, :'uk_today'::date - 9 as late_start \gset
select pg_temp.nearest(:'fwd_start', 'monthly', 1, pg_temp.next_of(:'FWD')) as fwd_k,
       pg_temp.nearest(:'back_start', 'monthly', 1, pg_temp.next_of(:'BACK')) as back_k,
       pg_temp.nearest(:'jan31', 'monthly', 1, pg_temp.next_of(:'LAST')) as last_k,
       pg_temp.nearest(:'early_start', 'weekly', 1, pg_temp.next_of(:'EARLY')) as early_k,
       pg_temp.nearest(:'late_start', 'weekly', 1, pg_temp.next_of(:'LATE')) as late_k \gset
select pg_temp.kept(:'FWD', pg_temp.occ(:'fwd_start', 'monthly', 1, :fwd_k)) as fwd_kept,
       pg_temp.kept(:'BACK', pg_temp.occ(:'back_start', 'monthly', 1, :back_k)) as back_kept,
       pg_temp.kept(:'LAST', pg_temp.occ(:'jan31', 'monthly', 1, :last_k)) as last_kept,
       pg_temp.kept(:'EARLY', pg_temp.occ(:'early_start', 'weekly', 1, :early_k)) as early_kept,
       pg_temp.kept(:'LATE', pg_temp.occ(:'late_start', 'weekly', 1, :late_k)) as late_kept \gset

set role authenticated;
set request.jwt.claim.sub = :'A';

-- ───────── Forward ten days, back ten days, to the 31st, to a year before the first posting ─────────
update recurring set start_date = :'fwd_start' where id = :'FWD'
returning (start_date = :'fwd_start'::date and posted_count = :fwd_k) as ok_s10_forward_next_is_the_nearest_to_the_old_next;
update recurring set start_date = :'back_start' where id = :'BACK'
returning (start_date = :'back_start'::date and posted_count = :back_k) as ok_s10_backward_next_is_the_nearest_to_the_old_next;
update recurring set start_date = :'jan31' where id = :'LAST'
returning (start_date = :'jan31'::date and posted_count = :last_k) as ok_s10_to_the_31st_next_is_the_nearest;
update recurring set start_date = :'early_start' where id = :'EARLY'
returning (start_date = :'early_start'::date and posted_count = :early_k) as ok_s10_before_the_first_next_is_the_nearest;

-- ───────── The review's examples, by the week so the days are exact ─────────
-- Weekly from 12 days ago: 12 and 5 days ago posted, D = in 2 days.
-- Sooner (15th → 5th): from 15 days ago the days are −15, −8, −1, +6; −1 is nearest to +2: it is next, and posts now.
update recurring set start_date = :'uk_today'::date - 15 where id = :'SOONER'
returning (posted_count = 2) as ok_s10_sooner_next_is_the_nearest_even_before_today;
-- Later (1st → 25th): from 9 days ago the days are −9, −2, +5; +5 is nearest to +2.
update recurring set start_date = :'uk_today'::date - 9 where id = :'LATER'
returning (posted_count = 2) as ok_s10_later_next_is_the_nearest_after_today;
-- A tie takes the later: every 2 weeks from 12 days ago, D = +2; from 19 days ago the days are −19, −5, +9 (7 either side).
update recurring set start_date = :'uk_today'::date - 19 where id = :'TIE'
returning (posted_count = 2) as ok_s10_a_tie_takes_the_later;

-- ───────── Made offline, synced later: the server's state when it arrives decides, whatever the phone saw ─────────
update recurring set start_date = :'late_start' where id = :'LATE'
returning (start_date = :'late_start'::date and posted_count = :late_k) as ok_s10_late_sync_counts_by_the_server;
select post_due_recurring() >= 0 as ok_s10_post_after_the_new_starts;
-- The queue sends it again (its answer was lost): nothing changes, nothing posts.
select posted_count as late_count from recurring where id = :'LATE' \gset
update recurring set start_date = :'late_start' where id = :'LATE'
returning (posted_count = :late_count) as ok_s10_replayed_start_keeps_the_count;
-- An older phone sends the whole form (every column the sheet owns), the same start: still nothing.
update recurring set description = 'Restart late', amount_pence = 9000, amount_varies = false, category_id = null,
       paid = jsonb_build_object(:'A', 9000), paid_via = 'person', split_mode = 'ratio', split_params = null,
       shares = jsonb_build_object(:'A', 4500, :'B', 4500), is_subscription = false, frequency = 'weekly', every = 1,
       start_date = :'late_start', end_date = null, notes = null
where id = :'LATE' returning (posted_count = :late_count) as ok_s10_full_form_replay_keeps_the_count;
select post_due_recurring() >= 0 as ok_s10_post_after_the_replays;
-- A phone can't set the count, nor clear "has posted".
update recurring set start_date = :'uk_today'::date - 8, posted_count = 0 where id = :'LATE';   -- expect error: posted_count is the server's
update recurring set ever_posted = false where id = :'LATE' returning ever_posted as ok_s10_a_phone_cant_clear_ever_posted;

-- ───────── What the changes did, read back as the owner ─────────
reset role;
set request.jwt.claim.sub = '';
select post_due_recurring_all() >= 0 as ok_s10_nightly_job_after_new_starts;
select pg_temp.kept(:'FWD', pg_temp.occ(:'fwd_start', 'monthly', 1, :fwd_k)) = :'fwd_kept'
       and pg_temp.new_ok(:'FWD', :'fwd_start', 'monthly', 1, :fwd_k, :'uk_today') and pg_temp.next_of(:'FWD') > :'uk_today'::date
   as ok_s10_forward_moves_nothing_and_posts_each_new_day_once;
select pg_temp.kept(:'BACK', pg_temp.occ(:'back_start', 'monthly', 1, :back_k)) = :'back_kept'
       and pg_temp.new_ok(:'BACK', :'back_start', 'monthly', 1, :back_k, :'uk_today') and pg_temp.next_of(:'BACK') > :'uk_today'::date
   as ok_s10_backward_moves_nothing_and_posts_each_new_day_once;
select pg_temp.kept(:'LAST', pg_temp.occ(:'jan31', 'monthly', 1, :last_k)) = :'last_kept'
       and pg_temp.new_ok(:'LAST', :'jan31', 'monthly', 1, :last_k, :'uk_today') and pg_temp.next_of(:'LAST') > :'uk_today'::date
   as ok_s10_to_the_31st_moves_nothing_and_posts_each_new_day_once;
-- From now on the 31st, or the month's last day when it is shorter (30 Nov, then 31 Dec).
select bool_and(extract(day from d) = 31 or d = (date_trunc('month', d) + interval '1 month - 1 day')::date)
       and count(*) filter (where extract(day from d) = 31) >= 7
   as ok_s10_the_31st_anchor_is_kept_from_now_on
from (select (r.start_date + recurring_step(r.frequency, r.every) * (r.posted_count + j))::date as d
      from recurring r, generate_series(0, 13) j where r.id = :'LAST') as next_dates;
select pg_temp.kept(:'EARLY', pg_temp.occ(:'early_start', 'weekly', 1, :early_k)) = :'early_kept'
       and pg_temp.new_ok(:'EARLY', :'early_start', 'weekly', 1, :early_k, :'uk_today') and pg_temp.next_of(:'EARLY') > :'uk_today'::date
   as ok_s10_before_the_first_back_posts_nothing;
select count(*) = 0 as ok_s10_nothing_dated_before_the_old_start
from expenses where recurring_id = :'EARLY' and occurrence_date < :'uk_today'::date - 30;
select array_agg(occurrence_date order by occurrence_date) = array[:'uk_today'::date - 12, :'uk_today'::date - 5, :'uk_today'::date - 1]
       and pg_temp.next_of(:'SOONER') = :'uk_today'::date + 6
   as ok_s10_sooner_posts_its_new_day_at_once_on_its_own_date
from expenses where recurring_id = :'SOONER';
select array_agg(occurrence_date order by occurrence_date) = array[:'uk_today'::date - 12, :'uk_today'::date - 5]
       and pg_temp.next_of(:'LATER') = :'uk_today'::date + 5
   as ok_s10_later_posts_nothing_now_next_in_five_days
from expenses where recurring_id = :'LATER';
select array_agg(occurrence_date order by occurrence_date) = array[:'uk_today'::date - 12] and pg_temp.next_of(:'TIE') = :'uk_today'::date + 9
   as ok_s10_tie_next_is_the_later
from expenses where recurring_id = :'TIE';
select pg_temp.kept(:'LATE', pg_temp.occ(:'late_start', 'weekly', 1, :late_k)) = :'late_kept'
       and pg_temp.new_ok(:'LATE', :'late_start', 'weekly', 1, :late_k, :'uk_today') and pg_temp.next_of(:'LATE') > :'uk_today'::date
   as ok_s10_late_sync_posts_nothing_twice;
-- Jae paid them all: the balance moves by exactly Sam's halves of the new days posted (SOONER's −1, and any other
-- new day on or before today), nothing else.
select net_pence = :net_a_before + (select coalesce(sum((e.shares->>:'B')::bigint), 0) from expenses e
                                    where e.recurring_id is not null and e.id not in (select id from pg_temp.before_ids))
       and (select count(*) from expenses e where e.recurring_id = :'SOONER' and e.id not in (select id from pg_temp.before_ids)) = 1
   as ok_s10_balance_moves_by_exactly_the_new_days
from member_net where user_id = :'A';

-- ───────── Fresh review 1: "has posted" never depends on posted_count ─────────
-- Monthly from 11 months ago, 12 posted. Moved into the future (count 0), then far back: nothing back-posts.
select count(*) as future_posted from expenses where recurring_id = :'FUTURE' \gset
select :future_posted::int >= 11 as ok_s10_future_posted_its_year;
set role authenticated;
set request.jwt.claim.sub = :'A';
update recurring set start_date = :'uk_today'::date + 20 where id = :'FUTURE'
returning (posted_count = 0 and ever_posted) as ok_s10_moved_into_the_future_count_0_still_has_posted;
reset role;
select pg_temp.next_of(:'FUTURE') as future_d \gset
select (:'uk_today'::date - interval '11 months')::date + 10 as back_far \gset
select pg_temp.nearest(:'back_far', 'monthly', 1, :'future_d') as far_k \gset
set role authenticated;
set request.jwt.claim.sub = :'A';
update recurring set start_date = :'back_far' where id = :'FUTURE'
returning (posted_count = :far_k) as ok_s10_moved_back_far_next_is_the_nearest_to_the_future_day;
select post_due_recurring() >= 0 as ok_s10_post_after_moving_back_far;
-- An older phone (which keys "has posted" on the count) sends a new rhythm too: still nothing back-dated.
update recurring set frequency = 'weekly', start_date = :'uk_today'::date - 300 where id = :'FUTURE';
select post_due_recurring() >= 0 as ok_s10_post_after_an_old_phones_rhythm;
reset role;
set request.jwt.claim.sub = '';
select count(*) = :future_posted as ok_s10_never_back_posts_after_a_start_moved_into_the_future
from expenses where recurring_id = :'FUTURE' and occurrence_date <= :'uk_today'::date;

-- ───────── A start change before the day's posting (between midnight and the nightly post) ─────────
-- Weekly from 7 days ago, its first day posted, today's not yet (D = today). From 3 days ago the days are −3 and +4:
-- −3 is nearest to today, so that period is billed once, on −3.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, posted_count, ever_posted) values
  (:'DUE', :'hid', 'Restart due today', 1100, jsonb_build_object(:'A', 1100), jsonb_build_object(:'A', 550, :'B', 550), 'weekly', :'uk_today'::date - 7, 1, true);
insert into expenses(household_id, description, amount_pence, date, paid, shares, country, source, recurring_id, occurrence_date)
values (:'hid', 'Restart due today', 1100, :'uk_today'::date - 7, jsonb_build_object(:'A', 1100), jsonb_build_object(:'A', 550, :'B', 550), 'GB', 'recurring', :'DUE', :'uk_today'::date - 7);
-- Paused, today's day not posted: a paused one posts nothing, start change or not.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, posted_count, ever_posted, active) values
  (:'HELD', :'hid', 'Restart held', 1300, jsonb_build_object(:'A', 1300), jsonb_build_object(:'A', 650, :'B', 650), 'weekly', :'uk_today'::date - 7, 1, true, false);
set role authenticated;
set request.jwt.claim.sub = :'A';
update recurring set start_date = :'uk_today'::date - 3 where id = :'DUE' returning (posted_count = 0) as ok_s10_due_today_next_is_the_nearest;
update recurring set start_date = :'uk_today'::date - 3 where id = :'HELD' returning (posted_count = 0 and not active) as ok_s10_paused_new_start_counts_too;
select post_due_recurring() >= 0 as ok_s10_post_after_due_start_change;
reset role;
set request.jwt.claim.sub = '';
select post_due_recurring_all() >= 0 as ok_s10_nightly_after_due_start_change;
select array_agg(occurrence_date order by occurrence_date) = array[:'uk_today'::date - 7, :'uk_today'::date - 3]
       and pg_temp.next_of(:'DUE') = :'uk_today'::date + 4
   as ok_s10_due_period_billed_once_next_follows_the_new_start
from expenses where recurring_id = :'DUE';
select count(*) = 0 as ok_s10_paused_old_day_not_posted_by_a_start_change from expenses where recurring_id = :'HELD';

-- ───────── Paused when the start moves, then resumed: no backlog, nothing twice ─────────
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date) values
  (:'RESTED', :'hid', 'Restart rested', 3000, jsonb_build_object(:'A', 3000), jsonb_build_object(:'A', 1500, :'B', 1500),
   'monthly', (:'uk_today'::date - interval '6 months')::date);
select post_due_recurring_all() >= 0 as ok_s10_rested_posted;
select pg_temp.kept(:'RESTED', :'uk_today'::date + 1) as rested_before \gset
select net_pence as net_a_rested from member_net where user_id = :'A' \gset
set role authenticated;
set request.jwt.claim.sub = :'B';
update recurring set active = false where id = :'RESTED';
update recurring set start_date = (:'uk_today'::date - interval '8 months')::date + 3 where id = :'RESTED'
returning (not active and ever_posted) as ok_s10_paused_start_change_keeps_has_posted;
update recurring set active = true where id = :'RESTED' returning active as ok_s10_resumed_after_a_new_start;
select post_due_recurring() >= 0 as ok_s10_post_after_resume;
reset role;
select pg_temp.kept(:'RESTED', :'uk_today'::date + 1) = :'rested_before' and pg_temp.next_of(:'RESTED') > :'uk_today'::date
   as ok_s10_resume_after_a_new_start_posts_nothing;
select net_pence = :net_a_rested as ok_s10_balance_untouched_by_a_paused_restart from member_net where user_id = :'A';

-- ───────── The history says the start changed (not the count, nor "has posted") ─────────
select count(*) = 1 as ok_s10_start_change_logged_before_and_after
from activity where entity = 'recurring' and entity_id = :'FWD' and action = 'edited' and actor = :'A'
  and summary ? 'start_date' and not summary ? 'posted_count' and not summary ? 'ever_posted'
  and (summary->'start_date'->>'after')::date = :'fwd_start'::date;
select count(*) = 0 as ok_s10_posting_logs_no_edit_of_the_template
from activity where entity = 'recurring' and entity_id in (:'SOONER', :'LATER', :'TIE', :'RESTED') and action = 'edited' and actor is null;
select count(*) = 0 as ok_s10_no_entry_twice_for_one_day
from (select recurring_id, occurrence_date from expenses where recurring_id is not null group by 1, 2 having count(*) > 1) x;
