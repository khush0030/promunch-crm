-- Schedule wa-unanswered: the customer-side smoke alarm.
--
-- Every other WhatsApp monitor watches the machinery (API reachable, heartbeat
-- alive, sends succeeding, jobs not dead-lettered). On 2026-09-05 all of them
-- were green while a customer sat unanswered, because the reply run threw
-- AFTER taking the per-turn claim: no send failed and no job gave up. This job
-- checks the one thing that actually matters, that an inbound message got an
-- answer, and alerts with a diagnosis when it did not.
--
-- Runs every 5 minutes; it only alerts once per thread per 6 hours, so a
-- sustained outage is one standing Slack item rather than a message every tick.
--
-- Apply by pasting into the Supabase dashboard SQL editor. Idempotent
-- (cron.schedule upserts by jobname).
-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'wa-unanswered';
--   select created_at, message from connector_events
--     where event = 'reply_missing' order by created_at desc limit 10;
--
-- Knowledge gaps are recorded by the same deploy (event 'kb_miss', level warn,
-- no alert). Review them with:
--   select detail->>'question' as question, count(*)
--   from connector_events
--   where connector = 'whatsapp' and event = 'kb_miss'
--     and created_at > now() - interval '7 days'
--   group by 1 order by 2 desc;

select cron.schedule(
  'wa-unanswered',
  '*/5 * * * *',
  $cmd$select net.http_post(
    url := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-unanswered',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );$cmd$
);
