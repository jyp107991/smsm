-- S8 fresh-review fixes (NOT-1, ACT-4): the database's own posting stays quiet at once but is never missed; a bill
-- kept from the Inbox notifies like any entry; what a change changed; a comment names itself; a variable bill says
-- so; a balance reminder no longer true says nothing; push services' answers; the push-address allowlist and the
-- same-phone handover. Runs after notifications_test.sql. X (cat) and Y (dog) share a household; Z lives elsewhere.
\set X '2b2b2b2b-0000-4000-8000-000000000001'
\set Y '2b2b2b2b-0000-4000-8000-000000000002'
\set Z '2b2b2b2b-0000-4000-8000-000000000003'
reset role;
set request.jwt.claim.sub = '';
insert into auth.users values (:'X'), (:'Y'), (:'Z') on conflict do nothing;
update notification_outbox set sent_at = now() where sent_at is null;
select (now() at time zone 'Europe/London')::date as today \gset
select ((now() at time zone 'Europe/London')::date + time '08:07') at time zone 'Europe/London' as at8 \gset
set role authenticated;
set request.jwt.claim.sub = :'X';
select create_household() as hx \gset
select set_identity('Xan', 'cat');
select join_code as hx_code from households \gset
set request.jwt.claim.sub = :'Y';
select join_household(:'hx_code') is not null as ok_not1_review_partner_joined;
select set_identity('Yul', 'dog');

-- ───────── the database's posting is quiet at once; a kept Inbox bill is a person's entry ─────────
set request.jwt.claim.sub = :'X';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Gas', 3000, jsonb_build_object(:'X', 3000), jsonb_build_object(:'X', 1500, :'Y', 1500), 'monthly', :'today')
returning id as gas \gset
select post_due_recurring() >= 1 as ok_not1_a_phone_posts_on_open;
reset role;
select count(*) = 0 as ok_not1_the_databases_posting_is_not_someone_adding
  from notification_outbox where household_id = :'hx' and kind = 'entry_added' and sent_at is null;
select count(*) = 0 as ok_not1_before_eight_posted_today_waits_for_the_daily_run
  from notification_outbox where household_id = :'hx' and kind = 'bill_posted' and sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'X';
insert into recurring(household_id, description, amount_pence, amount_varies, paid, shares, frequency, start_date)
values (my_household(), 'Energy', 8000, true, jsonb_build_object(:'X', 8000), jsonb_build_object(:'X', 4000, :'Y', 4000), 'monthly', '2025-01-03')
returning id as energy \gset
-- Its bill, as the posting puts it in the Inbox (S10 review: a day is kept only from its bill; migration 20261125000100).
reset role;
insert into inbox_items(household_id, source, recurring_id, occurrence_date, payload)
select household_id, 'bill', :'energy', '2025-01-03', '{}'::jsonb from members where user_id = :'X';
set role authenticated;
insert into expenses(household_id, description, amount_pence, paid, shares, source, recurring_id, occurrence_date)
values (my_household(), 'Energy', 8312, jsonb_build_object(:'X', 8312), jsonb_build_object(:'X', 4156, :'Y', 4156), 'recurring', :'energy', '2025-01-03')
returning id as kept \gset
reset role;
select count(*) = 1 as ok_not1_a_bill_kept_from_the_inbox_notifies_like_any_entry
  from notification_outbox where recipient = :'Y' and kind = 'entry_added' and ref_id = :'kept' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;

-- After today's 08:07 run, a phone posting today's occurrence announces it at once, to both, and only once.
insert into notification_daily_runs(day) values (:'today') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = :'Y';
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date)
values (my_household(), 'Water', 2874, jsonb_build_object(:'Y', 2874), jsonb_build_object(:'X', 1437, :'Y', 1437), 'monthly', :'today')
returning id as water \gset
select post_due_recurring() >= 1 as ok_not1_a_late_phone_posts;
reset role;
select id as water_posted from expenses where recurring_id = :'water' \gset
select count(*) = 2 and count(distinct recipient) = 2 as ok_not1_posted_after_eight_is_announced_at_once_to_both
  from notification_outbox where kind = 'bill_posted' and ref_id = :'water_posted' and sent_at is null;
select count(*) = 0 as ok_not1_still_never_someone_adding
  from notification_outbox where household_id = :'hx' and kind = 'entry_added' and sent_at is null;
delete from notification_daily_runs where day = :'today';
select queue_daily_notifications(:'at8') >= 0 as ok_not1_the_daily_run_runs_again_here;
select count(*) = 2 as ok_not1_the_daily_run_never_announces_it_twice
  from notification_outbox where kind = 'bill_posted' and ref_id = :'water_posted';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── what a change changed (review fix 9) ─────────
set role authenticated;
set request.jwt.claim.sub = :'X';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Tesco', 4250, jsonb_build_object(:'X', 4250), jsonb_build_object(:'X', 2125, :'Y', 2125)) returning id as t1 \gset
select id as eating from categories where household_id = my_household() and name = 'Eating out' \gset
update expenses set category_id = :'eating' where id = :'t1';
reset role;
update notification_outbox set sent_at = now() where sent_at is null and kind = 'entry_added';
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'change' = 'category' and data->>'category' = 'Eating out')
   as ok_not1_only_the_category_changed from got where kind = 'entry_changed';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'X';
update expenses set notes = 'the big shop' where id = :'t1';
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'change' = 'details') as ok_not1_another_detail_changed from got where kind = 'entry_changed';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'X';
update expenses set amount_pence = 4520, paid = jsonb_build_object(:'X', 4520), shares = jsonb_build_object(:'X', 2260, :'Y', 2260) where id = :'t1';
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'change' = 'amount' and (data->>'amount')::bigint = 4520) as ok_not1_the_amount_changed
  from got where kind = 'entry_changed';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── a comment names itself (review fix 5) ─────────
set role authenticated;
set request.jwt.claim.sub = :'Y';
insert into comments(household_id, expense_id, author, body) values (my_household(), :'t1', :'Y', 'big shop?') returning id as c1 \gset
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'commentId' = :'c1' and data->>'ref' = :'t1') as ok_act4_the_comment_names_itself
  from got where kind = 'comment';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── a variable bill tomorrow says it varies (review fix 6) ─────────
insert into notification_outbox(household_id, recipient, kind, ref_id) values (:'hx', :'X', 'bill_tomorrow', :'energy');
set role authenticated;
set request.jwt.claim.sub = :'X';
select count(*) = 1 as ok_not1_review_bills_tomorrow_on from (select set_notification_prefs('{"bills_tomorrow":true}'::jsonb)) x;
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and((data->>'varies')::boolean and (data->>'amount')::bigint = 8000 and data->>'description' = 'Energy')
   as ok_not1_a_variable_bill_says_it_varies from got where kind = 'bill_tomorrow';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── a balance reminder no longer true says nothing (review fix 9) ─────────
insert into notification_outbox(household_id, recipient, kind, payload)
values (:'hx', :'X', 'balance_reminder', '{"threshold": 100000}') returning id as stale_reminder \gset
set role authenticated;
set request.jwt.claim.sub = :'X';
select count(*) = 1 as ok_not1_review_balance_on from (select set_notification_prefs('{"balance":true}'::jsonb)) x;
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 0 as ok_not1_a_reminder_no_longer_true_is_not_sent from got where kind = 'balance_reminder';
select sent_at is not null as ok_not1_and_is_done from notification_outbox where id = :'stale_reminder';

-- ───────── push addresses: the push services only; the same phone's handover only (review fix 8) ─────────
set role authenticated;
set request.jwt.claim.sub = :'X';
select save_push_subscription('https://push.example.com/x', 'p', 'a');                     -- expect error: not a push service
select save_push_subscription('https://fcm.googleapis.com.example.com/x', 'p', 'a');      -- expect error: not a push service
select save_push_subscription('https://example.com/fcm.googleapis.com/x', 'p', 'a');      -- expect error: not a push service
select count(*) = 1 as ok_not1_apple_push from (select save_push_subscription('https://web.push.apple.com/QGsi', 'p', 'a')) x;
select count(*) = 1 as ok_not1_windows_push from (select save_push_subscription('https://wns2-par02p.notify.windows.com/w/?token=x', 'p', 'a')) x;
select count(*) = 1 as ok_not1_firefox_push from (select save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/x', 'p', 'a')) x;
set request.jwt.claim.sub = :'Z';
select create_household() is not null as ok_not1_review_another_household;
select save_push_subscription('https://web.push.apple.com/QGsi', 'p', 'a');               -- expect error: another household's phone
reset role;
select count(*) = 1 and bool_and(user_id = :'X') as ok_not1_another_household_never_takes_it
  from push_subscriptions where endpoint = 'https://web.push.apple.com/QGsi';

-- ───────── what push services say (review fix 7) ─────────
insert into push_subscriptions(endpoint, user_id, p256dh, auth, failing_since)
values ('https://fcm.googleapis.com/fcm/send/failing-long', :'X', 'p', 'a', now() - interval '25 hours'),
       ('https://fcm.googleapis.com/fcm/send/failing-new', :'X', 'p', 'a', null),
       ('https://fcm.googleapis.com/fcm/send/fine', :'X', 'p', 'a', now() - interval '3 hours');
set role authenticated;
set request.jwt.claim.sub = :'X';
select note_push_result('https://fcm.googleapis.com/fcm/send/fine', true);                -- expect error: the function's only
reset role;
set role service_role;
select note_push_result('https://fcm.googleapis.com/fcm/send/failing-long', false);
select note_push_result('https://fcm.googleapis.com/fcm/send/failing-new', false);
select note_push_result('https://fcm.googleapis.com/fcm/send/fine', true);
reset role;
select not exists (select 1 from push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/failing-long')
   as ok_not1_refused_for_a_day_is_forgotten;
select failing_since is not null as ok_not1_refused_once_is_kept_and_counted
  from push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/failing-new';
select last_ok_at is not null and failing_since is null as ok_not1_a_push_taken_marks_it_well
  from push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/fine';
update notification_outbox set sent_at = now() where sent_at is null;
