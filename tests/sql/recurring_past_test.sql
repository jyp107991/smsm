-- S9 (DECISIONS 23 Nov "S9: a regular payment started long ago", review fix 1): "Start from <next> instead" for a
-- payment whose next date is a shorter month-end keeps its own day. The phone saves the template paused with the
-- start the person picked, then resumes it: recurring_guard (migration recurring_guards) skips every occurrence
-- before the UK today on the resume, so nothing past posts, and the start (the anchor, REC-2) is kept, so 31 Jan
-- still gives 30 Nov, then 31 Dec. The writes are the app's own (PostgREST's upsert, then the update of `active`),
-- as Jae, signed in. Runs after schema_test.sql (A and B share a household); uses the real UK date.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
-- 31 Jan last year (always 10 or more months back) and 29 Feb of the last leap year before this one.
select make_date(extract(year from :'uk_today'::date)::int - 1, 1, 31) as jan31 \gset
select make_date(y, 2, 29) as feb29
from generate_series(extract(year from :'uk_today'::date)::int - 1, extract(year from :'uk_today'::date)::int - 4, -1) as y
where (y % 4 = 0 and y % 100 <> 0) or y % 400 = 0 limit 1 \gset
-- What the core counts as past (pastOccurrences): the occurrences before the UK today.
select count(*) as monthly_past from generate_series(0, 60) k where (:'jan31'::date + make_interval(months => k))::date < :'uk_today'::date \gset
select count(*) as yearly_past from generate_series(0, 10) k where (:'feb29'::date + make_interval(years => k))::date < :'uk_today'::date \gset

set role authenticated;
set request.jwt.claim.sub = :'A';

-- ───────── monthly from the 31st ─────────
-- 1. The insert, paused (as the phone's upsert sends it: every column it owns, posted_count never).
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, every, start_date, end_date, active)
values (gen_random_uuid(), my_household(), 'Past rent', 145000, jsonb_build_object(:'A', 145000), jsonb_build_object(:'A', 72500, :'B', 72500),
        'monthly', 1, :'jan31', null, false)
on conflict (id) do update set active = excluded.active
returning id as rent \gset
select post_due_recurring() >= 0 as ok_s9_paused_insert_posts_nothing_yet;
select count(*) = 0 as ok_s9_paused_insert_has_no_entries from expenses where recurring_id = :'rent';
-- 2. The resume (the phone's narrowed update of `active` alone).
update recurring set active = true where id = :'rent';
select post_due_recurring() >= 0 as ok_s9_post_after_resume;
select start_date = :'jan31'::date and active and posted_count = :monthly_past
   as ok_s9_resume_skips_exactly_the_past_and_keeps_the_start
from recurring where id = :'rent';
select count(*) = 0 as ok_s9_nothing_before_today_posts from expenses where recurring_id = :'rent' and occurrence_date < :'uk_today'::date;
-- Today's occurrence, if there is one today, posts today (as for any payment starting today); nothing else does.
select count(*) = (case when (:'jan31'::date + make_interval(months => :monthly_past))::date = :'uk_today'::date then 1 else 0 end)
   as ok_s9_only_today_can_post_now
from expenses where recurring_id = :'rent';
-- The next 14 dates keep the 31st: each is the 31st, or its month's last day when the month is shorter.
select bool_and(extract(day from d) = 31 or d = (date_trunc('month', d) + interval '1 month - 1 day')::date)
       and count(*) filter (where extract(day from d) = 31) >= 7
   as ok_s9_the_31st_anchor_is_kept
from (select (r.start_date + recurring_step(r.frequency, r.every) * (r.posted_count + j))::date as d
      from recurring r, generate_series(0, 13) j where r.id = :'rent') as next_dates;
select (start_date + recurring_step(frequency, every) * posted_count)::date >= :'uk_today'::date
   as ok_s9_next_occurrence_is_on_or_after_today
from recurring where id = :'rent';

-- ───────── yearly from 29 Feb ─────────
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, every, start_date, end_date, active)
values (gen_random_uuid(), my_household(), 'Leap fee', 9500, jsonb_build_object(:'A', 9500), jsonb_build_object(:'A', 4750, :'B', 4750),
        'yearly', 1, :'feb29', null, false)
on conflict (id) do update set active = excluded.active
returning id as leap \gset
update recurring set active = true where id = :'leap';
select post_due_recurring() >= 0 as ok_s9_post_after_leap_resume;
select start_date = :'feb29'::date and posted_count = :yearly_past as ok_s9_leap_resume_keeps_29_feb from recurring where id = :'leap';
select count(*) = 0 as ok_s9_leap_nothing_past_posts from expenses where recurring_id = :'leap' and occurrence_date < :'uk_today'::date;
-- The next leap year's date is 29 Feb again (never 28 Feb for good).
select bool_or(extract(month from d) = 2 and extract(day from d) = 29) as ok_s9_leap_day_comes_back
from (select (r.start_date + recurring_step(r.frequency, r.every) * (r.posted_count + j))::date as d
      from recurring r, generate_series(0, 4) j where r.id = :'leap') as next_dates;
reset role;
