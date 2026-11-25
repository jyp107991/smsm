-- smsm migration S10 fresh review, finding 1 (DECISIONS 25 Nov "S10 review: a regular payment's day is taken only by
-- its own posting or its Inbox bill"). Expand only: two new triggers; nothing the deployed app sends is refused.
--
-- A regular payment posts each of its days once: the unique indexes on (recurring_id, occurrence_date) and the
-- posting's `on conflict do nothing`. So a row that takes a day first stops the real one from posting: a 1p entry of
-- A's own on the day of the shared rent, and the rent never posts; a shared entry of B's on A's own gym's day, and her
-- own payment skips. From here, for a member's phone (the database's own posting and a restore are what make these):
--   1. an own entry (owner_id set) is never inserted: an own entry exists only as the posting of its owner's own
--      regular payment, or as a restored one (SPEC S10 "Out": own one-off entries). An upsert of a row already there is
--      an edit, checked as the update that follows (as check_refund_limit does), so the owner's edits still save;
--   2. an entry takes a regular payment's day (recurring_id and occurrence_date set, or changed) only from that day's
--      bill in the Inbox, and as a shared entry: the Inbox holds only shared bills (an own payment has a fixed amount,
--      so it never posts one), and a bill due while a payment was shared stays shared once kept, whoever's the
--      payment is now;
--   3. an Inbox item names a regular payment's day only when the posting made it: a phone never writes recurring_id or
--      occurrence_date on one (it never has: a receipt to sort has neither), so 2 can't be met with a bill of its own.
-- Unchanged: the Inbox's Keep (insert or upsert), its replay, Undo then Keep again, a phone's posting and the nightly
-- job, restore_backup (smsm.restoring) and the database owner's own writes.

create or replace function check_entry_day() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Only a member's phone is held to this; the posting and a restore are the database's own.
  if current_user <> 'authenticated'
     or coalesce(current_setting('smsm.posting', true), '') = 'on'
     or coalesce(current_setting('smsm.restoring', true), '') = 'on' then
    return new;
  end if;
  -- The phone writes by upsert (insert … on conflict do update): a row already there is an edit, checked by the update
  -- that follows, with what it was before.
  if tg_op = 'INSERT' and exists (select 1 from expenses where id = new.id) then return new; end if;
  if tg_op = 'INSERT' and new.owner_id is not null then
    raise exception 'a personal entry comes only from its owner''s own regular payment' using errcode = '42501';
  end if;
  if new.recurring_id is not null
     and (tg_op = 'INSERT' or new.recurring_id is distinct from old.recurring_id or new.occurrence_date is distinct from old.occurrence_date) then
    if new.owner_id is not null then
      raise exception 'a personal entry keeps the day its own regular payment posted it on' using errcode = '42501';
    end if;
    if not exists (select 1 from inbox_items i
                    where i.household_id = new.household_id and i.recurring_id = new.recurring_id
                      and i.occurrence_date is not distinct from new.occurrence_date) then
      raise exception 'a regular payment''s day is taken only by its own posting or its bill in the Inbox' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function check_entry_day() from public, anon, authenticated;
drop trigger if exists expenses_day on expenses;
create trigger expenses_day before insert or update on expenses for each row execute function check_entry_day();

create or replace function check_inbox_day() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' or coalesce(current_setting('smsm.posting', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' and (new.recurring_id is not null or new.occurrence_date is not null) then
    raise exception 'a regular payment''s bill comes only from its own posting' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.recurring_id is distinct from old.recurring_id or new.occurrence_date is distinct from old.occurrence_date) then
    raise exception 'a regular payment''s bill comes only from its own posting' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function check_inbox_day() from public, anon, authenticated;
drop trigger if exists inbox_items_day on inbox_items;
create trigger inbox_items_day before insert or update on inbox_items for each row execute function check_inbox_day();
