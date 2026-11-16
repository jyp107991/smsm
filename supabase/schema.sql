-- smsm: shared spending for two people.
-- Draft of record for docs/DATA_MODEL.md. Run once in the Supabase SQL editor; safe to re-run.
-- Money is integer pence. Every expense stores its shares as {user_id: pence}; shares always sum to amount_pence.
-- Tested against PostgreSQL 16 with an auth stub (see tests/sql/). Receipt storage policies and push tables are
-- specified in docs/DATA_MODEL.md and added in milestone M5/M6.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────

create table if not exists households (
  id            uuid primary key default gen_random_uuid(),
  currency      text not null default 'GBP',
  join_code     text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  default_ratio jsonb,             -- {user_id: percent}; null = 50/50. Changed only via an approved change request.
  created_at    timestamptz not null default now()
);

-- Identity (name + animal) is chosen once, then locked. Changes go through change_requests (both must approve).
create table if not exists members (
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text check (display_name is null or length(trim(display_name)) between 1 and 24),
  animal        text check (animal in ('cat','dog')),
  locked_at     timestamptz,        -- set when name and animal are first saved
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, animal)
);
create unique index if not exists members_one_household on members(user_id);

create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  emoji         text not null default '•',
  colour        text not null default '#8a8a8a',
  default_ratio jsonb,              -- {user_id: percent}; null = household default
  archived      boolean not null default false,
  sort          int not null default 0,
  unique (household_id, name)
);

-- For Monzo later (provider = 'monzo', external_id = Monzo account id). Unused in v1 except by CSV import.
create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  owner_id      uuid references auth.users(id),   -- null = joint
  provider      text not null default 'manual' check (provider in ('manual','csv','monzo')),
  external_id   text,
  created_at    timestamptz not null default now(),
  unique (household_id, provider, external_id)
);

create table if not exists recurring (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  description     text not null,
  amount_pence    bigint not null check (amount_pence > 0),
  category_id     uuid references categories(id) on delete set null,
  paid_by         uuid not null references auth.users(id),
  split_mode      text not null default 'ratio' check (split_mode in ('ratio','exact','for_other','treat')),
  split_params    jsonb,
  shares          jsonb not null,
  is_subscription boolean not null default false,
  frequency       text not null check (frequency in ('weekly','monthly','yearly')),
  every           int not null default 1 check (every between 1 and 52),
  start_date      date not null,
  end_date        date,
  posted_count    int not null default 0,   -- occurrence k falls on start_date + k*step (no month-end drift)
  active          boolean not null default true,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create table if not exists expenses (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references households(id) on delete cascade,
  description        text not null check (length(trim(description)) > 0),
  amount_pence       bigint not null check (amount_pence > 0),   -- the shared amount, in GBP
  date               date not null default current_date,
  category_id        uuid references categories(id) on delete set null,
  paid_by            uuid not null references auth.users(id),
  split_mode         text not null default 'ratio' check (split_mode in ('ratio','exact','for_other','treat')),
  split_params       jsonb,           -- ratio {uid: percent} or exact {uid: pence}, kept for editing
  shares             jsonb not null,  -- {uid: pence owed}
  items              jsonb,           -- itemised bill: [{label, pence, shared: bool}]; only shared lines are in amount_pence
  bill_total_pence   bigint,          -- whole receipt total when itemised (reference only)
  original_amount    numeric,         -- foreign currency entry
  original_currency  text,
  fx_rate            numeric,         -- GBP per 1 unit of original_currency
  notes              text,
  tags               text[] not null default '{}',
  receipt_path       text,            -- Supabase Storage object path (private bucket 'receipts')
  source             text not null default 'manual' check (source in ('manual','recurring','csv','monzo')),
  external_id        text,
  merchant           text,
  external_category  text,
  account_id         uuid references accounts(id) on delete set null,
  recurring_id       uuid references recurring(id) on delete set null,
  occurrence_date    date,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz      -- soft delete (undo, sync and the activity log need the row)
);
create unique index if not exists expenses_external on expenses(household_id, source, external_id) where external_id is not null;
create unique index if not exists expenses_occurrence on expenses(recurring_id, occurrence_date) where recurring_id is not null;
create index if not exists expenses_household_date on expenses(household_id, date desc);
create index if not exists expenses_updated on expenses(household_id, updated_at);

create table if not exists settlements (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  from_user     uuid not null references auth.users(id),
  to_user       uuid not null references auth.users(id),
  amount_pence  bigint not null check (amount_pence > 0),
  date          date not null default current_date,
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (from_user <> to_user)
);

-- Transactions discarded in the import inbox. Only a hash of the bank's transaction id is kept, so a re-import
-- does not show them again. No amount, merchant or date is stored.
create table if not exists import_ignores (
  household_id  uuid not null references households(id) on delete cascade,
  source        text not null check (source in ('csv','monzo')),
  id_hash       text not null,
  primary key (household_id, source, id_hash)
);

-- Import rules saved from the inbox: "always keep TESCO as Groceries 50/50", "always skip PRET".
create table if not exists import_rules (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  match_text    text not null,       -- case-insensitive substring of the merchant / name column
  decision      text not null check (decision in ('keep','skip')),
  category_id   uuid references categories(id) on delete set null,
  split_mode    text check (split_mode in ('ratio','exact','for_other','treat')),
  split_params  jsonb,
  created_at    timestamptz not null default now(),
  unique (household_id, match_text)
);

-- Changes that need both people: identity (name, animal) and the household default ratio.
create table if not exists change_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  kind          text not null check (kind in ('identity','default_ratio')),
  payload       jsonb not null,      -- identity: {user_id, display_name, animal}; default_ratio: {ratio}
  status        text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create unique index if not exists change_requests_one_pending on change_requests(household_id, kind) where status = 'pending';

-- Append-only log of who changed what. Written by triggers; nobody can edit it.
create table if not exists activity (
  id            bigint generated always as identity primary key,
  household_id  uuid not null references households(id) on delete cascade,
  actor         uuid references auth.users(id),     -- null = system (recurring posting)
  entity        text not null,                      -- expense | settlement | recurring | change_request | member
  entity_id     uuid,
  action        text not null,                      -- created | edited | deleted | restored | approved | declined ...
  summary       jsonb not null default '{}',        -- before/after of the fields that changed
  at            timestamptz not null default now()
);
create index if not exists activity_household_at on activity(household_id, at desc);

-- ───────────────────────── helpers ─────────────────────────

create or replace function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

-- ───────────────────────── integrity ─────────────────────────

create or replace function check_shares() returns trigger language plpgsql as $$
declare total bigint; bad int; n int;
begin
  select coalesce(sum((v)::bigint), 0), count(*) into total, n from jsonb_each_text(new.shares) as t(k, v);
  if total <> new.amount_pence then
    raise exception 'shares (%) must sum to amount (%)', total, new.amount_pence;
  end if;
  if exists (select 1 from jsonb_each_text(new.shares) t(k, v) where v::bigint < 0) then
    raise exception 'shares must not be negative';
  end if;
  select count(*) into bad from jsonb_object_keys(new.shares) k
   where not exists (select 1 from members m where m.household_id = new.household_id and m.user_id::text = k);
  if bad > 0 then raise exception 'shares name a non-member'; end if;
  if not exists (select 1 from members m where m.household_id = new.household_id and m.user_id = new.paid_by) then
    raise exception 'payer is not a member';
  end if;
  if new.split_mode = 'for_other' and coalesce((new.shares ->> new.paid_by::text)::bigint, 0) <> 0 then
    raise exception 'paid-for-the-other: the payer owes nothing';
  end if;
  if new.split_mode = 'treat' and (new.shares ->> new.paid_by::text)::bigint is distinct from new.amount_pence then
    raise exception 'treat: the payer covers the whole amount';
  end if;
  return new;
end $$;

drop trigger if exists expenses_check_shares on expenses;
create trigger expenses_check_shares before insert or update on expenses for each row execute function check_shares();
drop trigger if exists recurring_check_shares on recurring;
create trigger recurring_check_shares before insert or update on recurring for each row execute function check_shares();

create or replace function stamp_update() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'expenses' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;
drop trigger if exists expenses_stamp on expenses;
create trigger expenses_stamp before update on expenses for each row execute function stamp_update();
drop trigger if exists settlements_stamp on settlements;
create trigger settlements_stamp before update on settlements for each row execute function stamp_update();

-- Activity log for expenses, settlements and recurring.
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; diff jsonb := '{}'; k text; ent text;
begin
  ent := case tg_table_name when 'expenses' then 'expense' when 'settlements' then 'settlement' else 'recurring' end;
  if tg_op = 'INSERT' then
    act := 'created';
    diff := jsonb_build_object('after', to_jsonb(new) - 'shares' - 'split_params' - 'items');
  else
    if (to_jsonb(old) ? 'deleted_at') and (to_jsonb(old) ->> 'deleted_at') is null and (to_jsonb(new) ->> 'deleted_at') is not null then
      act := 'deleted';
    elsif (to_jsonb(old) ? 'deleted_at') and (to_jsonb(old) ->> 'deleted_at') is not null and (to_jsonb(new) ->> 'deleted_at') is null then
      act := 'restored';
    else
      act := 'edited';
      for k in select jsonb_object_keys(to_jsonb(new)) loop
        if k not in ('updated_at','updated_by','posted_count') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
          diff := diff || jsonb_build_object(k, jsonb_build_object('before', to_jsonb(old) -> k, 'after', to_jsonb(new) -> k));
        end if;
      end loop;
      if diff = '{}' then return new; end if;   -- nothing a person would call a change
    end if;
    if act <> 'edited' then diff := jsonb_build_object('description', to_jsonb(new) -> 'description', 'amount_pence', to_jsonb(new) -> 'amount_pence'); end if;
  end if;
  insert into activity(household_id, actor, entity, entity_id, action, summary)
  values (new.household_id, auth.uid(), ent, new.id, act, diff);
  return new;
end $$;

drop trigger if exists expenses_log on expenses;
create trigger expenses_log after insert or update on expenses for each row execute function log_activity();
drop trigger if exists settlements_log on settlements;
create trigger settlements_log after insert or update on settlements for each row execute function log_activity();
drop trigger if exists recurring_log on recurring;
create trigger recurring_log after insert or update on recurring for each row execute function log_activity();

-- Members can't be edited directly once locked: identity changes go through change_requests.
create or replace function guard_member_identity() returns trigger language plpgsql as $$
begin
  if current_setting('smsm.applying_change', true) = 'on' then return new; end if;
  if old.locked_at is not null and (new.display_name is distinct from old.display_name or new.animal is distinct from old.animal
                                    or new.locked_at is distinct from old.locked_at) then
    raise exception 'name and animal are locked; request a change in Settings';
  end if;
  if new.user_id <> old.user_id or new.household_id <> old.household_id then raise exception 'not allowed'; end if;
  return new;
end $$;
drop trigger if exists members_guard on members;
create trigger members_guard before update on members for each row execute function guard_member_identity();

create or replace function guard_household() returns trigger language plpgsql as $$
begin
  if current_setting('smsm.applying_change', true) = 'on' then return new; end if;
  if new.default_ratio is distinct from old.default_ratio then
    raise exception 'the default split changes only when both of you approve';
  end if;
  if new.join_code is distinct from old.join_code then raise exception 'not allowed'; end if;
  return new;
end $$;
drop trigger if exists households_guard on households;
create trigger households_guard before update on households for each row execute function guard_household();

-- ───────────────────────── access control ─────────────────────────

alter table households      enable row level security;
alter table members         enable row level security;
alter table categories      enable row level security;
alter table accounts        enable row level security;
alter table recurring       enable row level security;
alter table expenses        enable row level security;
alter table settlements     enable row level security;
alter table import_ignores  enable row level security;
alter table import_rules    enable row level security;
alter table change_requests enable row level security;
alter table activity        enable row level security;

drop policy if exists hh_read on households;
create policy hh_read on households for select using (id = my_household());
drop policy if exists hh_update on households;
create policy hh_update on households for update using (id = my_household());

drop policy if exists mem_read on members;
create policy mem_read on members for select using (household_id = my_household());
-- No direct member updates: set_identity() and change requests are the only writers.

do $$ declare t text; begin
  foreach t in array array['categories','accounts','recurring','expenses','settlements','import_ignores','import_rules'] loop
    execute format('drop policy if exists %1$s_all on %1$s', t);
    execute format('create policy %1$s_all on %1$s for all using (household_id = my_household()) with check (household_id = my_household())', t);
  end loop;
end $$;
-- Hard deletes are not offered for money rows: soft delete only.
drop policy if exists expenses_all on expenses;
drop policy if exists expenses_sel on expenses;
create policy expenses_sel on expenses for select using (household_id = my_household());
drop policy if exists expenses_ins on expenses;
create policy expenses_ins on expenses for insert with check (household_id = my_household());
drop policy if exists expenses_upd on expenses;
create policy expenses_upd on expenses for update using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists settlements_all on settlements;
drop policy if exists settlements_sel on settlements;
create policy settlements_sel on settlements for select using (household_id = my_household());
drop policy if exists settlements_ins on settlements;
create policy settlements_ins on settlements for insert with check (household_id = my_household());
drop policy if exists settlements_upd on settlements;
create policy settlements_upd on settlements for update using (household_id = my_household()) with check (household_id = my_household());

drop policy if exists cr_read on change_requests;
create policy cr_read on change_requests for select using (household_id = my_household());
drop policy if exists act_read on activity;
create policy act_read on activity for select using (household_id = my_household());

-- ───────────────────────── RPCs ─────────────────────────

create or replace function create_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  insert into households default values returning id into hid;
  insert into members(household_id, user_id) values (hid, auth.uid());
  insert into categories(household_id, name, emoji, colour, sort) values
    (hid, 'Groceries',     '🛒', '#5E9C6F', 1),
    (hid, 'Eating out',    '🍜', '#D9774B', 2),
    (hid, 'Rent & bills',  '🏠', '#6C7FC4', 3),
    (hid, 'Utilities',     '💡', '#C9A23A', 4),
    (hid, 'Transport',     '🚆', '#4A9BAE', 5),
    (hid, 'Subscriptions', '📺', '#9A6BB8', 6),
    (hid, 'Household',     '🧺', '#8C8A5A', 7),
    (hid, 'Going out',     '🍸', '#C9577E', 8),
    (hid, 'Travel',        '✈️', '#3F86C2', 9),
    (hid, 'Gifts',         '🎁', '#C25E5E', 10),
    (hid, 'Health',        '💊', '#4FA58C', 11),
    (hid, 'Other',         '•',  '#8A8A8A', 12);
  return hid;
end $$;

create or replace function join_household(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  select id into hid from households where join_code = upper(trim(p_code)) for update;
  if hid is null then raise exception 'no household with that code'; end if;
  if (select count(*) from members where household_id = hid) >= 2 then raise exception 'this household already has two people'; end if;
  insert into members(household_id, user_id) values (hid, auth.uid());
  return hid;
end $$;

-- First-time identity: name + animal, then locked for good (changes need both people).
create or replace function set_identity(p_name text, p_animal text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid() and locked_at is not null) then
    raise exception 'already set; request a change instead';
  end if;
  if exists (select 1 from members where household_id = my_household() and animal = p_animal and user_id <> auth.uid()) then
    raise exception 'your partner already picked the %', p_animal;
  end if;
  perform set_config('smsm.applying_change', 'on', true);
  update members set display_name = trim(p_name), animal = p_animal, locked_at = now() where user_id = auth.uid();
  perform set_config('smsm.applying_change', 'off', true);
end $$;

create or replace function request_change(p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; hid uuid := my_household();
begin
  if hid is null then raise exception 'not in a household'; end if;
  if (select count(*) from members where household_id = hid) < 2 then raise exception 'your partner has not joined yet'; end if;
  insert into change_requests(household_id, requested_by, kind, payload) values (hid, auth.uid(), p_kind, p_payload)
  returning id into rid;
  insert into activity(household_id, actor, entity, entity_id, action, summary)
  values (hid, auth.uid(), 'change_request', rid, 'requested', jsonb_build_object('kind', p_kind, 'payload', p_payload));
  return rid;
end $$;

-- The partner (never the requester) approves or declines. The requester may cancel.
create or replace function decide_change(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cr change_requests; tot numeric;
begin
  select * into cr from change_requests where id = p_id and household_id = my_household() for update;
  if cr.id is null or cr.status <> 'pending' then raise exception 'no pending request'; end if;
  if cr.requested_by = auth.uid() then
    if p_approve then raise exception 'your partner has to approve this'; end if;
    update change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return;
  end if;
  if not p_approve then
    update change_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = p_id;
  else
    perform set_config('smsm.applying_change', 'on', true);
    if cr.kind = 'identity' then
      if exists (select 1 from members where household_id = cr.household_id and animal = cr.payload->>'animal'
                 and user_id <> (cr.payload->>'user_id')::uuid) then
        -- swapping animals: the other person takes the remaining one
        update members set animal = null where household_id = cr.household_id and animal = cr.payload->>'animal';
        update members set display_name = trim(cr.payload->>'display_name'), animal = cr.payload->>'animal'
          where household_id = cr.household_id and user_id = (cr.payload->>'user_id')::uuid;
        update members set animal = case cr.payload->>'animal' when 'cat' then 'dog' else 'cat' end
          where household_id = cr.household_id and animal is null;
      else
        update members set display_name = trim(cr.payload->>'display_name'), animal = cr.payload->>'animal'
          where household_id = cr.household_id and user_id = (cr.payload->>'user_id')::uuid;
      end if;
    else
      select sum(v::numeric) into tot from jsonb_each_text(cr.payload->'ratio') t(k, v);
      if tot <> 100 then raise exception 'ratio must add up to 100'; end if;
      update households set default_ratio = cr.payload->'ratio' where id = cr.household_id;
    end if;
    perform set_config('smsm.applying_change', 'off', true);
    update change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  end if;
  insert into activity(household_id, actor, entity, entity_id, action, summary)
  values (cr.household_id, auth.uid(), 'change_request', p_id,
          case when p_approve then 'approved' else 'declined' end, jsonb_build_object('kind', cr.kind));
end $$;

-- Post every due occurrence of every active recurring expense up to today. Idempotent (unique index on
-- recurring_id + occurrence_date), so both phones calling it at once is harmless. Also scheduled nightly.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid;
begin
  if p_household is not null and auth.uid() is not null and p_household is distinct from my_household() then
    raise exception 'not your household';
  end if;
  hid := coalesce(p_household, my_household());
  if hid is null then return 0; end if;
  for r in select * from recurring where household_id = hid and active for update loop
    step := case r.frequency when 'weekly' then make_interval(weeks => r.every)
                             when 'monthly' then make_interval(months => r.every)
                             else make_interval(years => r.every) end;
    loop
      d := (r.start_date + step * r.posted_count)::date;
      exit when d > current_date or (r.end_date is not null and d > r.end_date);
      insert into expenses(household_id, description, amount_pence, date, category_id, paid_by, split_mode,
                           split_params, shares, notes, source, recurring_id, occurrence_date, created_by)
      values (r.household_id, r.description, r.amount_pence, d, r.category_id, r.paid_by, r.split_mode,
              r.split_params, r.shares, r.notes, 'recurring', r.id, d, null)
      on conflict do nothing;
      r.posted_count := r.posted_count + 1;
      posted := posted + 1;
    end loop;
    update recurring set posted_count = r.posted_count where id = r.id;
  end loop;
  return posted;
end $$;

-- Nightly posting (Database → Extensions: enable pg_cron, then run once):
-- select cron.schedule('smsm-recurring', '5 0 * * *', $$ select post_due_recurring(id) from households $$);

grant execute on function my_household(), create_household(), join_household(text), set_identity(text, text),
  request_change(text, jsonb), decide_change(uuid, boolean), post_due_recurring(uuid) to authenticated;
