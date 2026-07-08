# Database Migrations — structure & conventions

The schema lives in **two** directories. This is intentional but easy to trip on,
so here's the map.

## Where things live

| Directory | Owns | Applied how |
|---|---|---|
| `supabase/migrations/` | Legacy CRM core: `contacts`, `orders`, `campaigns`, `campaign_emails`, `flows`, `flow_enrollments`, `email_events` (+ the RLS lockdown `004`). | Supabase dashboard SQL editor (by hand). |
| `promunch-email-agent/supabase/migrations/` | Everything else: WhatsApp, Shopify, Amazon, Instagram, B2B leads/outreach, KB/RAG, connector events, RFM. | Supabase dashboard SQL editor (by hand). |

Both projects point at the **same** Supabase database (`hlykspakpewuilttnydm`).
The split is historical (the email agent started as a separate repo) — treat the
two dirs as one logical migration set.

## Conventions

1. **Apply by hand.** Migrations are pasted into the SQL editor, not run via
   `supabase db push`. Each new file should be idempotent where practical
   (`create ... if not exists`, `drop policy if exists`, etc.) so a re-paste is safe.
2. **Timestamp prefix `YYYYMMDDHHMMSS_name.sql`.** Must be unique — see below.
3. **New CRM-core tables** → `supabase/migrations/`. **Everything else** →
   `promunch-email-agent/supabase/migrations/`.
4. Run `scripts/check-migrations.sh` before committing a new migration; it fails
   on a new duplicate-timestamp collision.

## Pre-existing duplicate timestamps (do NOT rename)

Five timestamp pairs collide. They are **already applied in production**, and
because migrations are applied by hand, renaming them would only create
confusion (and would desync any future move to `supabase db push`). They are
grandfathered in `scripts/check-migrations.sh`:

| Timestamp | Files |
|---|---|
| `20260520130000` | `lead_classification` + `shopify_order_status` |
| `20260610170000` | `shopify_orders_is_creator` + `wa_reply_claims` |
| `20260624140000` | `instagram_dm` + `leads_enrichment` |
| `20260624170000` | `instagram_collab_scoring` + `outreach_replies` |
| `20260629120000` | `wa_campaign_send_lock` + `wa_ticket_watchdog` |

Within each pair the two files touch different tables, so the ambiguous order is
harmless in practice — but new collisions are not allowed.

## Security-relevant migrations (recent)

- `supabase/migrations/004_lock_anon_rls.sql` — closes the public-anon PII breach
  (C1); re-grants `service_role` on `contacts`/`orders`.
- `promunch-email-agent/supabase/migrations/20260702130000_hardening.sql` —
  `search_path` pin + missing indexes.
- `promunch-email-agent/scripts/m3-gate-cron-auth.sql` — Vault-authenticated cron
  (not a migration; a one-shot re-schedule script).
