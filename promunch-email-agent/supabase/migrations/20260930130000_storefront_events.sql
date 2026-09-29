-- ============================================================
-- STOREFRONT EVENTS + browse-abandonment cron
--
-- storefront_events is written by the public /api/public/track route, fed by
-- the PROMUNCH Shopify Web Pixel (shopify-app/extensions/promunch-storefront-pixel):
-- product_viewed, product_added_to_cart, checkout_started. Identity comes from
-- a logged-in customer's email or a signed pm_c token on email links;
-- anonymous rows for the same client_id are back-linked once the visitor is
-- identified.
--
-- email-browse-tick (hourly) enrols identified, consenting viewers who did not
-- add to cart / check out / order into the ACTIVE flow with
-- trigger_type='segment_entry' and trigger_config.segment='browse_abandon'.
-- It never sends; email-flow-tick sends behind its email_sends claim. No active
-- browse flow => nobody is enrolled. The tick also purges rows > 90 days old.
--
-- Security: service-role only (RLS on, no policies, anon/authenticated revoked).
-- Rows hold emails + browsing, i.e. PII.
--
-- Apply by hand in the Supabase dashboard SQL editor (docs/runbooks/MIGRATIONS).
-- Deploy the Next.js app (vercel --prod) BEFORE applying, or the cron 404s.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.storefront_events (
  id          BIGSERIAL PRIMARY KEY,
  client_id   TEXT NOT NULL,
  contact_id  UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  email       TEXT,
  event       TEXT NOT NULL CHECK (event IN ('product_viewed', 'product_added_to_cart', 'checkout_started')),
  product     JSONB,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tick scan (last 24h) + 90-day purge.
CREATE INDEX IF NOT EXISTS idx_storefront_events_created ON public.storefront_events (created_at);
-- Back-link anonymous rows when a client identifies.
CREATE INDEX IF NOT EXISTS idx_storefront_events_client ON public.storefront_events (client_id, created_at);
-- Per-contact / per-email history (dashboard + future flows like price drop).
CREATE INDEX IF NOT EXISTS idx_storefront_events_contact ON public.storefront_events (contact_id, created_at) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_storefront_events_email ON public.storefront_events (email, created_at) WHERE email IS NOT NULL;

ALTER TABLE public.storefront_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_events FROM anon, authenticated;
GRANT ALL ON public.storefront_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.storefront_events_id_seq TO service_role;

-- Cooldown lookup in the tick: browse enrolments per (flow, contact, entered_at).
CREATE INDEX IF NOT EXISTS idx_flow_enrollments_flow_contact_entered
  ON public.flow_enrollments (flow_id, contact_id, entered_at);

-- ---- pg_cron: hourly at :23 (clear of the :X0 stampede, see CRON_TOPOLOGY) ----
select cron.unschedule('email-browse-tick')
where exists (select 1 from cron.job where jobname = 'email-browse-tick');

select cron.schedule(
  'email-browse-tick',
  '23 * * * *',
  $$
  select net.http_post(
    url := 'https://promunch-crm.vercel.app/api/cron/email-browse-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 5000
  );
  $$
);

-- Verify after applying:
--   select relrowsecurity from pg_class where relname = 'storefront_events';           -- t
--   select jobname, schedule, active from cron.job where jobname = 'email-browse-tick'; -- '23 * * * *', t
--   select event, count(*), count(email) identified from storefront_events
--     where created_at > now() - interval '1 day' group by 1;                           -- rows once the pixel is live
