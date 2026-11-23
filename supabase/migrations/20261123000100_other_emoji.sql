-- smsm migration (S9b, finding 20; SPEC CAT-1, DESIGN §4.2): "Other" has an emoji like the other eleven starting
-- categories (📦), instead of the placeholder dot. New households start with it. An existing household's "Other" gets it
-- only while it is still the untouched starting category (S9b review 7): named "Other", the placeholder dot, stone, not
-- archived, made with the household (no 'created' entry in the log, from before categories were logged, or one at the
-- moment the household was made: a person's own "Other" is logged later), and never edited by a person in its name,
-- emoji, colour or archived state (clearing an emoji on purpose stores the same dot, and is such an edit). Its place in
-- the order doesn't count: moving it says nothing about its emoji. The change is logged like any category edit
-- (categories_log; no person made it, so it has no actor). Expand only: the deployed app shows any emoji a category has.

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
    (hid, 'Other',         '📦', 'stone',  12);
  return hid;
end $$;

-- The one-off update, kept as a function so the SQL tests can try it on households of every kind.
create or replace function give_other_its_emoji() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update categories c set emoji = '📦'
  where c.name = 'Other' and c.emoji = '•' and c.colour = 'stone' and not c.archived
    and not exists (
      select 1 from activity a join households h on h.id = c.household_id
      where a.entity = 'category' and a.entity_id = c.id and a.action = 'created' and a.at <> h.created_at)
    and not exists (
      select 1 from activity a
      where a.entity = 'category' and a.entity_id = c.id and a.action = 'edited' and a.actor is not null
        and (a.summary ? 'name' or a.summary ? 'emoji' or a.summary ? 'colour' or a.summary ? 'archived'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function give_other_its_emoji() from public, anon, authenticated, service_role;

do $$ begin perform give_other_its_emoji(); end $$;
