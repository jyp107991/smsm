-- S8 (NOT-1): the deploy's smoke test has only the publishable key, so health() (open to anon) says whether the push
-- function has made its keys, and nothing more about them. Runs after notifications_test.sql, which stored a key.
reset role;
set role anon;
set request.jwt.claim.sub = '';
select (health()->>'ok')::boolean and (health()->>'push')::boolean as ok_not1_health_says_the_push_keys_are_there;
select health()::text not like '%BPublicKeyForTests%' as ok_not1_health_does_not_give_the_key_away;
reset role;
