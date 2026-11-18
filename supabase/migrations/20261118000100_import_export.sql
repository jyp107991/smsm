-- S7 (EXP-1, EXP-3): restoring a JSON backup, and the storage used against the free plan.
--
-- restore_backup only ever ADDS rows. A row whose id is already in this household is left alone; nothing is
-- updated or deleted. A backup's people are mapped to this household's two members by the caller (p_people:
-- backup user id → member user id). An id that already belongs to another household gets a fresh id, and the
-- mapping is kept in restore_ids so references sent in later calls (a backup goes in chunks) follow it.
-- Categories with the same name as one already here are matched to it rather than added twice.
-- Regular payments come back paused, so nothing posts on its own. Every row still passes the database's own
-- checks (paid and shares sum to the amount; members only) and is logged by the usual triggers.

create table if not exists restore_ids (
  household_id uuid not null references households(id) on delete cascade,
  old_id uuid not null,
  new_id uuid not null,
  primary key (household_id, old_id)
);
alter table restore_ids enable row level security;
-- No policies: only restore_backup (security definer) reads or writes it.
revoke all on table restore_ids from anon, authenticated;

-- Renames the top-level keys of a {user id: value} object by the people map; keys not in the map are kept
-- (the money checks then refuse a row that names anyone who isn't a member).
create or replace function restore_remap_keys(j jsonb, p_people jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when j is null or jsonb_typeof(j) <> 'object' then j
    else coalesce((select jsonb_object_agg(coalesce(p_people ->> k, k), v) from jsonb_each(j) t(k, v)), '{}'::jsonb) end
$$;

create or replace function restore_backup(p_people jsonb, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hid uuid := my_household();
  r jsonb; old uuid; tgt uuid; n_rows int := 0;
  added jsonb := '{}'::jsonb; skipped jsonb := '{}'::jsonb;
  e expenses; s settlements; c categories; ch chapters; rc recurring; cm comments;
  member_ids uuid[]; mapped uuid[];
  t text;
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

  -- Categories: by id, then by name; otherwise added.
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
      insert into categories select c.*;
      added := jsonb_set(added, '{categories}', to_jsonb((added ->> 'categories')::int + 1));
    else
      skipped := jsonb_set(skipped, '{categories}', to_jsonb((skipped ->> 'categories')::int + 1));
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'chapters', '[]')) loop
    old := (r ->> 'id')::uuid;
    if restore_target(hid, old, 'chapters') is not null then
      skipped := jsonb_set(skipped, '{chapters}', to_jsonb((skipped ->> 'chapters')::int + 1)); continue;
    end if;
    ch := jsonb_populate_record(null::chapters, r);
    ch.id := restore_new_id(hid, old, 'chapters');
    ch.household_id := hid;
    insert into chapters select ch.*;
    added := jsonb_set(added, '{chapters}', to_jsonb((added ->> 'chapters')::int + 1));
  end loop;

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
    insert into recurring select rc.*;
    added := jsonb_set(added, '{recurring}', to_jsonb((added ->> 'recurring')::int + 1));
  end loop;

  -- Entries before money back, so a refund finds the entry it refunds within the same call.
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
    insert into expenses select e.* on conflict do nothing;
    if found then
      added := jsonb_set(added, '{expenses}', to_jsonb((added ->> 'expenses')::int + 1));
    else
      skipped := jsonb_set(skipped, '{expenses}', to_jsonb((skipped ->> 'expenses')::int + 1));
    end if;
  end loop;

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
    insert into settlements select s.*;
    added := jsonb_set(added, '{settlements}', to_jsonb((added ->> 'settlements')::int + 1));
  end loop;

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
    insert into comments select cm.*;
    added := jsonb_set(added, '{comments}', to_jsonb((added ->> 'comments')::int + 1));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'category_memory', '[]')) loop
    insert into category_memory(household_id, key, category_id, split_mode, split_params, uses, source, updated_at)
    values (hid, r ->> 'key', restore_ref(hid, (r ->> 'category_id')::uuid, 'categories'), r ->> 'split_mode',
            restore_remap_keys(r -> 'split_params', p_people), coalesce((r ->> 'uses')::int, 1),
            coalesce(r ->> 'source', 'user'), coalesce((r ->> 'updated_at')::timestamptz, now()))
    on conflict do nothing;
    if found then added := jsonb_set(added, '{category_memory}', to_jsonb((added ->> 'category_memory')::int + 1));
    else skipped := jsonb_set(skipped, '{category_memory}', to_jsonb((skipped ->> 'category_memory')::int + 1)); end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_rows -> 'import_rules', '[]')) loop
    insert into import_rules(household_id, match_text, decision, category_id, split_mode, split_params)
    values (hid, r ->> 'match_text', r ->> 'decision', restore_ref(hid, (r ->> 'category_id')::uuid, 'categories'),
            r ->> 'split_mode', restore_remap_keys(r -> 'split_params', p_people))
    on conflict do nothing;
    if found then added := jsonb_set(added, '{import_rules}', to_jsonb((added ->> 'import_rules')::int + 1));
    else skipped := jsonb_set(skipped, '{import_rules}', to_jsonb((skipped ->> 'import_rules')::int + 1)); end if;
  end loop;

  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- The id a backup row already has in this household (itself, or the id it was given before), else null.
create or replace function restore_target(p_hid uuid, p_old uuid, p_table text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare found_id uuid;
begin
  if p_old is null then return null; end if;
  execute format('select id from %I where id = $1 and household_id = $2', p_table) into found_id using p_old, p_hid;
  if found_id is not null then return found_id; end if;
  select m.new_id into found_id from restore_ids m where m.household_id = p_hid and m.old_id = p_old;
  if found_id is not null then
    execute format('select id from %I where id = $1 and household_id = $2', p_table) into found_id using found_id, p_hid;
  end if;
  return found_id;
end $$;

-- The id a new row from a backup gets: its own, unless another household already has it.
create or replace function restore_new_id(p_hid uuid, p_old uuid, p_table text) returns uuid
language plpgsql security definer set search_path = public as $$
declare taken boolean; fresh uuid;
begin
  if p_old is null then return gen_random_uuid(); end if;
  execute format('select exists (select 1 from %I where id = $1)', p_table) into taken using p_old;
  if not taken then return p_old; end if;
  fresh := gen_random_uuid();
  insert into restore_ids values (p_hid, p_old, fresh)
  on conflict (household_id, old_id) do update set new_id = excluded.new_id;
  return fresh;
end $$;

-- A reference inside a backup row, followed to this household's row; null when it isn't here.
create or replace function restore_ref(p_hid uuid, p_old uuid, p_table text) returns uuid
language sql stable security definer set search_path = public as $$
  select restore_target(p_hid, p_old, p_table)
$$;

revoke all on function restore_backup(jsonb, jsonb) from public, anon;
grant execute on function restore_backup(jsonb, jsonb) to authenticated;
revoke all on function restore_target(uuid, uuid, text) from public, anon, authenticated;
revoke all on function restore_new_id(uuid, uuid, text) from public, anon, authenticated;
revoke all on function restore_ref(uuid, uuid, text) from public, anon, authenticated;
revoke all on function restore_remap_keys(jsonb, jsonb) from public, anon, authenticated;

-- EXP-3: the database's size and this household's receipt photos, against the free plan's limits.
create or replace function storage_used() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hid uuid := my_household(); photos bigint := 0;
begin
  if hid is null then raise exception 'not in a household' using errcode = '42501'; end if;
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects
               where bucket_id = 'receipts' and name like $1$q$ into photos using hid::text || '/%';
  end if;
  return jsonb_build_object('database_bytes', pg_database_size(current_database()), 'photo_bytes', photos);
end $$;
revoke all on function storage_used() from public, anon;
grant execute on function storage_used() to authenticated;
