-- smsm: shared spending for two people.  Baseline schema, v2 (2026-11-16).
-- Tested on PostgreSQL 16 with an auth stub: tests/sql/. Extend with numbered files in supabase/migrations/;
-- never edit this file after it has been applied to the live project.
--
-- Money is integer pence, GBP only. Every expense stores who paid (`paid`) and who owes (`shares`) as
-- {user_id: pence}; each always sums to amount_pence. A person's net position is paid minus shares.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────

create table if not exists households (
  id             uuid primary key default gen_random_uuid(),
  join_code      text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  home_country   char(2) not null default 'GB',
  default_ratio  jsonb,               -- {user_id: percent}; null = 50/50. Changes only via an approved request.
  joint_enabled  boolean not null default false,   -- "paid from our joint account" offered as a payer
  joint_ratio    jsonb,               -- how the joint account is funded; null = 50/50
  created_at     timestamptz not null default now()
);

-- Identity (name + animal) is chosen once, then locked. Changes go through change_requests.
create table if not exists members (
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text check (display_name is null or length(trim(display_name)) between 1 and 24),
  animal        text check (animal in ('cat','dog')),
  locked_at     timestamptz,
  monzo_me      text,                 -- monzo.me username for the settle-up handoff (not locked)
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
  colour        text not null default 'stone',     -- a palette token name, not a hex
  default_ratio jsonb,                -- null = household default
  archived      boolean not null default false,
  sort          int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (household_id, name)
);

-- A chapter is a named run of spending kept apart from everyday life: a trip, the wedding, moving house.
create table if not exists chapters (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 40),
  emoji         text not null default '🌿',
  kind          text not null default 'project' check (kind in ('trip','project')),
  country       char(2),              -- trips: where
  start_date    date,
  end_date      date,
  closed        boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- For Monzo later (provider = 'monzo', external_id = Monzo account id).
create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  owner_id      uuid references auth.users(id),    -- null = joint
  provider      text not null default 'manual' check (provider in ('manual','csv','monzo')),
  external_id   text,
  created_at    timestamptz not null default now(),
  unique (household_id, provider, external_id)
);

create table if not exists recurring (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  description     text not null,
  amount_pence    bigint not null check (amount_pence > 0),   -- the estimate when amount_varies
  amount_varies   boolean not null default false,             -- e.g. energy: ask for the amount each time
  category_id     uuid references categories(id) on delete set null,
  paid            jsonb not null,
  paid_via        text not null default 'person' check (paid_via in ('person','joint')),
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
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists expenses (
  id                uuid primary key default gen_random_uuid(),   -- generated on the phone, so retries are safe
  household_id      uuid not null references households(id) on delete cascade,
  kind              text not null default 'expense' check (kind in ('expense','money_back')),
  description       text not null check (length(trim(description)) > 0),
  amount_pence      bigint not null check (amount_pence > 0),
  date              date not null default current_date,
  category_id       uuid references categories(id) on delete set null,
  chapter_id        uuid references chapters(id) on delete set null,   -- null = everyday
  paid              jsonb not null,    -- {uid: pence paid}; for money_back: who received it
  paid_via          text not null default 'person' check (paid_via in ('person','joint')),
  split_mode        text not null default 'ratio' check (split_mode in ('ratio','exact','for_other','treat')),
  split_params      jsonb,             -- ratio {uid: percent} or exact {uid: pence}, kept for editing
  shares            jsonb not null,    -- {uid: pence owed}; for money_back: who it belongs to
  items             jsonb,             -- itemised bill: [{label, pence, shared}]; only shared lines are in amount_pence
  bill_total_pence  bigint,            -- whole receipt total when itemised (reference only)
  -- where
  country           char(2) not null default 'GB',
  place             text,              -- "Kyoto", "Hackney"
  lat               numeric(6,3),      -- rounded to about 100 m
  lng               numeric(6,3),
  -- paid in another currency (reference only; amount_pence is always GBP)
  original_amount   numeric,
  original_currency char(3),
  fx_rate           numeric,
  notes             text,
  tags              text[] not null default '{}',
  receipt_path      text,              -- Supabase Storage, private bucket 'receipts'
  -- where it came from
  source            text not null default 'manual' check (source in ('manual','recurring','scan','csv','monzo')),
  external_id       text,
  merchant          text,
  external_category text,
  account_id        uuid references accounts(id) on delete set null,
  recurring_id      uuid references recurring(id) on delete set null,
  occurrence_date   date,
  refund_of         uuid references expenses(id) on delete set null,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz        -- soft delete
);
create unique index if not exists expenses_external on expenses(household_id, source, external_id) where external_id is not null;
create unique index if not exists expenses_occurrence on expenses(recurring_id, occurrence_date) where recurring_id is not null;
create index if not exists expenses_household_date on expenses(household_id, date desc);
create index if not exists expenses_chapter on expenses(chapter_id) where chapter_id is not null;

create table if not exists settlements (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  from_user     uuid not null references auth.users(id),
  to_user       uuid not null references auth.users(id),
  amount_pence  bigint not null check (amount_pence > 0),
  date          date not null default current_date,
  note          text,
  method        text not null default 'other' check (method in ('monzo','other')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (from_user <> to_user)
);

-- Things waiting for a decision before they become expenses: a variable bill that needs its amount, a receipt
-- saved to sort later, something shared into the app, and (later) Monzo transactions. Never counted as money.
create table if not exists inbox_items (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  source          text not null check (source in ('bill','scan','share','monzo')),
  status          text not null default 'open' check (status in ('open','kept','dismissed')),
  payload         jsonb not null default '{}',     -- suggested expense fields
  receipt_path    text,
  recurring_id    uuid references recurring(id) on delete cascade,
  occurrence_date date,
  external_id     text,
  expense_id      uuid references expenses(id) on delete set null,   -- set when kept
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists inbox_occurrence on inbox_items(recurring_id, occurrence_date) where recurring_id is not null;
create unique index if not exists inbox_external on inbox_items(household_id, source, external_id) where external_id is not null;

create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  expense_id    uuid not null references expenses(id) on delete cascade,
  author        uuid not null references auth.users(id),
  body          text not null check (length(trim(body)) between 1 and 500),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists comments_expense on comments(expense_id, created_at);

-- What the household has taught the app: "tesco" → Groceries (and its usual split). Filled by people's
-- choices first, by the AI fallback second; a person's choice always overwrites an AI guess.
create table if not exists category_memory (
  household_id  uuid not null references households(id) on delete cascade,
  key           text not null,        -- normalised description / merchant
  category_id   uuid references categories(id) on delete cascade,
  split_mode    text,
  split_params  jsonb,
  uses          int not null default 1,
  source        text not null default 'user' check (source in ('user','ai','seed')),
  updated_at    timestamptz not null default now(),
  primary key (household_id, key)
);

-- Import: rules ("always keep TESCO as Groceries") and discarded rows (hash of the bank's id only).
create table if not exists import_rules (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  match_text    text not null,
  decision      text not null check (decision in ('keep','skip')),
  category_id   uuid references categories(id) on delete set null,
  split_mode    text check (split_mode in ('ratio','exact','for_other','treat')),
  split_params  jsonb,
  created_at    timestamptz not null default now(),
  unique (household_id, match_text)
);
create table if not exists import_ignores (
  household_id  uuid not null references households(id) on delete cascade,
  source        text not null check (source in ('csv','monzo')),
  id_hash       text not null,
  primary key (household_id, source, id_hash)
);

-- The month in review: figures computed by code, optional prose written from those figures.
create table if not exists recaps (
  household_id  uuid not null references households(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),
  stats         jsonb not null,
  prose         text,
  created_at    timestamptz not null default now(),
  primary key (household_id, period)
);

-- Changes that need both people: identity (name, animal) and the household default ratio.
create table if not exists change_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  kind          text not null check (kind in ('identity','default_ratio')),
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decided_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create unique index if not exists change_requests_one_pending on change_requests(household_id, kind) where status = 'pending';

-- Append-only history. Written by triggers and RPCs only.
create table if not exists activity (
  id            bigint generated always as identity primary key,
  household_id  uuid not null references households(id) on delete cascade,
  actor         uuid references auth.users(id),     -- null = system
  entity        text not null,
  entity_id     uuid,
  action        text not null,
  summary       jsonb not null default '{}',
  at            timestamptz not null default now()
);
create index if not exists activity_household_at on activity(household_id, at desc);

-- Operations.
create table if not exists ai_usage (              -- written by the `ai` Edge Function only
  household_id  uuid not null references households(id) on delete cascade,
  day           date not null,
  kind          text not null,
  calls         int not null default 0,
  primary key (household_id, day, kind)
);
create table if not exists client_errors (         -- phones report crashes here; read with the service role
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid(),
  at            timestamptz not null default now(),
  app_version   text,
  route         text,
  message       text not null,
  stack         text,
  context       jsonb
);
create table if not exists app_config (            -- e.g. min_client_version: older apps must refresh before writing
  key    text primary key,
  value  jsonb not null
);
insert into app_config(key, value) values ('min_client_version', '"0.0.0"') on conflict do nothing;

-- ───────────────────────── helpers ─────────────────────────

create or replace function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

create or replace function jsonb_pence_sum(j jsonb) returns bigint language sql immutable as $$
  select coalesce(sum(v::bigint), 0)::bigint from jsonb_each_text(j) as t(k, v)
$$;

-- ───────────────────────── integrity ─────────────────────────

create or replace function check_money() returns trigger language plpgsql as $$
declare k text; payers int; payer text;
begin
  if jsonb_pence_sum(new.shares) <> new.amount_pence then
    raise exception 'shares (%) must sum to amount (%)', jsonb_pence_sum(new.shares), new.amount_pence;
  end if;
  if jsonb_pence_sum(new.paid) <> new.amount_pence then
    raise exception 'paid (%) must sum to amount (%)', jsonb_pence_sum(new.paid), new.amount_pence;
  end if;
  if exists (select 1 from jsonb_each_text(new.shares || new.paid) t(k, v) where v::bigint < 0)
     or exists (select 1 from jsonb_each_text(new.paid) t(k, v) where v::bigint < 0) then
    raise exception 'amounts must not be negative';
  end if;
  for k in select jsonb_object_keys(new.shares) union select jsonb_object_keys(new.paid) loop
    if not exists (select 1 from members m where m.household_id = new.household_id and m.user_id::text = k) then
      raise exception 'paid or shares name a non-member';
    end if;
  end loop;
  select count(*), min(t.k) into payers, payer from jsonb_each_text(new.paid) t(k, v) where v::bigint > 0;
  if new.split_mode = 'for_other' and (payers <> 1 or coalesce((new.shares ->> payer)::bigint, 0) <> 0) then
    raise exception 'paid-for-the-other: one person pays and owes nothing';
  end if;
  if new.split_mode = 'treat' and exists (
       select 1 from members m where m.household_id = new.household_id
        and coalesce((new.shares ->> m.user_id::text)::bigint, 0) <> coalesce((new.paid ->> m.user_id::text)::bigint, 0)) then
    raise exception 'treat: whoever pays covers it';
  end if;
  return new;
end $$;

drop trigger if exists expenses_check_money on expenses;
create trigger expenses_check_money before insert or update on expenses for each row execute function check_money();
drop trigger if exists recurring_check_money on recurring;
create trigger recurring_check_money before insert or update on recurring for each row execute function check_money();

create or replace function stamp_update() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'expenses' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['expenses','settlements','recurring','chapters','categories','inbox_items'] loop
    execute format('drop trigger if exists %1$s_stamp on %1$s', t);
    execute format('create trigger %1$s_stamp before update on %1$s for each row execute function stamp_update()', t);
  end loop;
end $$;

-- History for expenses, settlements and recurring templates.
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; diff jsonb := '{}'; k text; ent text; o jsonb; n jsonb := to_jsonb(new);
begin
  ent := case tg_table_name when 'expenses' then 'expense' when 'settlements' then 'settlement' else 'recurring' end;
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
  foreach t in array array['expenses','settlements','recurring'] loop
    execute format('drop trigger if exists %1$s_log on %1$s', t);
    execute format('create trigger %1$s_log after insert or update on %1$s for each row execute function log_activity()', t);
  end loop;
end $$;

-- Locked identity and the default ratio change only through an approved request.
create or replace function guard_member_identity() returns trigger language plpgsql as $$
begin
  if current_setting('smsm.applying_change', true) = 'on' then return new; end if;
  if old.locked_at is not null and (new.display_name is distinct from old.display_name
       or new.animal is distinct from old.animal or new.locked_at is distinct from old.locked_at) then
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

-- ───────────────────────── the balance, in SQL ─────────────────────────
-- net_pence > 0: this person is owed that much by the other. The two rows of a household always sum to zero.
-- The app computes the same figure in src/lib/balance.ts; tests assert the two agree.
create or replace view member_net with (security_invoker = true) as
select m.household_id, m.user_id,
  coalesce((select sum((case e.kind when 'money_back' then -1 else 1 end)
              * (coalesce((e.paid ->> m.user_id::text)::bigint, 0) - coalesce((e.shares ->> m.user_id::text)::bigint, 0)))
            from expenses e where e.household_id = m.household_id and e.deleted_at is null), 0)
  + coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.from_user = m.user_id), 0)
  - coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.to_user = m.user_id), 0)
  as net_pence
from members m;

-- ───────────────────────── access control ─────────────────────────

do $$ declare t text; begin
  foreach t in array array['households','members','categories','chapters','accounts','recurring','expenses','settlements',
                           'inbox_items','comments','category_memory','import_rules','import_ignores','recaps',
                           'change_requests','activity','ai_usage','client_errors','app_config'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

drop policy if exists hh_read on households;
create policy hh_read on households for select using (id = my_household());
drop policy if exists hh_update on households;
create policy hh_update on households for update using (id = my_household()) with check (id = my_household());

drop policy if exists mem_read on members;
create policy mem_read on members for select using (household_id = my_household());
-- No direct member writes: set_identity(), set_monzo_me() and change requests are the only writers.

-- Household tables either person can read and write freely.
do $$ declare t text; begin
  foreach t in array array['categories','chapters','accounts','recurring','inbox_items','category_memory',
                           'import_rules','import_ignores'] loop
    execute format('drop policy if exists %1$s_all on %1$s', t);
    execute format('create policy %1$s_all on %1$s for all using (household_id = my_household()) with check (household_id = my_household())', t);
  end loop;
end $$;

-- Money rows: read, insert, update. No delete policy, so hard deletes are impossible (soft delete only).
do $$ declare t text; begin
  foreach t in array array['expenses','settlements'] loop
    execute format('drop policy if exists %1$s_sel on %1$s', t);
    execute format('create policy %1$s_sel on %1$s for select using (household_id = my_household())', t);
    execute format('drop policy if exists %1$s_ins on %1$s', t);
    execute format('create policy %1$s_ins on %1$s for insert with check (household_id = my_household())', t);
    execute format('drop policy if exists %1$s_upd on %1$s', t);
    execute format('create policy %1$s_upd on %1$s for update using (household_id = my_household()) with check (household_id = my_household())', t);
  end loop;
end $$;

drop policy if exists comments_sel on comments;
create policy comments_sel on comments for select using (household_id = my_household());
drop policy if exists comments_ins on comments;
create policy comments_ins on comments for insert with check (household_id = my_household() and author = auth.uid());
drop policy if exists comments_upd on comments;
create policy comments_upd on comments for update using (author = auth.uid()) with check (author = auth.uid());

-- Read-only for people; written by RPCs, triggers or the service role.
drop policy if exists recaps_read on recaps;
create policy recaps_read on recaps for select using (household_id = my_household());
drop policy if exists cr_read on change_requests;
create policy cr_read on change_requests for select using (household_id = my_household());
drop policy if exists act_read on activity;
create policy act_read on activity for select using (household_id = my_household());
drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage for select using (household_id = my_household());
drop policy if exists config_read on app_config;
create policy config_read on app_config for select using (true);
drop policy if exists errors_ins on client_errors;
create policy errors_ins on client_errors for insert with check (user_id = auth.uid());

-- ───────────────────────── table privileges ─────────────────────────
-- The project is created with "automatically expose new tables" OFF, so nothing is reachable until granted here.
-- Grants say which operations exist at all; row-level security above says which rows. anon gets nothing.
revoke all on all tables in schema public from anon, authenticated;
grant select, update                 on households to authenticated;
grant select                         on members to authenticated;
grant select, insert, update, delete on categories, chapters, accounts, recurring, inbox_items, category_memory,
                                        import_rules, import_ignores to authenticated;
grant select, insert, update         on expenses, settlements, comments to authenticated;
grant select                         on recaps, change_requests, activity, ai_usage, app_config, member_net to authenticated;
grant insert                         on client_errors to authenticated;

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
    (hid, 'Groceries',     '🛒', 'moss',   1),
    (hid, 'Eating out',    '🍜', 'amber',  2),
    (hid, 'Rent & bills',  '🏠', 'walnut', 3),
    (hid, 'Utilities',     '💡', 'honey',  4),
    (hid, 'Transport',     '🚆', 'slate',  5),
    (hid, 'Subscriptions', '📺', 'plum',   6),
    (hid, 'Household',     '🧺', 'oak',    7),
    (hid, 'Going out',     '🍸', 'berry',  8),
    (hid, 'Travel',        '✈️', 'lake',   9),
    (hid, 'Gifts',         '🎁', 'clay',   10),
    (hid, 'Health',        '💊', 'fern',   11),
    (hid, 'Other',         '•',  'stone',  12);
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

create or replace function set_monzo_me(p_username text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_username is not null and p_username !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'that does not look like a monzo.me name'; end if;
  update members set monzo_me = p_username where user_id = auth.uid();
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

-- The partner (never the requester) approves or declines. The requester may only cancel.
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

-- Post every due occurrence of every active recurring template, up to today. Fixed amounts become expenses;
-- "amount varies" templates become an inbox item asking for the amount. Recurring spending is always home
-- spending: country = the household's home country and no chapter, wherever the two of you happen to be.
-- Idempotent (unique indexes on recurring_id + occurrence_date), so both phones calling at once is harmless.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid; home char(2);
begin
  if p_household is not null and auth.uid() is not null and p_household is distinct from my_household() then
    raise exception 'not your household';
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

-- Nightly posting (Database → Extensions: enable pg_cron, then run once):
-- select cron.schedule('smsm-recurring', '5 0 * * *', $$ select post_due_recurring(id) from households $$);

grant execute on function my_household(), create_household(), join_household(text), set_identity(text, text),
  set_monzo_me(text), request_change(text, jsonb), decide_change(uuid, boolean), post_due_recurring(uuid) to authenticated;
