# Bulk order form + instant reply (Oct 7, 2026)

Replaces the Pify "Form Builder" iframe on promunch.in/pages/bulk-orders. Before this, those submissions never reached the CRM: no deal was created, no WhatsApp ping was sent and no reply went out.

Approved mockup: https://claude.ai/artifact/Tjk9Kzb8TdKfokRpq8XHqB (form, email, question split).

## Flow
```
promunch.in bulk-orders page
  <div id="promunch-bulk-form"></div> + <script src=CRM/api/public/bulk-form-embed>
    → POST /api/public/bulk-inquiry   (Origin allowlist + honeypot + field validation)
       1. insert bulk_inquiries        (UNIQUE submission_key: double-click safe)
       2. create/link a deal           (kind from order type; reuses an open deal with the same contact_email)
       3. auto-reply via Resend        (claim: pending→sending CAS + UNIQUE auto_reply_key = email + IST day)
    → AFTER INSERT trigger → edge fn bulk-lead-alert → pingLeadDesk (claim lead_alert:bulk:<id>) → LEADS_WA_ID
      pg_cron bulk-lead-alert-sweep every 10 min retries pings the trigger missed
Customer replies to hello@ → normal Inbox draft (needs approval) + deal-scan updates the same deal
  (deal-scan now matches a thread to an open deal by contact email first)
```

## Form vs email questions
- **Form:** name, company, work email, phone (WhatsApp), order type, quantity band, products (optional), city, needed-by (optional), notes (optional).
- **Email:** 2 questions specific to the order type (`TYPE_QUESTIONS` in `src/lib/bulk-inquiry/schema.ts`) plus budget per unit, delivery pincode and GSTIN.
- **Email opener:** one AI line that is not allowed to state product facts, prices or numbers (`opener.ts` validates it). If anything fails, a fixed line is used.

## Controls
- `bulk_inquiry_settings` (single row): `autoreply_enabled` is the kill switch. When false, inquiries, deals and WhatsApp pings still happen, but no customer email goes out. Also holds `whatsapp_display` and `quote_promise`.
- Copy rules: PROMUNCH in capitals, no em dashes, "Your Munchy Pal". Tests enforce these.

## Files
- `src/lib/bulk-inquiry/`: schema, email, opener, process, embed-script, tests.
- `src/app/api/public/bulk-inquiry`, `src/app/api/public/bulk-form-embed`.
- `promunch-email-agent/supabase/functions/bulk-lead-alert`.
- `supabase/migrations/20261007200000_bulk_inquiries.sql`: apply by hand, after deploying `bulk-lead-alert`.

## Install on the storefront
In the theme editor on the bulk-orders page, remove the Pify app block and add a **Custom Liquid** block containing:
```html
<div id="promunch-bulk-form"></div>
<script src="https://admin.promunch.in/api/public/bulk-form-embed" async></script>
```
