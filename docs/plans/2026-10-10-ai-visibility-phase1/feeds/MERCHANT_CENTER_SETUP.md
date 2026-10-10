# Product feeds: Google Merchant Center, Microsoft Merchant Center and the Meta catalogue

AI-visibility Phase 1, task 5. Written 2026-10-10.

**Why this matters.** The Phase 1 audit found all 22 Shopify products missing a GTIN. Structured product feeds (Google Merchant Center, Microsoft Merchant Center, Meta catalogue) are a common data source for search and shopping surfaces, and a GTIN is the identifier they use to match a listing to a real, specific product. Without it, items show "Limited performance due to missing identifiers" and rarely appear outside a plain branded search. This guide covers getting the GTINs out of Shopify and into each feed.

**Status of the code side:** see section 6. The Meta feed change is committed only until the migration, edge deploy and `vercel --prod` in section 6 have run.

---

## 1. Before anything else: the Shopify product data

Every feed below is built from Shopify, so fix the data once, there.

| Shopify field | Becomes | What to check |
|---|---|---|
| Variant **Barcode** | `gtin` | The EAN-13 printed on the pack. GS1 India codes start with `890`. One code per variant (each size or pack count has its own barcode). Digits only, no spaces needed. |
| **Vendor** | `brand` | Set to `PROMUNCH` on every product. Google's app uses Vendor as the brand. |
| Variant **SKU** | `mpn` (Meta) | Already set. Keep it. |
| **Title** | `title` | Product name plus flavour and pack size, for example "PROMUNCH Roasted Soya Crunchies, Peri Peri, 100 g". |
| **Description** | `description` | Plain facts that match the pack label. No claims the label does not support. |
| Variant **Price** / **Compare-at price** | `price` / `sale_price` | Must equal what the product page and checkout show. |
| Inventory | `availability` | Track inventory in Shopify so sold-out variants go "out of stock" automatically. |
| Product images | `image_link` | Clean pack shot on a plain background. No price stickers, badges or text overlays on the main image. |

Self-check before syncing: the CRM now validates barcodes with the GS1 check digit (`src/lib/gtin.ts`). A typo in a single digit fails the check and is dropped from the Meta feed. The same typo would be disapproved by Google as "Invalid value [gtin]". Section 6 has a SQL query that lists which variants have a barcode and whether it looks like an EAN-13.

---

## 2. Google Merchant Center (recommended path: Shopify's Google & YouTube app)

Use Shopify's free **Google & YouTube** sales channel app. It creates or links a Merchant Center account, verifies and claims the store domain, and keeps products, prices and stock in sync automatically. It maps the Shopify variant Barcode to `gtin`, so once the barcodes are in Shopify nothing else is needed for GTINs. Free listings cost nothing; you do not need to run ads.

### 2.1 Steps

1. **Shopify admin → Settings → Apps and sales channels → Shopify App Store**, search "Google & YouTube", add the app (by Google / Shopify).
2. **Connect a Google account.** Use the company Google account that should own Merchant Center long term (not a personal account). If a Merchant Center account already exists for promunch.in, choose it; otherwise let the app create one.
3. **Store requirements check.** The app checks the online store before it will sync. Make sure:
   - the store has no password page;
   - a refund/return policy, privacy policy and terms of service are published (Settings → Policies) and linked in the footer;
   - contact details (email, phone and a business address) are visible on the site;
   - checkout works for India and accepts at least one payment method.
4. **Target market:** India, currency INR, language English.
5. **Shipping:** pick how shipping reaches Merchant Center (see 2.3). It must match what checkout charges.
6. **Product sync:** choose "Sync all products" (or select the 22 active products). Products need to be published to the Google & YouTube sales channel; check Products → select all → "Include in sales channels" if any are missing.
7. **Free listings:** keep "Free listings" turned on. No Performance Max campaign is needed.
8. Wait for review. First review usually takes a few days. Then work through **Merchant Center → Products → Needs attention** (see 2.4).

### 2.2 Required and recommended attributes (food, India)

The app fills these from Shopify; this is what Google expects so you know what to fix when something is flagged.

| Attribute | Required? | Source |
|---|---|---|
| `id` | Required | App generated (Shopify product and variant ids). Different from the Meta feed id; that is fine. |
| `title`, `description`, `link`, `image_link` | Required | Shopify product |
| `price` | Required | Variant price, INR, tax inclusive (Indian prices include GST) |
| `availability` | Required | Shopify inventory |
| `brand` | Required | Vendor (`PROMUNCH`) |
| `gtin` | Required for any product that has one | Variant Barcode |
| `condition` | Required | `new` (app default) |
| `google_product_category` | Recommended | Set in the app (Food, Beverages & Tobacco > Food Items > Snack Foods). Google will infer it if missing. |
| `sale_price` | Optional | Compare-at price present means the app sends a sale price |
| `shipping` | Required (account level) | Merchant Center shipping settings |
| `identifier_exists` | Only set to `no` for items that truly have no barcode | Do not use it as a shortcut once barcodes exist |

### 2.3 Shipping settings: free at ₹599 and above, otherwise ₹99

Merchant Center → Settings → Shipping and returns → Add shipping service:

- Country: India, currency INR.
- Delivery time: the real handling plus transit days you can meet.
- Shipping cost: **based on order price**. Under ₹599 = ₹99. ₹599 and above = free.

If the Google & YouTube app offers to import Shopify shipping rates automatically, that is fine as long as the Shopify rates already encode the same rule. Either way the numbers in Merchant Center must match checkout.

Two things not to put in shipping or price:

- The **COD +₹50** fee is a payment surcharge, not shipping. Leave it out of the shipping cost.
- The **prepaid 5% off** is a checkout discount. Do not lower the feed price for it; the feed price must match the product page price.

### 2.4 Common disapprovals for Indian food products, and the fix

| Merchant Center issue | Usual cause here | Fix |
|---|---|---|
| Missing value [gtin] / Limited performance due to missing identifiers | Barcode field empty | Enter the EAN-13 in the variant Barcode; the app re-syncs within hours. |
| Invalid value [gtin] / Incorrect product identifier | Typo, a SKU typed into Barcode, or a code from a reserved range (prefixes 020 to 029 and 200 to 299 are for in-store use) | Re-enter from the physical pack; check it against the GS1 India record. |
| Mismatched value (page crawl) [price] | Price changed in Shopify but the crawl saw an old price, theme shows a different price, or a currency converter app changes the price | Keep one price per variant; avoid geo/currency switching for Googlebot; resync. |
| Mismatched value (page crawl) [availability] | Variant sold out but still "in stock" (or the reverse), often because inventory is not tracked | Turn on inventory tracking; make the product page show "Sold out" correctly. |
| Missing shipping information / Incorrect shipping | No shipping service for India, or the rule does not match checkout | Fix section 2.3. |
| Unavailable desktop/mobile landing page | Password page, a redirect, or the product unpublished from the online store | Remove the password, publish the product, check the URL loads in a private window. |
| Image issues (promotional overlay, generic image) | Badges, "BESTSELLER" or price text on the main image | Use a clean pack shot as the first image; put lifestyle shots second. |
| Misrepresentation (account level) | Missing contact details, return policy or business info; claims the site cannot back up | Publish policies, show contact details and business address, keep nutrition claims consistent with the pack label. |
| Unsupported or unverified health claims | Words like "cures", "boosts immunity", "weight loss guaranteed" | Stick to label facts (protein per serving, roasted vs fried as stated in the Master KB). |

### 2.5 Verify and claim promunch.in

Merchant Center → Settings → Business info → Website: `https://promunch.in` (the Shopify primary domain).

- The Google & YouTube app normally verifies and claims the domain for you during setup.
- If you do it by hand: the Shopify theme already carries a `google-site-verification` meta tag. If that tag belongs to a Google account that is a user on this Merchant Center account (or to a Search Console property owned by it), choose "HTML tag" or "Google Search Console" and click Verify, then **Claim**. If the tag belongs to a different Google account, either add that account as an admin on Merchant Center or add the new tag Merchant Center shows to the theme `<head>` (keep the old tag; multiple tags are allowed).
- Only one Merchant Center account can claim a domain. If the claim fails with "already claimed", find and release the other account first rather than creating a new one.

---

## 3. Microsoft (Bing) Merchant Center: import from Google

Once the Google catalogue is clean, reuse it.

1. Sign in to Microsoft Advertising (create a free account if needed; no spend required for setup).
2. **Tools → Microsoft Merchant Center → Create store.** Enter promunch.in and confirm India is offered as the market. Market support changes over time, so check it in the form rather than assuming.
3. **Verify the domain.** Easiest: add the site in Bing Webmaster Tools and use "Import from Google Search Console", or use the UET tag / meta tag method Microsoft offers.
4. In the store: **Catalogs / Feeds → Create feed → Import from Google Merchant Center.** Sign in with the Google account that owns Merchant Center, pick the account, and set a daily schedule.
5. Wait for review, then check the store's catalogue status for rejected items. They are usually the same issues as section 2.4 and are fixed in Shopify, which flows Shopify → Google → Microsoft.

---

## 4. What this does and does not cover

- These feeds are a common data source for search and shopping surfaces, including AI-assisted shopping answers on some platforms. We do not control how any specific assistant uses them, so treat feed quality as table stakes, not a guarantee of placement.
- Product facts in the feeds come from Shopify. The Master KB stays the source of truth for the WhatsApp and email bots; it is not affected by this work.

---

## 5. Meta catalogue: the new `gtin` column

The Meta Commerce catalogue pulls a scheduled CSV from `https://admin.promunch.in/api/public/meta-catalog`, built from `wa_catalog_items` (refreshed every 30 minutes by the `shopify-catalog-sync` edge function).

What changed:

- `shopify-catalog-sync` now reads each variant's Shopify `barcode` (Admin GraphQL) and stores it, raw, in the new `wa_catalog_items.barcode` column.
- The feed has one new last column, `gtin`. It is filled only when the barcode is a valid GTIN (8, 12, 13 or 14 digits with a correct GS1 check digit, see `src/lib/gtin.ts`), otherwise left blank. A blank `gtin` is accepted by Meta; a wrong one gets the item flagged.
- `id` is unchanged: it is still the Shopify variant id, which Meta echoes back as `product_retailer_id` for WhatsApp in-chat ordering. `mpn` (SKU) is unchanged.
- Validation happens only in the feed. The edge function stores the raw value so a bad barcode stays visible in the database (and in the verification query below) instead of silently disappearing.
- Safe in any deploy order: if the `barcode` column does not exist yet, the sync logs a warning and syncs everything else, and the feed serves without GTINs instead of erroring.

---

## 6. Deploy order and verification

Code is **committed only** until each step below has actually run.

1. **Migration** (Supabase dashboard → SQL editor, paste by hand):
   `promunch-email-agent/supabase/migrations/20261010120000_wa_catalog_items_barcode.sql`
2. **Edge function** (from `promunch-email-agent/`):
   `supabase functions deploy shopify-catalog-sync`
3. **App:** `vercel --prod` (ships the feed `gtin` column).
4. **Run a sync** from the dashboard (`/api/shopify/catalog`) or wait for the next 30-minute cron tick. The sync response includes `"barcodeColumn": true` once the column is in use.

Verification query (SQL editor):

```sql
select retailer_id,
       title,
       barcode,
       barcode ~ '^890[0-9]{10}$' as looks_like_gs1_india_ean13
from wa_catalog_items
where in_stock
order by sort;
```

Expect every in-stock variant to show its barcode once the owner has filled Shopify. The query checks shape only; the feed also checks the check digit.

Feed check:

```bash
curl -s https://admin.promunch.in/api/public/meta-catalog | head -3
```

The header row should end in `,mpn,gtin`, and product rows should end in the 13-digit code. A row ending in an empty field means that variant's barcode is missing or fails the check digit. Then in Meta Commerce Manager → Catalogue → Data sources, run "Fetch now" on the scheduled feed and confirm no new errors.

Live test (per AGENTS.md): after deploy, confirm one real product shows its GTIN in Commerce Manager's item detail, and that a WhatsApp in-chat order from the catalogue still produces the right Shopify cart link (proves the `id` column is untouched).
