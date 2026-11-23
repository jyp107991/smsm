-- S9a fresh review (docs/DECISIONS.md, 23 Nov, "S9a review"): money back and its original, as the phone writes them.
--   3. The phone writes by upsert (insert … on conflict do update): an unrelated edit of a refund is never refused,
--      and an edit that raises it past what is left is.
--   4. An original is never edited below the live money back linked to it.
--   2. Money back for an original that was deleted is refused (insert or restore on its own); restoring the original
--      brings back what was deleted with it, as it was, even where the limit would now say no.
--   6. A row deleted again keeps the moment it was first deleted, so restoring its original still finds its refunds.
--   8. Money back is only ever for the household's own expense, and deleting an original touches only its own
--      household's rows.
-- Runs after schema_test.sql (A and B share a household). Each block starts from rows of its own.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set P 'e9a00000-0000-4000-8000-000000000001'
reset role;
insert into auth.users values (:'P') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = :'A';

-- ───────── 3. MB-2: the phone's upsert of an existing refund ─────────
-- A £40.00 lamp and a £50.00 refund linked to it from before the rule (made as the owner, triggers off).
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'S9r lamp', 4000, jsonb_build_object(:'A', 4000), jsonb_build_object(:'A', 2000, :'B', 2000))
returning id as lamp \gset
select my_household() as hh \gset
reset role;
set session_replication_role = replica;
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r old refund', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'lamp')
returning id as old_back \gset
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = :'A';
-- Renamed by the phone, the way it writes (PostgREST upsert): never refused.
insert into expenses(id, household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'old_back', :'hh', 'money_back', 'S9r old refund, renamed', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'lamp')
on conflict (id) do update set description = excluded.description, amount_pence = excluded.amount_pence, paid = excluded.paid,
  shares = excluded.shares, refund_of = excluded.refund_of;
select description = 'S9r old refund, renamed' as ok_mb2_upsert_unrelated_edit_never_refused from expenses where id = :'old_back';
-- A chair: £60.00, £10.00 back. Raised past what is left (£50.00) by an upsert: refused; up to it: fine.
insert into expenses(household_id, description, amount_pence, paid, shares)
values (:'hh', 'S9r chair', 6000, jsonb_build_object(:'A', 6000), jsonb_build_object(:'A', 3000, :'B', 3000))
returning id as chair \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r chair back', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'chair')
returning id as chair_back \gset
insert into expenses(id, household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'chair_back', :'hh', 'money_back', 'S9r chair back', 6001, jsonb_build_object(:'A', 6001), jsonb_build_object(:'A', 3001, :'B', 3000), :'chair')
on conflict (id) do update set amount_pence = excluded.amount_pence, paid = excluded.paid, shares = excluded.shares;  -- expect error: more than the £60.00 left
insert into expenses(id, household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'chair_back', :'hh', 'money_back', 'S9r chair back', 6000, jsonb_build_object(:'A', 6000), jsonb_build_object(:'A', 3000, :'B', 3000), :'chair')
on conflict (id) do update set amount_pence = excluded.amount_pence, paid = excluded.paid, shares = excluded.shares;
select amount_pence = 6000 as ok_mb2_upsert_up_to_what_is_left from expenses where id = :'chair_back';

-- ───────── 4. MB-2: an original is never edited below what has come back on it ─────────
insert into expenses(household_id, description, amount_pence, paid, shares)
values (:'hh', 'S9r desk', 10000, jsonb_build_object(:'A', 10000), jsonb_build_object(:'A', 5000, :'B', 5000))
returning id as desk \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r desk back', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'desk');
update expenses set amount_pence = 4000, paid = jsonb_build_object(:'A', 4000), shares = jsonb_build_object(:'A', 2000, :'B', 2000)
where id = :'desk';  -- expect error: money back on this is £50.00, more than the new amount
insert into expenses(id, household_id, description, amount_pence, paid, shares)
values (:'desk', :'hh', 'S9r desk', 4999, jsonb_build_object(:'A', 4999), jsonb_build_object(:'A', 2500, :'B', 2499))
on conflict (id) do update set amount_pence = excluded.amount_pence, paid = excluded.paid, shares = excluded.shares;  -- expect error: the phone's upsert too
select amount_pence = 10000 as ok_mb2_original_kept_its_amount from expenses where id = :'desk';
update expenses set amount_pence = 5000, paid = jsonb_build_object(:'A', 5000), shares = jsonb_build_object(:'A', 2500, :'B', 2500) where id = :'desk';
select amount_pence = 5000 as ok_mb2_original_down_to_what_came_back from expenses where id = :'desk';

-- ───────── 2. MB-3: money back for a deleted original ─────────
-- A £50.00 kettle, all of it back. Jae deletes the kettle (its refund goes with it); Sam's refund queued offline then
-- arrives: refused. Restoring the kettle brings back its own refund.
insert into expenses(household_id, description, amount_pence, paid, shares)
values (:'hh', 'S9r kettle', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500))
returning id as kettle \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r kettle back', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'kettle')
returning id as kettle_back \gset
update expenses set deleted_at = now() where id = :'kettle';
set request.jwt.claim.sub = :'B';
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r kettle back again', 5000, jsonb_build_object(:'B', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'kettle');  -- expect error: the original was deleted
select count(*) = 0 as ok_mb3_no_money_back_for_a_deleted_original from expenses where description = 'S9r kettle back again';
update expenses set deleted_at = null where id = :'kettle_back';  -- expect error: not restored on its own while the original is deleted
select deleted_at is not null as ok_mb3_refund_stays_deleted_with_its_original from expenses where id = :'kettle_back';
update expenses set deleted_at = null where id = :'kettle';
select count(*) = 2 as ok_act3_original_restored_with_its_refund from expenses where id in (:'kettle', :'kettle_back') and deleted_at is null;
-- Restoring the original brings back what was deleted with it as it was, even where the limit would now say no (a
-- refund from before this rule, still counted against the kettle).
update expenses set deleted_at = now() where id = :'kettle';
reset role;
set session_replication_role = replica;
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r kettle stray', 5000, jsonb_build_object(:'A', 5000), jsonb_build_object(:'A', 2500, :'B', 2500), :'kettle')
returning id as stray \gset
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = :'A';
update expenses set deleted_at = null where id = :'kettle';
select deleted_at is null as ok_act3_restore_not_checked_against_the_limit from expenses where id = :'kettle_back';
reset role;
set session_replication_role = replica;
update expenses set deleted_at = now() where id = :'stray';
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = :'A';

-- ───────── 6. ACT-3: a second delete keeps the first moment ─────────
insert into expenses(household_id, description, amount_pence, paid, shares)
values (:'hh', 'S9r rug', 3000, jsonb_build_object(:'A', 3000), jsonb_build_object(:'A', 1500, :'B', 1500))
returning id as rug \gset
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r rug back', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'rug')
returning id as rug_back \gset
update expenses set deleted_at = '2026-11-20T10:00:00Z' where id = :'rug';
set request.jwt.claim.sub = :'B';
update expenses set deleted_at = '2026-11-21T10:00:00Z' where id = :'rug';
select deleted_at = '2026-11-20T10:00:00Z'::timestamptz as ok_act3_second_delete_keeps_first_moment from expenses where id = :'rug';
update expenses set deleted_at = null where id = :'rug';
select deleted_at is null as ok_act3_restore_after_second_delete_finds_refund from expenses where id = :'rug_back';
set request.jwt.claim.sub = :'A';

-- ───────── 8. MB-2: only the household's own expense ─────────
set request.jwt.claim.sub = :'P';
select create_household() is not null as ok_mb2_another_household;
select my_household() as pp \gset
insert into expenses(household_id, description, amount_pence, paid, shares)
values (:'pp', 'S9r theirs', 8000, jsonb_build_object(:'P', 8000), jsonb_build_object(:'P', 8000))
returning id as theirs \gset
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r not ours', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'theirs');  -- expect error: another household's expense
select count(*) = 0 as ok_mb2_no_money_back_for_another_household from expenses where description = 'S9r not ours';
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'hh', 'money_back', 'S9r back of a back', 100, jsonb_build_object(:'A', 100), jsonb_build_object(:'A', 50, :'B', 50), :'chair_back');  -- expect error: money back is for an expense
select count(*) = 0 as ok_mb2_no_money_back_for_money_back from expenses where description = 'S9r back of a back';
-- A row in the other household pointing at our desk (made as the owner): deleting the desk leaves it alone.
reset role;
set session_replication_role = replica;
insert into expenses(household_id, kind, description, amount_pence, paid, shares, refund_of)
values (:'pp', 'money_back', 'S9r theirs, pointing at our desk', 100, jsonb_build_object(:'P', 100), jsonb_build_object(:'P', 100), :'desk')
returning id as cross \gset
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = :'A';
update expenses set deleted_at = now() where id = :'desk';
reset role;
select deleted_at is null as ok_act3_delete_follows_only_its_own_household from expenses where id = :'cross';

-- Tidy: nothing of this file counts any more.
set session_replication_role = replica;
update expenses set deleted_at = now() where description like 'S9r %' and deleted_at is null;
set session_replication_role = origin;
set role authenticated;
