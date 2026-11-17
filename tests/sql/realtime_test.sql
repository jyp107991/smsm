-- Checks for migration 20261117000100_realtime: the tables the phones listen to are published.
reset role;
select count(*) = 6 as ok_realtime_tables_published from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('households','members','categories','expenses','settlements','change_requests');
select count(*) = 0 as ok_operational_tables_not_published from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename in ('client_errors','join_attempts','ai_usage','app_config');
