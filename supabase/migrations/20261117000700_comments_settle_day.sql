-- smsm migration 10 (S5b: ACT-4 comments, SET-4 settle day).
-- Comments: threads on entries, written and soft-deleted by their author only (the baseline's policies), never
-- hard-deleted, every change logged, heard at once by the partner's phone.
-- Settle day: the household's day of the month (1–28) when the month's recap comes with a Settle up; either
-- person sets it through an RPC, and the change is logged.

-- ───────── comments ─────────
revoke delete on comments from authenticated;

create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; diff jsonb := '{}'; k text; ent text; o jsonb; n jsonb := to_jsonb(new);
begin
  ent := case tg_table_name when 'expenses' then 'expense' when 'settlements' then 'settlement'
                            when 'categories' then 'category' when 'inbox_items' then 'inbox_item'
                            when 'chapters' then 'chapter' when 'comments' then 'comment' else 'recurring' end;
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
drop trigger if exists comments_log on comments;
create trigger comments_log after insert or update on comments for each row execute function log_activity();

-- The author can't be changed, and a comment can't move to another entry or household.
create or replace function comments_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.author is distinct from old.author or new.expense_id is distinct from old.expense_id or new.household_id is distinct from old.household_id then
    raise exception 'a comment stays with its author and its entry' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function comments_guard() from public, anon, authenticated;
drop trigger if exists comments_guard on comments;
create trigger comments_guard before update on comments for each row execute function comments_guard();

-- A comment's entry is one of its own household's (foreign keys ignore RLS).
create or replace function check_comment_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from expenses e where e.id = new.expense_id and e.household_id = new.household_id) then
    raise exception 'that entry is not one of yours' using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function check_comment_entry() from public, anon, authenticated;
drop trigger if exists comments_entry on comments;
create trigger comments_entry before insert on comments for each row execute function check_comment_entry();

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

-- ───────── settle day ─────────
alter table households add column if not exists settle_day smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'households_settle_day_check') then
    alter table households add constraint households_settle_day_check check (settle_day is null or settle_day between 1 and 28);
  end if;
end $$;

create or replace function set_settle_day(p_day int) returns void
language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household(); was smallint;
begin
  if hid is null then raise exception 'not in a household'; end if;
  if p_day is not null and (p_day < 1 or p_day > 28) then raise exception 'pick a day from 1 to 28'; end if;
  select settle_day into was from households where id = hid;
  if was is not distinct from p_day then return; end if;
  update households set settle_day = p_day where id = hid;
  insert into activity(household_id, actor, entity, entity_id, action, summary)
  values (hid, auth.uid(), 'household', hid, 'edited', jsonb_build_object('settle_day', jsonb_build_object('before', was, 'after', p_day)));
end $$;
revoke execute on function set_settle_day(int) from public, anon;
grant execute on function set_settle_day(int) to authenticated;
