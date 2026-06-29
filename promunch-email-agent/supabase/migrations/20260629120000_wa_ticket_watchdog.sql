-- Ticket SLA watchdog state.
--
-- The watchdog (wa-ticket-watchdog) re-pings the team about any open/pending
-- ticket that is past its SLA and still unowned, escalating until a human
-- claims it in the dashboard. These two columns let it nag on a sane cadence
-- (once per SLA window) instead of every 15-minute tick.
--
--   ticket_last_alert_at — when the watchdog last paged the team about this ticket
--   ticket_alert_count   — how many times it has paged (drives "1st/2nd/3rd reminder")
--
-- Run in the Supabase dashboard SQL editor (migrations apply via the dashboard,
-- not the CLI, on this project).

alter table wa_threads
  add column if not exists ticket_last_alert_at timestamptz,
  add column if not exists ticket_alert_count   int not null default 0;

-- The watchdog scans by (status, priority, opened_at) — already indexed by
-- wa_threads_ticket_idx from 20260520180000_whatsapp_kb.sql, so no new index.
