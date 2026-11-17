-- S3 (docs/slices/S3.md): regular payments post once, on the UK date, at home; variable bills wait in the Inbox
-- and are never money; the nightly job; the partner hears about bills and Inbox decisions. Written before the
-- build (ENGINEERING §5, tests first by someone else). Runs after schema_test.sql (A and B share a household).
-- Two phones (and the nightly job) at once are real separate sessions, through dblink.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
-- What "today" means for posting (DAT-2): London's date, whatever the session's time zone.
select (now() at time zone 'Europe/London')::date as uk_today \gset
-- dblink in a schema of its own, so the public schema's function privileges (hardening_test.sql) stay as the migrations left them.
create schema if not exists test_tools;
create extension if not exists dblink schema test_tools;
set search_path = public, test_tools;

-- ───────── REC-2: a phone and another phone at once: every occurrence posts once ─────────
-- Weekly from 15 days ago: occurrences 15, 8 and 1 days ago (three, whichever side of midnight).
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'hid', 'Concurrent rent', 120000, jsonb_build_object(:'A', 120000), jsonb_build_object(:'A', 60000, :'B', 60000),
        'weekly', :'uk_today'::date - 15)
returning id as conc \gset
select dblink_connect('phone_a', format('dbname=%s user=postgres', current_database()));
select dblink_connect('phone_b', format('dbname=%s user=postgres', current_database()));
select dblink_connect('job', format('dbname=%s user=postgres', current_database()));
select dblink_exec('phone_a', 'set role authenticated');
select dblink_exec('phone_a', format('set request.jwt.claim.sub = %L', :'A'));
select dblink_exec('phone_b', 'set role authenticated');
select dblink_exec('phone_b', format('set request.jwt.claim.sub = %L', :'B'));
-- Jae's phone posts inside a transaction that stays open while Sam's phone asks too.
select dblink_exec('phone_a', 'begin');
select n >= 3 as ok_rec2_first_phone_posts from dblink('phone_a', 'select post_due_recurring()') as t(n int);
select dblink_send_query('phone_b', 'select post_due_recurring()') = 1 as ok_rec2_second_phone_asks_meanwhile;
select pg_sleep(0.3);
select dblink_exec('phone_a', 'commit');
select n = 0 as ok_rec2_second_phone_posts_nothing from dblink_get_result('phone_b') as t(n int);
select * from dblink_get_result('phone_b') as t(n int);
select count(*) = 3 and count(distinct occurrence_date) = 3 as ok_rec2_each_occurrence_posted_once
from expenses where recurring_id = :'conc';
select posted_count = 3 as ok_rec2_posted_count_counts_each_occurrence_once from recurring where id = :'conc';

-- ───────── REC-2 REC-3: a phone and the nightly job at once, for a bill whose amount varies ─────────
insert into recurring(household_id, description, amount_pence, amount_varies, paid, shares, frequency, start_date)
values (:'hid', 'Concurrent water', 3000, true, jsonb_build_object(:'B', 3000), jsonb_build_object(:'A', 1500, :'B', 1500),
        'weekly', :'uk_today'::date - 15)
returning id as water \gset
select net_pence as net_before_water from member_net where user_id = :'A' \gset
select dblink_exec('phone_a', 'begin');
select n >= 3 as ok_rec2_phone_posts_variable_bills from dblink('phone_a', 'select post_due_recurring()') as t(n int);
select dblink_send_query('job', format('select post_due_recurring(%L)', :'hid')) = 1 as ok_rec2_nightly_job_runs_meanwhile;
select pg_sleep(0.3);
select dblink_exec('phone_a', 'commit');
select n = 0 as ok_rec2_nightly_job_posts_nothing_more from dblink_get_result('job') as t(n int);
select * from dblink_get_result('job') as t(n int);
select count(*) = 3 and count(distinct occurrence_date) = 3 and bool_and(status = 'open' and source = 'bill')
   as ok_rec3_each_variable_bill_waits_once_in_the_inbox
from inbox_items where recurring_id = :'water';
select count(*) = 0 as ok_rec3_variable_bills_never_become_expenses_by_themselves from expenses where recurring_id = :'water';
select bool_and(payload->>'description' = 'Concurrent water' and (payload->>'estimate_pence')::bigint = 3000
                and payload->>'date' = occurrence_date::text)
   as ok_rec3_inbox_item_offers_the_usual_amount
from inbox_items where recurring_id = :'water';
-- INB-3: waiting Inbox items change no figure.
select net_pence = :net_before_water as ok_inb3_open_inbox_items_are_not_in_member_net from member_net where user_id = :'A';
select posted_count = 3 as ok_rec3_posted_count_counts_variable_bills_once from recurring where id = :'water';
select dblink_disconnect('phone_a');
select dblink_disconnect('phone_b');
select dblink_disconnect('job');

-- ───────── INB-2 INB-3: keeping a variable bill makes one expense; keeping it again is refused ─────────
set role authenticated;
set request.jwt.claim.sub = :'B';
select id as item, occurrence_date as item_date from inbox_items where recurring_id = :'water' order by occurrence_date limit 1 \gset
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (gen_random_uuid(), my_household(), 'Concurrent water', 2874, :'item_date', jsonb_build_object(:'B', 2874),
        jsonb_build_object(:'A', 1437, :'B', 1437), 'recurring', :'water', :'item_date')
returning id as kept_expense \gset
update inbox_items set status = 'kept', expense_id = :'kept_expense' where id = :'item';
select status = 'kept' and expense_id = :'kept_expense' as ok_inb2_kept_item_points_at_its_entry from inbox_items where id = :'item';
select net_pence = :net_before_water - 1437 as ok_inb2_kept_bill_is_money_once from member_net where user_id = :'A';
-- The other phone kept the same bill meanwhile (a second entry for the same occurrence):
insert into expenses(id, household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date)
values (gen_random_uuid(), my_household(), 'Concurrent water', 2874, :'item_date', jsonb_build_object(:'A', 2874),
        jsonb_build_object(:'A', 1437, :'B', 1437), 'recurring', :'water', :'item_date');   -- expect error: one entry per bill occurrence
select id as item2 from inbox_items where recurring_id = :'water' and status = 'open' order by occurrence_date limit 1 \gset
update inbox_items set status = 'dismissed' where id = :'item2';
select count(*) = 1 as ok_inb2_not_ours_dismisses from inbox_items where id = :'item2' and status = 'dismissed' and expense_id is null;
select net_pence = :net_before_water - 1437 as ok_inb3_dismissed_bill_is_not_money from member_net where user_id = :'A';

-- ───────── DAT-2: bills post on the UK date, whatever the session's time zone ─────────
-- A zone whose date differs from London's right now: Kiribati (UTC+14) is a day ahead from 10:00 UTC,
-- Baker Island (UTC−12) a day behind until 11:00 UTC; one of the two always differs.
reset role;
select case when (now() at time zone 'Etc/GMT-14')::date <> :'uk_today'::date then 'Etc/GMT-14' else 'Etc/GMT+12' end as tz \gset
select (now() at time zone :'tz')::date <> :'uk_today'::date as ok_dat2_test_zone_is_on_another_date;
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Due today in the UK', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500),
        'monthly', :'uk_today');
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Due tomorrow in the UK', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500),
        'monthly', :'uk_today'::date + 1);
set timezone = :'tz';
select post_due_recurring() >= 0 as ok_dat2_posting_runs_in_another_zone;
reset timezone;
select count(*) = 1 and bool_and(date = :'uk_today' and occurrence_date = :'uk_today') as ok_dat2_due_on_the_uk_date_posts_that_day
from expenses where description = 'Due today in the UK';
select count(*) = 0 as ok_dat2_tomorrow_in_the_uk_does_not_post_yet from expenses where description = 'Due tomorrow in the UK';

-- ───────── REC-4: always home and in no chapter, even while a trip is open ─────────
-- schema_test left an open trip (Japan, JP) running through today.
select count(*) >= 1 as ok_rec4_a_trip_is_open from chapters where kind = 'trip' and not closed and country = 'JP';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Home insurance', 2400, jsonb_build_object(:'A', 2400), jsonb_build_object(:'A', 1200, :'B', 1200),
        'monthly', :'uk_today'::date - 1);
select post_due_recurring() >= 1 as ok_rec4_posts;
select count(*) = 1 and bool_and(country = 'GB' and chapter_id is null and source = 'recurring' and recurring_id is not null)
   as ok_rec4_posted_at_home_in_no_chapter
from expenses where description = 'Home insurance';

-- ───────── REC-6: editing a template changes future occurrences only, and the change is in its history ─────────
-- Weekly from 15 days ago, ending 5 days ago: two occurrences post (15 and 8 days ago).
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, end_date)
values (my_household(), 'Cleaner', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000),
        'weekly', :'uk_today'::date - 15, :'uk_today'::date - 5)
returning id as cleaner \gset
select post_due_recurring() >= 2 as ok_rec6_first_two_post;
select count(*) = 2 as ok_rec6_two_posted_before_the_change from expenses where recurring_id = :'cleaner';
-- The price goes up and the end is lifted: the posted ones stay at £40.00, the next one is £45.00.
update recurring set amount_pence = 4500, paid = jsonb_build_object(:'A', 4500), shares = jsonb_build_object(:'A', 2250, :'B', 2250),
       end_date = null
where id = :'cleaner';
select count(*) = 2 and bool_and(amount_pence = 4000 and (shares->>:'B')::bigint = 2000) as ok_rec6_posted_occurrences_untouched
from expenses where recurring_id = :'cleaner' and occurrence_date < :'uk_today'::date - 5;
select count(*) = 1 as ok_rec6_price_change_in_history
from activity where entity = 'recurring' and entity_id = :'cleaner' and action = 'edited'
  and (summary->'amount_pence'->>'before')::bigint = 4000 and (summary->'amount_pence'->>'after')::bigint = 4500;
select post_due_recurring() >= 1 as ok_rec6_next_occurrence_posts;
select count(*) = 1 and bool_and(amount_pence = 4500) as ok_rec6_next_occurrence_at_the_new_price
from expenses where recurring_id = :'cleaner' and occurrence_date = :'uk_today'::date - 1;
select posted_count = 3 as ok_rec6_posted_count_carries_on from recurring where id = :'cleaner';

-- ───────── Templates are paused or ended, never deleted ─────────
update recurring set active = false where id = :'cleaner';
select count(*) = 1 as ok_rec1_paused_template_kept from recurring where id = :'cleaner' and not active;
delete from recurring where id = :'cleaner';                           -- expect error: templates are paused or ended, never deleted
select count(*) = 1 as ok_rec1_template_still_there from recurring where id = :'cleaner';

-- ───────── The partner's phone hears about templates and Inbox decisions (Realtime) ─────────
reset role;
select count(*) = 2 as ok_inb2_rec7_bills_and_inbox_published from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('recurring', 'inbox_items');

-- ───────── REC-2: the nightly job (pg_cron; the stand-in in auth_stub.sql where pg_cron isn't installed) ─────────
-- Scheduled once, by name, daily in the small hours: 00:xx–05:xx UTC is after midnight in London in winter and summer.
select count(*) = 1 as ok_rec2_nightly_job_scheduled
from cron.job where jobname = 'smsm-recurring' and command ilike '%post_due_recurring%';
select count(*) = 1 as ok_rec2_nightly_job_runs_early_every_day
from cron.job where jobname = 'smsm-recurring' and schedule ~ '^[0-5]?[0-9] [0-5] \* \* \*$';
-- What it runs posts what is due for every household, with no one signed in.
set request.jwt.claim.sub = '';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'hid', 'Left for the job', 1800, jsonb_build_object(:'A', 1800), jsonb_build_object(:'A', 900, :'B', 900),
        'monthly', :'uk_today'::date - 1);
do $$ declare c text; begin
  select command into c from cron.job where jobname = 'smsm-recurring';
  if c is not null then execute c; end if;
end $$;
select count(*) = 1 as ok_rec2_nightly_job_posts_what_is_due from expenses where description = 'Left for the job';
