-- S4a (docs/slices/S4.md): chapters are closed, never deleted; every change to one is in the household's
-- history (entity 'chapter'); the partner's phone hears about them (Realtime); an entry can only point at its own
-- household's chapter. Written before the build (ENGINEERING §5, tests first by someone else). Runs after
-- schema_test.sql (A and B share a household; it left an open trip, Japan, with one entry, Ramen).
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set D '55555555-5555-5555-5555-555555555555'
reset role;
set role authenticated;

-- ───────── CHP-1: a chapter is created; its creation is in the history ─────────
set request.jwt.claim.sub = :'A';
insert into chapters(household_id, name, emoji, kind) values (my_household(), 'New sofa', '🛋️', 'project')
returning id as sofa \gset
select count(*) = 1 as ok_chp1_project_created from chapters where id = :'sofa' and kind = 'project' and not closed;
select count(*) = 1 as ok_chp1_creation_logged from activity
where entity = 'chapter' and entity_id = :'sofa' and action = 'created' and actor = :'A';
insert into chapters(household_id, name, emoji, kind, country, start_date, end_date)
values (my_household(), 'Lisbon', '🇵🇹', 'trip', 'PT', '2026-05-01', '2026-04-30');  -- expect error: ends before it starts
insert into chapters(household_id, name, kind) values (my_household(), '   ', 'project');  -- expect error: a chapter needs a name

-- ───────── CHP-1 CHP-3: edits, closing and reopening are logged with what changed and who ─────────
set request.jwt.claim.sub = :'B';
update chapters set name = 'Sofa', emoji = '🪑' where id = :'sofa';
select count(*) = 1 as ok_chp1_edit_logged from activity
where entity = 'chapter' and entity_id = :'sofa' and action = 'edited' and actor = :'B'
  and summary->'name'->>'before' = 'New sofa' and summary->'name'->>'after' = 'Sofa'
  and summary->'emoji'->>'after' = '🪑';
update chapters set closed = true where id = :'sofa';
select closed as ok_chp3_closed from chapters where id = :'sofa';
select count(*) = 1 as ok_chp3_close_logged from activity
where entity = 'chapter' and entity_id = :'sofa' and action = 'edited' and actor = :'B'
  and summary->'closed'->>'before' = 'false' and summary->'closed'->>'after' = 'true';
set request.jwt.claim.sub = :'A';
update chapters set closed = false where id = :'sofa';
select not closed as ok_chp3_reopened from chapters where id = :'sofa';
select count(*) = 1 as ok_chp3_reopen_logged from activity
where entity = 'chapter' and entity_id = :'sofa' and action = 'edited' and actor = :'A'
  and summary->'closed'->>'before' = 'true' and summary->'closed'->>'after' = 'false';

-- ───────── CHP-2 CHP-4: an entry in a chapter is still one entry in the one balance ─────────
select net_pence as net_a_before from member_net where user_id = :'A' \gset
insert into expenses(household_id, description, amount_pence, paid, shares, chapter_id)
values (my_household(), 'Sofa deposit', 20000, jsonb_build_object(:'A', 20000), jsonb_build_object(:'A', 10000, :'B', 10000), :'sofa')
returning id as deposit \gset
select chapter_id = :'sofa' as ok_chp2_entry_in_its_chapter from expenses where id = :'deposit';
select net_pence = :net_a_before + 10000 as ok_chp4_chapter_entry_moves_the_one_balance from member_net where user_id = :'A';

-- ───────── CHP-2: an entry may point only at its own household's chapter ─────────
-- Another couple's household, with a chapter of its own.
reset role;
insert into auth.users values (:'D') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = :'D';
select create_household() is not null as ok_chp2_another_household;
insert into chapters(household_id, name, emoji, kind, country) values (my_household(), 'Their trip', '🏝️', 'trip', 'ES')
returning id as theirs \gset
set request.jwt.claim.sub = :'A';
select count(*) = 0 as ok_chp2_other_households_chapter_unseen from chapters where id = :'theirs';
update chapters set closed = true where id = :'theirs';
reset role;
select not closed as ok_chp2_other_households_chapter_untouchable from chapters where id = :'theirs';
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid, shares, chapter_id)
values (my_household(), 'Sneaky', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), :'theirs');  -- expect error: not our chapter
update expenses set chapter_id = :'theirs' where id = :'deposit';     -- expect error: not our chapter
reset role;
select count(*) = 0 as ok_chp2_no_entry_points_at_another_households_chapter from expenses where chapter_id = :'theirs';
select chapter_id = :'sofa' as ok_chp2_entry_kept_its_own_chapter from expenses where id = :'deposit';
-- Nor at a chapter that doesn't exist.
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid, shares, chapter_id)
values (my_household(), 'Nowhere', 1000, jsonb_build_object(:'A', 1000), jsonb_build_object(:'A', 500, :'B', 500), gen_random_uuid());  -- expect error: no such chapter

-- ───────── CHP-1: the partner's phone hears about chapters (Realtime) ─────────
reset role;
select count(*) = 1 as ok_chp1_chapters_published from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chapters';

-- ───────── CHP-3: chapters are closed, never deleted (non-negotiable 4) ─────────
-- Last in this file, so nothing above depends on it while delete is still allowed.
set role authenticated;
set request.jwt.claim.sub = :'A';
delete from chapters where id = :'sofa';                               -- expect error: chapters are closed, never deleted
reset role;
select count(*) = 1 as ok_chp3_never_deleted from chapters where id = :'sofa';
select chapter_id = :'sofa' as ok_chp3_entries_keep_their_chapter from expenses where id = :'deposit';
