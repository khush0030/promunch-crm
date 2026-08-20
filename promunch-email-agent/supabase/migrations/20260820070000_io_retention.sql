-- Disk IO budget rescue (Aug 20, 2026).
--
-- Supabase flagged the project for depleting its Disk IO budget. Cause was not
-- a code bug: three log tables grew unbounded for 3 months and one dashboard
-- RPC scanned the worst of them once per cron job.
--
--   cron.job_run_details  293,454 rows / 132 MB, never vacuumed, never analyzed
--   email_logs            174,627 rows / 132 MB (116k of them 'received'/'skipped')
--   connector_events       76,988 rows /  45 MB (66k of them level='info')
--   net._http_response     257 MB of bloat holding 967 live rows
--
-- The historic purge + VACUUM FULL was run by hand (566 MB -> 61 MB). This
-- migration is what keeps it from coming back.

-- 1. assistant_cron_status(): was a lateral "order by start_time desc limit 1"
--    per cron job — 24 separate scans of cron.job_run_details per call, ~3.7 GB
--    of reads for five calls. cron.job_run_details cannot be indexed (owned by
--    supabase_admin), so instead take ONE bounded pass with distinct on.
--    A job that has not run in 2 days reports null, which reads as "stale" on
--    the dashboard exactly like a failure does.
create or replace function public.assistant_cron_status()
returns table(jobname text, schedule text, active boolean, last_status text, last_start timestamptz)
language sql
security definer
set search_path to 'public', 'cron'
as $function$
  with last_run as (
    select distinct on (jobid) jobid, status, start_time
    from cron.job_run_details
    where start_time > now() - interval '2 days'
    order by jobid, start_time desc
  )
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    l.status::text as last_status,
    l.start_time
  from cron.job j
  left join last_run l on l.jobid = j.jobid
  order by j.jobname;
$function$;

-- 2. Retention. Keeps every table bounded so autovacuum can actually hold the
--    line. Errors are swallowed per-table: a purge that cannot run must never
--    take the nightly job (or anything else) down with it.
create or replace function public.purge_operational_logs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'cron'
as $$
declare
  runs bigint := 0;
  logs bigint := 0;
  events bigint := 0;
begin
  -- pg_cron run history: 7 days is plenty for "did the heartbeat fire?"
  begin
    delete from cron.job_run_details
    where end_time < now() - interval '7 days'
       or (end_time is null and start_time < now() - interval '7 days');
    get diagnostics runs = row_count;
  exception when others then
    raise warning 'purge job_run_details failed: %', sqlerrm;
  end;

  -- email intake noise. 'drafted' / 'sent' / 'failed' / 'feedback' are the audit
  -- trail and are kept forever; 'received' / 'skipped' are volume.
  begin
    delete from email_logs
    where created_at < now() - interval '30 days'
      and event_type in ('received', 'skipped');
    get diagnostics logs = row_count;
  exception when others then
    raise warning 'purge email_logs failed: %', sqlerrm;
  end;

  -- connector chatter. warn/error stay: they are what the alerting reads.
  begin
    delete from connector_events
    where created_at < now() - interval '30 days'
      and level = 'info';
    get diagnostics events = row_count;
  exception when others then
    raise warning 'purge connector_events failed: %', sqlerrm;
  end;

  return jsonb_build_object(
    'job_run_details', runs,
    'email_logs', logs,
    'connector_events', events,
    'at', now()
  );
end;
$$;

revoke all on function public.purge_operational_logs() from public, anon, authenticated;

-- 3. Nightly at 03:10 UTC (08:40 IST) — quiet hour, well clear of the 03:30
--    watchdog digest and the 01:30 RFM tick.
select cron.unschedule('purge-operational-logs')
where exists (select 1 from cron.job where jobname = 'purge-operational-logs');

select cron.schedule(
  'purge-operational-logs',
  '10 3 * * *',
  $$select public.purge_operational_logs()$$
);

-- 4. Weekly plain VACUUM (never FULL — no exclusive lock) over the four hot
--    log tables. net._http_response is the reason this exists: pg_net churns
--    ~1,900 rows/day through it but autovacuum touched it twice in 90 days,
--    which is how it reached 257 MB holding 967 rows. One statement, because
--    pg_cron wraps a multi-statement command string in a transaction and
--    VACUUM cannot run inside one.
select cron.unschedule('vacuum-hot-log-tables')
where exists (select 1 from cron.job where jobname = 'vacuum-hot-log-tables');

select cron.schedule(
  'vacuum-hot-log-tables',
  '40 3 * * 0',
  $$vacuum (analyze) net._http_response, public.email_logs, public.connector_events, cron.job_run_details$$
);
