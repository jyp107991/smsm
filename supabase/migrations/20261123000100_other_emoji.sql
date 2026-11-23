-- smsm migration (S9b, finding 20; SPEC CAT-1, DESIGN §4.2): "Other" has an emoji like the other eleven starting
-- categories (📦), instead of the placeholder dot. New households start with it; a household whose "Other" still has
-- the placeholder (never given an emoji of its own) gets it too. The change is logged like any other category edit
-- (categories_log; no person made it, so it has no actor). A category the household renamed or gave its own emoji is
-- left alone. Expand only: the deployed app shows any emoji a category has.

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

update categories set emoji = '📦' where name = 'Other' and emoji = '•';
