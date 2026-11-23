-- smsm migration (S9a, fix 7; SPEC MB-2, MB-3, ACT-2, ACT-3; DATA_MODEL §3): money back linked to its original.
--
--   * MB-2: a money back may not be more than its original still has to come back: the original's amount less its
--     other live linked money back. Refused on insert, and on an edit that raises it (more money, another original,
--     a restore); an unrelated edit of a row from before this rule is never refused. Money back with no original
--     (selling something shared, MB-1) has no such limit. A restore from a backup (smsm.restoring) is not checked:
--     it puts back what was there.
--   * ACT-3: deleting an original soft-deletes its live linked money back in the same statement (one transaction:
--     the same deleted_at, the same person, the same moment in the history). Restoring the original restores the
--     rows deleted with it (the same deleted_at), and only those: a refund deleted on its own earlier stays deleted.
--     The partner hears about the original only (one notification, not one per refund).
--   * MB-3: a money back whose original is deleted never counts: member_net and member_net_on leave it out, however
--     it came about (a row from before this rule, an edit made while one phone was offline).
-- Expand only: the deployed app keeps working (it already refuses the same on the phone from S9a on).

-- ───────── MB-2: never more back than the original ─────────
create function check_refund_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_amount bigint; v_back bigint; v_left bigint;
begin
  if new.kind <> 'money_back' or new.refund_of is null or new.deleted_at is not null then return new; end if;
  if coalesce(current_setting('smsm.restoring', true), '') = 'on' then return new; end if;
  -- Only a change that raises what has come back is checked.
  if tg_op = 'UPDATE' and old.kind = 'money_back' and old.deleted_at is null and old.refund_of is not distinct from new.refund_of
     and new.amount_pence <= old.amount_pence then
    return new;
  end if;
  -- One refund at a time per original (two phones at once can't both squeeze in).
  select amount_pence into v_amount from expenses where id = new.refund_of for update;
  if not found then return new; end if;
  select coalesce(sum(amount_pence), 0) into v_back from expenses
   where refund_of = new.refund_of and kind = 'money_back' and deleted_at is null and id <> new.id;
  v_left := greatest(v_amount - v_back, 0);
  if new.amount_pence > v_left then
    raise exception 'that''s more than the £%.% still to come back', v_left / 100, lpad((v_left % 100)::text, 2, '0')
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function check_refund_limit() from public, anon, authenticated, service_role;
create trigger expenses_refund_limit before insert or update on expenses for each row execute function check_refund_limit();

-- ───────── ACT-3: the original's money back goes (and comes back) with it ─────────
create function follow_original() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'expense' then return null; end if;
  if old.deleted_at is null and new.deleted_at is not null then
    perform set_config('smsm.following', 'on', true);
    update expenses set deleted_at = new.deleted_at
     where refund_of = new.id and kind = 'money_back' and deleted_at is null;
    perform set_config('smsm.following', 'off', true);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform set_config('smsm.following', 'on', true);
    update expenses set deleted_at = null
     where refund_of = new.id and kind = 'money_back' and deleted_at = old.deleted_at;
    perform set_config('smsm.following', 'off', true);
  end if;
  return null;
end $$;
revoke all on function follow_original() from public, anon, authenticated, service_role;
create trigger expenses_follow_original after update of deleted_at on expenses for each row execute function follow_original();

-- The notification for the partner is the original's; the refunds that followed it add none (S8 otherwise unchanged).
create or replace function notify_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_payload jsonb := '{}'; v_fields jsonb;
begin
  if auth.uid() is null then return null; end if;
  if current_setting('smsm.following', true) = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    if current_setting('smsm.posting', true) = 'on' or new.deleted_at is not null then return null; end if;
    v_kind := 'entry_added';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_kind := 'entry_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_kind := 'entry_restored';
  elsif new.deleted_at is not null then
    return null;
  elsif (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return null;
  else
    v_kind := 'entry_changed';
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_fields
      from jsonb_each(to_jsonb(new) - 'updated_at' - 'updated_by' - 'category_guess') n
     where n.value is distinct from to_jsonb(old) -> n.key;
    v_payload := jsonb_build_object('fields', v_fields);
  end if;
  perform queue_notification(new.household_id, auth.uid(), v_kind, new.id, v_payload);
  return null;
end $$;

-- ───────── MB-3: a money back whose original is deleted never counts ─────────
create or replace view member_net with (security_invoker = true) as
select m.household_id, m.user_id,
  coalesce((select sum((case e.kind when 'money_back' then -1 else 1 end)
              * (coalesce((e.paid ->> m.user_id::text)::bigint, 0) - coalesce((e.shares ->> m.user_id::text)::bigint, 0)))
            from expenses e where e.household_id = m.household_id and e.deleted_at is null
              and not (e.kind = 'money_back' and exists (select 1 from expenses o where o.id = e.refund_of and o.deleted_at is not null))), 0)
  + coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.from_user = m.user_id), 0)
  - coalesce((select sum(s.amount_pence) from settlements s
              where s.household_id = m.household_id and s.deleted_at is null and s.to_user = m.user_id), 0)
  as net_pence
from members m;

create or replace function member_net_on(p_household uuid, p_user uuid, p_day date) returns bigint
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(case e.kind when 'money_back' then -1 else 1 end
                               * (coalesce((e.paid ->> p_user::text)::bigint, 0) - coalesce((e.shares ->> p_user::text)::bigint, 0)))
                      from expenses e where e.household_id = p_household and e.deleted_at is null and e.date <= p_day
                        and not (e.kind = 'money_back' and exists (select 1 from expenses o where o.id = e.refund_of and o.deleted_at is not null))), 0)
        + coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.from_user = p_user and s.date <= p_day), 0)
        - coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.to_user = p_user and s.date <= p_day), 0))::bigint
$$;
