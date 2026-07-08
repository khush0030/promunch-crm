-- WhatsApp campaign scheduler on Supabase pg_cron (Hobby-plan replacement for
-- the Vercel */15 cron). Paste once into the Supabase SQL Editor.
-- Fires every 15 min: atomically claims any 'scheduled' campaign whose time has
-- passed (status -> 'sending') and kicks wa-campaign-send, which self-chains
-- until the whole list is sent. The UPDATE...RETURNING is the claim, so two
-- ticks can never fire the same campaign twice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'wa-campaign-tick',
  '*/15 * * * *',
  $$
    with due as (
      update wa_campaigns
         set status = 'sending', started_at = now(), last_error = null
       where status = 'scheduled'
         and scheduled_at <= now()
      returning id
    )
    select net.http_post(
      url     := 'https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-campaign-send',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('campaign_id', id, '_continue', true)
    )
    from due;
  $$
);

-- verify it's registered:
select jobid, schedule, jobname from cron.job where jobname = 'wa-campaign-tick';
