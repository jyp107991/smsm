-- smsm migration 3 (S2 groundwork): limit guessing of join codes.
-- While sign-ups are open, anyone can create an account; a 6-character code must not be guessable by
-- trying many. Each signed-in account gets 10 wrong codes per hour. A wrong code now returns null (and is
-- counted) instead of raising, because raising would roll back the record of the attempt.

create table if not exists join_attempts (
  user_id  uuid not null references auth.users(id) on delete cascade,
  at       timestamptz not null default now()
);
create index if not exists join_attempts_user_at on join_attempts(user_id, at);
alter table join_attempts enable row level security;   -- no policies: only the function below touches it
revoke all on join_attempts from anon, authenticated;

create or replace function join_household(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  -- One join at a time per account, so parallel requests can't each see a count under the limit.
  perform pg_advisory_xact_lock(hashtext('join:' || auth.uid()::text));
  if (select count(*) from join_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'too many wrong codes; try again in an hour';
  end if;
  select id into hid from households where join_code = upper(trim(p_code)) for update;
  if hid is null then
    insert into join_attempts(user_id) values (auth.uid());
    return null;                                -- the app says "No household has that code"
  end if;
  if (select count(*) from members where household_id = hid) >= 2 then raise exception 'this household already has two people'; end if;
  insert into members(household_id, user_id) values (hid, auth.uid());
  delete from join_attempts where user_id = auth.uid();
  return hid;
end $$;
revoke execute on function join_household(text) from public, anon;
grant execute on function join_household(text) to authenticated;
