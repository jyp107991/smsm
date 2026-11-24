-- smsm migration (S10, the owner's two asks for regular payments; DECISIONS 24 Nov). Expand only: a new nullable
-- column, and two functions replaced. The deployed app keeps working: it never sends deleted_at (null, as before),
-- and the start it can't move yet still applies as before.
--
-- 1. Delete a paused or ended regular payment: a soft delete, like an entry's (non-negotiable 4: no hard delete of
--    money rows; every change logged, which log_activity already does for any table with deleted_at: "deleted",
--    "restored"). recurring_guard keeps two rules, so no phone (old, offline or wrong) can get round them:
--      a. A deleted template is never running: deleting one that is active and not ended (its end after the UK
--         today) is refused, and so is any write that would make a deleted one run again (a resume, a later end).
--         Ended today counts as ended, as Bills shows it.
--      b. Deleting and restoring change deleted_at alone, so Undo brings back exactly what was deleted and a restore
--         can't also resume it. A second delete (the other phone, which hadn't heard) keeps the first time.
--    post_due_recurring never posts a deleted template. What it posted stays as it is, with its recurring_id.
-- 2. A new start after one has posted (the same rhythm): the start picked is the anchor (REC-2) and every occurrence
--    of the new schedule on or before the UK today counts as done. So the change itself posts nothing: nothing
--    back-dated, nothing twice, and a new day that falls today doesn't post today (that period's bill has posted on
--    the old day). Posted days never move (REC-6). A new rhythm (How often, Every) still applies from the old
--    schedule's next day, as migration 8 made it; the sheet keeps How often fixed once one has posted.
alter table recurring add column if not exists deleted_at timestamptz;

create or replace function recurring_guard() returns trigger
language plpgsql set search_path = public as $$
declare uk_today date := (now() at time zone 'Europe/London')::date; nxt date; n int := 0;
        own constant text[] := array['deleted_at', 'updated_at', 'posted_count'];
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then new.posted_count := 0; end if;
    if new.deleted_at is not null and new.active and (new.end_date is null or new.end_date > uk_today) then
      raise exception 'a regular payment that is still running can''t be deleted: pause or end it first' using errcode = '23514';
    end if;
    return new;
  end if;
  if current_user = 'authenticated' and new.posted_count is distinct from old.posted_count then
    raise exception 'posted_count is kept by the server' using errcode = '42501';
  end if;
  -- 1b. Delete and restore are one thing at a time; deleted once, when it was.
  if (old.deleted_at is null) <> (new.deleted_at is null) then
    if (to_jsonb(new) - own) is distinct from (to_jsonb(old) - own) then
      raise exception 'deleting or restoring a regular payment changes nothing else' using errcode = '23514';
    end if;
  elsif old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  -- 1a. A deleted template is never running.
  if new.deleted_at is not null and new.active and (new.end_date is null or new.end_date > uk_today) then
    if old.deleted_at is not null then
      raise exception 'a deleted regular payment can''t run again' using errcode = '23514';
    end if;
    raise exception 'a regular payment that is still running can''t be deleted: pause or end it first' using errcode = '23514';
  end if;
  if old.posted_count > 0 and (new.frequency, new.every) is not distinct from (old.frequency, old.every)
     and new.start_date is distinct from old.start_date then
    -- 2. A new start: what falls on or before today is done; the next is the first new day after today.
    new.posted_count := 0;
    loop
      exit when (new.start_date + recurring_step(new.frequency, new.every) * new.posted_count)::date > uk_today;
      new.posted_count := new.posted_count + 1;
      n := n + 1;
      if n > 100000 then raise exception 'that start is too far back' using errcode = '22023'; end if;
    end loop;
    n := 0;
  elsif old.posted_count > 0 and (new.frequency, new.every, new.start_date) is distinct from (old.frequency, old.every, old.start_date) then
    nxt := (old.start_date + recurring_step(old.frequency, old.every) * old.posted_count)::date;
    new.start_date := greatest(new.start_date, nxt);
    new.posted_count := 0;
  end if;
  if not old.active and new.active then
    loop
      exit when (new.start_date + recurring_step(new.frequency, new.every) * new.posted_count)::date >= uk_today or n >= 10000;
      new.posted_count := new.posted_count + 1;
      n := n + 1;
    end loop;
  end if;
  return new;
end $$;
revoke execute on function recurring_guard() from public, anon, authenticated;

-- As migration 20261118000200_notifications left it, plus: a deleted template never posts.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid; home char(2); v_id uuid; v_late boolean;
        uk_today date := (now() at time zone 'Europe/London')::date;
begin
  if auth.uid() is not null and p_household is not null and p_household is distinct from my_household() then
    raise exception 'not your household';
  end if;
  if auth.uid() is null and current_setting('role', true) in ('anon', 'authenticated') then
    raise exception 'not signed in';
  end if;
  hid := coalesce(p_household, my_household());
  if hid is null then return 0; end if;
  perform set_config('smsm.posting', 'on', true);
  v_late := exists (select 1 from notification_daily_runs where day = uk_today)
            and (select count(*) from members x where x.household_id = hid) = 2;
  select home_country into home from households where id = hid;
  for r in select * from recurring where household_id = hid and active and deleted_at is null order by id for update loop
    step := case r.frequency when 'weekly' then make_interval(weeks => r.every)
                             when 'monthly' then make_interval(months => r.every)
                             else make_interval(years => r.every) end;
    loop
      d := (r.start_date + step * r.posted_count)::date;
      exit when d > uk_today or (r.end_date is not null and d > r.end_date);
      if r.amount_varies then
        insert into inbox_items(household_id, source, recurring_id, occurrence_date, payload)
        values (r.household_id, 'bill', r.id, d, jsonb_build_object('description', r.description,
                'estimate_pence', r.amount_pence, 'date', d, 'category_id', r.category_id))
        on conflict do nothing;
      else
        v_id := null;
        insert into expenses(household_id, description, amount_pence, date, category_id, chapter_id, paid, paid_via,
                             split_mode, split_params, shares, notes, country, source, recurring_id, occurrence_date)
        values (r.household_id, r.description, r.amount_pence, d, r.category_id, null, r.paid, r.paid_via,
                r.split_mode, r.split_params, r.shares, r.notes, coalesce(home, 'GB'), 'recurring', r.id, d)
        on conflict do nothing
        returning id into v_id;
        if v_late and v_id is not null and d = uk_today then
          insert into notification_outbox(household_id, recipient, kind, ref_id, payload)
          select hid, m.user_id, 'bill_posted', v_id, jsonb_build_object('recurring_id', r.id) from members m where m.household_id = hid;
        end if;
      end if;
      r.posted_count := r.posted_count + 1;
      posted := posted + 1;
    end loop;
    update recurring set posted_count = r.posted_count where id = r.id and posted_count is distinct from r.posted_count;
  end loop;
  perform set_config('smsm.posting', 'off', true);
  if v_late then perform kick_push(); end if;
  return posted;
end $$;
revoke execute on function post_due_recurring(uuid) from public, anon;
grant execute on function post_due_recurring(uuid) to authenticated;
