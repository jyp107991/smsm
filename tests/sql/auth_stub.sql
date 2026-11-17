-- Minimal stand-in for Supabase's auth schema, for testing supabase/schema.sql on plain PostgreSQL 16.
-- auth.uid() reads request.jwt.claim.sub, which the tests set per "user".
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Like Supabase: functions created in public are granted to the API roles by default. The migrations must
-- take that away where it isn't wanted (anon), so the tests run against the worse case.
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
on conflict do nothing;
-- Like Supabase: the publication Realtime reads exists (empty) before the migrations run.
set client_min_messages = error;   -- plain PostgreSQL warns that wal_level isn't logical; irrelevant here
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
reset client_min_messages;
