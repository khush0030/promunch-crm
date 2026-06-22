# WhatsApp in-chat ordering (Path A)

End-to-end shopping inside WhatsApp: the bot shows catalog cards → the customer
builds a cart in WhatsApp → they get a 1-tap Shopify checkout link → the order
lands in `shopify_orders` through the existing Shopify webhook. No payment
onboarding required; the final pay step happens on Shopify (UPI / card / COD).

## The one convention that makes it work

**Every Meta catalog item's `retailer_id` (a.k.a. "Content ID") MUST equal that
item's Shopify _variant_ numeric id.**

That single shared id is the whole trick: when a customer submits a cart, Meta's
`order` webhook gives us `product_items[].product_retailer_id`, which is then
already the Shopify variant id, so we build a checkout permalink
(`https://promunch.in/cart/<variantId>:<qty>,...`) with zero Shopify product API
calls. See [`_shared/shopify-cart.ts`](../supabase/functions/_shared/shopify-cart.ts).

## One-time Meta setup (manual, in Commerce Manager)

1. **Commerce Manager → Catalogs → Create catalog** (type: e-commerce).
2. Add products. For each item set **Content ID = the Shopify variant id**.
   Easiest via CSV upload: the `id` column = variant id, plus `title`,
   `description`, `price`, `image_link`, `availability`.
3. **Connect the catalog to your WhatsApp Business Account** (WhatsApp Manager →
   Catalog) and submit for commerce review (usually hours to ~2 days).
4. **Enable Cart** in WhatsApp Manager so the multi-product card shows an
   "Add to cart" experience.
5. Copy the **Catalog ID** → set `WHATSAPP_CATALOG_ID` in Supabase secrets.

## Populate the mirror table

The rich cards (image, price, description) live in Meta and are rendered by
WhatsApp. We keep a thin mirror, `wa_catalog_items`, so the bot knows which
`retailer_id`s to put in a product-list message and how to group them. Apply
migration `20260622160000_wa_catalog_items.sql` (via the dashboard SQL editor —
see the Supabase deploy constraints note).

**Recommended — one-click sync from Shopify.** Dashboard → Settings →
Connections → Shopify store → **"Sync catalog to WhatsApp"**. This calls
`/api/shopify/catalog` → the `shopify-catalog-sync` edge function, which pages
all ACTIVE Shopify products via the Admin API and upserts one row per variant
(`retailer_id` = variant id, `title`, `category` = product type, `price_inr`,
`in_stock` from availability). Variants Shopify no longer returns are flagged
`in_stock = false`. Re-run it whenever the catalog changes (or schedule it).

**Manual alternative** (if the Admin API isn't configured):

```sql
insert into wa_catalog_items (retailer_id, title, category, price_inr, sort) values
  ('42155123001', 'Soya Crunchies Peri Peri', 'Crunchies', 99, 1),
  ('42155123002', 'Soya Crunchies Cream & Onion', 'Crunchies', 99, 2),
  ('42155987001', 'Roasted Edamame Sea Salt', 'Edamame', 149, 1)
-- retailer_id MUST match the Meta Content ID == Shopify variant id
on conflict (retailer_id) do update set
  title = excluded.title, category = excluded.category,
  price_inr = excluded.price_inr, sort = excluded.sort, in_stock = true,
  updated_at = now();
```

## The flow in code

| Step | Where |
|------|-------|
| Customer asks to browse/order → bot calls `show_products` tool | [`wa-ai-reply/index.ts`](../supabase/functions/wa-ai-reply/index.ts) — `buildCatalogSections` reads `wa_catalog_items`, sends a `product_list` |
| Send dispatch for `interactive` / `catalog` kinds | [`wa-send/index.ts`](../supabase/functions/wa-send/index.ts) |
| Catalog / interactive / CTA-URL payload builders | [`_shared/whatsapp.ts`](../supabase/functions/_shared/whatsapp.ts) |
| Customer submits cart → `order` webhook → checkout link | [`wa-webhook/index.ts`](../supabase/functions/wa-webhook/index.ts) — `sendCheckout` |
| Cart → permalink, variant-id convention | [`_shared/shopify-cart.ts`](../supabase/functions/_shared/shopify-cart.ts) |

## Limits to know

- **24-hour window:** browsing/checkout replies are normal session messages and
  are fine while the chat is open. Proactively pushing a catalog to a cold
  contact needs an approved template.
- **product_list:** max 30 items across 10 sections (enforced in
  `buildCatalogSections`); section title max 24 chars.
- **Catalog review:** Meta must approve the catalog before cards render.
- The checkout link drops to Shopify for payment. Truly native pay-in-chat is
  **Path B** (Razorpay/PayU `order_details` payment messages, India) — the
  `order`-webhook parse already produces the line items it would need, so it
  bolts on without rework.

## Deploy

```bash
supabase functions deploy wa-webhook wa-send wa-ai-reply shopify-catalog-sync
supabase secrets set WHATSAPP_CATALOG_ID=<id>
# apply migration 20260622160000_wa_catalog_items.sql via the dashboard SQL editor
# then: Settings → Connections → "Sync catalog to WhatsApp"
```

The catalog sync reuses the existing Shopify Admin creds
(`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` / `SHOPIFY_STORE_DOMAIN`).
