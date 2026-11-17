-- Checks for migration 20261117000000_join_attempt_limit. Runs after schema_test.sql (households exist).
reset role;
insert into auth.users values ('44444444-4444-4444-4444-444444444444') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select join_household('ZZZZZ1') is null as ok_wrong_code_returns_null;
select join_household('ZZZZZ2'), join_household('ZZZZZ3'), join_household('ZZZZZ4'), join_household('ZZZZZ5'),
       join_household('ZZZZZ6'), join_household('ZZZZZ7'), join_household('ZZZZZ8'), join_household('ZZZZZ9');
select join_household('ZZZZZA') is null as ok_tenth_wrong_code_still_answers;
select join_household('ZZZZZB');                                       -- expect error: too many wrong codes
select count(*) = 0 as ok_not_joined_after_wrong_codes from members where user_id = '44444444-4444-4444-4444-444444444444';
select * from join_attempts;                                           -- expect error: no access
