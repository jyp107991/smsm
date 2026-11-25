-- smsm migration S10 (owner, 25 Nov: "should be able to add recurring payments that are not shared, which clearly are
-- separately recorded and filterable as separate individual recurring payments/bills/subs"; "both of you can see them";
-- "kept fully separate"; "insights must include and be separately produced for each individual"). DECISIONS 25 Nov
-- "Personal regular payments". Expand only: two new nullable columns, the deployed app keeps working (it never sends
-- owner_id, so everything it writes stays shared, as before).
--
-- 1. recurring.owner_id: null = shared (as every template so far); a member = that person's own. expenses.owner_id: the
--    same for what a template posts. A personal row is the owner's alone: paid and shares are the whole amount to the
--    owner (split "treat", by a person), so check_money holds; a personal entry is an expense, in no chapter, never money
--    back and never refunded; a personal template has a fixed amount (no Inbox bills).
-- 2. Who may write (row-level security): both members read every row; only the owner writes a personal one (insert,
--    update: the partner's write is refused); a shared one is anyone's, as before. Only you can make a shared template
--    your own; only the owner can make theirs shared again; it is never handed to the other person.
-- 3. Whose is a template applies from the next payment on: a change of owner first posts, as it was, every day already
--    due (as a delete does), and an entry's owner never changes, so no money already counted moves.
-- 4. Never in a shared figure: member_net and member_net_on leave personal entries out; no notification is queued for
--    a personal entry or bill; the recap's "last month had something" looks at shared entries; comments are for shared
--    entries; restore_backup keeps whose each row was (people mapped).

-- ───────── 1. the columns and their shape ─────────
alter table recurring add column if not exists owner_id uuid;
alter table expenses add column if not exists owner_id uuid;

create or replace function check_personal() returns trigger
language plpgsql set search_path = public as $$
declare o text;
begin
  if tg_table_name = 'expenses' and tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'whose an entry is never changes (it would move money already counted)' using errcode = '23514';
  end if;
  if new.owner_id is null then return new; end if;
  o := new.owner_id::text;
  if not exists (select 1 from members m where m.household_id = new.household_id and m.user_id = new.owner_id) then
    raise exception 'a personal payment belongs to one of the two of you' using errcode = '23514';
  end if;
  if new.split_mode <> 'treat' or new.paid_via <> 'person'
     or coalesce((new.paid ->> o)::bigint, -1) <> new.amount_pence or coalesce((new.shares ->> o)::bigint, -1) <> new.amount_pence then
    raise exception 'a personal payment is all its owner''s: paid and shares are the whole amount' using errcode = '23514';
  end if;
  if tg_table_name = 'recurring' then
    if new.amount_varies then
      raise exception 'a personal regular payment has a fixed amount' using errcode = '23514';
    end if;
  elsif new.kind <> 'expense' or new.chapter_id is not null or new.refund_of is not null then
    raise exception 'a personal entry is an expense, in no chapter' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function check_personal() from public, anon, authenticated;
drop trigger if exists expenses_personal on expenses;
create trigger expenses_personal before insert or update on expenses for each row execute function check_personal();
drop trigger if exists recurring_personal on recurring;
create trigger recurring_personal before insert or update on recurring for each row execute function check_personal();

-- ───────── 2. who may write ─────────
drop policy if exists expenses_ins on expenses;
create policy expenses_ins on expenses for insert
  with check (household_id = my_household() and (owner_id is null or owner_id = auth.uid()));
drop policy if exists expenses_upd on expenses;
create policy expenses_upd on expenses for update
  using (household_id = my_household() and (owner_id is null or owner_id = auth.uid()))
  with check (household_id = my_household() and (owner_id is null or owner_id = auth.uid()));
drop policy if exists recurring_all on recurring;
drop policy if exists recurring_sel on recurring;
create policy recurring_sel on recurring for select using (household_id = my_household());
drop policy if exists recurring_ins on recurring;
create policy recurring_ins on recurring for insert
  with check (household_id = my_household() and (owner_id is null or owner_id = auth.uid()));
drop policy if exists recurring_upd on recurring;
create policy recurring_upd on recurring for update
  using (household_id = my_household() and (owner_id is null or owner_id = auth.uid()))
  with check (household_id = my_household() and (owner_id is null or owner_id = auth.uid()));

-- ───────── 3. a change of whose: from the next payment on ─────────
-- As migration 20261124000000 left it, plus: a template is never handed to the other person; a change of owner first
-- posts every day already due as it was (so it is counted as it was: shared, or the old owner's), and the schedule
-- rules below count from there.
create or replace function recurring_guard() returns trigger
language plpgsql set search_path = public as $$
declare uk_today date := (now() at time zone 'Europe/London')::date; nxt date; n int := 0; done int; started boolean;
        own constant text[] := array['deleted_at', 'updated_at', 'posted_count', 'ever_posted'];
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then new.posted_count := 0; new.ever_posted := false; end if;
    -- A backup from before the column (restore_backup) has none: what it had counted says.
    new.ever_posted := coalesce(new.ever_posted, false) or coalesce(new.posted_count, 0) > 0;
    if new.deleted_at is not null and new.active and (new.end_date is null or new.end_date > uk_today) then
      raise exception 'a regular payment that is still running can''t be deleted: pause or end it first' using errcode = '23514';
    end if;
    return new;
  end if;
  if current_user = 'authenticated' and new.posted_count is distinct from old.posted_count then
    raise exception 'posted_count is kept by the server' using errcode = '42501';
  end if;
  -- 4. Whose it is: never the other person's; only the owner hands theirs back to shared (row-level security too).
  if new.owner_id is distinct from old.owner_id and coalesce(current_setting('smsm.restoring', true), '') <> 'on' then
    if old.owner_id is not null and new.owner_id is not null then
      raise exception 'a personal regular payment can''t be handed to the other person' using errcode = '42501';
    end if;
    if auth.uid() is not null and coalesce(new.owner_id, old.owner_id) is distinct from auth.uid() then
      raise exception 'only its owner can change whose a regular payment is' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      raise exception 'a deleted regular payment can''t change whose it is' using errcode = '23514';
    end if;
  end if;
  -- 2. Only the server says it has posted, and it never stops having posted.
  new.ever_posted := old.ever_posted;
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
  -- 1c. Deleted: first the days due by today that haven't posted (nothing for a paused one).
  done := old.posted_count;
  if old.deleted_at is null and new.deleted_at is not null then
    new.posted_count := recurring_post_due_one(old.id);
  elsif new.owner_id is distinct from old.owner_id then
    -- 4b. A change of whose: what is already due posts first, as it was (nothing for a paused one).
    done := recurring_post_due_one(old.id);
    new.posted_count := done;
  end if;
  started := old.ever_posted or done > 0;
  if started and (new.frequency, new.every) is not distinct from (old.frequency, old.every)
     and new.start_date is distinct from old.start_date then
    -- 3. A new start: the next payment is the new occurrence nearest to the old next day.
    new.posted_count := recurring_restart_index(old.start_date, old.frequency, old.every, done, new.start_date);
  elsif started and (new.frequency, new.every, new.start_date) is distinct from (old.frequency, old.every, old.start_date) then
    nxt := (old.start_date + recurring_step(old.frequency, old.every) * done)::date;
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
  new.ever_posted := new.ever_posted or new.posted_count > 0;
  return new;
end $$;
revoke execute on function recurring_guard() from public, anon, authenticated;

-- As migration 20261124000100 left it, plus: what a personal template posts is its owner's (owner_id), and no
-- notification is queued for it.
create or replace function recurring_post_due_one(p_id uuid, p_kick boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; n int; home char(2); v_id uuid; v_late boolean; v_told boolean := false;
        uk_today date := (now() at time zone 'Europe/London')::date; was text := current_setting('smsm.posting', true);
begin
  select * into r from recurring where id = p_id;
  if not found then return 0; end if;
  if auth.uid() is not null and r.household_id is distinct from my_household() then
    raise exception 'not your household';
  end if;
  n := r.posted_count;
  if not r.active or r.deleted_at is not null then return n; end if;
  perform set_config('smsm.posting', 'on', true);
  v_late := exists (select 1 from notification_daily_runs where day = uk_today)
            and (select count(*) from members x where x.household_id = r.household_id) = 2
            and r.owner_id is null;
  select home_country into home from households where id = r.household_id;
  loop
    d := (r.start_date + recurring_step(r.frequency, r.every) * n)::date;
    exit when d > uk_today or (r.end_date is not null and d > r.end_date);
    if r.amount_varies then
      insert into inbox_items(household_id, source, recurring_id, occurrence_date, payload)
      values (r.household_id, 'bill', r.id, d, jsonb_build_object('description', r.description,
              'estimate_pence', r.amount_pence, 'date', d, 'category_id', r.category_id, 'notes', r.notes))
      on conflict do nothing;
    else
      v_id := null;
      insert into expenses(household_id, description, amount_pence, date, category_id, chapter_id, paid, paid_via,
                           split_mode, split_params, shares, notes, country, source, recurring_id, occurrence_date, owner_id)
      values (r.household_id, r.description, r.amount_pence, d, r.category_id, null, r.paid, r.paid_via,
              r.split_mode, r.split_params, r.shares, r.notes, coalesce(home, 'GB'), 'recurring', r.id, d, r.owner_id)
      on conflict do nothing
      returning id into v_id;
      if v_late and v_id is not null and d = uk_today then
        insert into notification_outbox(household_id, recipient, kind, ref_id, payload)
        select r.household_id, m.user_id, 'bill_posted', v_id, jsonb_build_object('recurring_id', r.id) from members m where m.household_id = r.household_id;
        v_told := true;
      end if;
    end if;
    n := n + 1;
  end loop;
  perform set_config('smsm.posting', coalesce(nullif(was, ''), 'off'), true);
  if p_kick and v_told then perform kick_push(); end if;
  return n;
end $$;
revoke execute on function recurring_post_due_one(uuid, boolean) from public, anon;
grant execute on function recurring_post_due_one(uuid, boolean) to authenticated;

-- ───────── 4. never in a shared figure ─────────
create or replace view member_net with (security_invoker = true) as
select m.household_id, m.user_id,
  coalesce((select sum((case e.kind when 'money_back' then -1 else 1 end)
              * (coalesce((e.paid ->> m.user_id::text)::bigint, 0) - coalesce((e.shares ->> m.user_id::text)::bigint, 0)))
            from expenses e where e.household_id = m.household_id and e.deleted_at is null and e.owner_id is null
              and not (e.kind = 'money_back' and exists (select 1 from expenses o where o.id = e.refund_of and o.deleted_at is not null))), 0)
  + coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.from_user = m.user_id), 0)
  - coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.to_user = m.user_id), 0)
  as net_pence
from members m;

create or replace function member_net_on(p_household uuid, p_user uuid, p_day date) returns bigint
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(case e.kind when 'money_back' then -1 else 1 end
                               * (coalesce((e.paid ->> p_user::text)::bigint, 0) - coalesce((e.shares ->> p_user::text)::bigint, 0)))
                      from expenses e where e.household_id = p_household and e.deleted_at is null and e.date <= p_day and e.owner_id is null
                        and not (e.kind = 'money_back' and exists (select 1 from expenses o where o.id = e.refund_of and o.deleted_at is not null))), 0)
        + coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.from_user = p_user and s.date <= p_day), 0)
        - coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.to_user = p_user and s.date <= p_day), 0))::bigint
$$;

-- As migration 20261123000000 left it, plus: nothing is queued for a personal entry.
create or replace function notify_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_payload jsonb := '{}'; v_fields jsonb;
begin
  if auth.uid() is null then return null; end if;
  if current_setting('smsm.following', true) = 'on' then return null; end if;
  -- S10: a personal entry is its owner's own business: never a notification.
  if new.owner_id is not null then return null; end if;
  if tg_op = 'INSERT' then
    if current_setting('smsm.posting', true) = 'on' or new.deleted_at is not null then return null; end if;
    v_kind := 'entry_added';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_kind := 'entry_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_kind := 'entry_restored';
  elsif new.deleted_at is not null then
    return null;
  elsif (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return null;
  else
    v_kind := 'entry_changed';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_fields
      from jsonb_each(to_jsonb(new) - 'updated_at' - 'updated_by' - 'category_guess') n
     where n.value is distinct from to_jsonb(old) -> n.key;
    v_payload := jsonb_build_object('fields', v_fields);
  end if;
  perform queue_notification(new.household_id, auth.uid(), v_kind, new.id, v_payload);
  return null;
end $$;

-- As migration 20261118000200 left it, plus: a personal bill is never posted or due "for both", and last month's
-- recap is for a month with shared entries in it. (A deleted template is also never "due tomorrow".)
create or replace function queue_daily_notifications(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare v_local timestamp := p_now at time zone 'Europe/London'; d date := (p_now at time zone 'Europe/London')::date;
        n int := 0; c int;
begin
  if extract(hour from v_local) <> 8 then return 0; end if;
  insert into notification_daily_runs(day) values (d) on conflict do nothing;
  if not found then return 0; end if;
  delete from notification_daily_runs where day < d - 400;

  -- A shared regular payment posted today: both.
  insert into notification_outbox(household_id, recipient, kind, ref_id, payload)
  select e.household_id, m.user_id, 'bill_posted', e.id, jsonb_build_object('recurring_id', e.recurring_id)
    from expenses e join members m on m.household_id = e.household_id
   where e.recurring_id is not null and e.source = 'recurring' and e.occurrence_date = d and e.deleted_at is null and e.owner_id is null
     and (select count(*) from members x where x.household_id = e.household_id) = 2
     and not exists (select 1 from notification_outbox a where a.kind = 'bill_posted' and a.ref_id = e.id);
  get diagnostics c = row_count; n := n + c;

  -- A shared bill posts tomorrow (its next occurrence): both (most have the switch off).
  insert into notification_outbox(household_id, recipient, kind, ref_id)
  select r.household_id, m.user_id, 'bill_tomorrow', r.id
    from recurring r join members m on m.household_id = r.household_id
   where r.active and r.deleted_at is null and r.owner_id is null and (r.end_date is null or r.end_date >= d + 1)
     and exists (select 1 from generate_series(r.posted_count, r.posted_count + 3) k
                  where (r.start_date + recurring_step(r.frequency, r.every) * k)::date = d + 1)
     and (select count(*) from members x where x.household_id = r.household_id) = 2;
  get diagnostics c = row_count; n := n + c;

  -- The 1st: last month's recap, where last month has something in it.
  if extract(day from d) = 1 then
    insert into notification_outbox(household_id, recipient, kind, payload)
    select h.id, m.user_id, 'recap_ready', jsonb_build_object('month', to_char(d - 1, 'YYYY-MM'))
      from households h join members m on m.household_id = h.id
     where (select count(*) from members x where x.household_id = h.id) = 2
       and exists (select 1 from expenses e where e.household_id = h.id and e.deleted_at is null and e.owner_id is null
                     and e.date between date_trunc('month', d - 1)::date and d - 1);
    get diagnostics c = row_count; n := n + c;
  end if;

  -- Settle day, unless the two are square.
  insert into notification_outbox(household_id, recipient, kind)
  select h.id, m.user_id, 'settle_day'
    from households h join members m on m.household_id = h.id
   where h.settle_day = extract(day from d)
     and (select count(*) from members x where x.household_id = h.id) = 2
     and exists (select 1 from member_net b where b.household_id = h.id and b.net_pence <> 0);
  get diagnostics c = row_count; n := n + c;

  -- The balance above a person's chosen amount (the same way round) on each of the last 30 days: that person, at
  -- most once every 30 days.
  with due as (
    select m.household_id, m.user_id, p.balance_threshold_pence as threshold
      from members m join notification_prefs p on p.user_id = m.user_id and p.balance
     where (select count(*) from members x where x.household_id = m.household_id) = 2
       and not exists (select 1 from notification_reminders r where r.user_id = m.user_id and r.last_sent > d - 30)
       and (select bool_and(q.net > p.balance_threshold_pence) or bool_and(q.net < -p.balance_threshold_pence)
              from (select member_net_on(m.household_id, m.user_id, x::date) as net
                      from generate_series(d - 29, d, interval '1 day') x) q)
  ), queued as (
    insert into notification_outbox(household_id, recipient, kind, payload)
    select household_id, user_id, 'balance_reminder', jsonb_build_object('threshold', threshold) from due
    returning recipient
  )
  insert into notification_reminders(user_id, last_sent) select recipient, d from queued
  on conflict (user_id) do update set last_sent = excluded.last_sent;
  get diagnostics c = row_count; n := n + c;

  if n > 0 then perform kick_push(); end if;
  return n;
end $$;
revoke all on function queue_daily_notifications(timestamptz) from public, anon, authenticated, service_role;

-- As migration 20261123000000 left it, plus: money back is never for a personal entry.
create or replace function check_refund_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_orig expenses; v_back bigint; v_left bigint;
begin
  if coalesce(current_setting('smsm.restoring', true), '') = 'on' then return new; end if;
  -- Restoring an original brings back the money back deleted with it, as it was (follow_original).
  if coalesce(current_setting('smsm.following', true), '') = 'on' then return new; end if;
  -- The phone writes by upsert (insert … on conflict do update). A row that is already there is an edit: the update
  -- that follows is checked as one, with what it was before (so an unrelated edit is never refused).
  if tg_op = 'INSERT' and exists (select 1 from expenses where id = new.id) then return new; end if;
  if new.kind = 'expense' then
    -- An original is never edited below the live money back linked to it.
    if tg_op = 'UPDATE' and old.kind = 'expense' and new.deleted_at is null and new.amount_pence < old.amount_pence then
      select coalesce(sum(amount_pence), 0) into v_back from expenses
       where refund_of = new.id and household_id = new.household_id and kind = 'money_back' and deleted_at is null;
      if v_back > new.amount_pence then
        raise exception 'money back on this is £%.%, more than the new amount', v_back / 100, lpad((v_back % 100)::text, 2, '0')
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  if new.kind <> 'money_back' or new.refund_of is null or new.deleted_at is not null then return new; end if;
  -- One refund at a time per original (two phones at once can't both squeeze in). Only the household's own expense.
  select * into v_orig from expenses where id = new.refund_of for update;
  if not found or v_orig.household_id <> new.household_id or v_orig.kind <> 'expense' or v_orig.owner_id is not null then
    raise exception 'money back can only be for an expense of yours' using errcode = '23514';
  end if;
  -- Only a change that raises what has come back is checked.
  if tg_op = 'UPDATE' and old.kind = 'money_back' and old.deleted_at is null and old.refund_of is not distinct from new.refund_of
     and new.amount_pence <= old.amount_pence then
    return new;
  end if;
  if v_orig.deleted_at is not null then
    raise exception 'the original was deleted, so this can''t be money back for it' using errcode = '23514';
  end if;
  select coalesce(sum(amount_pence), 0) into v_back from expenses
   where refund_of = new.refund_of and household_id = new.household_id and kind = 'money_back' and deleted_at is null and id <> new.id;
  v_left := greatest(v_orig.amount_pence - v_back, 0);
  if new.amount_pence > v_left then
    raise exception 'that''s more than the £%.% still to come back', v_left / 100, lpad((v_left % 100)::text, 2, '0')
      using errcode = '23514';
  end if;
  return new;
end $$;

-- As migration 20261117000700 left it, plus: comments are for shared entries (a personal one is its owner's own).
create or replace function check_comment_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from expenses e where e.id = new.expense_id and e.household_id = new.household_id and e.owner_id is null) then
    raise exception 'that entry is not one of yours' using errcode = '23503';
  end if;
  return new;
end $$;

-- As migration 20261118000100 left it, plus: a restored row keeps whose it was (people mapped).
create or replace function restore_backup(p_people jsonb, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hid uuid := my_household();
  r jsonb; old uuid; tgt uuid; n_rows int := 0;
  added jsonb := '{}'::jsonb; skipped jsonb := '{}'::jsonb;
  e expenses; s settlements; c categories; ch chapters; rc recurring; cm comments;
  member_ids uuid[]; mapped uuid[];
  t text;
  cur text := '';
begin
  if hid is null then raise exception 'not in a household' using errcode = '42501'; end if;
  select array_agg(user_id order by user_id) into member_ids from members where household_id = hid;
  if coalesce(array_length(member_ids, 1), 0) <> 2 then
    raise exception 'both of you need to have joined before restoring' using errcode = '22023';
  end if;
  if p_people is null or jsonb_typeof(p_people) <> 'object' then raise exception 'no people map' using errcode = '22023'; end if;
  select array_agg(distinct v::uuid order by v::uuid) into mapped from jsonb_each_text(p_people) t(k, v);
  if (select count(*) from jsonb_object_keys(p_people)) <> 2 or mapped is distinct from member_ids then
    raise exception 'map the backup''s two people to the two of you' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'object' then raise exception 'no rows' using errcode = '22023'; end if;
  foreach t in array array['categories','chapters','recurring','expenses','settlements','comments','category_memory','import_rules'] loop
    if p_rows ? t and jsonb_typeof(p_rows -> t) <> 'array' then raise exception '% must be a list', t using errcode = '22023'; end if;
    n_rows := n_rows + coalesce(jsonb_array_length(p_rows -> t), 0);
    added := added || jsonb_build_object(t, 0);
    skipped := skipped || jsonb_build_object(t, 0);
  end loop;
  if n_rows > 500 then raise exception 'at most 500 rows a call' using errcode = '22023'; end if;
  perform set_config('smsm.restoring', 'on', true);

  begin
  -- Categories: by id, then by name; otherwise added.
  cur := 'categories';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'categories', '[]')) loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'categories') is null then
      select id into tgt from categories where household_id = hid and lower(btrim(name)) = lower(btrim(r ->> 'name')) limit 1;
      if tgt is not null then
        insert into restore_ids values (hid, old, tgt) on conflict do nothing;
        skipped := jsonb_set(skipped, '{categories}', to_jsonb((skipped ->> 'categories')::int + 1));
        continue;
      end if;
      c := jsonb_populate_record(null::categories, r);
      c.id := restore_new_id(hid, old, 'categories');
      c.household_id := hid;
      c.default_ratio := restore_remap_keys(c.default_ratio, p_people);
      c.emoji := coalesce(c.emoji, '•'); c.colour := coalesce(c.colour, 'stone'); c.archived := coalesce(c.archived, false);
      c.sort := coalesce(c.sort, 0); c.updated_at := coalesce(c.updated_at, now());
      insert into categories select c.*;
      added := jsonb_set(added, '{categories}', to_jsonb((added ->> 'categories')::int + 1));
    else
      skipped := jsonb_set(skipped, '{categories}', to_jsonb((skipped ->> 'categories')::int + 1));
    end if;
  end loop;

  cur := 'chapters';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'chapters', '[]')) loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'chapters') is not null then
      skipped := jsonb_set(skipped, '{chapters}', to_jsonb((skipped ->> 'chapters')::int + 1)); continue;
    end if;
    ch := jsonb_populate_record(null::chapters, r);
    ch.id := restore_new_id(hid, old, 'chapters');
    ch.household_id := hid;
    ch.emoji := coalesce(ch.emoji, '🌿'); ch.kind := coalesce(ch.kind, 'project'); ch.closed := coalesce(ch.closed, false);
    ch.created_at := coalesce(ch.created_at, now()); ch.updated_at := coalesce(ch.updated_at, now());
    ch.created_by := restore_person(ch.created_by, p_people, member_ids);
    insert into chapters select ch.*;
    added := jsonb_set(added, '{chapters}', to_jsonb((added ->> 'chapters')::int + 1));
  end loop;

  cur := 'recurring';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'recurring', '[]')) loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'recurring') is not null then
      skipped := jsonb_set(skipped, '{recurring}', to_jsonb((skipped ->> 'recurring')::int + 1)); continue;
    end if;
    rc := jsonb_populate_record(null::recurring, r);
    rc.id := restore_new_id(hid, old, 'recurring');
    rc.household_id := hid;
    rc.active := false;  -- paused: nothing posts on its own after a restore
    rc.category_id := restore_ref(hid, rc.category_id, 'categories');
    rc.paid := restore_remap_keys(rc.paid, p_people);
    rc.shares := restore_remap_keys(rc.shares, p_people);
    rc.split_params := restore_remap_keys(rc.split_params, p_people);
    rc.amount_varies := coalesce(rc.amount_varies, false); rc.paid_via := coalesce(rc.paid_via, 'person');
    rc.split_mode := coalesce(rc.split_mode, 'ratio'); rc.is_subscription := coalesce(rc.is_subscription, false);
    rc.every := coalesce(rc.every, 1); rc.posted_count := coalesce(rc.posted_count, 0);
    rc.created_at := coalesce(rc.created_at, now()); rc.updated_at := coalesce(rc.updated_at, now());
    rc.created_by := restore_person(rc.created_by, p_people, member_ids);
    -- S10: whose it is, the person mapped (a person not mapped: refused by check_personal).
    if rc.owner_id is not null then rc.owner_id := coalesce(restore_person(rc.owner_id, p_people, member_ids), rc.owner_id); end if;
    insert into recurring select rc.*;
    added := jsonb_set(added, '{recurring}', to_jsonb((added ->> 'recurring')::int + 1));
  end loop;

  -- Entries before money back, so a refund finds the entry it refunds within the same call.
  cur := 'expenses';
  for r in select x from jsonb_array_elements(coalesce(p_rows -> 'expenses', '[]')) x
           order by (x ->> 'kind') = 'money_back', x ->> 'created_at' loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'expenses') is not null then
      skipped := jsonb_set(skipped, '{expenses}', to_jsonb((skipped ->> 'expenses')::int + 1)); continue;
    end if;
    e := jsonb_populate_record(null::expenses, r);
    e.id := restore_new_id(hid, old, 'expenses');
    e.household_id := hid;
    e.category_id := restore_ref(hid, e.category_id, 'categories');
    e.chapter_id := restore_ref(hid, e.chapter_id, 'chapters');
    e.recurring_id := restore_ref(hid, e.recurring_id, 'recurring');
    e.refund_of := restore_ref(hid, e.refund_of, 'expenses');
    e.account_id := null;
    -- Photos aren't in a backup: a path from another household points at nothing here.
    if e.receipt_path is not null and split_part(e.receipt_path, '/', 1) <> hid::text then e.receipt_path := null; end if;
    e.paid := restore_remap_keys(e.paid, p_people);
    e.shares := restore_remap_keys(e.shares, p_people);
    e.split_params := restore_remap_keys(e.split_params, p_people);
    if e.recurring_id is null then e.occurrence_date := null; end if;
    e.kind := coalesce(e.kind, 'expense'); e.paid_via := coalesce(e.paid_via, 'person'); e.split_mode := coalesce(e.split_mode, 'ratio');
    e.country := coalesce(e.country, 'GB'); e.tags := coalesce(e.tags, '{}'); e.source := coalesce(e.source, 'manual');
    e.category_guess := coalesce(e.category_guess, false); e.created_at := coalesce(e.created_at, now()); e.updated_at := coalesce(e.updated_at, now());
    e.created_by := restore_person(e.created_by, p_people, member_ids);
    e.updated_by := restore_person(e.updated_by, p_people, member_ids);
    if e.owner_id is not null then e.owner_id := coalesce(restore_person(e.owner_id, p_people, member_ids), e.owner_id); end if;
    insert into expenses select e.* on conflict do nothing;
    if found then
      added := jsonb_set(added, '{expenses}', to_jsonb((added ->> 'expenses')::int + 1));
    else
      skipped := jsonb_set(skipped, '{expenses}', to_jsonb((skipped ->> 'expenses')::int + 1));
    end if;
  end loop;

  cur := 'settlements';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'settlements', '[]')) loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'settlements') is not null then
      skipped := jsonb_set(skipped, '{settlements}', to_jsonb((skipped ->> 'settlements')::int + 1)); continue;
    end if;
    s := jsonb_populate_record(null::settlements, r);
    s.id := restore_new_id(hid, old, 'settlements');
    s.household_id := hid;
    s.from_user := coalesce((p_people ->> s.from_user::text)::uuid, s.from_user);
    s.to_user := coalesce((p_people ->> s.to_user::text)::uuid, s.to_user);
    if not (s.from_user = any (member_ids) and s.to_user = any (member_ids)) then
      raise exception 'a settle-up names someone who isn''t one of you' using errcode = '22023';
    end if;
    s.method := coalesce(s.method, 'other'); s.created_at := coalesce(s.created_at, now()); s.updated_at := coalesce(s.updated_at, now());
    s.created_by := restore_person(s.created_by, p_people, member_ids);
    insert into settlements select s.*;
    added := jsonb_set(added, '{settlements}', to_jsonb((added ->> 'settlements')::int + 1));
  end loop;

  cur := 'comments';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'comments', '[]')) loop
    old := (r ->> 'id')::uuid;
    cm := jsonb_populate_record(null::comments, r);
    cm.expense_id := restore_ref(hid, cm.expense_id, 'expenses');
    if restore_target(hid, old, 'comments') is not null or cm.expense_id is null then
      skipped := jsonb_set(skipped, '{comments}', to_jsonb((skipped ->> 'comments')::int + 1)); continue;
    end if;
    cm.id := restore_new_id(hid, old, 'comments');
    cm.household_id := hid;
    cm.author := coalesce((p_people ->> cm.author::text)::uuid, cm.author);
    if not cm.author = any (member_ids) then
      raise exception 'a comment names someone who isn''t one of you' using errcode = '22023';
    end if;
    cm.created_at := coalesce(cm.created_at, now());
    insert into comments select cm.*;
    added := jsonb_set(added, '{comments}', to_jsonb((added ->> 'comments')::int + 1));
  end loop;

  cur := 'category_memory';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'category_memory', '[]')) loop
    perform restore_check_split(r ->> 'split_mode', restore_remap_keys(r -> 'split_params', p_people), member_ids);
    insert into category_memory(household_id, key, category_id, split_mode, split_params, uses, source, updated_at)
    values (hid, r ->> 'key', restore_ref(hid, (r ->> 'category_id')::uuid, 'categories'), r ->> 'split_mode',
            restore_remap_keys(r -> 'split_params', p_people), coalesce((r ->> 'uses')::int, 1),
            coalesce(r ->> 'source', 'user'), coalesce((r ->> 'updated_at')::timestamptz, now()))
    on conflict do nothing;
    if found then added := jsonb_set(added, '{category_memory}', to_jsonb((added ->> 'category_memory')::int + 1));
    else skipped := jsonb_set(skipped, '{category_memory}', to_jsonb((skipped ->> 'category_memory')::int + 1)); end if;
  end loop;

  cur := 'import_rules';
  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'import_rules', '[]')) loop
    -- A skip rule is one person's, kept on their phone: never restored into the shared record.
    if coalesce(r ->> 'decision', '') <> 'keep' then
      skipped := jsonb_set(skipped, '{import_rules}', to_jsonb((skipped ->> 'import_rules')::int + 1)); continue;
    end if;
    perform restore_check_split(r ->> 'split_mode', restore_remap_keys(r -> 'split_params', p_people), member_ids);
    insert into import_rules(household_id, match_text, decision, category_id, split_mode, split_params)
    values (hid, r ->> 'match_text', r ->> 'decision', restore_ref(hid, (r ->> 'category_id')::uuid, 'categories'),
            r ->> 'split_mode', restore_remap_keys(r -> 'split_params', p_people))
    on conflict do nothing;
    if found then added := jsonb_set(added, '{import_rules}', to_jsonb((added ->> 'import_rules')::int + 1));
    else skipped := jsonb_set(skipped, '{import_rules}', to_jsonb((skipped ->> 'import_rules')::int + 1)); end if;
  end loop;
  exception when others then
    -- Which part of the backup was refused, for the app to say in plain words; the whole call is undone.
    raise exception 'restore %: %', cur, sqlerrm using errcode = sqlstate;
  end;

  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;
