-- smsm migration 7 (S3, REC-2): the nightly job. Regular payments post even when neither phone opens: pg_cron
-- runs post_due_recurring for every household once a night. Nothing leaves the database (no secret, no HTTP).
--
-- 01:17 UTC is 01:17 in London in winter and 02:17 in summer: after midnight on the UK date either way, and off
-- the hour (Supabase's busiest minute). The job runs as the database owner with no sign-in, which
-- post_due_recurring allows for a named household (migration 2).
--
-- pg_cron is enabled only where the server has it (Supabase; Supabase docs, "Cron → Install": create extension
-- pg_cron with schema pg_catalog). Plain PostgreSQL (the SQL tests) has a stand-in `cron` schema
-- (tests/sql/auth_stub.sql). Scheduling by name is an upsert, so applying this twice leaves one job.
do $$
begin
  if to_regnamespace('cron') is null and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      -- e.g. not this server's cron database, or not preloaded: the phones still post on open (REC-2).
      raise notice 'pg_cron not enabled here: %', sqlerrm;
    end;
  end if;
  if to_regnamespace('cron') is not null then
    perform cron.schedule('smsm-recurring', '17 1 * * *', 'select post_due_recurring(id) from households');
  end if;
end $$;
