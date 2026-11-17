-- S5b (docs/slices/S5b.md "Data"): comments on an entry (ACT-4) and the household's settle day (SET-4).
-- Comments: the author alone edits or (soft) deletes their own; nobody hard-deletes one; every change is in the
-- household's history (entity 'comment'); the partner's phone hears about them (Realtime); a body is 1–500
-- characters. Settle day: households.settle_day is a day 1–28 or null, set only through set_settle_day(int) by
-- either member, logged. Written before the build (ENGINEERING §5, tests first by someone else). Runs after
-- schema_test.sql (A and B share a household; it left Tesco, e1, with Sam's comment "Was this the big shop?").
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
reset role;
set role authenticated;

-- An entry to talk about.
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Dishoom', 8600, jsonb_build_object(:'A', 8600), jsonb_build_object(:'A', 4300, :'B', 4300))
returning id as dish \gset

-- ───────── ACT-4: a comment is added by its author; its creation is in the history ─────────
insert into comments(household_id, expense_id, author, body) values (my_household(), :'dish', :'A', 'Worth it')
returning id as mine \gset
select count(*) = 1 as ok_act4_comment_added from comments where id = :'mine' and author = :'A' and deleted_at is null;
select count(*) = 1 as ok_act4_comment_creation_logged from activity
where entity = 'comment' and entity_id = :'mine' and action = 'created' and actor = :'A';
insert into comments(household_id, expense_id, author, body) values (my_household(), :'dish', :'A', '   ');          -- expect error: a comment needs words
insert into comments(household_id, expense_id, author, body) values (my_household(), :'dish', :'A', repeat('x', 501)); -- expect error: 500 characters at most
insert into comments(household_id, expense_id, author, body) values (my_household(), :'dish', :'A', repeat('x', 500))
returning id as long_one \gset
select length(body) = 500 as ok_act4_500_characters_allowed from comments where id = :'long_one';

-- ───────── ACT-4: the partner's comment ─────────
set request.jwt.claim.sub = :'B';
insert into comments(household_id, expense_id, author, body) values (my_household(), :'dish', :'B', 'Was it your birthday?')
returning id as theirs \gset
select count(*) = 3 as ok_act4_both_read_the_thread from comments where expense_id = :'dish';

-- ───────── ACT-4: the author edits their own; the edit is logged with what changed ─────────
set request.jwt.claim.sub = :'A';
update comments set body = 'Worth every penny' where id = :'mine';
select body = 'Worth every penny' as ok_act4_author_edits from comments where id = :'mine';
select count(*) = 1 as ok_act4_edit_logged from activity
where entity = 'comment' and entity_id = :'mine' and action = 'edited' and actor = :'A'
  and summary->'body'->>'before' = 'Worth it' and summary->'body'->>'after' = 'Worth every penny';
update comments set body = '' where id = :'mine';                                                      -- expect error: an edit still needs words

-- ───────── ACT-4: nobody can change the other's comment ─────────
update comments set body = 'Hijacked' where id = :'theirs';
update comments set deleted_at = now() where id = :'theirs';
reset role;
select body = 'Was it your birthday?' and deleted_at is null as ok_act4_partner_cannot_edit_or_delete_mine from comments where id = :'theirs';
set role authenticated;
set request.jwt.claim.sub = :'B';
update comments set body = 'Hijacked' where id = :'mine';
reset role;
select body = 'Worth every penny' as ok_act4_and_the_other_way_round from comments where id = :'mine';
set role authenticated;
-- Nor can an author hand their comment to the other person.
set request.jwt.claim.sub = :'A';
update comments set author = :'B' where id = :'mine';                                                  -- expect error: not your comment then

-- ───────── ACT-4: the author deletes their own, softly; the delete is logged ─────────
update comments set deleted_at = now() where id = :'mine';
select deleted_at is not null as ok_act4_soft_deleted from comments where id = :'mine';
select count(*) = 1 as ok_act4_delete_logged from activity
where entity = 'comment' and entity_id = :'mine' and action = 'deleted' and actor = :'A';

-- ───────── ACT-4: no comment is ever hard-deleted (non-negotiable 4) ─────────
delete from comments where id = :'mine';                                                               -- expect error: no delete privilege
set request.jwt.claim.sub = :'B';
delete from comments where id = :'theirs';                                                             -- expect error: no delete privilege
reset role;
select count(*) = 3 as ok_act4_never_hard_deleted from comments where expense_id = :'dish';
select not has_table_privilege('authenticated', 'public.comments', 'DELETE') as ok_act4_delete_not_granted;

-- ───────── ACT-4: an outsider sees and adds nothing ─────────
set role authenticated;
set request.jwt.claim.sub = :'C';
select count(*) = 0 as ok_act4_outsider_sees_no_comments from comments;
insert into comments(household_id, expense_id, author, body)
select household_id, id, :'C', 'Hello' from expenses where id = :'dish';  -- (sees no entry, so inserts nothing)
reset role;
select count(*) = 0 as ok_act4_outsider_added_nothing from comments where author = :'C';

-- ───────── ACT-4: the partner's phone hears about comments (Realtime) ─────────
select count(*) = 1 as ok_act4_comments_published from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments';

-- ───────── SET-4: settle day, a day 1–28 or none ─────────
select count(*) = 1 as ok_set4_settle_day_column from information_schema.columns
 where table_schema = 'public' and table_name = 'households' and column_name = 'settle_day';
set role authenticated;
set request.jwt.claim.sub = :'A';
select settle_day is null as ok_set4_off_by_default from households;
select set_settle_day(15);
select settle_day = 15 as ok_set4_either_member_sets_it from households;
select count(*) = 1 as ok_set4_change_logged from activity
where entity = 'household' and action = 'edited' and actor = :'A'
  and summary->'settle_day'->>'after' = '15';
set request.jwt.claim.sub = :'B';
select set_settle_day(28);
select settle_day = 28 as ok_set4_the_other_member_too from households;
select count(*) = 1 as ok_set4_partner_change_logged from activity
where entity = 'household' and action = 'edited' and actor = :'B'
  and summary->'settle_day'->>'before' = '15' and summary->'settle_day'->>'after' = '28';
select set_settle_day(29);                                                                             -- expect error: 1–28 only
select set_settle_day(0);                                                                              -- expect error: 1–28 only
select settle_day = 28 as ok_set4_out_of_range_kept_the_day from households;
select set_settle_day(null);
select settle_day is null as ok_set4_turned_off from households;
select count(*) = 1 as ok_set4_turning_off_logged from activity
where entity = 'household' and action = 'edited' and actor = :'B'
  and summary->'settle_day'->>'before' = '28' and summary ? 'settle_day' and summary->'settle_day'->'after' = 'null'::jsonb;

-- Only through the RPC: a direct write is refused, and an outsider can't set anyone's.
set request.jwt.claim.sub = :'A';
update households set settle_day = 3;                                                                  -- expect error: only through set_settle_day
reset role;
update households set settle_day = 40;                                                                 -- expect error: the column's own check
select count(*) filter (where settle_day is not null) = 0 as ok_set4_direct_writes_refused from households
 where id = (select household_id from members where user_id = :'A');
set role authenticated;
set request.jwt.claim.sub = :'C';
select set_settle_day(10);                                                                             -- expect error: not in a household
reset role;
select count(*) filter (where settle_day = 10) = 0 as ok_set4_outsider_changed_nothing from households;
set role anon;
select set_settle_day(10);                                                                             -- expect error: anon cannot execute
reset role;
