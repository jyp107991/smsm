-- The owner's check of regular payments (REC-1, REC-2, REC-6, ACT-2): adding, changing, pausing, resuming and
-- ending, through exactly the writes the app makes (src/data/api.ts upsertRecurring):
--   a new template: PostgREST upsert, insert … on conflict (id) do update set <every column sent> = excluded.…;
--   an edit, a pause, a resume or an end: PostgREST update of only the columns that changed (by id);
--   a phone that can't see the row falls back to the upsert, which is refused.
-- Runs after schema_test.sql (A and B share a household). D is a person with a household of their own.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set D '44444444-4444-4444-4444-444444444444'
\set BOX 'b1000000-0000-4000-8000-000000000001'
\set CLEANER 'b1000000-0000-4000-8000-000000000002'
\set LATER 'b1000000-0000-4000-8000-000000000003'
\set STOPS 'b1000000-0000-4000-8000-000000000004'
\set PRICE 'b1000000-0000-4000-8000-000000000005'
reset role;
set request.jwt.claim.sub = '';
select household_id as hid from members where user_id = :'A' \gset
select (now() at time zone 'Europe/London')::date as uk_today \gset
select id as household_cat from categories where household_id = :'hid' and name = 'Household' \gset
select id as gifts_cat from categories where household_id = :'hid' and name = 'Gifts' \gset
insert into auth.users values (:'D') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = :'D';
select create_household() is not null as ok_owner_check_d_has_a_household_of_their_own;
select my_household() as d_hid \gset

-- ───────── Add: the app's upsert, as Jae; due today, so the next post makes it money once ─────────
set request.jwt.claim.sub = :'A';
insert into recurring as r (id, household_id, description, amount_pence, amount_varies, category_id, paid, paid_via, split_mode,
                            split_params, shares, is_subscription, frequency, every, start_date, end_date, active, notes)
values (:'BOX', :'hid', 'Window box', 3333, false, :'household_cat', jsonb_build_object(:'B', 3333), 'person', 'ratio',
        jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 1666, :'B', 1667), false, 'monthly', 1, :'uk_today', null, true, null)
on conflict (id) do update set description = excluded.description, amount_pence = excluded.amount_pence, amount_varies = excluded.amount_varies,
  category_id = excluded.category_id, paid = excluded.paid, paid_via = excluded.paid_via, split_mode = excluded.split_mode,
  split_params = excluded.split_params, shares = excluded.shares, is_subscription = excluded.is_subscription, frequency = excluded.frequency,
  every = excluded.every, start_date = excluded.start_date, end_date = excluded.end_date, active = excluded.active, notes = excluded.notes
returning (posted_count = 0 and created_by = :'A' and active) as ok_rec1_upsert_creates_the_template;
select count(*) = 1 as ok_act2_creation_logged_with_who
from activity where entity = 'recurring' and entity_id = :'BOX' and action = 'created' and actor = :'A';
select net_pence as net_a_before from member_net where user_id = :'A' \gset
select post_due_recurring() >= 1 as ok_rec2_due_today_posts;
select count(*) = 1 and bool_and(amount_pence = 3333 and date = :'uk_today' and (shares->>:'A')::bigint = 1666)
   as ok_rec2_posted_once_at_its_amount from expenses where recurring_id = :'BOX';
select net_pence = :net_a_before - 1666 as ok_rec2_balance_moves_by_exactly_the_share from member_net where user_id = :'A';
select post_due_recurring() >= 0 as ok_rec2_posting_again_runs;
select count(*) = 1 as ok_rec2_posting_again_posts_nothing_more from expenses where recurring_id = :'BOX';
-- The queue replays the same upsert (the answer was lost): nothing doubles, and the server's count stays.
insert into recurring as r (id, household_id, description, amount_pence, amount_varies, category_id, paid, paid_via, split_mode,
                            split_params, shares, is_subscription, frequency, every, start_date, end_date, active, notes)
values (:'BOX', :'hid', 'Window box', 3333, false, :'household_cat', jsonb_build_object(:'B', 3333), 'person', 'ratio',
        jsonb_build_object(:'A', 50, :'B', 50), jsonb_build_object(:'A', 1666, :'B', 1667), false, 'monthly', 1, :'uk_today', null, true, null)
on conflict (id) do update set description = excluded.description, amount_pence = excluded.amount_pence, amount_varies = excluded.amount_varies,
  category_id = excluded.category_id, paid = excluded.paid, paid_via = excluded.paid_via, split_mode = excluded.split_mode,
  split_params = excluded.split_params, shares = excluded.shares, is_subscription = excluded.is_subscription, frequency = excluded.frequency,
  every = excluded.every, start_date = excluded.start_date, end_date = excluded.end_date, active = excluded.active, notes = excluded.notes
returning (posted_count = 1) as ok_rec1_replayed_upsert_keeps_the_count;
select count(*) = 1 as ok_rec1_replayed_upsert_is_one_template from recurring where id = :'BOX';
select count(*) = 0 as ok_act2_replay_that_changes_nothing_logs_nothing
from activity where entity = 'recurring' and entity_id = :'BOX' and action = 'edited';
select post_due_recurring() >= 0 and (select count(*) = 1 from expenses where recurring_id = :'BOX') as ok_rec2_replay_posts_nothing_again;

-- ───────── Modify: the app's update of the columns that changed ─────────
-- The amount: £33.33 → £40.00 (the money rebuilt by the phone, as for an entry).
update recurring set amount_pence = 4000, paid = jsonb_build_object(:'B', 4000), shares = jsonb_build_object(:'A', 2000, :'B', 2000)
where id = :'BOX'
returning (amount_pence = 4000 and posted_count = 1) as ok_rec6_amount_changed;
select count(*) = 1 and bool_and(amount_pence = 3333 and (shares->>:'A')::bigint = 1666 and description = 'Window box')
   as ok_rec6_posted_occurrence_untouched_by_the_new_amount from expenses where recurring_id = :'BOX';
select net_pence = :net_a_before - 1666 as ok_rec6_balance_untouched_by_the_new_amount from member_net where user_id = :'A';
select count(*) = 1 as ok_act2_amount_change_logged_before_and_after
from activity where entity = 'recurring' and entity_id = :'BOX' and action = 'edited' and actor = :'A'
  and (summary->'amount_pence'->>'before')::bigint = 3333 and (summary->'amount_pence'->>'after')::bigint = 4000;
-- The description, the payer, the split and the category, in one save.
update recurring set description = 'Window boxes', paid = jsonb_build_object(:'A', 4000), split_params = jsonb_build_object(:'A', 60, :'B', 40),
       shares = jsonb_build_object(:'A', 2400, :'B', 1600), category_id = :'gifts_cat'
where id = :'BOX';
select description = 'Window boxes' and paid = jsonb_build_object(:'A', 4000) and split_params = jsonb_build_object(:'A', 60, :'B', 40)
       and shares = jsonb_build_object(:'A', 2400, :'B', 1600) and category_id = :'gifts_cat'
   as ok_rec1_description_payer_split_category_kept from recurring where id = :'BOX';
select count(*) = 1 as ok_act2_details_change_logged
from activity where entity = 'recurring' and entity_id = :'BOX' and action = 'edited'
  and summary ?& array['description', 'paid', 'split_params', 'shares', 'category_id'] and not summary ? 'amount_pence';
select count(*) = 1 and bool_and(description = 'Window box' and paid = jsonb_build_object(:'B', 3333))
   as ok_rec6_posted_occurrence_keeps_its_own_details from expenses where recurring_id = :'BOX';
-- Money that doesn't add up is refused, as for an entry.
update recurring set amount_pence = 5000 where id = :'BOX';                               -- expect error: paid and shares no longer sum to the amount

-- The partner edits the same template: Sam's change lands on Jae's, column by column.
set request.jwt.claim.sub = :'B';
update recurring set notes = 'The one on the balcony' where id = :'BOX'
returning (notes = 'The one on the balcony' and description = 'Window boxes' and amount_pence = 4000) as ok_rec1_partner_edits_the_same_template;
select count(*) = 1 as ok_act2_partner_edit_logged_as_the_partner
from activity where entity = 'recurring' and entity_id = :'BOX' and action = 'edited' and actor = :'B' and summary ? 'notes';
set request.jwt.claim.sub = :'A';

-- ───────── How often and the start: free before anything posts; after, posted days never move ─────────
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'LATER', :'hid', 'Gym', 2500, jsonb_build_object(:'A', 2500), jsonb_build_object(:'A', 1250, :'B', 1250), 'monthly', :'uk_today'::date + 10);
update recurring set frequency = 'weekly', every = 3, start_date = :'uk_today'::date + 5 where id = :'LATER'
returning (frequency = 'weekly' and every = 3 and start_date = :'uk_today'::date + 5 and posted_count = 0) as ok_rec1_rhythm_and_start_change_before_posting;
-- After one has posted, the database doesn't refuse a new rhythm or start (an old or offline phone may send one);
-- it applies it from the next occurrence, so nothing back-dated posts and posted days stay (the sheet locks them).
update recurring set frequency = 'weekly', start_date = :'uk_today'::date - 30 where id = :'BOX'
returning (frequency = 'weekly' and start_date = (:'uk_today'::date + interval '1 month')::date and posted_count = 0)
   as ok_rec6_rhythm_after_posting_starts_at_the_next_occurrence;
select post_due_recurring() >= 0 as ok_rec6_post_after_rhythm_change;
select count(*) = 1 as ok_rec6_rhythm_change_posts_nothing_back_dated from expenses where recurring_id = :'BOX';

-- ───────── Remove: pause, resume and end are updates; nothing is ever deleted ─────────
-- Weekly from a week ago, not posted yet; Sam pauses it before the phone posts.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'CLEANER', :'hid', 'Cleaner', 1200, jsonb_build_object(:'A', 1200), jsonb_build_object(:'A', 600, :'B', 600), 'weekly', :'uk_today'::date - 7);
set request.jwt.claim.sub = :'B';
update recurring set active = false where id = :'CLEANER' returning (not active) as ok_rec1_partner_pauses;
select count(*) = 1 as ok_act2_pause_logged_as_only_active
from activity where entity = 'recurring' and entity_id = :'CLEANER' and action = 'edited' and actor = :'B'
  and summary = jsonb_build_object('active', jsonb_build_object('before', true, 'after', false));
reset role;
set request.jwt.claim.sub = '';
select post_due_recurring_all() >= 0 as ok_rec2_nightly_job_runs_while_paused;
select count(*) = 0 as ok_rec2_paused_posts_nothing_even_when_due from expenses where recurring_id = :'CLEANER';
set role authenticated;
set request.jwt.claim.sub = :'A';
-- Resumed: what fell due while paused is skipped; today's (still to come today) posts, once.
update recurring set active = true where id = :'CLEANER' returning (active and posted_count = 1) as ok_rec1_resume_skips_what_fell_due_while_paused;
select count(*) = 1 as ok_act2_resume_logged_without_the_count
from activity where entity = 'recurring' and entity_id = :'CLEANER' and action = 'edited' and actor = :'A'
  and summary = jsonb_build_object('active', jsonb_build_object('before', false, 'after', true));
reset role;
set request.jwt.claim.sub = '';   -- the nightly job: no one signed in
select post_due_recurring_all() >= 1 as ok_rec2_nightly_job_posts_after_resume;
select count(*) = 1 and bool_and(occurrence_date = :'uk_today') as ok_rec2_resumed_posts_today_only_once from expenses where recurring_id = :'CLEANER';
select post_due_recurring_all() >= 0 and (select count(*) = 1 from expenses where recurring_id = :'CLEANER') as ok_rec2_and_never_twice;
set role authenticated;
set request.jwt.claim.sub = :'A';
-- Ended today (the app's End): today's has posted, nothing after; the template and its entry stay.
update recurring set end_date = :'uk_today' where id = :'CLEANER' returning (end_date = :'uk_today' and active) as ok_rec1_end_sets_the_last_day;
select count(*) = 1 as ok_act2_end_logged
from activity where entity = 'recurring' and entity_id = :'CLEANER' and action = 'edited'
  and summary = jsonb_build_object('end_date', jsonb_build_object('before', null, 'after', :'uk_today'::date));
-- An end before its next day: weekly from 14 days ago, ended 10 days ago before anything posted: only the first posts.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'STOPS', :'hid', 'Window cleaner', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), 'weekly', :'uk_today'::date - 14);
update recurring set end_date = :'uk_today'::date - 10 where id = :'STOPS';
-- A payment that hasn't started yet can be ended (its end before its start): it never posts.
update recurring set end_date = :'uk_today' where id = :'LATER' returning (end_date < start_date) as ok_rec1_end_before_it_started_is_stored;
reset role;
set request.jwt.claim.sub = '';   -- the nightly job: no one signed in
select post_due_recurring_all() >= 1 as ok_rec2_nightly_job_runs_after_ends;
select count(*) = 1 and bool_and(occurrence_date = :'uk_today'::date - 14) as ok_rec2_nothing_posts_after_the_end from expenses where recurring_id = :'STOPS';
select count(*) = 1 as ok_rec2_ended_today_posts_nothing_more from expenses where recurring_id = :'CLEANER';
select count(*) = 0 as ok_rec2_ended_before_starting_never_posts from expenses where recurring_id = :'LATER';
-- No hard delete: not granted, and refused when tried.
select not has_table_privilege('authenticated', 'public.recurring', 'DELETE') as ok_rec1_delete_not_granted;
set role authenticated;
set request.jwt.claim.sub = :'A';
delete from recurring where id = :'CLEANER';                                              -- expect error: templates are paused or ended, never deleted
select count(*) = 1 as ok_rec1_ended_template_still_there from recurring where id = :'CLEANER';

-- ───────── The nightly job posts the edited amount, future only, exactly once ─────────
-- Weekly from 7 days ago, ending yesterday: last week's posts at £20.00.
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date, end_date)
values (:'PRICE', :'hid', 'Veg box', 2000, jsonb_build_object(:'A', 2000), jsonb_build_object(:'A', 1000, :'B', 1000), 'weekly',
        :'uk_today'::date - 7, :'uk_today'::date - 1);
reset role;
set request.jwt.claim.sub = '';   -- the nightly job: no one signed in
select post_due_recurring_all() >= 1 as ok_rec6_first_week_posts;
set role authenticated;
set request.jwt.claim.sub = :'A';
-- The app's edit: every column the sheet owns, the new price and no end (the sheet sends them all; only two changed).
update recurring set description = 'Veg box', amount_pence = 2250, amount_varies = false, category_id = null, paid = jsonb_build_object(:'A', 2250),
       paid_via = 'person', split_mode = 'ratio', split_params = null, shares = jsonb_build_object(:'A', 1125, :'B', 1125), is_subscription = false,
       frequency = 'weekly', every = 1, start_date = :'uk_today'::date - 7, end_date = null, notes = null
where id = :'PRICE' returning (posted_count = 1 and start_date = :'uk_today'::date - 7) as ok_rec6_full_edit_keeps_the_schedule;
reset role;
set request.jwt.claim.sub = '';   -- the nightly job: no one signed in
select post_due_recurring_all() >= 1 as ok_rec6_nightly_job_runs_after_the_price_change;
select post_due_recurring_all() >= 0 as ok_rec6_nightly_job_runs_again;
select count(*) = 2
       and count(*) filter (where occurrence_date = :'uk_today'::date - 7 and amount_pence = 2000) = 1
       and count(*) filter (where occurrence_date = :'uk_today' and amount_pence = 2250) = 1
   as ok_rec6_old_price_before_new_price_after_each_once from expenses where recurring_id = :'PRICE';

-- ───────── Another household can neither see nor change these, by update or by upsert ─────────
set role authenticated;
set request.jwt.claim.sub = :'D';
select count(*) = 0 as ok_rls_outsider_sees_no_templates from recurring where household_id = :'hid';
update recurring set amount_pence = 1, paid = jsonb_build_object(:'D', 1), shares = jsonb_build_object(:'D', 1) where id = :'BOX';
update recurring set active = false where id = :'PRICE';
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'BOX', :'hid', 'Mine now', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000), 'monthly', :'uk_today')
on conflict (id) do update set description = excluded.description;                    -- expect error: another household's row (and people)
insert into recurring(id, household_id, description, amount_pence, paid, shares, frequency, start_date)
values (:'BOX', :'d_hid', 'Mine now', 100, jsonb_build_object(:'D', 100), jsonb_build_object(:'D', 100), 'monthly', :'uk_today')
on conflict (id) do update set description = excluded.description, household_id = excluded.household_id;  -- expect error: not theirs to take over
delete from recurring where id = :'BOX';                                                  -- expect error: no delete, whoever asks
reset role;
select description = 'Window boxes' and amount_pence = 4000 and household_id = :'hid' as ok_rls_outsider_changed_nothing from recurring where id = :'BOX';
select active as ok_rls_outsider_could_not_pause from recurring where id = :'PRICE';
select count(*) = 0 as ok_rls_outsider_left_no_history from activity where entity = 'recurring' and actor = :'D';
