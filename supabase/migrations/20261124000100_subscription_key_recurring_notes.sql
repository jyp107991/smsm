-- smsm migration (owner's two reports on regular payments, 24 Nov; DECISIONS 24 Nov "One meaning for subscription" and
-- "Notes on regular payments"). Expand only: one new column, one new trigger, two functions replaced, one added. The
-- deployed app keeps working: it never sends seed_key (null, as before, for a category it adds), and an Inbox bill's
-- extra "notes" in its payload is ignored by it.
--
-- 1. A starting category knows which one it is: categories.seed_key ('subscriptions', 'other', ...), set by
--    create_household and never by a phone. The regular payment sheet finds the household's Subscriptions category by
--    it (picking it turns "Show in Subscriptions" on), so renaming it ("Streaming") changes nothing, and a category a
--    person adds and names "Subscriptions" is not it. At most one of each key per household. A restored backup's
--    category never brings a key: the receiving household's starting categories are its own.
--    Existing households: a category made with its household (logged at that moment, or from before categories were
--    logged; a person's own is logged later, as in migration 20261123000100) takes the key of the starting name it
--    had first (its first rename's "before", or its name if never renamed). Set without triggers: it is the column's
--    starting value, not a change anyone made, so it isn't logged and no stamp moves.
-- 2. A regular payment's notes (recurring.notes, there since the baseline, now on the sheet) go with what it posts from
--    now on: a fixed one's entry already copies them (recurring_post_due_one); an "amount varies" one's Inbox bill now
--    carries them in its payload, so the entry it becomes has the notes the template had on the day it was due. What
--    was posted before keeps the notes it had.

-- ───────── 1. the starting categories' key ─────────
alter table categories add column if not exists seed_key text;
alter table categories drop constraint if exists categories_seed_key_check;
alter table categories add constraint categories_seed_key_check check (seed_key is null or seed_key = any (array[
  'groceries', 'eating_out', 'rent_bills', 'utilities', 'transport', 'subscriptions', 'household', 'going_out', 'travel',
  'gifts', 'health', 'other']));
create unique index if not exists categories_household_seed_key on categories (household_id, seed_key) where seed_key is not null;

-- A phone never sets or changes the key; a restored category never brings one.
create or replace function categories_seed_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('smsm.restoring', true), '') = 'on' then
      new.seed_key := null;
    elsif current_user = 'authenticated' and new.seed_key is not null then
      raise exception 'a starting category''s key is set by the server' using errcode = '42501';
    end if;
  elsif current_user = 'authenticated' and new.seed_key is distinct from old.seed_key then
    raise exception 'a starting category''s key is set by the server' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists categories_seed_guard on categories;
create trigger categories_seed_guard before insert or update on categories for each row execute function categories_seed_guard();

create or replace function create_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a household'; end if;
  insert into households default values returning id into hid;
  insert into members(household_id, user_id) values (hid, auth.uid());
  insert into categories(household_id, name, emoji, colour, sort, seed_key) values
    (hid, 'Groceries',     '🛒', 'moss',   1,  'groceries'),
    (hid, 'Eating out',    '🍜', 'amber',  2,  'eating_out'),
    (hid, 'Rent & bills',  '🏠', 'walnut', 3,  'rent_bills'),
    (hid, 'Utilities',     '💡', 'honey',  4,  'utilities'),
    (hid, 'Transport',     '🚆', 'slate',  5,  'transport'),
    (hid, 'Subscriptions', '📺', 'plum',   6,  'subscriptions'),
    (hid, 'Household',     '🧺', 'oak',    7,  'household'),
    (hid, 'Going out',     '🍸', 'berry',  8,  'going_out'),
    (hid, 'Travel',        '✈️', 'lake',   9,  'travel'),
    (hid, 'Gifts',         '🎁', 'clay',   10, 'gifts'),
    (hid, 'Health',        '💊', 'fern',   11, 'health'),
    (hid, 'Other',         '📦', 'stone',  12, 'other');
  return hid;
end $$;

-- The one-off keying of existing households, kept as a function so the SQL tests can try it on households of every kind.
create or replace function key_starting_categories() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with seeds(key, name) as (values
    ('groceries', 'Groceries'), ('eating_out', 'Eating out'), ('rent_bills', 'Rent & bills'), ('utilities', 'Utilities'),
    ('transport', 'Transport'), ('subscriptions', 'Subscriptions'), ('household', 'Household'), ('going_out', 'Going out'),
    ('travel', 'Travel'), ('gifts', 'Gifts'), ('health', 'Health'), ('other', 'Other')),
  first_name as (
    select c.id, c.household_id, c.name, c.sort,
           coalesce((select a.summary -> 'name' ->> 'before' from activity a
                     where a.entity = 'category' and a.entity_id = c.id and a.action = 'edited' and a.summary ? 'name'
                     order by a.at, a.id limit 1), c.name) as was
    from categories c
    where c.seed_key is null
      and not exists (
        select 1 from activity a join households h on h.id = c.household_id
        where a.entity = 'category' and a.entity_id = c.id and a.action = 'created' and a.at <> h.created_at)),
  candidates as (
    select f.id, s.key,
           row_number() over (partition by f.household_id, s.key order by (f.name = s.name) desc, f.sort, f.id) as rn
    from first_name f join seeds s on s.name = f.was
    where not exists (select 1 from categories k where k.household_id = f.household_id and k.seed_key = s.key))
  update categories c set seed_key = x.key from candidates x where x.id = c.id and x.rn = 1;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function key_starting_categories() from public, anon, authenticated, service_role;

alter table categories disable trigger user;
do $$ begin perform key_starting_categories(); end $$;
alter table categories enable trigger user;

-- ───────── 2. an "amount varies" bill carries its template's notes ─────────
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
            and (select count(*) from members x where x.household_id = r.household_id) = 2;
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
                           split_mode, split_params, shares, notes, country, source, recurring_id, occurrence_date)
      values (r.household_id, r.description, r.amount_pence, d, r.category_id, null, r.paid, r.paid_via,
              r.split_mode, r.split_params, r.shares, r.notes, coalesce(home, 'GB'), 'recurring', r.id, d)
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
