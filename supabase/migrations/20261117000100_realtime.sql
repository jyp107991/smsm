-- smsm migration 4 (S2): the partner's phone hears changes within seconds (DATA_MODEL §6).
-- Supabase Realtime streams changes only for tables in the `supabase_realtime` publication. Row-level
-- security still applies to every subscriber, so each phone hears only its own household.
-- Guarded, so it is safe to apply twice and on a plain PostgreSQL without the publication.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['households','members','categories','expenses','settlements','change_requests'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
