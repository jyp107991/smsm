-- smsm migration 2 (S0): close function access for signed-out callers; add a health check.
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC. The baseline granted its RPCs to
-- `authenticated` but never revoked the PUBLIC default, so the publishable (anon) key could call them.
-- Most refuse without a sign-in, but post_due_recurring(uuid) skipped its household check when
-- auth.uid() was null (inside a security definer function current_user is the owner, so the caller's
-- role is read from the 'role' setting). From here on, functions are executable only where granted
-- (tests/sql/hardening_test.sql checks every public function's privileges).

revoke execute on all functions in schema public from public, anon;
-- Future functions: remove the global PUBLIC default (a per-schema rule cannot), and Supabase's per-schema
-- grant to anon. Each new function is then granted explicitly in its migration.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- Signed-in people call the RPCs; trigger functions need no grant (triggers run regardless).
grant execute on function my_household(), create_household(), join_household(text), set_identity(text, text),
  set_monzo_me(text), request_change(text, jsonb), decide_change(uuid, boolean), post_due_recurring(uuid)
  to authenticated;
-- Called from the money check trigger, which runs as the signed-in person.
grant execute on function jsonb_pence_sum(jsonb) to authenticated;

-- post_due_recurring: a signed-in caller may only post for their own household. Without a sign-in it is
-- reachable only by the database owner (the nightly job), which may name any household.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid; home char(2);
begin
  if auth.uid() is not null and p_household is not null and p_household is distinct from my_household() then
    raise exception 'not your household';
  end if;
  if auth.uid() is null and current_setting('role', true) in ('anon', 'authenticated') then
    raise exception 'not signed in';
  end if;
  hid := coalesce(p_household, my_household());
  if hid is null then return 0; end if;
  select home_country into home from households where id = hid;
  for r in select * from recurring where household_id = hid and active for update loop
    step := case r.frequency when 'weekly' then make_interval(weeks => r.every)
                             when 'monthly' then make_interval(months => r.every)
                             else make_interval(years => r.every) end;
    loop
      d := (r.start_date + step * r.posted_count)::date;
      exit when d > current_date or (r.end_date is not null and d > r.end_date);
      if r.amount_varies then
        insert into inbox_items(household_id, source, recurring_id, occurrence_date, payload)
        values (r.household_id, 'bill', r.id, d, jsonb_build_object('description', r.description,
                'estimate_pence', r.amount_pence, 'date', d, 'category_id', r.category_id))
        on conflict do nothing;
      else
        insert into expenses(household_id, description, amount_pence, date, category_id, paid, paid_via, split_mode,
                             split_params, shares, notes, country, source, recurring_id, occurrence_date)
        values (r.household_id, r.description, r.amount_pence, d, r.category_id, r.paid, r.paid_via, r.split_mode,
                r.split_params, r.shares, r.notes, home, 'recurring', r.id, d)
        on conflict do nothing;
      end if;
      r.posted_count := r.posted_count + 1;
      posted := posted + 1;
    end loop;
    update recurring set posted_count = r.posted_count where id = r.id;
  end loop;
  return posted;
end $$;
revoke execute on function post_due_recurring(uuid) from public, anon;
grant execute on function post_due_recurring(uuid) to authenticated;

-- Health check for the deploy smoke test and the keep-alive job. Reveals nothing but the minimum app version.
create or replace function health() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'min_client_version', (select value from app_config where key = 'min_client_version'))
$$;
revoke execute on function health() from public;
grant execute on function health() to anon, authenticated;
