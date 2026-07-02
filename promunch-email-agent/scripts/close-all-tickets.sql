-- close-all-tickets.sql
-- One-time reset: discard every existing ticket and start fresh under the new
-- two-number WhatsApp escalation model. Run once in the Supabase SQL editor
-- (project: CRM / hlykspakpewuilttnydm).
--
-- 1) Close every open/pending ticket, stamp resolved, clear watchdog counters.
-- 2) Hand every thread back to the bot (the old human-takeover model is retired;
--    the bot now keeps replying while a ticket is escalated on WhatsApp).

-- 1) close all live tickets + clear escalation state
update public.wa_threads
set ticket_status      = 'closed',
    ticket_resolved_at = now(),
    status             = 'bot',
    ticket_last_alert_at = null,
    ticket_alert_count   = 0
where ticket_status in ('open', 'pending');

-- 2) resume the bot on any thread still parked in a human/snoozed state
update public.wa_threads
set status = 'bot'
where status in ('human', 'snoozed');

-- verify: should return 0 open/pending tickets and 0 non-bot threads
-- select ticket_status, count(*) from public.wa_threads group by ticket_status;
-- select status, count(*) from public.wa_threads group by status;
