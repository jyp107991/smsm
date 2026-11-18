-- smsm migration (S8; NOT-1, NOT-2, NOT-3, ACT-4, INB-2): notifications, with nothing for the owner to set up.
--
-- The database fills an outbox (never a phone): triggers at once for the partner's changes, a daily job for bills,
-- the recap, settle day and the balance reminder. The push Edge Function (supabase/functions/push) drains it:
-- the database calls it through pg_net with a random token it made itself (push_config.token), and the function
-- reads that token, and keeps the VAPID key pair it made on its first run, in push_config with its own secret key.
-- Nothing in push_config, the outbox or the bookkeeping tables is readable by a phone. The public key is read
-- through push_public_key().
--
-- Who hears what: the recipient is always the other member; nothing is ever queued for the person who made the
-- change (auth.uid()); a change with no one signed in (the nightly posting, the database owner) queues nothing at
-- once; a restore from a backup queues nothing. Each person's switches (notification_prefs) are applied when the
-- function picks what to send (next_notifications); approvals are always on.
--
-- Where the server has no pg_net (the SQL tests' plain PostgreSQL), kick_push() does nothing, so no change ever
-- waits on it or fails because of it.

-- ───────── pg_net, where the server has it (Supabase: create extension pg_net with schema extensions) ─────────
do $$
begin
  if to_regnamespace('net') is null and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create schema if not exists extensions;
      create extension if not exists pg_net with schema extensions;
    exception when others then
      raise notice 'pg_net not enabled here: %', sqlerrm;
    end;
  end if;
end $$;

-- ───────── the function's own settings: one row, no client role may read it ─────────
create table push_config (
  id boolean primary key default true check (id),
  -- Filled in by the push function on its first run (?init=1): base64url of the raw P-256 point, and the private
  -- key's JWK as text. Never replaced once there (the phones' subscriptions are made with this public key).
  vapid_public text,
  vapid_private text,
  -- Made by the database itself: proves a call to the function is the database's.
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (length(token) >= 32),
  function_url text check (function_url is null or function_url like 'https://%'),
  updated_at timestamptz not null default now()
);
insert into push_config default values;
alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;
grant select, insert, update on push_config to service_role;

-- ───────── this person's phones ─────────
-- The push services browsers use (Chrome/Android, Firefox, Safari/Apple, Edge/Windows): a push is only ever sent there.
create function push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(length(p_endpoint) <= 2048
    and substring(p_endpoint from '^https://([^/:?#\s]+)/') ~ '^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)$',
    false)
$$;
revoke all on function push_endpoint_ok(text) from public, anon, authenticated, service_role;

create table push_subscriptions (
  endpoint text primary key check (push_endpoint_ok(endpoint)),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 200),
  created_at timestamptz not null default now(),
  -- A push service last took a push; it has refused them (other than "busy" or "down") since this time.
  last_ok_at timestamptz,
  failing_since timestamptz
);
create index push_subscriptions_user on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
create policy push_subscriptions_own on push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on push_subscriptions from anon, authenticated;
grant select on push_subscriptions to authenticated;
grant select, update, delete on push_subscriptions to service_role;

-- ───────── this person's switches (no row: the defaults) ─────────
create table notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entries boolean not null default true,
  settle_ups boolean not null default true,
  comments boolean not null default true,
  bills_today boolean not null default true,
  bills_tomorrow boolean not null default false,
  recap boolean not null default true,
  balance boolean not null default false,
  balance_threshold_pence bigint not null default 10000 check (balance_threshold_pence > 0 and balance_threshold_pence <= 100000000),
  updated_at timestamptz not null default now()
);
alter table notification_prefs enable row level security;
create policy notification_prefs_own on notification_prefs for select to authenticated using (user_id = auth.uid());
revoke all on notification_prefs from anon, authenticated;
grant select on notification_prefs to authenticated;
grant select on notification_prefs to service_role;

-- ───────── the outbox: filled by the database, drained by the function ─────────
create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  recipient uuid not null,
  -- Who did it (null for the daily ones).
  actor uuid,
  kind text not null check (kind in ('entry_added', 'entry_changed', 'entry_deleted', 'entry_restored', 'settle_added',
    'settle_changed', 'settle_deleted', 'comment', 'approval_waiting', 'approval_decided', 'bill_posted', 'bill_tomorrow',
    'recap_ready', 'settle_day', 'balance_reminder')),
  -- The entry, settle-up or change request; for a comment, the entry it is on; for a bill tomorrow, the template.
  ref_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  -- Handed to the function (next_notifications); not handed out again for 2 minutes, so the change's own call and
  -- the minute's run never both send it. Not marked sent by then (a push service was down): handed out again.
  claimed_at timestamptz,
  sent_at timestamptz
);
create index notification_outbox_waiting on notification_outbox(created_at, id) where sent_at is null;
create index notification_outbox_sent on notification_outbox(sent_at) where sent_at is not null;
alter table notification_outbox enable row level security;
revoke all on notification_outbox from anon, authenticated;

-- The daily job's own bookkeeping: the London dates it has run, and when each person was last reminded of the
-- balance (at most once every 30 days while it stays above their amount).
create table notification_daily_runs (day date primary key, at timestamptz not null default now());
alter table notification_daily_runs enable row level security;
revoke all on notification_daily_runs from anon, authenticated;
create table notification_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_sent date not null
);
alter table notification_reminders enable row level security;
revoke all on notification_reminders from anon, authenticated;

-- ───────── the phones' calls ─────────
create function push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select vapid_public from push_config where id
$$;
revoke all on function push_public_key() from public, anon;
grant execute on function push_public_key() to authenticated;

-- Upsert by endpoint: an endpoint another account had (the same phone, someone else signed in) moves to the caller.
-- An endpoint someone else had moves to the caller only on the same phone handed over within the household: the
-- caller must be in the same household and present the subscription's own keys (which only that phone's browser
-- has). An endpoint of another household's account is never taken.
create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); old push_subscriptions;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not push_endpoint_ok(p_endpoint) then raise exception 'that is not a push address'; end if;
  if coalesce(length(p_p256dh), 0) not between 1 and 200 or coalesce(length(p_auth), 0) not between 1 and 200 then
    raise exception 'the subscription''s keys are missing';
  end if;
  select * into old from push_subscriptions where endpoint = p_endpoint for update;
  if old.endpoint is null then
    insert into push_subscriptions(endpoint, user_id, p256dh, auth) values (p_endpoint, uid, p_p256dh, p_auth)
    on conflict (endpoint) do nothing;
  elsif old.user_id = uid then
    update push_subscriptions set p256dh = p_p256dh, auth = p_auth where endpoint = p_endpoint;
  else
    if (select household_id from members where user_id = old.user_id) is distinct from my_household() or my_household() is null then
      raise exception 'that push address belongs to someone else';
    end if;
    if old.p256dh <> p_p256dh or old.auth <> p_auth then
      raise exception 'that push address belongs to someone else';
    end if;
    update push_subscriptions set user_id = uid, created_at = now(), failing_since = null where endpoint = p_endpoint;
  end if;
end $$;
revoke all on function save_push_subscription(text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text) to authenticated;

-- Only the caller's own: turning this phone off never touches anyone else's.
create function remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;
revoke all on function remove_push_subscription(text) from public, anon;
grant execute on function remove_push_subscription(text) to authenticated;

-- Writes the caller's own row, only the keys given (the others keep their values or the defaults).
create function set_notification_prefs(p jsonb) returns notification_prefs
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k text; v numeric; r notification_prefs;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'preferences must be an object'; end if;
  for k in select jsonb_object_keys(p) loop
    if k in ('entries', 'settle_ups', 'comments', 'bills_today', 'bills_tomorrow', 'recap', 'balance') then
      if jsonb_typeof(p -> k) <> 'boolean' then raise exception 'a switch is on or off'; end if;
    elsif k = 'balance_threshold_pence' then
      if jsonb_typeof(p -> k) <> 'number' then raise exception 'the amount is a whole number of pence above zero'; end if;
      v := (p ->> k)::numeric;
      if v <> trunc(v) or v <= 0 or v > 100000000 then raise exception 'the amount is a whole number of pence above zero'; end if;
    else
      raise exception 'no such notification setting: %', k;
    end if;
  end loop;
  insert into notification_prefs(user_id) values (uid) on conflict (user_id) do nothing;
  update notification_prefs set
    entries = coalesce((p ->> 'entries')::boolean, entries),
    settle_ups = coalesce((p ->> 'settle_ups')::boolean, settle_ups),
    comments = coalesce((p ->> 'comments')::boolean, comments),
    bills_today = coalesce((p ->> 'bills_today')::boolean, bills_today),
    bills_tomorrow = coalesce((p ->> 'bills_tomorrow')::boolean, bills_tomorrow),
    recap = coalesce((p ->> 'recap')::boolean, recap),
    balance = coalesce((p ->> 'balance')::boolean, balance),
    balance_threshold_pence = coalesce((p ->> 'balance_threshold_pence')::bigint, balance_threshold_pence),
    updated_at = now()
  where user_id = uid
  returning * into r;
  return r;
end $$;
revoke all on function set_notification_prefs(jsonb) from public, anon;
grant execute on function set_notification_prefs(jsonb) to authenticated;

-- ───────── calling the function ─────────
-- A POST to the function with the database's token, through pg_net (sent once the transaction commits). Nothing
-- else travels in the request. A no-op without pg_net, before the function has recorded its address, or with
-- nothing waiting; never raises, so it never stops a change being saved.
create function kick_push() returns void
language plpgsql security definer set search_path = public as $$
declare c push_config;
begin
  if to_regnamespace('net') is null then return; end if;
  if not exists (select 1 from notification_outbox where sent_at is null) then return; end if;
  select * into c from push_config where id;
  if c.function_url is null or c.token is null then return; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
      using c.function_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-push-token', c.token), 10000;
  exception when others then
    raise warning 'kick_push: %', sqlerrm;
  end;
end $$;
revoke all on function kick_push() from public, anon, authenticated, service_role;

-- One row per other member, never the actor; a change with no actor, or during a restore, queues nothing.
-- The function is called once per transaction (pg_net sends after commit, so it sees every row queued).
create function queue_notification(p_household uuid, p_actor uuid, p_kind text, p_ref uuid, p_payload jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_recipient uuid; v_any boolean := false;
begin
  if p_actor is null or p_household is null then return; end if;
  if coalesce(current_setting('smsm.restoring', true), '') = 'on' then return; end if;
  for v_recipient in select user_id from members where household_id = p_household and user_id <> p_actor loop
    insert into notification_outbox(household_id, recipient, actor, kind, ref_id, payload)
    values (p_household, v_recipient, p_actor, p_kind, p_ref, coalesce(p_payload, '{}'));
    v_any := true;
  end loop;
  if v_any and current_setting('smsm.push_kicked', true) is distinct from 'on' then
    perform set_config('smsm.push_kicked', 'on', true);
    perform kick_push();
  end if;
end $$;
revoke all on function queue_notification(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;

-- ───────── at once: the partner's changes ─────────
-- An entry added, changed (a real change: a replayed write that changes nothing tells nobody), deleted or restored.
-- The database's own posting of regular payments (post_due_recurring, from the nightly job or a phone on open) is
-- never "added": "posted today" covers it. A bill kept from the Inbox is a person's entry like any other.
-- A change says what changed (payload.fields), so its words can say "moved Tesco to Eating out".
create function notify_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_payload jsonb := '{}'; v_fields jsonb;
begin
  if auth.uid() is null then return null; end if;
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
create trigger expenses_notify after insert or update on expenses for each row execute function notify_expense();

create function notify_settlement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then return null; end if;
    v_kind := 'settle_added';
  elsif old.deleted_at is null and new.deleted_at is not null then
    v_kind := 'settle_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    v_kind := 'settle_added';   -- restored: it counts again, as a settle-up
  elsif new.deleted_at is not null then
    return null;
  elsif (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  else
    v_kind := 'settle_changed';
  end if;
  perform queue_notification(new.household_id, auth.uid(), v_kind, new.id);
  return null;
end $$;
create trigger settlements_notify after insert or update on settlements for each row execute function notify_settlement();

create function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.deleted_at is not null then return null; end if;
  perform queue_notification(new.household_id, auth.uid(), 'comment', new.expense_id, jsonb_build_object('comment_id', new.id));
  return null;
end $$;
create trigger comments_notify after insert on comments for each row execute function notify_comment();

-- A request waiting (to the partner); a decision (to the one who asked). Cancelling one's own tells nobody.
create function notify_change_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    if new.status = 'pending' then perform queue_notification(new.household_id, auth.uid(), 'approval_waiting', new.id); end if;
  elsif old.status = 'pending' and new.status in ('approved', 'declined') and new.requested_by <> auth.uid() then
    perform queue_notification(new.household_id, auth.uid(), 'approval_decided', new.id);
  end if;
  return null;
end $$;
create trigger change_requests_notify after insert or update on change_requests for each row execute function notify_change_request();

-- ───────── what the function sends ─────────
-- Whether a person has this kind switched on (no row: the defaults); approvals always.
create function notification_enabled(p_user uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_kind in ('approval_waiting', 'approval_decided') then true
    when p_kind in ('entry_added', 'entry_changed', 'entry_deleted', 'entry_restored') then coalesce((select entries from notification_prefs where user_id = p_user), true)
    when p_kind in ('settle_added', 'settle_changed', 'settle_deleted') then coalesce((select settle_ups from notification_prefs where user_id = p_user), true)
    when p_kind = 'comment' then coalesce((select comments from notification_prefs where user_id = p_user), true)
    when p_kind = 'bill_posted' then coalesce((select bills_today from notification_prefs where user_id = p_user), true)
    when p_kind = 'bill_tomorrow' then coalesce((select bills_tomorrow from notification_prefs where user_id = p_user), false)
    when p_kind in ('recap_ready', 'settle_day') then coalesce((select recap from notification_prefs where user_id = p_user), true)
    when p_kind = 'balance_reminder' then coalesce((select balance from notification_prefs where user_id = p_user), false)
    else false
  end
$$;
revoke all on function notification_enabled(uuid, text) from public, anon, authenticated, service_role;

-- src/core/notify.ts's NotificationData for one row, from the database at send time; the balance is member_net now.
create function notification_data(o notification_outbox) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; v_balance jsonb; e expenses; s settlements; cr change_requests; r recurring; v_body text;
begin
  select coalesce(jsonb_object_agg(user_id::text, net_pence::bigint), '{}') into v_balance from member_net where household_id = o.household_id;
  d := jsonb_build_object('actor', o.actor, 'ref', o.ref_id, 'balance', v_balance);
  if o.kind in ('entry_added', 'entry_changed', 'entry_deleted', 'entry_restored', 'bill_posted') then
    select * into e from expenses where id = o.ref_id;
    d := d || jsonb_build_object('description', e.description, 'amount', e.amount_pence);
    -- A change: the amount (the words give the new one), only the category, or other details.
    if o.kind = 'entry_changed' and jsonb_typeof(o.payload -> 'fields') = 'array' then
      if o.payload -> 'fields' ? 'amount_pence' then
        d := d || jsonb_build_object('change', 'amount');
      elsif o.payload -> 'fields' = '["category_id"]'::jsonb then
        d := d || jsonb_build_object('change', 'category', 'category', (select c.name from categories c where c.id = e.category_id));
      else
        d := d || jsonb_build_object('change', 'details');
      end if;
    end if;
  elsif o.kind in ('settle_added', 'settle_changed', 'settle_deleted') then
    select * into s from settlements where id = o.ref_id;
    d := d || jsonb_build_object('amount', s.amount_pence, 'from', s.from_user);
  elsif o.kind = 'comment' then
    select * into e from expenses where id = o.ref_id;
    select body into v_body from comments where id = (o.payload ->> 'comment_id')::uuid;
    d := d || jsonb_build_object('description', e.description, 'comment', v_body, 'commentId', o.payload ->> 'comment_id');
  elsif o.kind in ('approval_waiting', 'approval_decided') then
    select * into cr from change_requests where id = o.ref_id;
    d := d || jsonb_build_object('request', cr.kind, 'approved', cr.status = 'approved');
  elsif o.kind = 'bill_tomorrow' then
    select * into r from recurring where id = o.ref_id;
    d := d || jsonb_build_object('description', r.description, 'amount', r.amount_pence, 'varies', r.amount_varies);
  elsif o.kind = 'recap_ready' then
    d := d || jsonb_build_object('month', o.payload ->> 'month');
  elsif o.kind = 'balance_reminder' then
    d := d || jsonb_build_object('threshold', (o.payload ->> 'threshold')::bigint);
  end if;
  return jsonb_strip_nulls(d);
end $$;
revoke all on function notification_data(notification_outbox) from public, anon, authenticated, service_role;

-- At most p_limit unsent rows, oldest first, only kinds the recipient has switched on (the rest are done, unsent);
-- each with its words' data, both names, the actor's animal and the recipient's badge count (open Inbox items and
-- change requests waiting for them). Tidies as it goes: unsent after 2 days dropped, sent after 7 days removed.
create function next_notifications(p_limit int) returns table(id uuid, recipient uuid, kind text, data jsonb, names jsonb, animal text, badge int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  delete from notification_outbox o where o.sent_at is null and o.created_at < now() - interval '2 days';
  delete from notification_outbox o where o.sent_at is not null and o.sent_at < now() - interval '7 days';
  update notification_outbox o set sent_at = now() where o.sent_at is null and not notification_enabled(o.recipient, o.kind);
  -- A balance reminder whose balance has come back within the person's amount since it was queued says nothing.
  update notification_outbox o set sent_at = now()
   where o.sent_at is null and o.kind = 'balance_reminder'
     and coalesce((select abs(b.net_pence) from member_net b where b.household_id = o.household_id and b.user_id = o.recipient), 0)
         <= coalesce((o.payload ->> 'threshold')::bigint, 0);
  return query
  with picked as (
    select o.id from notification_outbox o
     where o.sent_at is null and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
     order by o.created_at, o.id
     limit greatest(coalesce(p_limit, 0), 0)
     for update skip locked
  ), claimed as (
    update notification_outbox o set claimed_at = now() from picked where o.id = picked.id returning o.*
  )
  select c.id, c.recipient, c.kind, notification_data(c::notification_outbox),
         (select coalesce(jsonb_object_agg(m.user_id::text, m.display_name), '{}') from members m where m.household_id = c.household_id),
         (select m.animal from members m where m.household_id = c.household_id and m.user_id = c.actor),
         ((select count(*) from inbox_items i where i.household_id = c.household_id and i.status = 'open')
          + (select count(*) from change_requests q where q.household_id = c.household_id and q.status = 'pending' and q.requested_by <> c.recipient))::int
    from claimed c
   order by c.created_at, c.id;
end $$;
revoke all on function next_notifications(int) from public, anon, authenticated;
grant execute on function next_notifications(int) to service_role;

create function mark_notifications_sent(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update notification_outbox set sent_at = now() where id = any(p_ids) and sent_at is null
$$;
revoke all on function mark_notifications_sent(uuid[]) from public, anon, authenticated;
grant execute on function mark_notifications_sent(uuid[]) to service_role;

-- What a push service said to a push (the function, after each one): taken, the subscription is well; refused (not
-- "busy" or "down", which the function doesn't report), it is failing, and after 24 hours of that with no push taken
-- since, it is forgotten. Gone (404, 410) is removed straight away by the function.
create function note_push_result(p_endpoint text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update push_subscriptions set last_ok_at = now(), failing_since = null where endpoint = p_endpoint;
  else
    update push_subscriptions set failing_since = coalesce(failing_since, now()) where endpoint = p_endpoint;
    delete from push_subscriptions where endpoint = p_endpoint and failing_since < now() - interval '24 hours';
  end if;
end $$;
revoke all on function note_push_result(text, boolean) from public, anon, authenticated;
grant execute on function note_push_result(text, boolean) to service_role;

-- ───────── daily: bills, the recap, settle day, the balance reminder ─────────
-- One person's net on a day, by the entries' and settle-ups' own dates (as a statement reads it; member_net's sum).
create function member_net_on(p_household uuid, p_user uuid, p_day date) returns bigint
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(case e.kind when 'money_back' then -1 else 1 end
                               * (coalesce((e.paid ->> p_user::text)::bigint, 0) - coalesce((e.shares ->> p_user::text)::bigint, 0)))
                      from expenses e where e.household_id = p_household and e.deleted_at is null and e.date <= p_day), 0)
        + coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.from_user = p_user and s.date <= p_day), 0)
        - coalesce((select sum(s.amount_pence) from settlements s
                     where s.household_id = p_household and s.deleted_at is null and s.to_user = p_user and s.date <= p_day), 0))::bigint
$$;
revoke all on function member_net_on(uuid, uuid, date) from public, anon, authenticated, service_role;

-- Runs at 07:07 and 08:07 UTC; does its work only in the 08:00 hour in London, once per London date.
create function queue_daily_notifications(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare v_local timestamp := p_now at time zone 'Europe/London'; d date := (p_now at time zone 'Europe/London')::date;
        n int := 0; c int;
begin
  if extract(hour from v_local) <> 8 then return 0; end if;
  insert into notification_daily_runs(day) values (d) on conflict do nothing;
  if not found then return 0; end if;
  delete from notification_daily_runs where day < d - 400;

  -- A shared regular payment posted today: both.
  insert into notification_outbox(household_id, recipient, kind, ref_id, payload)
  select e.household_id, m.user_id, 'bill_posted', e.id, jsonb_build_object('recurring_id', e.recurring_id)
    from expenses e join members m on m.household_id = e.household_id
   where e.recurring_id is not null and e.source = 'recurring' and e.occurrence_date = d and e.deleted_at is null
     and (select count(*) from members x where x.household_id = e.household_id) = 2
     and not exists (select 1 from notification_outbox a where a.kind = 'bill_posted' and a.ref_id = e.id);
  get diagnostics c = row_count; n := n + c;

  -- A shared bill posts tomorrow (its next occurrence): both (most have the switch off).
  insert into notification_outbox(household_id, recipient, kind, ref_id)
  select r.household_id, m.user_id, 'bill_tomorrow', r.id
    from recurring r join members m on m.household_id = r.household_id
   where r.active and (r.end_date is null or r.end_date >= d + 1)
     and exists (select 1 from generate_series(r.posted_count, r.posted_count + 3) k
                  where (r.start_date + recurring_step(r.frequency, r.every) * k)::date = d + 1)
     and (select count(*) from members x where x.household_id = r.household_id) = 2;
  get diagnostics c = row_count; n := n + c;

  -- The 1st: last month's recap, where last month has something in it.
  if extract(day from d) = 1 then
    insert into notification_outbox(household_id, recipient, kind, payload)
    select h.id, m.user_id, 'recap_ready', jsonb_build_object('month', to_char(d - 1, 'YYYY-MM'))
      from households h join members m on m.household_id = h.id
     where (select count(*) from members x where x.household_id = h.id) = 2
       and exists (select 1 from expenses e where e.household_id = h.id and e.deleted_at is null
                     and e.date between date_trunc('month', d - 1)::date and d - 1);
    get diagnostics c = row_count; n := n + c;
  end if;

  -- Settle day, unless the two are square.
  insert into notification_outbox(household_id, recipient, kind)
  select h.id, m.user_id, 'settle_day'
    from households h join members m on m.household_id = h.id
   where h.settle_day = extract(day from d)
     and (select count(*) from members x where x.household_id = h.id) = 2
     and exists (select 1 from member_net b where b.household_id = h.id and b.net_pence <> 0);
  get diagnostics c = row_count; n := n + c;

  -- The balance above a person's chosen amount (the same way round) on each of the last 30 days: that person, at
  -- most once every 30 days.
  with due as (
    select m.household_id, m.user_id, p.balance_threshold_pence as threshold
      from members m join notification_prefs p on p.user_id = m.user_id and p.balance
     where (select count(*) from members x where x.household_id = m.household_id) = 2
       and not exists (select 1 from notification_reminders r where r.user_id = m.user_id and r.last_sent > d - 30)
       and (select bool_and(q.net > p.balance_threshold_pence) or bool_and(q.net < -p.balance_threshold_pence)
              from (select member_net_on(m.household_id, m.user_id, x::date) as net
                      from generate_series(d - 29, d, interval '1 day') x) q)
  ), queued as (
    insert into notification_outbox(household_id, recipient, kind, payload)
    select household_id, user_id, 'balance_reminder', jsonb_build_object('threshold', threshold) from due
    returning recipient
  )
  insert into notification_reminders(user_id, last_sent) select recipient, d from queued
  on conflict (user_id) do update set last_sent = excluded.last_sent;
  get diagnostics c = row_count; n := n + c;

  if n > 0 then perform kick_push(); end if;
  return n;
end $$;
revoke all on function queue_daily_notifications(timestamptz) from public, anon, authenticated, service_role;

-- ───────── regular payments posted by the database ─────────
-- post_due_recurring (unchanged otherwise: migration 20261117000500) marks its own posting (smsm.posting, for this
-- transaction), so what it posts is never "Sam added Rent" at once, whether the nightly job or a phone on open ran it:
-- "posted today" (the daily job at 08:07 London time) covers it. An occurrence of today posted after that run (a
-- phone opening later) is announced at once instead, to both, so it is never missed; never twice.
create or replace function post_due_recurring(p_household uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r recurring; d date; step interval; posted int := 0; hid uuid; home char(2); v_id uuid; v_late boolean;
        uk_today date := (now() at time zone 'Europe/London')::date;
begin
  if auth.uid() is not null and p_household is not null and p_household is distinct from my_household() then
    raise exception 'not your household';
  end if;
  if auth.uid() is null and current_setting('role', true) in ('anon', 'authenticated') then
    raise exception 'not signed in';
  end if;
  hid := coalesce(p_household, my_household());
  if hid is null then return 0; end if;
  perform set_config('smsm.posting', 'on', true);
  v_late := exists (select 1 from notification_daily_runs where day = uk_today)
            and (select count(*) from members x where x.household_id = hid) = 2;
  select home_country into home from households where id = hid;
  for r in select * from recurring where household_id = hid and active order by id for update loop
    step := case r.frequency when 'weekly' then make_interval(weeks => r.every)
                             when 'monthly' then make_interval(months => r.every)
                             else make_interval(years => r.every) end;
    loop
      d := (r.start_date + step * r.posted_count)::date;
      exit when d > uk_today or (r.end_date is not null and d > r.end_date);
      if r.amount_varies then
        insert into inbox_items(household_id, source, recurring_id, occurrence_date, payload)
        values (r.household_id, 'bill', r.id, d, jsonb_build_object('description', r.description,
                'estimate_pence', r.amount_pence, 'date', d, 'category_id', r.category_id))
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
          select hid, m.user_id, 'bill_posted', v_id, jsonb_build_object('recurring_id', r.id) from members m where m.household_id = hid;
        end if;
      end if;
      r.posted_count := r.posted_count + 1;
      posted := posted + 1;
    end loop;
    update recurring set posted_count = r.posted_count where id = r.id and posted_count is distinct from r.posted_count;
  end loop;
  perform set_config('smsm.posting', 'off', true);
  if v_late then perform kick_push(); end if;
  return posted;
end $$;
revoke execute on function post_due_recurring(uuid) from public, anon;
grant execute on function post_due_recurring(uuid) to authenticated;

-- ───────── the smoke test can see the keys are there ─────────
-- push_public_key() is for signed-in phones only, and the deploy's smoke test has only the publishable key, so
-- health() (open to anon) also says whether the function has made its keys. It says nothing else about them.
create or replace function health() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'min_client_version', (select value from app_config where key = 'min_client_version'),
                            'push', exists (select 1 from push_config where id and vapid_public is not null))
$$;

-- ───────── the schedule (where pg_cron is: Supabase; the SQL tests' stand-in) ─────────
-- Every minute: anything the change's own call missed. 07:07 and 08:07 UTC: one of them is 08:07 in London.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('smsm-push', '* * * * *', 'select kick_push()');
    perform cron.schedule('smsm-notify-daily', '7 7,8 * * *', 'select queue_daily_notifications()');
  end if;
end $$;
