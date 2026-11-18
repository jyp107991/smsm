-- S6b (docs/slices/S6b.md "Decisions made here → Recap wording", "Data"; SPEC INS-2): the recap's AI wording is kept
-- once per household per finished month, so the partner's phone reads the same words and the AI is asked once.
-- Written before the build (ENGINEERING §5, tests first by someone else). Runs after schema_test.sql (A and B share
-- a household; C is in none); E starts a household of its own here.
--
--   save_recap_prose(p_period text, p_stats jsonb, p_prose text) returns text: security definer; members only (a
--     signed-in person in no household is refused, anon can't execute it); p_period is 'YYYY-MM' (a real month) and
--     before the current UK month (Europe/London), else refused; p_prose not null or blank, else refused; insert-only:
--     if the household already has a row for that period, nothing changes and its prose is returned; otherwise the
--     row (household, period, stats, prose) is added and p_prose returned. recaps stays read-only to members
--     (written only through this RPC); members read their own household's rows, nobody else's.
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
\set E '66666666-6666-6666-6666-666666666666'
\set first '{"headline":"A paid £1,000.00 of October’s £1,365.50.","aside":null}'
\set second '{"headline":"October came to £1,365.50 together.","aside":"B paid £365.50."}'
reset role;
insert into auth.users values (:'E') on conflict do nothing;
select to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM') as this_month,
       to_char((now() at time zone 'Europe/London')::date - interval '1 month', 'YYYY-MM') as last_month,
       to_char((now() at time zone 'Europe/London')::date - interval '2 months', 'YYYY-MM') as older_month,
       to_char((now() at time zone 'Europe/London')::date + interval '1 month', 'YYYY-MM') as next_month \gset

set role authenticated;
set request.jwt.claim.sub = :'A';
select my_household() as hid \gset

-- ───────── INS-2: the first phone to open a finished month keeps its wording ─────────
select save_recap_prose(:'last_month', '{"total":"£1,365.50","paid":{"A":"£1,000.00","B":"£365.50"}}'::jsonb, :'first') = :'first'
  as ok_ins2_first_wording_is_kept;

-- The partner's phone, asking at the same time, gets the first wording back; nothing is overwritten.
set request.jwt.claim.sub = :'B';
select save_recap_prose(:'last_month', '{"total":"£9.99"}'::jsonb, :'second') = :'first' as ok_ins2_second_save_returns_the_first;
select count(*) = 1 as ok_ins2_partner_reads_the_one_row from recaps where period = :'last_month';
select prose = :'first' and stats->>'total' = '£1,365.50' as ok_ins2_partner_reads_the_first_wording
  from recaps where period = :'last_month';

reset role;
select count(*) = 1 as ok_ins2_one_row_per_household_and_month from recaps where household_id = :'hid' and period = :'last_month';
select prose = :'first' and stats->>'total' = '£1,365.50' as ok_ins2_never_overwritten
  from recaps where household_id = :'hid' and period = :'last_month';
select prosecdef as ok_ins2_save_recap_prose_is_security_definer
  from pg_proc where oid = 'public.save_recap_prose(text, jsonb, text)'::regprocedure;
select pg_get_functiondef('public.save_recap_prose(text, jsonb, text)'::regprocedure) ilike '%Europe/London%' as ok_ins2_this_month_is_the_uk_month;

-- An older finished month is fine too.
set role authenticated;
set request.jwt.claim.sub = :'A';
select save_recap_prose(:'older_month', '{"total":"£1,200.00"}'::jsonb, :'second') = :'second' as ok_ins2_an_older_month_is_kept;

-- ───────── INS-2: only finished months, properly named; prose required ─────────
select save_recap_prose(:'this_month', '{}'::jsonb, :'first');                    -- expect error: this month is not finished
select save_recap_prose(:'next_month', '{}'::jsonb, :'first');                    -- expect error: a future month
select save_recap_prose('2026-13', '{}'::jsonb, :'first');                        -- expect error: not a month
select save_recap_prose('Oct 2026', '{}'::jsonb, :'first');                       -- expect error: not YYYY-MM
select save_recap_prose(null, '{}'::jsonb, :'first');                             -- expect error: no period
select save_recap_prose('2025-01', '{}'::jsonb, null);                            -- expect error: no prose
select save_recap_prose('2025-01', '{}'::jsonb, '   ');                           -- expect error: blank prose
reset role;
select count(*) = 2 as ok_ins2_refused_saves_left_nothing from recaps where household_id = :'hid';

-- ───────── INS-2: the table is written only through the RPC ─────────
set role authenticated;
set request.jwt.claim.sub = :'A';
insert into recaps(household_id, period, stats, prose) values (my_household(), '2025-02', '{}'::jsonb, 'x');   -- expect error: only through the RPC
update recaps set prose = 'changed';                                                                          -- expect error: never overwritten
delete from recaps;                                                                                           -- expect error: no deletes
reset role;
select count(*) = 2 and bool_and(prose <> 'changed') as ok_ins2_rows_untouched from recaps where household_id = :'hid';

-- ───────── INS-2: members only; another household sees nothing of it ─────────
set role authenticated;
set request.jwt.claim.sub = :'C';
select save_recap_prose(:'last_month', '{}'::jsonb, :'first');                    -- expect error: not in a household
select count(*) = 0 as ok_ins2_outsider_reads_no_recaps from recaps;

set request.jwt.claim.sub = :'E';
select create_household() is not null as ok_ins2_another_household;
select count(*) = 0 as ok_ins2_other_household_reads_none_of_ours from recaps;
select save_recap_prose(:'last_month', '{"total":"£42.00"}'::jsonb, :'second') = :'second' as ok_ins2_other_household_keeps_its_own;
set request.jwt.claim.sub = :'A';
select count(*) = 2 as ok_ins2_ours_unchanged_by_theirs from recaps;
select prose = :'first' as ok_ins2_our_month_still_ours from recaps where period = :'last_month';

reset role;
set role anon;
select save_recap_prose(:'last_month', '{}'::jsonb, :'first');                    -- expect error: anon cannot execute
reset role;
select not has_function_privilege('anon', 'public.save_recap_prose(text, jsonb, text)', 'execute') as ok_ins2_anon_cannot_save;
select has_function_privilege('authenticated', 'public.save_recap_prose(text, jsonb, text)', 'execute') as ok_ins2_members_can_save;

-- S6b fresh review: nothing oversized is kept.
set role authenticated;
set request.jwt.claim.sub = :'A';
select save_recap_prose('2020-01', '{"total":"£1.00"}'::jsonb, repeat('x', 2001));                -- expect error: wording too long
select save_recap_prose('2020-01', jsonb_build_object('notes', repeat('y', 20000)), '{"headline":"x","aside":null}'); -- expect error: figures too large
reset role;
select count(*) = 0 as ok_set_review_nothing_oversized_kept from recaps where period = '2020-01' and household_id = :'hid';
