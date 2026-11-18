-- S8 (docs/slices/S8.md "Decisions made here → What is sent and when, Delivery, Switches, Subscriptions", "Data",
-- "Tests → SQL"; SPEC NOT-1, ACT-4, INB-2): the database fills the outbox, never a phone; the partner hears about a change
-- and the person who made it never does; the daily job; the switches at send selection; the subscriptions, the
-- preferences, the public key; nothing private is readable by a phone. Written before the build (ENGINEERING §5, tests
-- first by someone else). Runs after schema_test.sql. K (Kim, the cat) and L (Lee, the dog) start a household here;
-- P and Q, and M and N, start two more for the daily job (dated in 2025, passed in as "now"); S lives alone.
--
-- Interface these tests expect (names from the brief; choices made here where it leaves a shape open, which the
-- builder matches):
--   notification_outbox(id uuid default gen_random_uuid(), household_id, recipient uuid, kind text, ref_id uuid,
--     payload jsonb, created_at timestamptz default now(), sent_at timestamptz): no grants to anon or authenticated.
--     kind is one of src/core/notify.ts's NotificationKind ('entry_added', 'entry_changed', 'entry_deleted',
--     'entry_restored', 'settle_added', 'settle_changed', 'settle_deleted', 'comment', 'approval_waiting',
--     'approval_decided', 'bill_posted', 'bill_tomorrow', 'recap_ready', 'settle_day', 'balance_reminder').
--     ref_id: the entry, the settle-up or the change request; for a comment, the ENTRY it is on.
--   At once (triggers, actor = auth.uid()): an entry added, changed (a real change: an update or a replayed upsert that
--     changes nothing queues nothing), soft-deleted or restored; a settle-up added, changed or soft-deleted; a comment
--     added; a change request made (to the partner), decided (to the requester). Never for the actor; never without a
--     partner; nothing at once for a change with no actor (the nightly posting, the database owner).
--   next_notifications(p_limit int) returns table(id uuid, recipient uuid, kind text, data jsonb, names jsonb,
--     animal text, badge int), security definer, executable by service_role only (the push function):
--     at most p_limit unsent rows, oldest first, only kinds the recipient has switched on (approvals always);
--     data = src/core/notify.ts NotificationData built at send time: actor, ref, description, amount (pence),
--     comment, month, request, approved, threshold, and balance = { user id: member_net.net_pence } now;
--     names = { user id: display_name } for both members; animal = the actor's animal (null without one);
--     badge = the recipient's open Inbox items + change requests waiting for them.
--     It also tidies up as it goes: unsent rows older than 2 days are dropped (never returned), sent rows older than
--     7 days are removed.
--   queue_daily_notifications(p_now timestamptz default now()) returns int (rows queued): security definer, the
--     database owner only (cron). Does its work only when p_now is in the 08:00 hour in London, once per London date
--     (a second run that day queues nothing). For every household: bill_posted to both for each regular payment that
--     posted that day (an expense with recurring_id and occurrence_date = the London date); bill_tomorrow to both for each
--     active regular payment whose next occurrence is tomorrow; recap_ready to both on the 1st (data.month = last
--     month); settle_day to both when households.settle_day is that day of the month; balance_reminder to a person whose
--     own balance switch is on when the balance (by the entries' and settle-ups' own dates, as a statement reads it) has
--     been above their amount on each of the last 30 days.
--   notification_prefs(user_id uuid primary key, entries, settle_ups, comments, bills_today boolean default true,
--     bills_tomorrow boolean default false, recap boolean default true, balance boolean default false,
--     balance_threshold_pence bigint default 10000, updated_at): RLS own row; no row means the defaults.
--   set_notification_prefs(p jsonb): writes the caller's own row, only the keys given (the others keep their values or
--     defaults); a switch is a JSON boolean, the amount a whole number of pence above 0, else refused.
--   push_subscriptions(user_id, endpoint unique, p256dh, auth, created_at, last_ok_at): RLS own rows.
--   save_push_subscription(p_endpoint, p_p256dh, p_auth): upsert by endpoint; an endpoint another account had (the same
--     phone, someone else signed in) moves to the caller; only https endpoints. remove_push_subscription(p_endpoint):
--     the caller's own only.
--   push_config: exactly one row, no grants to anon or authenticated; token made by the database itself (a default),
--     vapid_public, vapid_private and function_url filled in by the function (null until then).
--   push_public_key() returns text: authenticated only; null until the function has made the keys.
--   kick_push(): no arguments; a no-op here (no pg_net); never executable by a phone.
--   Cron (the stand-in in auth_stub.sql here): 'smsm-push' every minute running kick_push, 'smsm-notify-daily' at
--     '7 7,8 * * *' running queue_daily_notifications; the brief lets both be skipped where pg_net is missing, so
--     here each is checked only if it is there.
\set A '11111111-1111-1111-1111-111111111111'
\set C '33333333-3333-3333-3333-333333333333'
\set K '1a1a1a1a-0000-4000-8000-000000000001'
\set L '1a1a1a1a-0000-4000-8000-000000000002'
\set M '1a1a1a1a-0000-4000-8000-000000000003'
\set N '1a1a1a1a-0000-4000-8000-000000000004'
\set S '1a1a1a1a-0000-4000-8000-000000000005'
\set P '1a1a1a1a-0000-4000-8000-000000000006'
\set Q '1a1a1a1a-0000-4000-8000-000000000007'
\set ep 'https://fcm.googleapis.com/fcm/send/test-endpoint-1'
reset role;
set request.jwt.claim.sub = '';
insert into auth.users values (:'K'), (:'L'), (:'M'), (:'N'), (:'S'), (:'P'), (:'Q') on conflict do nothing;
-- The earlier files' changes are already queued (the triggers ran for them): set them aside, so this file reads its own.
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── the household: Kim (the cat) and Lee (the dog) ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
select create_household() is not null as ok_not1_household;
select set_identity('Kim', 'cat');
select join_code as h1_code, id as h1 from households \gset
set request.jwt.claim.sub = :'L';
select join_household(:'h1_code') is not null as ok_not1_partner_joined;
select set_identity('Lee', 'dog');

-- ───────── NOT-1: the outbox and the keys are the database's; a phone reads only the public key ─────────
reset role;
select count(*) <= 1 as ok_not1_push_config_has_at_most_one_row from push_config;
insert into push_config(vapid_public) select null where not exists (select 1 from push_config);
select count(*) = 1 and bool_and(token is not null and length(token) >= 32) as ok_not1_the_database_makes_its_own_token from push_config;
select bool_and(vapid_public is null and vapid_private is null) as ok_not1_no_keys_until_the_function_makes_them from push_config;
insert into push_config(vapid_public, vapid_private, token) values ('x', 'y', 'z');          -- expect error: one row only
set role authenticated;
set request.jwt.claim.sub = :'K';
select push_public_key() is null as ok_not1_no_public_key_before_the_function_has_run;
reset role;
update push_config set vapid_public = 'BPublicKeyForTests', vapid_private = '{"kty":"EC","crv":"P-256"}',
       function_url = 'https://example.supabase.co/functions/v1/push';
set role authenticated;
set request.jwt.claim.sub = :'K';
select push_public_key() = 'BPublicKeyForTests' as ok_not1_a_phone_reads_the_public_key;
select count(*) from push_config;                                                            -- expect error: the private key is never readable by a phone
select count(*) from notification_outbox;                                                    -- expect error: the outbox is never readable by a phone
insert into notification_outbox(household_id, recipient, kind, payload) values (my_household(), :'L', 'entry_added', '{}'); -- expect error: phones never fill the outbox
select kick_push();                                                                          -- expect error: a phone can't call the push
select next_notifications(100);                                                              -- expect error: a phone can't read what is waiting
select queue_daily_notifications(now());                                                     -- expect error: a phone can't run the daily job
reset role;
set role anon;
select push_public_key();                                                                    -- expect error: signed in only
select count(*) from push_config;                                                            -- expect error: anon reads nothing
reset role;
select not has_table_privilege('authenticated', 'public.push_config', 'select, insert, update, delete')
   and not has_table_privilege('anon', 'public.push_config', 'select, insert, update, delete') as ok_not1_no_grants_on_push_config;
select not has_table_privilege('authenticated', 'public.notification_outbox', 'select, insert, update, delete')
   and not has_table_privilege('anon', 'public.notification_outbox', 'select, insert, update, delete') as ok_not1_no_grants_on_the_outbox;
select has_function_privilege('service_role', 'public.next_notifications(integer)', 'execute') as ok_not1_the_function_reads_the_outbox;
select not has_function_privilege('authenticated', 'public.kick_push()', 'execute')
   and not has_function_privilege('anon', 'public.kick_push()', 'execute') as ok_not1_kick_push_is_not_for_phones;
select not has_function_privilege('authenticated', 'public.queue_daily_notifications(timestamptz)', 'execute')
   and not has_function_privilege('anon', 'public.queue_daily_notifications(timestamptz)', 'execute') as ok_not1_the_daily_job_is_not_for_phones;
select prosecdef as ok_not1_next_notifications_is_security_definer from pg_proc where oid = 'public.next_notifications(integer)'::regprocedure;
-- With no pg_net here, the push call is a no-op that never fails (and so never stops a change being saved).
select count(*) = 1 as ok_not1_kick_push_is_a_no_op_without_pg_net from (select kick_push()) k;

-- ───────── NOT-1: the partner added an entry: queued at once for the partner, never for the one who added it ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
insert into expenses(id, household_id, description, amount_pence, paid, shares)
values (gen_random_uuid(), my_household(), 'Tesco', 4250, jsonb_build_object(:'K', 4250), jsonb_build_object(:'K', 2125, :'L', 2125))
returning id as e1 \gset
reset role;
select count(*) = 1 as ok_not1_partner_hears_an_entry_was_added from notification_outbox
 where household_id = :'h1' and recipient = :'L' and kind = 'entry_added' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_not1_nothing_about_ones_own_entry from notification_outbox where recipient = :'K' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'K' and data->>'ref' = :'e1' and data->>'description' = 'Tesco'
                                 and (data->>'amount')::bigint = 4250 and names->>:'K' = 'Kim' and names->>:'L' = 'Lee' and animal = 'cat')
   as ok_not1_selection_carries_who_what_and_how_much from got where recipient = :'L' and kind = 'entry_added';
select (data->'balance'->>:'K')::bigint = 2125 and (data->'balance'->>:'L')::bigint = -2125
   as ok_not1_the_balance_is_member_net from got where recipient = :'L' and kind = 'entry_added';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── NOT-1: changed, changed by the other, deleted, restored ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
update expenses set amount_pence = 4520, paid = jsonb_build_object(:'K', 4520), shares = jsonb_build_object(:'K', 2260, :'L', 2260) where id = :'e1';
reset role;
select count(*) = 1 as ok_not1_partner_hears_an_entry_changed from notification_outbox
 where recipient = :'L' and kind = 'entry_changed' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_not1_nothing_about_ones_own_change from notification_outbox where recipient = :'K' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and((data->>'amount')::bigint = 4520 and (data->'balance'->>:'L')::bigint = -2260)
   as ok_not1_a_change_carries_the_new_amount_and_balance from got where recipient = :'L' and kind = 'entry_changed';
update notification_outbox set sent_at = now() where sent_at is null;

set role authenticated;
set request.jwt.claim.sub = :'L';
update expenses set description = 'Tesco Metro' where id = :'e1';
reset role;
select count(*) = 1 as ok_not1_either_one_changing_tells_the_other from notification_outbox
 where recipient = :'K' and kind = 'entry_changed' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_not1_lee_hears_nothing_of_lees_change from notification_outbox where recipient = :'L' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'L' and data->>'description' = 'Tesco Metro' and animal = 'dog')
   as ok_not1_the_actor_is_whoever_changed_it from got where recipient = :'K' and kind = 'entry_changed';
update notification_outbox set sent_at = now() where sent_at is null;

-- A write that changes nothing (a phone replaying its queue, OFF-7) tells nobody anything.
set role authenticated;
set request.jwt.claim.sub = :'K';
update expenses set description = description where id = :'e1';
insert into expenses(id, household_id, description, amount_pence, paid, shares)
select id, household_id, description, amount_pence, paid, shares from expenses where id = :'e1'
on conflict (id) do update set description = excluded.description, amount_pence = excluded.amount_pence, paid = excluded.paid, shares = excluded.shares;
reset role;
select count(*) = 0 as ok_not1_a_replayed_write_that_changes_nothing_is_silent from notification_outbox where household_id = :'h1' and sent_at is null;

set role authenticated;
set request.jwt.claim.sub = :'K';
update expenses set deleted_at = now() where id = :'e1';
reset role;
select count(*) = 1 as ok_not1_partner_hears_an_entry_was_deleted from notification_outbox
 where recipient = :'L' and kind = 'entry_deleted' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_not1_a_delete_is_not_also_a_change from notification_outbox where kind = 'entry_changed' and household_id = :'h1' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'description' = 'Tesco Metro' and (data->>'amount')::bigint = 4520
                                 and (data->'balance'->>:'K')::bigint = 0 and (data->'balance'->>:'L')::bigint = 0)
   as ok_not1_a_delete_says_what_went_and_the_balance_after from got where recipient = :'L' and kind = 'entry_deleted';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'K';
update expenses set deleted_at = null where id = :'e1';
reset role;
select count(*) = 1 as ok_not1_partner_hears_an_entry_was_restored from notification_outbox
 where recipient = :'L' and kind = 'entry_restored' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_not1_nothing_for_the_one_who_restored from notification_outbox where recipient = :'K' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── NOT-1: settle-ups ─────────
set role authenticated;
set request.jwt.claim.sub = :'L';
insert into settlements(household_id, from_user, to_user, amount_pence) values (my_household(), :'L', :'K', 2260) returning id as s1 \gset
reset role;
select count(*) = 1 as ok_not1_partner_hears_of_a_settle_up from notification_outbox
 where recipient = :'K' and kind = 'settle_added' and ref_id = :'s1' and sent_at is null;
select count(*) = 0 as ok_not1_nothing_about_ones_own_settle_up from notification_outbox where recipient = :'L' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'L' and data->>'ref' = :'s1' and (data->>'amount')::bigint = 2260
                                 and (data->'balance'->>:'K')::bigint = 0 and (data->'balance'->>:'L')::bigint = 0)
   as ok_not1_a_settle_up_carries_its_amount_and_the_balance from got where recipient = :'K' and kind = 'settle_added';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'L';
update settlements set amount_pence = 3000 where id = :'s1';
reset role;
select count(*) = 1 as ok_not1_partner_hears_a_settle_up_changed from notification_outbox
 where recipient = :'K' and kind = 'settle_changed' and ref_id = :'s1' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'L';
update settlements set deleted_at = now() where id = :'s1';
reset role;
select count(*) = 1 as ok_not1_partner_hears_a_settle_up_deleted from notification_outbox
 where recipient = :'K' and kind = 'settle_deleted' and ref_id = :'s1' and sent_at is null;
select count(*) = 0 as ok_not1_nothing_about_ones_own_settle_up_changes from notification_outbox where recipient = :'L' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── ACT-4 NOT-1: a comment ─────────
set role authenticated;
set request.jwt.claim.sub = :'L';
insert into comments(household_id, expense_id, author, body) values (my_household(), :'e1', :'L', 'was this the big shop?');
reset role;
select count(*) = 1 as ok_act4_the_partner_is_notified_of_a_comment from notification_outbox
 where recipient = :'K' and kind = 'comment' and ref_id = :'e1' and sent_at is null;
select count(*) = 0 as ok_act4_nothing_about_ones_own_comment from notification_outbox where recipient = :'L' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'L' and data->>'ref' = :'e1' and data->>'description' = 'Tesco Metro'
                                 and data->>'comment' = 'was this the big shop?')
   as ok_act4_the_comment_carries_its_words_and_its_entry from got where recipient = :'K' and kind = 'comment';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'K';
insert into comments(household_id, expense_id, author, body) values (my_household(), :'e1', :'K', 'Yes, the big one');
reset role;
select count(*) = 1 and bool_and(recipient = :'L') as ok_act4_and_the_other_way_round from notification_outbox
 where household_id = :'h1' and kind = 'comment' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── NOT-1: approvals, always on; the badge (INB-2) ─────────
-- Lee switches every switch off: a change request still reaches Lee.
set role authenticated;
set request.jwt.claim.sub = :'L';
select count(*) = 1 as ok_not1_lee_turns_everything_off from (select set_notification_prefs(
  '{"entries":false,"settle_ups":false,"comments":false,"bills_today":false,"bills_tomorrow":false,"recap":false,"balance":false}'::jsonb)) x;
-- An Inbox item waiting for the household.
set request.jwt.claim.sub = :'K';
insert into inbox_items(household_id, source, payload) values (my_household(), 'scan', '{}'::jsonb);
select request_change('default_ratio', jsonb_build_object('ratio', jsonb_build_object(:'K', 60, :'L', 40))) as rid \gset
reset role;
select count(*) = 1 as ok_not1_a_request_waiting_reaches_the_partner from notification_outbox
 where recipient = :'L' and kind = 'approval_waiting' and ref_id = :'rid' and sent_at is null;
select count(*) = 0 as ok_not1_not_the_one_who_asked from notification_outbox where recipient = :'K' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'K' and data->>'request' = 'default_ratio')
   as ok_not1_approvals_are_always_on from got where recipient = :'L' and kind = 'approval_waiting';
select bool_and(badge = 2) as ok_inb2_badge_counts_the_inbox_and_the_approval_waiting from got where recipient = :'L' and kind = 'approval_waiting';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'L';
select decide_change(:'rid', true);
reset role;
select count(*) = 1 as ok_not1_the_requester_hears_the_decision from notification_outbox
 where recipient = :'K' and kind = 'approval_decided' and ref_id = :'rid' and sent_at is null;
select count(*) = 0 as ok_not1_not_the_one_who_decided from notification_outbox where recipient = :'L' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'actor' = :'L' and (data->>'approved')::boolean and badge = 1)
   as ok_not1_the_decision_says_yes_and_the_badge_counts_the_inbox from got where recipient = :'K' and kind = 'approval_decided';
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── NOT-1: each type its own switch, respected when the function picks what to send ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Bakery', 600, jsonb_build_object(:'K', 600), jsonb_build_object(:'K', 300, :'L', 300));
insert into settlements(household_id, from_user, to_user, amount_pence) values (my_household(), :'K', :'L', 100);
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 0 as ok_not1_entries_off_means_no_entry_notifications from got where recipient = :'L' and kind like 'entry_%';
select count(*) = 0 as ok_not1_settle_ups_off_means_no_settle_up_notifications from got where recipient = :'L' and kind like 'settle_%';
update notification_outbox set sent_at = now() where sent_at is null;
set role authenticated;
set request.jwt.claim.sub = :'L';
select count(*) = 1 as ok_not1_lee_turns_entries_back_on from (select set_notification_prefs('{"entries":true}'::jsonb)) x;
set request.jwt.claim.sub = :'K';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Florist', 2000, jsonb_build_object(:'K', 2000), jsonb_build_object(:'K', 1000, :'L', 1000));
insert into settlements(household_id, from_user, to_user, amount_pence) values (my_household(), :'K', :'L', 200);
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 1 and bool_and(data->>'description' = 'Florist') as ok_not1_a_switch_turned_on_sends_again
  from got where recipient = :'L' and kind = 'entry_added';
select count(*) = 0 as ok_not1_one_switch_does_not_turn_on_another from got where recipient = :'L' and kind like 'settle_%';
update notification_outbox set sent_at = now() where sent_at is null;

-- At most p_limit, oldest first.
set role authenticated;
set request.jwt.claim.sub = :'K';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'First', 100, jsonb_build_object(:'K', 100), jsonb_build_object(:'K', 50, :'L', 50));
select pg_sleep(0.01);
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Second', 100, jsonb_build_object(:'K', 100), jsonb_build_object(:'K', 50, :'L', 50));
reset role;
drop table if exists got;
create temp table got as select * from next_notifications(1);
select count(*) = 1 and bool_and(data->>'description' = 'First') as ok_not1_at_most_the_limit_oldest_first from got;
update notification_outbox set sent_at = now() where sent_at is null;

-- Waiting too long, or long sent: tidied away.
insert into notification_outbox(household_id, recipient, kind, ref_id, payload, created_at)
values (:'h1', :'K', 'entry_added', :'e1', '{}'::jsonb, now() - interval '3 days') returning id as stale \gset
insert into notification_outbox(household_id, recipient, kind, ref_id, payload, created_at, sent_at)
values (:'h1', :'K', 'entry_added', :'e1', '{}'::jsonb, now() - interval '9 days', now() - interval '8 days') returning id as old_sent \gset
insert into notification_outbox(household_id, recipient, kind, ref_id, payload, created_at, sent_at)
values (:'h1', :'K', 'entry_added', :'e1', '{}'::jsonb, now() - interval '1 day', now() - interval '1 day') returning id as recent_sent \gset
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 0 as ok_not1_older_than_two_days_is_never_sent from got where id = :'stale';
select not exists (select 1 from notification_outbox where id = :'stale') as ok_not1_older_than_two_days_unsent_is_dropped;
select not exists (select 1 from notification_outbox where id = :'old_sent')
   and exists (select 1 from notification_outbox where id = :'recent_sent') as ok_not1_sent_rows_go_after_seven_days;

-- Someone alone in a household has nobody to tell.
set role authenticated;
set request.jwt.claim.sub = :'S';
select create_household() as solo \gset
select set_identity('Solo', 'cat');
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Alone', 500, jsonb_build_object(:'S', 500), jsonb_build_object(:'S', 500));
reset role;
select count(*) = 0 as ok_not1_no_partner_no_notification from notification_outbox where household_id = :'solo';

-- ───────── NOT-1: the preferences, per person ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
select count(*) = 1 as ok_not1_kim_sets_one_switch from (select set_notification_prefs('{"comments":false}'::jsonb)) x;
select count(*) = 1 and bool_and(user_id = :'K' and entries and settle_ups and not comments and bills_today and not bills_tomorrow
                                 and recap and not balance and balance_threshold_pence = 10000)
   as ok_not1_the_others_keep_their_defaults_and_kim_reads_only_her_own from notification_prefs;
select count(*) = 1 as ok_not1_kim_sets_more from (select set_notification_prefs('{"comments":true,"balance":true,"balance_threshold_pence":15000}'::jsonb)) x;
select comments and balance and balance_threshold_pence = 15000 and not bills_tomorrow and entries
   as ok_not1_only_the_keys_given_change from notification_prefs where user_id = :'K';
select set_notification_prefs('{"balance_threshold_pence":-5}'::jsonb);                     -- expect error: the amount is above zero
select set_notification_prefs('{"balance_threshold_pence":0}'::jsonb);                      -- expect error: the amount is above zero
select set_notification_prefs('{"balance_threshold_pence":12.5}'::jsonb);                   -- expect error: whole pence
select set_notification_prefs('{"entries":"maybe"}'::jsonb);                                -- expect error: a switch is on or off
insert into notification_prefs(user_id) values (:'L');                                      -- expect error: not one's own row
set request.jwt.claim.sub = :'L';
select count(*) = 1 and bool_and(user_id = :'L' and entries and not settle_ups and not comments)
   as ok_not1_lee_reads_only_lees_own_untouched_by_kim from notification_prefs;
reset role;
set role anon;
select set_notification_prefs('{"entries":false}'::jsonb);                                  -- expect error: signed in only
reset role;

-- ───────── NOT-1: this phone's subscription ─────────
set role authenticated;
set request.jwt.claim.sub = :'K';
select count(*) = 1 as ok_not1_kim_saves_this_phone from (select save_push_subscription(:'ep', 'p256dh-kim', 'auth-kim')) x;
select count(*) = 1 and bool_and(user_id = :'K' and p256dh = 'p256dh-kim' and auth = 'auth-kim') as ok_not1_kim_reads_her_subscription from push_subscriptions;
set request.jwt.claim.sub = :'L';
select count(*) = 0 as ok_not1_lee_reads_none_of_kims from push_subscriptions;
select count(*) = 1 as ok_not1_lee_signs_in_on_the_same_phone from (select save_push_subscription(:'ep', 'p256dh-lee', 'auth-lee')) x;
reset role;
select count(*) = 1 and bool_and(user_id = :'L' and p256dh = 'p256dh-lee' and auth = 'auth-lee')
   as ok_not1_the_endpoint_moves_to_whoever_is_signed_in from push_subscriptions where endpoint = :'ep';
set role authenticated;
set request.jwt.claim.sub = :'K';
select count(*) = 0 as ok_not1_kim_no_longer_has_it from push_subscriptions;
select count(*) = 1 as ok_not1_kim_asks_to_remove_it from (select remove_push_subscription(:'ep')) x;
reset role;
select count(*) = 1 as ok_not1_removing_someone_elses_does_nothing from push_subscriptions where endpoint = :'ep';
set role authenticated;
set request.jwt.claim.sub = :'L';
select count(*) = 1 as ok_not1_lee_saves_again from (select save_push_subscription(:'ep', 'p256dh-new', 'auth-new')) x;
reset role;
select count(*) = 1 and bool_and(p256dh = 'p256dh-new' and auth = 'auth-new') as ok_not1_saving_again_updates_not_duplicates
  from push_subscriptions where endpoint = :'ep';
set role authenticated;
set request.jwt.claim.sub = :'L';
select save_push_subscription('http://192.168.0.1/push', 'p', 'a');                         -- expect error: https only
select save_push_subscription('', 'p', 'a');                                                -- expect error: no endpoint
insert into push_subscriptions(user_id, endpoint, p256dh, auth) values (:'K', 'https://push.example.com/x', 'p', 'a'); -- expect error: not one's own
select count(*) = 1 as ok_not1_lee_turns_this_phone_off from (select remove_push_subscription(:'ep')) x;
reset role;
select count(*) = 0 as ok_not1_turning_off_removes_the_subscription from push_subscriptions where endpoint = :'ep';
set role anon;
select save_push_subscription(:'ep', 'p', 'a');                                             -- expect error: signed in only
reset role;

-- ───────── NOT-1: the daily job ─────────
-- P (Pat, cat) and Q (Quinn, dog), settle day the 1st. Pat paid £300.00 for both on 15 Jan 2025, so Quinn has owed Pat
-- at least £150.00 ever since (£765.00 now, with everything below). Rent posted itself on 1 Mar 2025 (no one did it); Water (it varies) posts on 2 Mar; Gym is paused.
set role authenticated;
set request.jwt.claim.sub = :'P';
select create_household() as h3 \gset
select set_identity('Pat', 'cat');
select join_code as h3_code from households \gset
set request.jwt.claim.sub = :'Q';
select join_household(:'h3_code') is not null as ok_not1_second_household;
select set_identity('Quinn', 'dog');
select set_settle_day(1);
-- Pat keeps the balance reminder at £100.00; Quinn wants the day-before heads-up.
set request.jwt.claim.sub = :'P';
select count(*) = 1 as ok_not1_pat_wants_the_balance_reminder from (select set_notification_prefs('{"balance":true}'::jsonb)) x;
set request.jwt.claim.sub = :'Q';
select count(*) = 1 as ok_not1_quinn_wants_bills_tomorrow from (select set_notification_prefs('{"bills_tomorrow":true}'::jsonb)) x;
reset role;
set request.jwt.claim.sub = '';
insert into expenses(household_id, description, amount_pence, date, paid, shares, created_at, created_by, updated_by)
values (:'h3', 'Sofa', 30000, '2025-01-15', jsonb_build_object(:'P', 30000), jsonb_build_object(:'P', 15000, :'Q', 15000),
        '2025-01-15 12:00:00+00', :'P', :'P');
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, end_date, posted_count)
values (:'h3', 'Rent', 120000, jsonb_build_object(:'P', 120000), jsonb_build_object(:'P', 60000, :'Q', 60000), 'monthly', '2025-02-01', '2025-03-31', 2)
returning id as rent \gset
insert into expenses(household_id, description, amount_pence, date, paid, shares, source, recurring_id, occurrence_date, created_at)
values (:'h3', 'Rent', 120000, '2025-03-01', jsonb_build_object(:'P', 120000), jsonb_build_object(:'P', 60000, :'Q', 60000),
        'recurring', :'rent', '2025-03-01', '2025-03-01 01:17:00+00')
returning id as rent_posted \gset
-- Something in February (last month's recap has something in it) and in June (for the summer run below).
insert into expenses(household_id, description, amount_pence, date, paid, shares, created_at, created_by, updated_by)
values (:'h3', 'Groceries', 2000, '2025-02-10', jsonb_build_object(:'P', 2000), jsonb_build_object(:'P', 1000, :'Q', 1000),
        '2025-02-10 12:00:00+00', :'P', :'P'),
       (:'h3', 'Picnic', 1000, '2025-06-10', jsonb_build_object(:'P', 1000), jsonb_build_object(:'P', 500, :'Q', 500),
        '2025-06-10 12:00:00+00', :'P', :'P');
insert into recurring(household_id, description, amount_pence, amount_varies, paid, shares, frequency, start_date, end_date)
values (:'h3', 'Water', 2874, true, jsonb_build_object(:'Q', 2874), jsonb_build_object(:'P', 1437, :'Q', 1437), 'monthly', '2025-03-02', '2025-03-31');
insert into recurring(household_id, description, amount_pence, paid, shares, frequency, start_date, end_date, active)
values (:'h3', 'Gym', 3000, jsonb_build_object(:'Q', 3000), jsonb_build_object(:'P', 1500, :'Q', 1500), 'monthly', '2025-03-02', '2025-03-31', false);
-- A change with no one signed in (the nightly posting) tells nobody at once.
select count(*) = 0 as ok_not1_the_nightly_posting_sends_nothing_at_once from notification_outbox where household_id = :'h3';

-- M (Mo) and N (Nic): Mo paid £300.00 for both on 19 Feb 2025, only ten days before 1 Mar; no settle day.
set role authenticated;
set request.jwt.claim.sub = :'M';
select create_household() as h2 \gset
select set_identity('Mo', 'cat');
select join_code as h2_code from households \gset
select count(*) = 1 as ok_not1_mo_wants_the_balance_reminder from (select set_notification_prefs('{"balance":true}'::jsonb)) x;
set request.jwt.claim.sub = :'N';
select join_household(:'h2_code') is not null as ok_not1_third_household;
select set_identity('Nic', 'dog');
reset role;
set request.jwt.claim.sub = '';
insert into expenses(household_id, description, amount_pence, date, paid, shares, created_at, created_by, updated_by)
values (:'h2', 'Boiler', 30000, '2025-02-19', jsonb_build_object(:'M', 30000), jsonb_build_object(:'M', 15000, :'N', 15000),
        '2025-02-19 12:00:00+00', :'M', :'M');
update notification_outbox set sent_at = now() where sent_at is null;

-- Only in the 08:00 hour, London time: 07:07 and 08:07 UTC both run, and one of them is 08:07 in London.
select queue_daily_notifications('2025-03-01 07:07:00 Europe/London') = 0 as ok_not1_daily_job_waits_for_eight_in_london;
select count(*) = 0 as ok_not1_nothing_queued_at_seven from notification_outbox where household_id in (:'h3', :'h2') and sent_at is null;
select queue_daily_notifications('2025-03-01 08:07:00 Europe/London') > 0 as ok_not1_daily_job_runs_at_eight_in_london;
select queue_daily_notifications('2025-03-01 08:07:30 Europe/London') = 0 as ok_not1_daily_job_runs_once_a_day;
select count(*) = 2 and count(distinct recipient) = 2 as ok_not1_posted_today_goes_to_both
  from notification_outbox where household_id = :'h3' and kind = 'bill_posted' and sent_at is null;
select count(*) = 2 and count(distinct recipient) = 2 as ok_not1_the_recap_is_ready_on_the_first_for_both
  from notification_outbox where household_id = :'h3' and kind = 'recap_ready' and sent_at is null;
select count(*) = 2 and count(distinct recipient) = 2 as ok_not1_settle_day_goes_to_both
  from notification_outbox where household_id = :'h3' and kind = 'settle_day' and sent_at is null;
select count(*) = 0 as ok_not1_no_settle_day_where_none_is_set from notification_outbox where household_id = :'h2' and kind = 'settle_day' and sent_at is null;
select count(*) = 0 as ok_not1_ten_days_owed_is_not_thirty from notification_outbox where household_id = :'h2' and kind = 'balance_reminder' and sent_at is null;
drop table if exists got;
create temp table got as select * from next_notifications(100);
select count(*) = 2 and bool_and(data->>'description' = 'Rent' and (data->>'amount')::bigint = 120000
                                 and (data->'balance'->>:'P')::bigint = 76500 and (data->'balance'->>:'Q')::bigint = -76500)
   as ok_not1_posted_today_says_what_and_the_balance from got where recipient in (:'P', :'Q') and kind = 'bill_posted';
select count(*) = 2 and bool_and(data->>'month' = '2025-02') as ok_not1_the_recap_is_for_last_month
  from got where recipient in (:'P', :'Q') and kind = 'recap_ready';
select count(*) = 2 and bool_and((data->'balance'->>:'P')::bigint = 76500) as ok_not1_settle_day_carries_the_balance
  from got where recipient in (:'P', :'Q') and kind = 'settle_day';
select count(*) = 1 and bool_and(recipient = :'Q' and data->>'description' = 'Water' and (data->>'amount')::bigint = 2874)
   as ok_not1_bills_tomorrow_only_for_whoever_switched_it_on_never_a_paused_one from got where recipient in (:'P', :'Q') and kind = 'bill_tomorrow';
select count(*) = 1 and bool_and(recipient = :'P' and (data->>'threshold')::bigint = 10000 and (data->'balance'->>:'Q')::bigint = -76500)
   as ok_not1_thirty_days_above_the_amount_reminds_whoever_switched_it_on from got where recipient in (:'P', :'Q') and kind = 'balance_reminder';
select count(*) = 0 as ok_not1_balance_reminder_off_by_default from got where recipient in (:'M', :'N') and kind = 'balance_reminder';
update notification_outbox set sent_at = now() where sent_at is null;

-- The next day: not the 1st, not settle day, nothing posted, nothing due tomorrow.
select queue_daily_notifications('2025-03-02 08:07:00 Europe/London') >= 0 as ok_not1_the_next_day_runs;
select count(*) = 0 as ok_not1_the_next_day_has_nothing_for_pat_and_quinn
  from notification_outbox where household_id = :'h3' and kind in ('recap_ready', 'settle_day', 'bill_posted', 'bill_tomorrow') and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;
-- In summer London is an hour ahead: 07:07 UTC is 08:07 there, 06:07 UTC is not.
select queue_daily_notifications('2025-07-01 06:07:00+00') = 0 as ok_not1_summer_seven_in_london_waits;
select queue_daily_notifications('2025-07-01 07:07:00+00') > 0 as ok_not1_summer_eight_in_london_runs;
select count(*) = 2 and count(distinct recipient) = 2 as ok_not1_summer_recap_for_june
  from notification_outbox where household_id = :'h3' and kind = 'recap_ready' and sent_at is null;
update notification_outbox set sent_at = now() where sent_at is null;

-- ───────── NOT-1: the schedule (each only if pg_net let it be scheduled) ─────────
select count(*) = 0 or bool_and(schedule = '* * * * *' and command ilike '%kick_push%') as ok_not1_push_every_minute
  from cron.job where jobname = 'smsm-push';
select count(*) = 0 or bool_and(schedule = '7 7,8 * * *' and command ilike '%queue_daily_notifications%') as ok_not1_daily_at_seven_and_eight_utc
  from cron.job where jobname = 'smsm-notify-daily';
select count(*) <= 1 as ok_not1_one_daily_job from cron.job where jobname = 'smsm-notify-daily';
