-- wa_templates v2: template approval pipeline (Phase 1).
--
-- Additive + idempotent. Apply by pasting into the Supabase dashboard SQL
-- editor. Safe in either deploy order: wa-template-create retries its writes
-- without these columns if they do not exist yet.
--
-- Columns (names are a contract: wa-webhook also writes rejected_reason_detail,
-- quality_score and previous_category on template status events):
--   quality_score          Meta quality rating: GREEN | YELLOW | RED | UNKNOWN
--   rejected_reason_detail readable rejection text (rejection_reason keeps the code)
--   previous_category      category before Meta re-categorised the template
--   header_samples         example values for {{n}} in a TEXT header (body
--                          samples already live in `variables`)
--   needs_media            media-header template whose file we could not
--                          re-host from Meta; unusable in campaigns until an
--                          image/video/PDF is uploaded
--   pending_edit           reserved for staged edits of an approved template
--                          (the dashboard currently submits edits directly and
--                          never overwrites an approved row with a draft)
--   last_synced_at         last time sync saw this template at Meta

alter table wa_templates add column if not exists quality_score          text;
alter table wa_templates add column if not exists rejected_reason_detail text;
alter table wa_templates add column if not exists previous_category      text;
alter table wa_templates add column if not exists header_samples         jsonb;
alter table wa_templates add column if not exists needs_media            boolean not null default false;
alter table wa_templates add column if not exists pending_edit           jsonb;
alter table wa_templates add column if not exists last_synced_at         timestamptz;

-- ── pg_cron: status polling ─────────────────────────────────────────────────
-- Every 15 minutes at :07/:22/:37/:52 (off the :X0 stampede, see
-- 20260912120000_wa_watchdog_offset.sql). The job only calls Meta when
-- something is waiting for review, or when no sync has run for 6 hours (to
-- pick up quality ratings, pauses and re-categorisations). Otherwise it is a
-- single cheap SELECT.
-- Bearer comes from Vault at run time (same pattern as
-- 20260705100000_cron_jobs_canonical.sql); the secret never sits in the job.
select cron.schedule(
  'wa-template-sync',
  '7-59/15 * * * *',
  $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-template-create',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from wa_templates where status = 'pending')
     or coalesce((select max(last_synced_at) from wa_templates), 'epoch'::timestamptz) < now() - interval '6 hours';$cmd$
);

-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'wa_templates' order by ordinal_position;
--   select jobname, schedule, active from cron.job where jobname = 'wa-template-sync';
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'wa-template-sync')
--     order by start_time desc limit 5;
--   select status_code, left(content, 200), created from net._http_response
--     order by created desc limit 5;
