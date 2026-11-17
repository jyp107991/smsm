-- smsm migration 5 (S2 review): who made a row comes from the sign-in, never from the phone.
-- Before this, `created_by` (and `updated_by` on expenses) was whatever the phone sent, so one person could
-- write a row as the other. Expand-then-contract: the app already deployed still sends `created_by`; these
-- triggers overwrite it with the signed-in person, so it keeps working, and the new app stops sending it.
--
-- "A person" is a request with a signed-in user (auth.uid() is set): the phone, and the functions a phone
-- calls. The nightly job and the service role have no user, so what they write is kept as written.

alter table expenses    alter column created_by set default auth.uid();
alter table settlements alter column created_by set default auth.uid();
alter table recurring   alter column created_by set default auth.uid();
alter table chapters    alter column created_by set default auth.uid();
alter table inbox_items alter column created_by set default auth.uid();

-- Runs as the caller (not security definer), like stamp_update: it only reads auth.uid().
create or replace function stamp_author() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      if tg_table_name = 'expenses' then new.updated_by := auth.uid(); end if;
    end if;
  else
    -- Nobody changes who made a row, whoever asks.
    new.created_by := old.created_by;
    if tg_table_name = 'expenses' and auth.uid() is not null then new.updated_by := auth.uid(); end if;
  end if;
  return new;
end $$;

drop trigger if exists expenses_author on expenses;
create trigger expenses_author before insert or update on expenses for each row execute function stamp_author();
drop trigger if exists settlements_author on settlements;
create trigger settlements_author before insert or update on settlements for each row execute function stamp_author();
drop trigger if exists recurring_author on recurring;
create trigger recurring_author before insert or update on recurring for each row execute function stamp_author();
drop trigger if exists chapters_author on chapters;
create trigger chapters_author before insert or update on chapters for each row execute function stamp_author();
drop trigger if exists inbox_items_author on inbox_items;
create trigger inbox_items_author before insert or update on inbox_items for each row execute function stamp_author();
