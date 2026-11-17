-- smsm migration 11 (S6a: smart features — the reading).
-- The `ai` Edge Function counts each call per household per UK day through increment_ai_usage (it checks the cap
-- itself); receipt photos live in a private bucket, one folder per household, never changed or deleted; an
-- entry's category set by an AI guess is marked, and the mark goes as soon as a person changes the category.

-- ───────── AI usage ─────────
create or replace function increment_ai_usage(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household(); n int;
begin
  if hid is null then raise exception 'not in a household'; end if;
  if p_kind not in ('scan', 'parse', 'categorise', 'recap', 'ask') then raise exception 'unknown kind'; end if;
  insert into ai_usage(household_id, day, kind, calls)
  values (hid, (now() at time zone 'Europe/London')::date, p_kind, 1)
  on conflict (household_id, day, kind) do update set calls = ai_usage.calls + 1
  returning calls into n;
  return n;
end $$;
revoke execute on function increment_ai_usage(text) from public, anon;
grant execute on function increment_ai_usage(text) to authenticated;

-- ───────── category guesses ─────────
alter table expenses add column if not exists category_guess boolean not null default false;

create or replace function clear_category_guess() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A guess is written together with its mark; any other change of category is a person's, and ends the guess.
  if new.category_id is distinct from old.category_id and new.category_guess is not distinct from old.category_guess then
    new.category_guess := false;
  end if;
  return new;
end $$;
revoke execute on function clear_category_guess() from public, anon, authenticated;
drop trigger if exists expenses_category_guess on expenses;
create trigger expenses_category_guess before update on expenses for each row execute function clear_category_guess();

-- ───────── receipt photos ─────────
-- Supabase Storage only (the plain Postgres used by the SQL tests has no storage schema).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    -- Shrunk JPEGs only (1280 px, well under 2 MB): anything else is refused by Storage itself.
    execute $b$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('receipts', 'receipts', false, 2097152, '{image/jpeg}')
      on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = '{image/jpeg}'$b$;
    execute 'drop policy if exists receipts_insert on storage.objects';
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = my_household()::text)$p$;
    execute 'drop policy if exists receipts_select on storage.objects';
    execute $p$create policy receipts_select on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and (storage.foldername(name))[1] = my_household()::text)$p$;
    -- No update or delete policy: a receipt, once kept, stays (non-negotiable 4).
  end if;
end $$;
