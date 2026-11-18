-- S6a (docs/slices/S6.md "Data"; SPEC SCAN-1, SCAN-4, SCAN-5, CAT-2): the daily counts behind the smart-feature caps,
-- the receipts bucket and the guess mark on an entry. Written before the build (ENGINEERING §5, tests first by someone
-- else). Runs after schema_test.sql (A and B share a household; C is in none).
--
--   increment_ai_usage(p_kind text) returns int: security definer; members only (a signed-in person in no household
--     is refused, anon can't execute it); adds one to ai_usage for (my household, today's UK date, kind) and returns
--     the new count; kinds are scan, parse, categorise, recap, ask; ai_usage is only ever written through it.
--   expenses.category_guess boolean not null default false (CAT-2 step 4).
--   Storage bucket `receipts` (private): objects at <household_id>/<uuid>.jpg; members insert and read under their own
--     household's folder only; nobody updates or deletes (non-negotiable 4); anon nothing. Plain PostgreSQL has no
--     `storage` schema, so those checks run through the helpers below and pass trivially (each labelled
--     ending "_skip_if_no_storage") when storage.objects doesn't exist; against the Supabase stack they are real.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
reset role;

-- Runs a statement given as text: null without the storage schema; -1 if it fails; otherwise the rows it touched
-- (or, for a select, returned).
create function pg_temp.storage_rows(q text) returns int language plpgsql as $f$
declare n int;
begin
  if to_regclass('storage.objects') is null then return null; end if;
  execute q;
  get diagnostics n = row_count;
  return n;
exception when others then return -1;
end $f$;
-- Runs a boolean query given as text: null without the storage schema; false if it fails.
create function pg_temp.storage_q(q text) returns boolean language plpgsql as $f$
declare r boolean;
begin
  if to_regclass('storage.objects') is null then return null; end if;
  execute q into r;
  return coalesce(r, false);
exception when others then return false;
end $f$;
grant execute on function pg_temp.storage_rows(text), pg_temp.storage_q(text) to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = :'A';
select my_household() as hid \gset

-- ───────── SCAN-5: increment_ai_usage counts per household, per kind, per UK day ─────────
select increment_ai_usage('scan') = 1 as ok_scan5_first_scan_of_the_day_is_one;
select increment_ai_usage('scan') = 2 as ok_scan5_second_scan_is_two;
set request.jwt.claim.sub = :'B';
select increment_ai_usage('scan') = 3 as ok_scan5_the_partner_counts_towards_the_same_household;
select increment_ai_usage('parse') = 1 as ok_scan5_each_kind_is_counted_apart;
select increment_ai_usage('categorise') = 1 as ok_cat2_categorise_counted;
select increment_ai_usage('recap') = 1 as ok_scan5_recap_is_a_kind;
select increment_ai_usage('ask') = 1 as ok_scan5_ask_is_a_kind;
select increment_ai_usage('banana');                                                                    -- expect error: not a kind
select increment_ai_usage(null);                                                                        -- expect error: not a kind
select increment_ai_usage('SCAN');                                                                      -- expect error: not a kind

reset role;
select calls = 3 and day = (now() at time zone 'Europe/London')::date as ok_scan5_one_row_per_day_and_kind
  from ai_usage where household_id = :'hid' and kind = 'scan';
select count(*) = 5 as ok_scan5_nothing_counted_for_refused_kinds from ai_usage where household_id = :'hid';
select pg_get_functiondef('public.increment_ai_usage(text)'::regprocedure) ilike '%Europe/London%' as ok_scan5_the_day_is_the_uk_date;
select prosecdef as ok_scan5_increment_is_security_definer from pg_proc where oid = 'public.increment_ai_usage(text)'::regprocedure;

-- Another day's count is its own: yesterday's 30 scans don't stop today's.
insert into ai_usage(household_id, day, kind, calls)
values (:'hid', (now() at time zone 'Europe/London')::date - 1, 'scan', 30);
set role authenticated;
set request.jwt.claim.sub = :'A';
select increment_ai_usage('scan') = 4 as ok_scan5_yesterday_is_not_today;
reset role;
select calls = 30 as ok_scan5_yesterday_left_alone from ai_usage
 where household_id = :'hid' and kind = 'scan' and day = (now() at time zone 'Europe/London')::date - 1;

-- ───────── SCAN-5: members read their own counts; nobody writes them except through the RPC ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
select count(*) = 6 as ok_scan5_members_read_their_households_counts from ai_usage;
insert into ai_usage(household_id, day, kind, calls) values (my_household(), current_date + 1, 'scan', 0); -- expect error: only through the RPC
update ai_usage set calls = 0;                                                                          -- expect error: only through the RPC

-- An outsider (signed in, in no household) can't count and sees nothing.
set request.jwt.claim.sub = :'C';
select increment_ai_usage('scan');                                                                      -- expect error: not in a household
select count(*) = 0 as ok_scan5_outsider_sees_no_counts from ai_usage;
reset role;
select count(*) = 6 as ok_scan5_outsider_counted_nothing from ai_usage where household_id = :'hid';

set role anon;
select increment_ai_usage('scan');                                                                      -- expect error: anon cannot execute
reset role;
select not has_function_privilege('anon', 'public.increment_ai_usage(text)', 'execute') as ok_scan5_anon_cannot_count;
select has_function_privilege('authenticated', 'public.increment_ai_usage(text)', 'execute') as ok_scan5_members_can_count;

-- ───────── CAT-2: the guess mark on an entry ─────────
select count(*) = 1 as ok_cat2_category_guess_column from information_schema.columns
 where table_schema = 'public' and table_name = 'expenses' and column_name = 'category_guess'
   and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false';
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into expenses(household_id, description, amount_pence, paid, shares)
values (my_household(), 'Zzyzx Emporium', 1800, jsonb_build_object(:'A', 1800), jsonb_build_object(:'A', 900, :'B', 900))
returning id as zz \gset
select category_guess = false as ok_cat2_not_a_guess_by_default from expenses where id = :'zz';
update expenses set category_id = (select id from categories where name = 'Household' and household_id = my_household()), category_guess = true
 where id = :'zz';
select category_guess as ok_cat2_a_guess_can_be_marked from expenses where id = :'zz';
update expenses set category_guess = null where id = :'zz';                                             -- expect error: never null

-- ───────── SCAN-1 SCAN-4: the receipts bucket (real against Supabase; skipped without storage) ─────────
reset role;
select coalesce(pg_temp.storage_q($q$ select exists (select 1 from storage.buckets where id = 'receipts' and not public) $q$), true)
  as ok_scan1_receipts_bucket_is_private_skip_if_no_storage;

set role authenticated;
set request.jwt.claim.sub = :'A';
select coalesce(pg_temp.storage_rows(format($q$ insert into storage.objects(bucket_id, name) values ('receipts', %L) $q$,
  :'hid' || '/00000000-0000-4000-8000-0000000000f1.jpg')) = 1, true)
  as ok_scan1_member_uploads_into_own_folder_skip_if_no_storage;
select coalesce(pg_temp.storage_rows(format($q$ insert into storage.objects(bucket_id, name) values ('receipts', %L) $q$,
  '00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000f2.jpg')) <> 1, true)
  as ok_scan1_not_into_another_households_folder_skip_if_no_storage;
select coalesce(pg_temp.storage_rows($q$ insert into storage.objects(bucket_id, name) values ('receipts', 'loose.jpg') $q$) <> 1, true)
  as ok_scan1_not_outside_any_folder_skip_if_no_storage;

set request.jwt.claim.sub = :'B';
select coalesce(pg_temp.storage_q(format($q$ select count(*) = 1 from storage.objects where bucket_id = 'receipts' and name = %L $q$,
  :'hid' || '/00000000-0000-4000-8000-0000000000f1.jpg')), true)
  as ok_scan1_partner_reads_the_photo_skip_if_no_storage;
select coalesce(pg_temp.storage_rows(format($q$ update storage.objects set name = %L where bucket_id = 'receipts' $q$,
  :'hid' || '/renamed.jpg')) <= 0, true)
  as ok_scan1_nobody_updates_a_photo_skip_if_no_storage;
select coalesce(pg_temp.storage_rows($q$ delete from storage.objects where bucket_id = 'receipts' $q$) <= 0, true)
  as ok_scan1_nobody_deletes_a_photo_skip_if_no_storage;

set request.jwt.claim.sub = :'C';
select coalesce(pg_temp.storage_rows($q$ select 1 from storage.objects where bucket_id = 'receipts' $q$) <= 0, true)
  as ok_scan1_outsider_sees_no_photos_skip_if_no_storage;
select coalesce(pg_temp.storage_rows(format($q$ insert into storage.objects(bucket_id, name) values ('receipts', %L) $q$,
  :'hid' || '/00000000-0000-4000-8000-0000000000f3.jpg')) <> 1, true)
  as ok_scan1_outsider_cannot_upload_skip_if_no_storage;

reset role;
set role anon;
select coalesce(pg_temp.storage_rows($q$ select 1 from storage.objects where bucket_id = 'receipts' $q$) <= 0, true)
  as ok_scan1_anon_sees_no_photos_skip_if_no_storage;
select coalesce(pg_temp.storage_rows(format($q$ insert into storage.objects(bucket_id, name) values ('receipts', %L) $q$,
  :'hid' || '/00000000-0000-4000-8000-0000000000f4.jpg')) <> 1, true)
  as ok_scan1_anon_cannot_upload_skip_if_no_storage;

reset role;
select coalesce(pg_temp.storage_q(format($q$ select count(*) = 1 from storage.objects where bucket_id = 'receipts' and name like %L $q$,
  :'hid' || '/%')), true)
  as ok_scan1_the_one_photo_is_still_there_skip_if_no_storage;
