-- smsm migration 6 (S3): regular payments post on the UK date, once; the partner hears about bills and Inbox
-- decisions; templates, Inbox items and categories are never hard-deleted; categories take palette colours
-- only and every change to one is logged. Additive: no existing row is rewritten.

-- ───────── post_due_recurring: the UK date (DAT-2), once per occurrence (REC-2), always home (REC-4) ─────────
-- "Today" is London's date whatever the session's time zone (a phone abroad still posts on the UK date). The
-- template rows are locked (`for update`), so a second caller (the other phone, or the nightly job) waits for
-- the first to commit, then reads the moved-on posted_count and posts nothing more; the unique indexes on
-- (recurring_id, occurrence_date) are the second guard. Amount varies → an open Inbox item, never an expense.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid; home char(2);
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
  select home_country into home from households where id = hid;
  for r in select * from recurring where household_id = hid and active order by id for update loop
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
        insert into expenses(household_id, description, amount_pence, date, category_id, chapter_id, paid, paid_via,
                             split_mode, split_params, shares, notes, country, source, recurring_id, occurrence_date)
        values (r.household_id, r.description, r.amount_pence, d, r.category_id, null, r.paid, r.paid_via,
                r.split_mode, r.split_params, r.shares, r.notes, coalesce(home, 'GB'), 'recurring', r.id, d)
        on conflict do nothing;
      end if;
      r.posted_count := r.posted_count + 1;
      posted := posted + 1;
    end loop;
    update recurring set posted_count = r.posted_count where id = r.id and posted_count is distinct from r.posted_count;
  end loop;
  return posted;
end $$;
revoke execute on function post_due_recurring(uuid) from public, anon;
grant execute on function post_due_recurring(uuid) to authenticated;

-- ───────── nothing here is hard-deleted ─────────
-- Templates are paused (active = false) or ended (end_date); categories are archived; Inbox items are kept or
-- dismissed. Row-level security still decides which rows; without the privilege no row can be deleted at all.
revoke delete on recurring, categories, inbox_items from authenticated;

-- ───────── categories: palette colours only (DESIGN §3.1) ─────────
-- Added NOT VALID, so it can never fail on a row already stored; then validated, which succeeds whenever every
-- stored colour is a palette name (as the twelve starting categories are). If one isn't, it stays unvalidated:
-- new and changed rows are still checked.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'categories_colour_palette') then
    alter table categories add constraint categories_colour_palette check (colour in
      ('moss','amber','walnut','honey','slate','plum','oak','berry','lake','clay','fern','stone')) not valid;
  end if;
  begin
    alter table categories validate constraint categories_colour_palette;
  exception when check_violation then
    raise notice 'categories_colour_palette left unvalidated: a stored colour is not a palette name';
  end;
end $$;

-- ───────── every change is logged (non-negotiable 4) ─────────
-- log_activity learns two more tables: categories ('category') and Inbox items ('inbox_item'). Edits record
-- { field: { before, after } } as for expenses.
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; diff jsonb := '{}'; k text; ent text; o jsonb; n jsonb := to_jsonb(new);
begin
  ent := case tg_table_name when 'expenses' then 'expense' when 'settlements' then 'settlement'
                            when 'categories' then 'category' when 'inbox_items' then 'inbox_item' else 'recurring' end;
  if tg_op = 'INSERT' then
    act := 'created';
    diff := jsonb_build_object('after', n - 'split_params' - 'items');
  else
    o := to_jsonb(old);
    if (o ? 'deleted_at') and (o ->> 'deleted_at') is null and (n ->> 'deleted_at') is not null then
      act := 'deleted';
    elsif (o ? 'deleted_at') and (o ->> 'deleted_at') is not null and (n ->> 'deleted_at') is null then
      act := 'restored';
    else
      act := 'edited';
      for k in select jsonb_object_keys(n) loop
        if k not in ('updated_at','updated_by','posted_count') and (n -> k) is distinct from (o -> k) then
          diff := diff || jsonb_build_object(k, jsonb_build_object('before', o -> k, 'after', n -> k));
        end if;
      end loop;
      if diff = '{}' then return new; end if;
    end if;
    if act <> 'edited' then
      diff := jsonb_build_object('description', n -> 'description', 'amount_pence', n -> 'amount_pence');
    end if;
  end if;
  insert into activity(household_id, actor, entity, entity_id, action, summary)
  values (new.household_id, auth.uid(), ent, new.id, act, diff);
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['categories','inbox_items'] loop
    execute format('drop trigger if exists %1$s_log on %1$s', t);
    execute format('create trigger %1$s_log after insert or update on %1$s for each row execute function log_activity()', t);
  end loop;
end $$;

-- ───────── the partner's phone hears about templates and Inbox decisions (Realtime) ─────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['recurring','inbox_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
