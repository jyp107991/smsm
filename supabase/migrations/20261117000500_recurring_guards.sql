-- smsm migration 8 (S3 fresh review): a regular payment never back-posts or skips money when it is edited,
-- paused and resumed, or ended and restarted. The database enforces it, so no phone (old, offline, or wrong)
-- can get round it.
--
-- posted_count counts the occurrences already posted, numbered from start_date with the template's step.
--  1. A new rhythm (frequency, every) or a new start on a template that has posted applies from its next
--     occurrence on: start_date moves to the later of the day picked and the old schedule's next day, and the
--     count starts again from 0. Posted days never move (REC-6: an edit changes future occurrences only).
--  2. Resumed (active false → true): what fell due while it was paused is skipped, not posted in a run of
--     back-dated entries ("Paused. Nothing posts until you resume it."). Moving an end date later is an edit of
--     the schedule itself: the days it now covers post (REC-6's SQL test).
--  3. posted_count is the server's: a signed-in phone can't set it (only post_due_recurring, as the owner, moves it).
create or replace function recurring_step(p_frequency text, p_every int) returns interval
language sql immutable set search_path = public as $$
  select case p_frequency when 'weekly' then make_interval(weeks => p_every)
                          when 'monthly' then make_interval(months => p_every)
                          else make_interval(years => p_every) end
$$;

create or replace function recurring_guard() returns trigger
language plpgsql set search_path = public as $$
declare uk_today date := (now() at time zone 'Europe/London')::date; nxt date; n int := 0;
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then new.posted_count := 0; end if;
    return new;
  end if;
  if current_user = 'authenticated' and new.posted_count is distinct from old.posted_count then
    raise exception 'posted_count is kept by the server' using errcode = '42501';
  end if;
  if old.posted_count > 0 and (new.frequency, new.every, new.start_date) is distinct from (old.frequency, old.every, old.start_date) then
    nxt := (old.start_date + recurring_step(old.frequency, old.every) * old.posted_count)::date;
    new.start_date := greatest(new.start_date, nxt);
    new.posted_count := 0;
  end if;
  if not old.active and new.active then
    loop
      exit when (new.start_date + recurring_step(new.frequency, new.every) * new.posted_count)::date >= uk_today or n >= 10000;
      new.posted_count := new.posted_count + 1;
      n := n + 1;
    end loop;
  end if;
  return new;
end $$;
revoke execute on function recurring_guard() from public, anon, authenticated;

drop trigger if exists recurring_guard on recurring;
create trigger recurring_guard before insert or update on recurring for each row execute function recurring_guard();

-- The nightly job posts household by household: one household's failure (a template the money checks refuse)
-- is reported and never stops the others' bills.
create or replace function post_due_recurring_all() returns int
language plpgsql security definer set search_path = public as $$
declare h uuid; total int := 0;
begin
  for h in select id from households order by id loop
    begin
      total := total + post_due_recurring(h);
    exception when others then
      raise warning 'post_due_recurring failed for household %: %', h, sqlerrm;
    end;
  end loop;
  return total;
end $$;
revoke execute on function post_due_recurring_all() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('smsm-recurring', '17 1 * * *', 'select post_due_recurring_all()');
  end if;
end $$;
