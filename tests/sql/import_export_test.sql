-- S7 (docs/slices/S7.md "Decisions made here → Restore, Storage used, What is already decided", "Data", "Tests → SQL";
-- SPEC EXP-1, EXP-3, IMP-3): restoring a JSON backup only adds, the storage figure, and the import tables' row-level
-- security. Written before the build (ENGINEERING §5, tests first by someone else). Runs after schema_test.sql (A and
-- B share a household with entries; C is in none). F and G start a household of their own here (the one restored
-- into); H starts one alone.
--
--   restore_backup(p_people jsonb, p_rows jsonb) returns jsonb: security definer; the caller must be a member of a
--     household with two members; p_people maps each backup user id to a member of this household ({ backup id:
--     member id }, the two backup ids to the two different members); p_rows is
--     { categories?, chapters?, expenses?, settlements?, recurring?, comments?, category_memory?, import_rules? },
--     each an array of rows as the backup holds them (whole table rows, the old household's id in household_id, the
--     backup's user ids in paid / shares / from_user / to_user / author / created_by). Rows whose id is already in
--     this household are skipped; nothing is ever updated or deleted; a row whose id is found in another household
--     gets a new id, and references to it inside the same call (refund_of, a comment's expense_id, …) follow it;
--     money rows keep the database's own checks (a bad row refuses the whole call); regular payments come back paused;
--     at most 500 rows in a call; safe to repeat (a renamed row is renamed the same way again, so a second call finds
--     it and skips it).
--   Choice made here where the brief leaves the shape open: it returns
--     { "added": { "<table>": n, … }, "skipped": { "<table>": n, … } } with the p_rows keys as table names.
--   storage_used() returns jsonb { "database_bytes": n, "photo_bytes": n }: security definer; members only;
--     photo_bytes is the household's receipt bytes (0 on plain PostgreSQL, which has no storage schema).
--   import_ignores and import_rules: members read and write their own household's rows only.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
\set F '77777777-7777-7777-7777-777777777777'
\set G '88888888-8888-8888-8888-888888888888'
\set H '99999999-9999-9999-9999-999999999999'
-- The backup's own people and household (from before a wipe: not users here).
\set X1 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\set X2 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
\set X3 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
\set OLD 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
\set cat1 'b1000000-0000-4000-8000-000000000001'
\set ch1 'b2000000-0000-4000-8000-000000000001'
\set e1 'b3000000-0000-4000-8000-000000000001'
\set e2 'b3000000-0000-4000-8000-000000000002'
\set e3 'b3000000-0000-4000-8000-000000000003'
\set e4 'b3000000-0000-4000-8000-000000000004'
\set mb1 'b3000000-0000-4000-8000-000000000005'
\set s1 'b4000000-0000-4000-8000-000000000001'
\set r1 'b5000000-0000-4000-8000-000000000001'
\set cm1 'b6000000-0000-4000-8000-000000000001'
\set rule1 'b7000000-0000-4000-8000-000000000001'
\set rule2 'b7000000-0000-4000-8000-000000000002'
reset role;
insert into auth.users values (:'F'), (:'G'), (:'H') on conflict do nothing;

-- An expense id that already exists in A and B's household: a backup row with it must not touch theirs.
select e.id as clash, e.description as clash_description, e.amount_pence as clash_amount
  from expenses e join members m on m.household_id = e.household_id and m.user_id = :'A'
 order by e.created_at, e.id limit 1 \gset

-- ───────── the household restored into: F and G ─────────
set role authenticated;
set request.jwt.claim.sub = :'F';
select create_household() is not null as ok_exp1_restore_target_household;
select set_identity('Robin', 'cat');
select join_code as fg_code, id as fg from households \gset
set request.jwt.claim.sub = :'G';
select join_household(:'fg_code') is not null as ok_exp1_restore_target_partner_joined;
select set_identity('Alex', 'dog');
set request.jwt.claim.sub = :'H';
select create_household() is not null as ok_exp1_one_person_household;

-- ───────── the backup (as the app's backup holds it: whole rows) ─────────
reset role;
create temp table bk_categories (like public.categories including defaults);
create temp table bk_chapters (like public.chapters including defaults);
create temp table bk_expenses (like public.expenses including defaults);
create temp table bk_settlements (like public.settlements including defaults);
create temp table bk_recurring (like public.recurring including defaults);
create temp table bk_comments (like public.comments including defaults);
create temp table bk_memory (like public.category_memory including defaults);
create temp table bk_rules (like public.import_rules including defaults);
insert into bk_categories(id, household_id, name, emoji, colour, sort) values (:'cat1', :'OLD', 'Pets', '🐾', 'moss', 13);
insert into bk_chapters(id, household_id, name, emoji, kind, country, start_date, end_date, created_by)
values (:'ch1', :'OLD', 'Japan', '🗾', 'trip', 'JP', '2025-04-01', '2025-04-10', :'X1');
insert into bk_expenses(id, household_id, kind, description, amount_pence, date, category_id, chapter_id, paid, split_mode, shares, country, refund_of, deleted_at, created_by, updated_by) values
  (:'e1', :'OLD', 'expense', 'Tesco', 4400, '2025-03-01', :'cat1', null, jsonb_build_object(:'X1', 4400), 'ratio', jsonb_build_object(:'X1', 2200, :'X2', 2200), 'GB', null, null, :'X1', :'X1'),
  (:'e2', :'OLD', 'expense', 'Haircut', 3000, '2025-03-02', null, null, jsonb_build_object(:'X1', 3000), 'for_other', jsonb_build_object(:'X1', 0, :'X2', 3000), 'GB', null, null, :'X1', :'X1'),
  (:'e3', :'OLD', 'expense', 'Dinner treat', 6000, '2025-04-03', null, :'ch1', jsonb_build_object(:'X2', 6000), 'treat', jsonb_build_object(:'X2', 6000), 'JP', null, null, :'X2', :'X2'),
  (:'e4', :'OLD', 'expense', 'Gum', 100, '2025-03-04', null, null, jsonb_build_object(:'X2', 100), 'ratio', jsonb_build_object(:'X1', 50, :'X2', 50), 'GB', null, '2025-03-05T10:00:00Z', :'X2', :'X2'),
  (:'clash', :'OLD', 'expense', 'Clashing lamp', 1000, '2025-03-06', null, null, jsonb_build_object(:'X1', 1000), 'ratio', jsonb_build_object(:'X1', 500, :'X2', 500), 'GB', null, null, :'X1', :'X1'),
  (:'mb1', :'OLD', 'money_back', 'Lamp refund', 2000, '2025-03-07', null, null, jsonb_build_object(:'X1', 2000), 'ratio', jsonb_build_object(:'X1', 1000, :'X2', 1000), 'GB', :'clash', null, :'X1', :'X1');
insert into bk_settlements(id, household_id, from_user, to_user, amount_pence, date, method, created_by)
values (:'s1', :'OLD', :'X2', :'X1', 2200, '2025-03-08', 'other', :'X2');
insert into bk_recurring(id, household_id, description, amount_pence, paid, split_mode, split_params, shares, frequency, every, start_date, posted_count, active, created_by)
values (:'r1', :'OLD', 'Rent', 100000, jsonb_build_object(:'X1', 100000), 'ratio', jsonb_build_object(:'X1', 50, :'X2', 50), jsonb_build_object(:'X1', 50000, :'X2', 50000), 'monthly', 1, '2025-01-01', 3, true, :'X1');
insert into bk_comments(id, household_id, expense_id, author, body) values (:'cm1', :'OLD', :'clash', :'X2', 'Was this the old lamp?');
insert into bk_memory(household_id, key, category_id, source) values (:'OLD', 'tesco', :'cat1', 'user');
-- Only keep rules are shared (review fix 2); a skip rule in an old backup is left out.
alter table bk_rules drop constraint if exists import_rules_decision_check;
insert into bk_rules(id, household_id, match_text, decision, category_id, split_mode) values (:'rule1', :'OLD', 'pret', 'keep', :'cat1', 'treat');
insert into bk_rules(id, household_id, match_text, decision) values (:'rule2', :'OLD', 'larder & leaf', 'skip');

select jsonb_build_object(
  'categories', (select jsonb_agg(to_jsonb(t)) from bk_categories t),
  'chapters', (select jsonb_agg(to_jsonb(t)) from bk_chapters t),
  'expenses', (select jsonb_agg(to_jsonb(t) order by t.id) from bk_expenses t),
  'settlements', (select jsonb_agg(to_jsonb(t)) from bk_settlements t),
  'recurring', (select jsonb_agg(to_jsonb(t)) from bk_recurring t),
  'comments', (select jsonb_agg(to_jsonb(t)) from bk_comments t),
  'category_memory', (select jsonb_agg(to_jsonb(t)) from bk_memory t),
  'import_rules', (select jsonb_agg(to_jsonb(t)) from bk_rules t)
)::text as backup \gset
select jsonb_build_object(:'X1', :'F', :'X2', :'G')::text as people \gset
-- The backup's own balance, by DATA_MODEL §3 over its live rows: X1 is owed £25.00.
select (select coalesce(sum(case when kind = 'money_back' then -1 else 1 end * (coalesce((paid->>:'X1')::bigint, 0) - coalesce((shares->>:'X1')::bigint, 0))), 0)
          from bk_expenses where deleted_at is null)
     + (select coalesce(sum(case when from_user = :'X1' then amount_pence else -amount_pence end), 0) from bk_settlements where deleted_at is null)
  as backup_net_x1 \gset
select :'backup_net_x1'::bigint = 2500 as ok_exp1_backup_balance_worked_by_hand;

-- ───────── EXP-1: who may restore ─────────
set role authenticated;
set request.jwt.claim.sub = :'C';
select restore_backup(jsonb_build_object(:'X1', :'A', :'X2', :'B'), :'backup'::jsonb);              -- expect error: not in a household
set request.jwt.claim.sub = :'H';
select restore_backup(jsonb_build_object(:'X1', :'H', :'X2', :'H'), :'backup'::jsonb);              -- expect error: both people must have joined
set request.jwt.claim.sub = :'F';
select restore_backup(jsonb_build_object(:'X1', :'F', :'X2', :'C'), :'backup'::jsonb);              -- expect error: a person mapped to a non-member
select restore_backup(jsonb_build_object(:'X1', :'F', :'X2', :'F'), :'backup'::jsonb);              -- expect error: both mapped to one person
select restore_backup(jsonb_build_object(:'X1', :'F'), :'backup'::jsonb);                            -- expect error: a backup person left unmapped
reset role;
set role anon;
select restore_backup(:'people'::jsonb, :'backup'::jsonb);                                           -- expect error: anon cannot execute
reset role;
select count(*) = 0 as ok_exp1_refused_restores_added_nothing from expenses where id in (:'e1', :'e2', :'e3', :'e4', :'mb1');
select count(*) = 0 as ok_exp1_refused_restores_added_nothing_for_h
  from expenses e join members m on m.household_id = e.household_id where m.user_id = :'H';
select not has_function_privilege('anon', 'public.restore_backup(jsonb, jsonb)', 'execute') as ok_exp1_anon_cannot_restore;
select has_function_privilege('authenticated', 'public.restore_backup(jsonb, jsonb)', 'execute') as ok_exp1_members_can_restore;
select prosecdef as ok_exp1_restore_is_security_definer from pg_proc where oid = 'public.restore_backup(jsonb, jsonb)'::regprocedure;

-- ───────── EXP-1: the restore ─────────
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(:'people'::jsonb, :'backup'::jsonb)::text as res1 \gset
select (:'res1'::jsonb->'added'->>'expenses')::int = 6 and (:'res1'::jsonb->'added'->>'settlements')::int = 1
   and (:'res1'::jsonb->'added'->>'chapters')::int = 1 and (:'res1'::jsonb->'added'->>'categories')::int = 1
   and (:'res1'::jsonb->'added'->>'recurring')::int = 1 and (:'res1'::jsonb->'added'->>'comments')::int = 1
   and (:'res1'::jsonb->'added'->>'category_memory')::int = 1 and (:'res1'::jsonb->'added'->>'import_rules')::int = 1
  as ok_exp1_restore_counts_what_it_added;
select coalesce((:'res1'::jsonb->'skipped'->>'expenses')::int, 0) = 0 as ok_exp1_first_restore_skips_nothing;

-- Everything lands in the caller's household, the backup's people mapped onto this household's.
select count(*) = 6 as ok_exp1_entries_restored from expenses where household_id = :'fg';
select count(*) = 1 as ok_exp1_settle_up_restored from settlements where household_id = :'fg' and id = :'s1' and from_user = :'G' and to_user = :'F';
select (paid->>:'F')::bigint = 4400 and (shares->>:'F')::bigint = 2200 and (shares->>:'G')::bigint = 2200 and not (paid ? :'X1')
  as ok_exp1_people_mapped_in_paid_and_shares from expenses where id = :'e1';
select household_id = :'fg' and category_id = :'cat1' as ok_exp1_entry_keeps_its_category from expenses where id = :'e1';
select count(*) = 1 as ok_exp1_category_restored from categories where id = :'cat1' and household_id = :'fg' and name = 'Pets';
select chapter_id = :'ch1' and country = 'JP' as ok_exp1_entry_keeps_its_chapter from expenses where id = :'e3';
select count(*) = 1 as ok_exp1_chapter_restored from chapters where id = :'ch1' and household_id = :'fg';
select deleted_at is not null as ok_exp1_deleted_entry_comes_back_deleted from expenses where id = :'e4';
select split_mode = 'for_other' and (shares->>:'G')::bigint = 3000 as ok_exp1_for_other_restored from expenses where id = :'e2';
select not active and (paid->>:'F')::bigint = 100000 as ok_exp1_regular_payment_comes_back_paused from recurring where id = :'r1' and household_id = :'fg';
select category_id = :'cat1' as ok_exp1_category_memory_restored from category_memory where household_id = :'fg' and key = 'tesco';
select decision = 'keep' and category_id = :'cat1' as ok_imp3_import_rule_restored from import_rules where household_id = :'fg' and match_text = 'pret';
select count(*) = 0 as ok_imp3_skip_rule_never_restored from import_rules where household_id = :'fg' and match_text = 'larder & leaf';
select (:'res1'::jsonb->'skipped'->>'import_rules')::int = 1 as ok_imp3_skip_rule_counted_as_left_alone;
-- Who made each row is the backup's person, mapped (review fix 9), not whoever restored it.
reset role;
select created_by = :'G' and updated_by = :'G' as ok_exp1_restored_entry_keeps_its_mapped_author from expenses where id = :'e3';
select created_by = :'F' as ok_exp1_restored_entry_by_the_restorer_mapped from expenses where id = :'e1';
select created_by = :'G' as ok_exp1_restored_settle_up_keeps_its_author from settlements where id = :'s1';
select created_by = :'F' as ok_exp1_restored_chapter_keeps_its_author from chapters where id = :'ch1';
select coalesce(current_setting('smsm.restoring', true), '') <> 'on' as ok_exp1_restoring_flag_ends_with_the_call;
set role authenticated;
set request.jwt.claim.sub = :'F';

-- The clashing id: A and B's row untouched; ours under a new id; references followed.
reset role;
select count(*) = 1 as ok_exp1_other_households_row_untouched from expenses
 where id = :'clash' and description = :'clash_description' and amount_pence = :'clash_amount'::bigint and household_id <> :'fg';
select id as renamed from expenses where household_id = :'fg' and description = 'Clashing lamp' \gset
select :'renamed'::uuid <> :'clash'::uuid as ok_exp1_clashing_id_renamed;
select refund_of = :'renamed'::uuid as ok_exp1_refund_follows_the_renamed_entry from expenses where id = :'mb1';
select expense_id = :'renamed'::uuid and author = :'G' and household_id = :'fg' as ok_exp1_comment_follows_the_renamed_entry from comments where id = :'cm1';

-- The balance after the restore is the backup's, with the people mapped.
set role authenticated;
set request.jwt.claim.sub = :'G';
select (select net_pence from member_net where user_id = :'F') = :'backup_net_x1'::bigint
   and (select net_pence from member_net where user_id = :'G') = -:'backup_net_x1'::bigint as ok_exp1_balance_equals_the_backups;

-- Every restored row is in the history, as any write is.
reset role;
select count(*) >= 6 as ok_exp1_restored_entries_logged from activity where household_id = :'fg' and entity = 'expense' and action = 'created';
select count(*) = 1 as ok_exp1_restored_settle_up_logged from activity where household_id = :'fg' and entity = 'settlement' and entity_id = :'s1' and action = 'created';

-- ───────── EXP-1: it only adds; repeating is a no-op ─────────
select count(*) as fg_activity_before from activity where household_id = :'fg' \gset
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(:'people'::jsonb, :'backup'::jsonb)::text as res2 \gset
select coalesce((:'res2'::jsonb->'added'->>'expenses')::int, 0) = 0 and coalesce((:'res2'::jsonb->'added'->>'settlements')::int, 0) = 0
   and coalesce((:'res2'::jsonb->'added'->>'comments')::int, 0) = 0 and coalesce((:'res2'::jsonb->'added'->>'chapters')::int, 0) = 0
  as ok_exp1_repeat_adds_nothing;
select (:'res2'::jsonb->'skipped'->>'expenses')::int = 6 as ok_exp1_repeat_skips_every_entry;
select count(*) = 6 as ok_exp1_repeat_leaves_six_entries from expenses where household_id = :'fg';
select count(*) = 1 as ok_exp1_repeat_leaves_one_comment from comments where household_id = :'fg';
select net_pence = :'backup_net_x1'::bigint as ok_exp1_repeat_leaves_the_balance from member_net where user_id = :'F';
reset role;
select count(*) = :'fg_activity_before'::bigint as ok_exp1_repeat_logs_nothing from activity where household_id = :'fg';

-- A backup whose rows now differ from what is here (edited, deleted since) changes nothing here.
select jsonb_build_object(
  'expenses', jsonb_build_array(to_jsonb(t) || jsonb_build_object('description', 'Changed by the backup', 'amount_pence', 9999,
                'paid', jsonb_build_object(:'X1', 9999), 'shares', jsonb_build_object(:'X1', 5000, :'X2', 4999))),
  'settlements', (select jsonb_agg(to_jsonb(s) || jsonb_build_object('deleted_at', '2025-03-09T00:00:00Z')) from bk_settlements s),
  'recurring', (select jsonb_agg(to_jsonb(r) || jsonb_build_object('description', 'Changed rent')) from bk_recurring r)
)::text as changed from bk_expenses t where t.id = :'e1' \gset
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(:'people'::jsonb, :'changed'::jsonb) is not null as ok_exp1_changed_rows_accepted_and_skipped;
reset role;
select description = 'Tesco' and amount_pence = 4400 as ok_exp1_never_updates from expenses where id = :'e1';
select deleted_at is null as ok_exp1_never_deletes from settlements where id = :'s1';
select description = 'Rent' as ok_exp1_never_updates_a_regular_payment from recurring where id = :'r1';
select count(*) = 0 as ok_exp1_nothing_edited_or_deleted_by_restore from activity
 where household_id = :'fg' and action in ('edited', 'deleted') and entity in ('expense', 'settlement', 'chapter', 'comment', 'category');

-- ───────── EXP-1: the money checks still hold ─────────
create temp table bk_bad (like public.expenses including defaults);
insert into bk_bad(id, household_id, description, amount_pence, date, paid, shares) values
  ('b3000000-0000-4000-8000-00000000000a', :'OLD', 'Fine', 500, '2025-05-01', jsonb_build_object(:'X1', 500), jsonb_build_object(:'X1', 250, :'X2', 250)),
  ('b3000000-0000-4000-8000-00000000000b', :'OLD', 'Bad sum', 500, '2025-05-02', jsonb_build_object(:'X1', 500), jsonb_build_object(:'X1', 100, :'X2', 100)),
  ('b3000000-0000-4000-8000-00000000000c', :'OLD', 'Stranger', 500, '2025-05-03', jsonb_build_object(:'X3', 500), jsonb_build_object(:'X1', 250, :'X2', 250));
select jsonb_build_object('expenses', jsonb_agg(to_jsonb(t) order by t.id))::text as bad_sum
  from bk_bad t where t.description in ('Fine', 'Bad sum') \gset
select jsonb_build_object('expenses', jsonb_agg(to_jsonb(t)))::text as stranger from bk_bad t where t.description = 'Stranger' \gset
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(:'people'::jsonb, :'bad_sum'::jsonb);                                         -- expect error: shares must sum to the amount
select restore_backup(:'people'::jsonb, :'stranger'::jsonb);                                        -- expect error: paid names someone who isn't mapped
reset role;
select count(*) = 0 as ok_exp1_a_bad_row_refuses_the_whole_call from expenses
 where id in ('b3000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b', 'b3000000-0000-4000-8000-00000000000c');

-- ───────── EXP-1: at most 500 rows a call ─────────
create temp table bk_many (like public.expenses including defaults);
insert into bk_many(id, household_id, description, amount_pence, date, paid, split_mode, shares)
select ('b8000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, :'OLD', 'Treat ' || i, 100, '2025-06-01',
       jsonb_build_object(:'X1', 100), 'treat', jsonb_build_object(:'X1', 100)
  from generate_series(1, 500) i;
insert into bk_many(id, household_id, description, amount_pence, date, paid, split_mode, shares)
select ('b9000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, :'OLD', 'Treat ' || i, 100, '2025-06-02',
       jsonb_build_object(:'X1', 100), 'treat', jsonb_build_object(:'X1', 100)
  from generate_series(1, 501) i;
select jsonb_build_object('expenses', jsonb_agg(to_jsonb(t)))::text as five_hundred from bk_many t where t.id::text like 'b8000000-%' \gset
select jsonb_build_object('expenses', jsonb_agg(to_jsonb(t)))::text as five_hundred_and_one from bk_many t where t.id::text like 'b9000000-%' \gset
set role authenticated;
set request.jwt.claim.sub = :'F';
select restore_backup(:'people'::jsonb, :'five_hundred_and_one'::jsonb);                            -- expect error: more than 500 rows
select (restore_backup(:'people'::jsonb, :'five_hundred'::jsonb)->'added'->>'expenses')::int = 500 as ok_exp1_500_rows_in_one_call;
reset role;
select count(*) = 0 as ok_exp1_over_500_added_nothing from expenses where id::text like 'b9000000-%';
select count(*) = 506 as ok_exp1_household_has_the_500_and_the_six from expenses where household_id = :'fg';
select net_pence = :'backup_net_x1'::bigint as ok_exp1_treats_leave_the_balance from member_net where user_id = :'F';

-- ───────── EXP-1: a format-1 backup (review fix 1): columns added since are missing, their defaults are used ─────────
select jsonb_build_object('expenses', jsonb_build_array(jsonb_build_object(
  'id', 'b3000000-0000-4000-8000-00000000000d', 'household_id', :'OLD', 'description', 'Old shop', 'amount_pence', 300,
  'date', '2025-02-01', 'paid', jsonb_build_object(:'X1', 300), 'shares', jsonb_build_object(:'X1', 150, :'X2', 150),
  'created_by', :'X1', 'deleted_at', null)))::text as format1 \gset
set role authenticated;
set request.jwt.claim.sub = :'G';
select (restore_backup(:'people'::jsonb, :'format1'::jsonb)->'added'->>'expenses')::int = 1 as ok_exp1_format1_entry_restored;
reset role;
select kind = 'expense' and split_mode = 'ratio' and not category_guess and source = 'manual' and country = 'GB' and tags = '{}'
   and paid_via = 'person' and created_by = :'F'
  as ok_exp1_format1_entry_takes_the_defaults from expenses where id = 'b3000000-0000-4000-8000-00000000000d';

-- ───────── EXP-1: a refused part names its table (review fix 9) ─────────
create function pg_temp.restore_error(p jsonb, r jsonb) returns text language plpgsql as $$
begin
  perform restore_backup(p, r);
  return 'no error';
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.restore_error(jsonb, jsonb) to authenticated;
set role authenticated;
set request.jwt.claim.sub = :'F';
select pg_temp.restore_error(:'people'::jsonb, :'bad_sum'::jsonb) like 'restore expenses: %' as ok_exp1_refusal_names_the_table;

-- ───────── EXP-1: remembered splits and rules from a backup are checked (review fix 10) ─────────
select restore_backup(:'people'::jsonb, jsonb_build_object('category_memory', jsonb_build_array(jsonb_build_object('key', 'odd mode', 'split_mode', 'halves'))));
                                                                                                    -- expect error: an unknown split mode
select restore_backup(:'people'::jsonb, jsonb_build_object('category_memory', jsonb_build_array(jsonb_build_object('key', 'stranger split', 'split_mode', 'ratio',
  'split_params', jsonb_build_object(:'X1', 50, :'X3', 50)))));                                    -- expect error: a split naming someone unmapped
select restore_backup(:'people'::jsonb, jsonb_build_object('import_rules', jsonb_build_array(jsonb_build_object('match_text', 'odd rule', 'decision', 'keep', 'split_mode', 'halves'))));
                                                                                                    -- expect error: a rule with an unknown split mode
select pg_temp.restore_error(:'people'::jsonb, jsonb_build_object('import_rules', jsonb_build_array(jsonb_build_object('match_text', 'odd rule', 'decision', 'keep', 'split_mode', 'halves'))))
  like 'restore import_rules: %' as ok_exp1_rule_refusal_names_its_table;
select (restore_backup(:'people'::jsonb, jsonb_build_object('category_memory', jsonb_build_array(jsonb_build_object('key', 'fair split', 'split_mode', 'ratio',
  'split_params', jsonb_build_object(:'X1', 60, :'X2', 40)))))->'added'->>'category_memory')::int = 1 as ok_exp1_mapped_split_restored;
reset role;
select split_params = jsonb_build_object(:'F', 60, :'G', 40) as ok_exp1_restored_split_names_the_members
  from category_memory where household_id = :'fg' and key = 'fair split';
select count(*) = 0 as ok_exp1_refused_splits_added_nothing from category_memory where household_id = :'fg' and key in ('odd mode', 'stranger split');

-- ───────── EXP-3: storage used ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
select storage_used()::text as used \gset
select (:'used'::jsonb->>'database_bytes')::bigint > 0 as ok_exp3_database_bytes;
select (:'used'::jsonb->>'photo_bytes')::bigint >= 0 as ok_exp3_photo_bytes;
set request.jwt.claim.sub = :'F';
select (storage_used()->>'database_bytes')::bigint > 0 as ok_exp3_any_member_reads_it;
set request.jwt.claim.sub = :'C';
select storage_used();                                                                              -- expect error: not in a household
reset role;
set role anon;
select storage_used();                                                                              -- expect error: anon cannot execute
reset role;
select not has_function_privilege('anon', 'public.storage_used()', 'execute') as ok_exp3_anon_cannot_read_storage;
select prosecdef as ok_exp3_storage_used_is_security_definer from pg_proc where oid = 'public.storage_used()'::regprocedure;

-- ───────── IMP-3: import_ignores and import_rules belong to their household ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into import_ignores(household_id, source, id_hash) values (my_household(), 'monzo', repeat('a', 64));
insert into import_ignores(household_id, source, id_hash) values (:'fg', 'monzo', repeat('b', 64));                  -- expect error: not our household
insert into import_ignores(household_id, source, id_hash) values (my_household(), 'paypal', repeat('c', 64));        -- expect error: not a source
insert into import_rules(household_id, match_text, decision) values (my_household(), 'larder & leaf', 'keep') returning id as a_rule \gset
insert into import_rules(household_id, match_text, decision) values (:'fg', 'larder & leaf', 'keep');                -- expect error: not our household
insert into import_rules(household_id, match_text, decision) values (my_household(), 'noodle bar', 'skip');         -- expect error: skip rules stay on the phone
select count(*) = 1 as ok_imp3_members_read_their_ignores from import_ignores where id_hash = repeat('a', 64);
set request.jwt.claim.sub = :'B';
select count(*) = 1 as ok_imp3_partner_reads_the_ignores from import_ignores where id_hash = repeat('a', 64);
select count(*) = 1 as ok_imp3_partner_reads_the_rules from import_rules where id = :'a_rule';
set request.jwt.claim.sub = :'F';
select count(*) = 0 as ok_imp3_other_household_reads_none_of_our_ignores from import_ignores where id_hash = repeat('a', 64);
select count(*) = 0 as ok_imp3_other_household_reads_none_of_our_rules from import_rules where id = :'a_rule';
select count(*) = 1 as ok_imp3_other_household_reads_its_own_rule from import_rules where match_text = 'pret';
update import_rules set match_text = 'changed' where id = :'a_rule';
delete from import_ignores where id_hash = repeat('a', 64);
delete from import_rules where id = :'a_rule';
set request.jwt.claim.sub = :'C';
select count(*) = 0 as ok_imp3_outsider_reads_no_ignores from import_ignores;
select count(*) = 0 as ok_imp3_outsider_reads_no_rules from import_rules;
reset role;
select count(*) = 1 as ok_imp3_others_cannot_delete_our_ignore from import_ignores where id_hash = repeat('a', 64);
select match_text = 'larder & leaf' as ok_imp3_others_cannot_change_our_rule from import_rules where id = :'a_rule';
select count(*) = 0 as ok_imp3_refused_ignores_not_written from import_ignores where id_hash in (repeat('b', 64), repeat('c', 64));
-- Undo of Not ours, and Remove of a rule: the household's own member can take them away.
set role authenticated;
set request.jwt.claim.sub = :'A';
delete from import_ignores where id_hash = repeat('a', 64);
delete from import_rules where id = :'a_rule';
reset role;
select count(*) = 0 as ok_imp3_member_removes_an_ignore from import_ignores where id_hash = repeat('a', 64);
select count(*) = 0 as ok_imp3_member_removes_a_rule from import_rules where id = :'a_rule';
select column_name = 'id_hash' as ok_imp3_ignores_hold_only_a_hash from information_schema.columns
 where table_schema = 'public' and table_name = 'import_ignores' and column_name not in ('household_id', 'source');
