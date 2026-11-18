-- smsm migration 12 (S6b: INS-2 recap wording). The AI's wording of a finished month is kept once per household, so
-- the partner's phone shows the same words and the AI is asked once. Written only through save_recap_prose; members
-- read their own household's rows (the baseline's recaps_read policy).


create or replace function save_recap_prose(p_period text, p_stats jsonb, p_prose text) returns text
language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household(); kept text;
  this_month text := to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM');
begin
  if hid is null then raise exception 'not in a household'; end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'not a month'; end if;
  if p_period >= this_month then raise exception 'only a finished month has its wording kept'; end if;
  if p_prose is null or btrim(p_prose) = '' then raise exception 'no wording'; end if;
  if p_stats is null then raise exception 'no figures'; end if;
  -- Two short sentences and a month's figures: nothing bigger is kept.
  if octet_length(p_prose) > 2000 then raise exception 'wording too long'; end if;
  if pg_column_size(p_stats) > 16384 then raise exception 'figures too large'; end if;
  insert into recaps(household_id, period, stats, prose) values (hid, p_period, p_stats, p_prose)
  on conflict (household_id, period) do nothing;  -- the primary key: once per household per month
  select prose into kept from recaps where household_id = hid and period = p_period;
  return kept;
end $$;
revoke execute on function save_recap_prose(text, jsonb, text) from public, anon;
grant execute on function save_recap_prose(text, jsonb, text) to authenticated;
