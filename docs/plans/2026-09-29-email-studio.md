# Email Studio (in-CRM Klaviyo replacement)

Plan doc (goals, phases, Diwali timeline): https://claude.ai/code/artifact/ca478684-8765-459c-b5db-9b0efb034f8d

## What shipped (Phases 1 to 3 core)

Lives at **Marketing > Email Studio** (`/dashboard/email`), access area `email_marketing`.

| Piece | Where |
| --- | --- |
| Design model (blocks JSON), renderer (table/inline HTML, same code for preview + send), copy checks, segments, attribution rules | `src/lib/email-studio/` |
| Drag-and-drop builder, segment editor, report view | `src/components/email-studio/` |
| Pages: Home, Campaigns (3-step wizard + report), Templates (9 built-ins incl. 4 Diwali), Audiences, Brand & settings | `src/app/dashboard/email/` |
| API | `src/app/api/email-studio/*` |
| Revenue attribution (UTM first, else click within 5 days, email or phone match) | `/api/cron/email-attribution-tick` |
| Sender | `src/lib/email/campaign-send.ts` (consent-only audiences, unique per-recipient claim, approval + warm-up re-check, merge tags in subject) |

## Guardrails (server-enforced)

- Audience is always: email present, status active, `accepts_marketing` or `email_consent = SUBSCRIBED`, not suppressed.
- Send needs: no red checks (em dashes, lowercase brand, Oltaflock, broken links, empty blocks), a test send of the **exact** current content (content hash), and approval when warm-up is on or recipients exceed the threshold. A non-admin's send becomes "waiting for approval"; an admin sending is the approval. Any edit clears an approval.
- Warm-up cap (`email_studio_settings.warmup_max_recipients`, default 150) blocks larger campaigns outright.
- `campaign_emails (campaign_id, contact_id)` is unique: a recipient can never be claimed twice.
- The legacy `/api/campaigns/[id]/send` is admin-only now.

## Go-live checklist

- [x] Migrations `016_email_studio.sql` + `017_email_studio_templates_table.sql` applied (Sep 29). 017 exists because `email_templates` is the B2B "Saved emails" table; Studio uses `email_studio_templates`.
- [x] promunch.in verified in Resend; open + click tracking enabled with tracking subdomain `links`.
- [ ] DNS: CNAME `links.promunch.in` → `links2.resend-dns.com` (Cloudflare, DNS only / grey cloud). Until then Resend tracks nothing.
- [ ] Vercel prod env `EMAIL_MARKETING_FROM="PROMUNCH <hello@promunch.in>"` (today falls back to trypromunch.in). Also switches the live abandoned-cart flow sender: that is the intended warm-up traffic.
- [ ] Postal address in Brand & settings (footer is legally required; fallback is only "PROMUNCH, India").
- [ ] Apply `promunch-email-agent/supabase/migrations/20260929120000_cron_email_studio.sql` (schedules `email-campaign-tick` every 5 min, which was never scheduled, and `email-attribution-tick` every 3 h) AFTER the Vercel deploy.
- [ ] `vercel --prod`, then live test: build a campaign to a 1-person audience, approve, send.
- [ ] Retire Brevo campaign sending at cutover (never two email systems).

## Not built yet

Automations on the new builder (flows still use the old editor at `/dashboard/flows`), signup-forms tab, subject A/B, preference centre, win-back flow, CSV import with consent mapping.
