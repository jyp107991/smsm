-- smsm migration 9 (S4a, chapters: CHP-1…CHP-4). The chapters table is in the baseline; this makes it behave
-- like the other shared tables: closed, never deleted; every change logged; the partner's phone hears at once;
-- and an entry can only be in its own household's chapter.

-- ───────── nothing here is hard-deleted (non-negotiable 4) ─────────
revoke delete on chapters from authenticated;

-- ───────── every change is logged: log_activity learns chapters ('chapter') ─────────
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; diff jsonb := '{}'; k text; ent text; o jsonb; n jsonb := to_jsonb(new);
begin
  ent := case tg_table_name when 'expenses' then 'expense' when 'settlements' then 'settlement'
                            when 'categories' then 'category' when 'inbox_items' then 'inbox_item'
                            when 'chapters' then 'chapter' else 'recurring' end;
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
drop trigger if exists chapters_log on chapters;
create trigger chapters_log after insert or update on chapters for each row execute function log_activity();

-- ───────── an entry's chapter is one of its own household's (RLS hides other rows; this refuses the id) ─────────
create or replace function check_entry_chapter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.chapter_id is not null
     and not exists (select 1 from chapters c where c.id = new.chapter_id and c.household_id = new.household_id) then
    raise exception 'that chapter is not one of yours' using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function check_entry_chapter() from public, anon, authenticated;
drop trigger if exists expenses_chapter on expenses;
create trigger expenses_chapter before insert or update of chapter_id, household_id on expenses
  for each row execute function check_entry_chapter();

-- ───────── the partner's phone hears about chapters (Realtime) ─────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chapters') then
    alter publication supabase_realtime add table public.chapters;
  end if;
end $$;
