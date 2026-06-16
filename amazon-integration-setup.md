# Amazon Seller Central → PROMUNCH CRM (SP-API)

Goal: orders & sales, inventory/FBA, buyer messaging, finances → CRM, mirroring the Shopify pattern
(Supabase edge function polls API → upserts tables → dashboard page + Maya Slack alerts).

Region: **India** (marketplace `A21TJRUUN4KGV`, Seller Central `sellercentral.amazon.in`).
India lives in Amazon's **Europe** API region: endpoint `https://sellingpartnerapi-eu.amazon.com`.

---

## The one hard truth first

"Admin access to Seller Central" is NOT data access. Data comes through the **Selling Partner API (SP-API)**,
which you switch on separately. Two more things to know up front:

1. **Buyer PII is restricted.** Amazon hides real buyer email/phone. You get anonymized orders +
   a no-reply *relay* for messaging. So Amazon buyers can't be added to WhatsApp/email outreach like Shopify buyers.
2. **You need a Professional selling plan** (not Individual) to use SP-API. You almost certainly have this.

Good news: Amazon **removed the old AWS / SigV4 signing requirement**. You now only need a Login-with-Amazon
(LWA) token. Much simpler than older guides say — ignore anything mentioning "IAM role ARN" or "AWS access keys".

---

## PART A — Amazon console setup (you do this by hand, ~30 min)

### Step 1 — Register as a developer
1. Log in to `sellercentral.amazon.in` as the admin.
2. Top menu: **Settings (gear) → User Permissions**, scroll to **Third-party developer and apps** →
   click **Visit Manage Your Apps**. (Or: **Apps & Services → Develop Apps**.)
3. Click **Developer Profile** / register. Fill the form:
   - Who uses the data: "Internal use only" (you're building for your own store).
   - Security questions: answer honestly (encrypted at rest/in transit, access limited to you, etc.).
4. Submit. Private/self-use profiles are usually approved fast.

### Step 2 — Create your app and get LWA credentials
1. On **Develop Apps**, click **Add new app client**.
2. Name: `PROMUNCH CRM`. App type: **SP-API**.
3. **Roles** — tick the data sets you need (Amazon shows a checkbox + description for each; pick by description):
   - Orders / "Amazon Fulfillment" + "Direct-to-Consumer Shipping" → order & sales data
   - "Inventory and Order Tracking" → FBA / stock
   - "Finance and Accounting" → settlements, fees, payouts
   - "Buyer Communication" (a **restricted** role) → messaging relay
   - "Amazon ... (PII)" restricted role → only if you ever need buyer name/address. Requires accepting
     Amazon's Data Protection Policy. Skip if you don't need it — keeps approval simpler.
4. Save. Open the app → you now have:
   - **LWA Client ID** (`amzn1.application-oa2-client....`)
   - **LWA Client Secret**
   Copy both somewhere safe. The secret is shown once.

> Restricted roles (Buyer Communication, PII) may show "pending" until Amazon approves. Orders/inventory/finance work immediately.

### Step 3 — Self-authorize → get the Refresh Token (the key that unlocks everything)
Because the app is for your *own* seller account, you don't build an OAuth flow — you self-authorize.
1. In **Develop Apps**, find your app → **Authorize** (or the "..." menu → **Authorize**).
2. Click **Authorize app** for your own account.
3. Amazon shows a **Refresh Token** (`Atzr|....`). Copy it. This is long-lived — treat it like a password.

You now hold the three secrets that matter:
- `LWA Client ID`
- `LWA Client Secret`
- `Refresh Token`

That's the entire Amazon side. Everything else is code.

---

## PART B — How the auth actually works (so the code makes sense)

1. Exchange refresh token → short-lived **access token** (valid ~1h):
   `POST https://api.amazon.com/auth/o2/token`
   body: `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...`
   → returns `access_token`.
2. Call SP-API with header `x-amz-access-token: <access_token>` against `https://sellingpartnerapi-eu.amazon.com`.
3. For **restricted** data (buyer info, messaging), first call the **Tokens API** to mint a
   **Restricted Data Token (RDT)**, then use that instead of the normal access token for that one call.

APIs we'll use:
| Need              | API                                   | Key operation                          |
|-------------------|---------------------------------------|----------------------------------------|
| Orders & sales    | Orders API v0                         | `getOrders`, `getOrderItems`           |
| Bulk backfill     | Reports API                           | `GET_FLAT_FILE_ALL_ORDERS_DATA...`     |
| Inventory / FBA   | FBA Inventory API                     | `getInventorySummaries`                |
| Finances          | Finances API                          | `listFinancialEvents`                  |
| Buyer messaging   | Messaging + Solicitations API (RDT)   | `getMessagingActionsForOrder`          |

---

## PART C — Code build (mirrors Shopify; I implement this)

Secrets to set in Supabase (same place as your Shopify/Slack secrets):
```
AMAZON_LWA_CLIENT_ID
AMAZON_LWA_CLIENT_SECRET
AMAZON_SP_REFRESH_TOKEN
AMAZON_MARKETPLACE_ID = A21TJRUUN4KGV
AMAZON_SP_ENDPOINT    = https://sellingpartnerapi-eu.amazon.com
```

Files to add (parallel to the Shopify ones):
- `supabase/functions/_shared/amazon.ts` — LWA token cache, RDT helper, `getOrders/getInventory/getFinances`.
- `supabase/functions/amazon-poll/index.ts` — cron-polled: pull new orders since last run → upsert
  `amazon_orders` (+ `amazon_order_items`); low-stock check → Slack via Maya. Dedup like `wa_messages`.
- `supabase/migrations/<ts>_amazon_tables.sql` — `amazon_orders`, `amazon_order_items`, `amazon_inventory`
  (run in dashboard SQL editor — migrations can't deploy via CLI here).
- `src/app/dashboard/amazon/page.tsx` — orders + sales + inventory view, mirroring Shopify pages.
- Slack: reuse existing `_shared/slack.ts` (Maya) for new-order pings + low-stock alerts.
- Cron: add `amazon-poll` to the scheduler (like the order-confirmation sweep).

Deploy: edge functions via Supabase CLI (works); migration via dashboard SQL editor (CLI blocked).
