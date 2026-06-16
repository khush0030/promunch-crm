# Amazon Seller Central → PROMUNCH CRM (SP-API)

Replaces OMS Guru for order alerts, and adds true financials + settlement reconciliation,
mirroring the Shopify pattern (Supabase edge function polls SP-API → upserts tables →
dashboard page + Maya Slack alerts).

Region: **India** — marketplace `A21TJRUUN4KGV`, endpoint `https://sellingpartnerapi-eu.amazon.com`
(India is served by Amazon's EU region — not a typo).

Account: **Vippy Industries Ltd** seller account. App: `PROMUNCH CRM`
(`amzn1.sp.solution.104d3bf2-...`), private/self-authorized.

---

## Status: LIVE ✅

| Piece | State |
|---|---|
| SP-API auth (LWA + refresh token) | ✅ working |
| Orders sync (336 backfilled, ongoing) | ✅ |
| Line-items | ✅ (decoupled + just-in-time on alert) |
| FBA inventory (134 SKUs) | ✅ |
| Finances — per-order fee breakdown | ✅ (970 events) |
| Settlement ingestion + reconciliation | ✅ (Jun 8–15 reconciled, variance ₹0.00) |
| Slack: order alerts → #amazon-orders | ✅ |
| Slack: settlement/variance → #amazon-finance | ✅ |
| Dashboard `/dashboard/amazon` | ✅ (ships on next Vercel deploy) |
| Cron (15-min sync + daily settlements) | ⏳ activates on next Vercel deploy |

---

## What you can get from Amazon (and what you can't)

| Data | Status |
|---|---|
| Orders, sales, status, FBA vs merchant | ✅ |
| Line items (SKU/ASIN/qty/price) | ✅ |
| FBA inventory, inbound, reserved | ✅ |
| Per-order fees (referral, FBA, other) + true net | ✅ |
| Settlements — actual bank deposits, line by line | ✅ |
| Buyer name/email/phone/address | ⚠️ restricted (PII role + RDT); email is a no-reply relay |
| Ads spend | ❌ separate Amazon Ads API |

**Reconciliation chosen: Amazon settlement vs computed** — does the sum of every settlement
line item equal the money Amazon actually deposited? Variance = unaccounted money → Slack alert.

---

## Architecture (files added)

Edge function (Supabase project `hlykspakpewuilttnydm` = promunch-email-agent):
- `supabase/functions/_shared/amazon.ts` — SP-API client: LWA token cache, RDT, getOrders,
  getOrderItems, getInventorySummaries, listFinancialEvents (paginated), fee breakdown
  (`shipmentEconomics`), Reports API + settlement TSV parsing.
- `supabase/functions/amazon-poll/index.ts` — the poller. Sections: orders, inventory,
  finances, settlements. Each advances its own watermark on success only.
- `supabase/config.toml` — `[functions.amazon-poll] verify_jwt = false`.

Migrations (run via dashboard SQL editor — CLI migrations are blocked on this project):
- `20260616120000_amazon_tables.sql` — orders, order_items, inventory, finance_events, sync_state (+ RLS lock).
- `20260616130000_amazon_financials.sql` — fee columns + settlements + settlement_lines + report_state.
- `20260616140000_amazon_settlement_breakdown.sql` — settlement gross/fees/refunds/breakdown columns.

Next.js (promunch-crm):
- `src/app/api/amazon/route.ts` — server-side (service role) financials API.
- `src/app/dashboard/amazon/page.tsx` — sales/fees/net + settlement reconciliation + orders + low stock.
- `src/app/api/cron/amazon-poll/route.ts` + `amazon-settlements/route.ts` — Vercel cron triggers.
- `vercel.json` — crons: poll `*/15 * * * *`, settlements `0 5 * * *`.
- `src/components/Sidebar.tsx` — "Amazon" nav item.

---

## Secrets (Supabase Edge Functions → Secrets) — ALL SET ✅

```
AMAZON_LWA_CLIENT_ID            (set)
AMAZON_LWA_CLIENT_SECRET        (set)
AMAZON_SP_REFRESH_TOKEN         (set)
AMAZON_MARKETPLACE_ID           = A21TJRUUN4KGV
AMAZON_SP_ENDPOINT             = https://sellingpartnerapi-eu.amazon.com
AMAZON_ORDERS_SLACK_CHANNEL_ID  = C0BBP5G5VRN   (#amazon-orders)
AMAZON_FINANCE_SLACK_CHANNEL_ID = C0BANG2HZRR   (#amazon-finance)
```

Optional tuning (defaults shown):
```
AMAZON_LOW_STOCK_THRESHOLD   = 10     # FBA fulfillable units that trigger a low-stock alert
AMAZON_ALERT_MAX_AGE_HOURS   = 12     # only alert orders placed within this window (stops backfill spam)
AMAZON_ITEM_BATCH            = 8      # line-item fetches per run
```

---

## Manual triggers (for testing / backfill)

```
# combined steady-state sync (orders + inventory + finances)
curl "https://hlykspakpewuilttnydm.supabase.co/functions/v1/amazon-poll"

# single section
curl ".../amazon-poll?only=orders&days=7"      # widen window for a deliberate order backfill
curl ".../amazon-poll?only=inventory"
curl ".../amazon-poll?only=finances"
curl ".../amazon-poll?only=settlements"         # ingest next unseen settlement report
curl ".../amazon-poll?only=settlements&reprocess=1"  # re-ingest newest report
curl ".../amazon-poll?only=settlements&debug=1"      # inspect report headers/rows, no writes
```

---

## To go fully live

1. **Deploy promunch-crm to Vercel** (push to main) → dashboard page + the two crons activate.
   Vercel needs `NEXT_PUBLIC_SUPABASE_URL` (already set) and optional `CRON_SECRET`.
2. Confirm Maya is in **#amazon-orders** and **#amazon-finance** (`/invite @Maya`).

That's it — orders then flow to Slack automatically and you can retire OMS Guru.

---

## Notes / future

- Buyer messaging (Buyer Communication / Solicitation roles) is approved-pending at Amazon; once
  active, wire the Messaging API (needs RDT) for review requests like the Shopify flow.
- Finances currently capture Shipment + Refund events; settlement reconciliation is the source of
  truth for money (it includes storage/service/reserve lines the events don't).
- The first settlement (Jun 8–15) netted **negative** — fees (₹3,650, ~33%) + refunds (₹913) +
  reserves exceeded ₹10,905 gross. The dashboard makes this visible per period.
