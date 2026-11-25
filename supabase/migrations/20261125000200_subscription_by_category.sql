-- smsm migration (owner, 25 Nov: "why do you still have a subscriptions category and a subscriptions switch";
-- DECISIONS 25 Nov "The category alone decides what a subscription is", superseding 24 Nov "One meaning for
-- subscription"). Expand only: the column stays, one trigger added, one one-off function. The deployed app keeps
-- working: it may still send is_subscription, and the trigger sets it from the category whatever it sent.
--
-- A regular payment is a subscription exactly when its category is its household's Subscriptions category (the
-- starting one, categories.seed_key = 'subscriptions'; renamed, it still is; a person's own "Subscriptions" is not),
-- shared or one person's own alike. recurring.is_subscription is kept to that rule on every insert and update, so it
-- never says anything the category doesn't. The app reads the category, never the column.
--
-- Named to run before recurring_guard (triggers run in name order): the guard's "deleting or restoring changes nothing
-- else" then compares the column as the rule sets it, so a stale phone's old value can't make a delete fail.
--
-- Existing rows are set once by the same rule. As the keying of the starting categories (migration 20261124000100),
-- without triggers: it is the column taking its rule's value, not a change anyone made, so it isn't logged and no
-- stamp moves. A payment a person had switched on outside Subscriptions stops being one (the owner's rule); one in
-- Subscriptions they had switched off becomes one.

create or replace function recurring_category_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.is_subscription := new.category_id is not null and exists (
    select 1 from categories c
    where c.id = new.category_id and c.household_id = new.household_id and c.seed_key = 'subscriptions');
  return new;
end $$;
revoke all on function recurring_category_subscription() from public, anon, authenticated;
drop trigger if exists recurring_category_subscription on recurring;
create trigger recurring_category_subscription before insert or update on recurring
  for each row execute function recurring_category_subscription();

-- The one-off: every row's column by the rule. Kept as a function so the SQL tests can try it.
create or replace function subscription_follow_category() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update recurring r set is_subscription = x.want
  from (select r2.id, coalesce(c.seed_key = 'subscriptions', false) as want
        from recurring r2 left join categories c on c.id = r2.category_id and c.household_id = r2.household_id) x
  where x.id = r.id and r.is_subscription is distinct from x.want;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function subscription_follow_category() from public, anon, authenticated, service_role;

alter table recurring disable trigger user;
do $$ begin perform subscription_follow_category(); end $$;
alter table recurring enable trigger user;
