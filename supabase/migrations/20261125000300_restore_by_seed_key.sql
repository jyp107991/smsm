-- REC-7 review (25 Nov): a backup's starting category maps onto this household's one with the same starting key before
-- matching by name. Since the category alone decides what a subscription is, a backup whose Subscriptions category was
-- renamed ("Streaming") would otherwise come back as a new, unkeyed category and its payments would silently leave
-- Subscriptions. Only restore_backup changes; it is otherwise as in 20261125000000.
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
      -- A starting category (by its key) is this household's starting one, renamed or not (REC-7: the Subscriptions
      -- category alone makes a subscription, so a renamed one must land on it); then by name.
      tgt := null;
      if nullif(r ->> 'seed_key', '') is not null then
        select id into tgt from categories where household_id = hid and seed_key = r ->> 'seed_key' limit 1;
      end if;
      if tgt is null then
        select id into tgt from categories where household_id = hid and lower(btrim(name)) = lower(btrim(r ->> 'name')) limit 1;
      end if;
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

