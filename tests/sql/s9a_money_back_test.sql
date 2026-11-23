-- S9a (docs/slices/S9a.md, fix 7; SPEC MB-2 MB-3 ACT-3, DATA_MODEL §3): money back linked to an original.
--   * A money back may not be more than its original still has to come back (the original's amount less its live
--     linked money back); the database refuses it, on insert and on an edit that raises it.
--   * Deleting the original soft-deletes its live linked money back in the same action (one statement, one
--     transaction: the history rows carry the same time and the same person). Restoring the original restores the
--     rows deleted with it, and only those (a refund deleted on its own earlier stays deleted).
--   * A money back whose original is deleted never counts: member_net (and member_net_on, the same sum by date)
--     leave it out, however it came about.
-- Written before the build (ENGINEERING §5, tests first by someone else). Runs after schema_test.sql (A and B share
-- a household). Balances are checked as changes from a starting figure, so earlier files' rows don't matter.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
reset role;
set role authenticated;
set request.jwt.claim.sub = :'A';

select net_pence as net_start from member_net where user_id = :'A' \gset

-- Jae pays £40.00 for a lamp, 50/50: Sam owes Jae £20.00 more.
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'S9a lamp', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000))
returning id as lamp \gset
-- £10.00 comes back to Jae, the same split: Sam now owes £5.00 less.
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a lamp refund', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'lamp')
returning id as back1 \gset
select net_pence = :net_start + 2000 - 500 as ok_mb3_linked_money_back_moves_the_balance from member_net where user_id = :'A';

-- ───────── MB-2: never more than is still to come back (£30.00 here) ─────────
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a too much back', 3001, jsonb_build_object(:'A', 3001), jsonb_build_object(:'A', 1501, :'B', 1500), :'lamp');  -- expect error: £30.01 is more than the £30.00 still to come back
update expenses set amount_pence = 4001, paid = jsonb_build_object(:'A', 4001), shares = jsonb_build_object(:'A', 2001, :'B', 2000)
where id = :'back1';  -- expect error: an edit may not raise it past the original either
select amount_pence = 1000 as ok_mb2_refused_edit_left_the_row from expenses where id = :'back1';
select count(*) = 0 as ok_mb2_refused_insert_left_nothing from expenses where description = 'S9a too much back';
-- Exactly what is left is fine.
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a rest back', 3000, jsonb_build_object(:'A', 3000), jsonb_build_object(:'A', 1500, :'B', 1500), :'lamp')
returning id as back2 \gset
select count(*) = 2 as ok_mb2_up_to_the_whole_original from expenses where refund_of = :'lamp' and deleted_at is null;
-- A deleted money back gives its room back.
set request.jwt.claim.sub = :'B';
update expenses set deleted_at = now() where id = :'back2';
select deleted_at is not null as ok_mb2_rest_deleted_on_its_own from expenses where id = :'back2';
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a second try', 3000, jsonb_build_object(:'B', 3000), jsonb_build_object(:'A', 1500, :'B', 1500), :'lamp')
returning id as back3 \gset
select count(*) = 1 as ok_mb2_deleted_money_back_frees_its_amount from expenses where id = :'back3' and deleted_at is null;
-- Money back with no original (selling something shared, MB-1) has no such limit.
insert into expenses(household_id, kind, description, amount_pence, paid, shares)
values (my_household(), 'money_back', 'S9a sold the old sofa', 500000, jsonb_build_object(:'B', 500000), jsonb_build_object(:'A', 250000, :'B', 250000))
returning id as sofa \gset
select count(*) = 1 as ok_mb1_unlinked_money_back_unlimited from expenses where id = :'sofa';
update expenses set deleted_at = now() where id = :'sofa';
update expenses set deleted_at = now() where id = :'back3';
set request.jwt.claim.sub = :'A';
select net_pence = :net_start + 2000 - 500 as ok_mb3_back_to_one_refund from member_net where user_id = :'A';
-- Tidy, so what follows stands on its own whatever happened above: none of the lamp's rows count any more.
reset role;
set session_replication_role = replica;
update expenses set deleted_at = now() where (id = :'lamp' or refund_of = :'lamp') and deleted_at is null;
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = :'A';

-- A chair: Jae paid £60.00, 50/50 (+£30.00); £10.00 back to Jae (−£5.00); £20.00 back to Sam, later deleted on its own.
select net_pence as net_base from member_net where user_id = :'A' \gset
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'S9a chair', 6000, jsonb_build_object(:'A', 6000), jsonb_build_object(:'A', 3000, :'B', 3000))
returning id as chair \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a chair refund', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'chair')
returning id as back1 \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (my_household(), 'money_back', 'S9a chair voucher', 2000, jsonb_build_object(:'B', 2000), jsonb_build_object(:'A', 1000, :'B', 1000), :'chair')
returning id as back2 \gset
set request.jwt.claim.sub = :'B';
update expenses set deleted_at = now() where id = :'back2';
set request.jwt.claim.sub = :'A';
select net_pence = :net_base + 3000 - 500 as ok_mb3_chair_and_its_refund_count from member_net where user_id = :'A';

-- ───────── ACT-3 MB-3: deleting the original deletes its money back, in the same logged action ─────────
update expenses set deleted_at = now() where id = :'chair';
select deleted_at is not null as ok_act3_linked_money_back_deleted_with_original from expenses where id = :'back1';
select coalesce((select deleted_at from expenses where id = :'back1') = (select deleted_at from expenses where id = :'chair'), false) as ok_act3_same_moment;
select count(*) = 1 as ok_act2_money_back_deletion_logged from activity
where entity = 'expense' and entity_id = :'back1' and action = 'deleted' and actor = :'A';
select coalesce((select at from activity where entity_id = :'back1' and action = 'deleted' order by id desc limit 1)
     = (select at from activity where entity_id = :'chair' and action = 'deleted' order by id desc limit 1), false) as ok_act2_one_action;
select net_pence = :net_base as ok_mb3_nothing_left_counting from member_net where user_id = :'A';
-- The voucher deleted on its own earlier keeps its own deletion (one history row, by B).
select count(*) = 1 as ok_act3_earlier_deletion_untouched from activity where entity_id = :'back2' and action = 'deleted' and actor = :'B';

-- ───────── ACT-3: restoring the original restores what was deleted with it, and only that ─────────
set request.jwt.claim.sub = :'B';
update expenses set deleted_at = null where id = :'chair';
select deleted_at is null as ok_act3_restore_brings_money_back_back from expenses where id = :'back1';
select deleted_at is not null as ok_act3_refund_deleted_before_stays_deleted from expenses where id = :'back2';
select count(*) = 1 as ok_act2_money_back_restore_logged from activity
where entity = 'expense' and entity_id = :'back1' and action = 'restored' and actor = :'B';
select net_pence = :net_base + 3000 - 500 as ok_mb3_restored_both from member_net where user_id = :'A';

-- ───────── MB-3: a money back whose original is deleted never counts ─────────
-- An orphan however it came about (a row from before this rule, a partial restore): made here as the database owner
-- with triggers off, so only the original is marked deleted.
reset role;
select household_id as hh from expenses where id = :'chair' \gset
select member_net_on(:'hh', :'A', current_date) as on_before \gset
set session_replication_role = replica;
update expenses set deleted_at = now() where id = :'chair';
set session_replication_role = origin;
select deleted_at is null as ok_orphan_set_up from expenses where id = :'back1';
-- The chair's +£30.00 goes, and so does the orphan's −£5.00.
select member_net_on(:'hh', :'A', current_date) = :on_before - 3000 + 500 as ok_mb3_member_net_on_leaves_out_orphan;
set role authenticated;
set request.jwt.claim.sub = :'A';
select net_pence = :net_base as ok_mb3_member_net_leaves_out_orphan from member_net where user_id = :'A';
select sum(net_pence) = 0 as ok_bal1_still_sums_to_zero from member_net;

-- Tidy: nothing of this file counts any more.
reset role;
set session_replication_role = replica;
update expenses set deleted_at = now() where id = :'back1';
set session_replication_role = origin;
set role authenticated;
