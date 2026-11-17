-- S3 (docs/slices/S3.md), CAT-1: categories can be added, renamed, re-emojied, recoloured from the palette,
-- reordered and archived; archived ones keep their history; a category is never deleted. Every change is
-- logged (non-negotiable 4). Written before the build. Runs after schema_test.sql (A and B share a household).
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
reset role;
set role authenticated;
set request.jwt.claim.sub = :'A';

insert into categories(household_id, name, emoji, colour, sort) values (my_household(), 'Pets', '🐾', 'fern', 13)
returning id as pets \gset
select count(*) = 13 as ok_cat1_added from categories;
-- Colours are palette token names (DESIGN §3.1), never a free colour.
insert into categories(household_id, name, emoji, colour, sort) values (my_household(), 'Neon', '•', '#ff00ff', 14); -- expect error: colour not in the palette
update categories set colour = 'pink' where id = :'pets';             -- expect error: colour not in the palette
update categories set colour = 'plum' where id = :'pets';
select colour = 'plum' as ok_cat1_recoloured_from_the_palette from categories where id = :'pets';

-- Rename and re-emoji; the change is in the household's history.
set request.jwt.claim.sub = :'B';
update categories set name = 'Pet things', emoji = '🐕' where id = :'pets';
select count(*) = 1 as ok_cat1_rename_logged from activity
where entity = 'category' and entity_id = :'pets' and action = 'edited' and actor = :'B'
  and summary->'name'->>'before' = 'Pets' and summary->'name'->>'after' = 'Pet things';

-- Reorder: sort is the household's order.
update categories set sort = 0 where id = :'pets';
select (array_agg(name order by sort, name))[1] = 'Pet things' as ok_cat1_reordered from categories;

-- Archive: the entries keep their category.
insert into expenses(household_id, description, amount_pence, category_id, paid, shares)
values (my_household(), 'Dog food', 2000, :'pets', jsonb_build_object(:'B', 2000), jsonb_build_object(:'A', 1000, :'B', 1000))
returning id as dogfood \gset
update categories set archived = true where id = :'pets';
select category_id = :'pets' as ok_cat1_archived_keeps_its_entries from expenses where id = :'dogfood';
select archived as ok_cat1_archived from categories where id = :'pets';
delete from categories where id = :'pets';                             -- expect error: categories are archived, never deleted
select count(*) = 1 as ok_cat1_never_deleted from categories where id = :'pets';
