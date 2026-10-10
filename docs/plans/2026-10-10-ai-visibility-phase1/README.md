# AI visibility phase 1 (10 Oct 2026)

Response to the PROMUNCH AI visibility audit of 10 Oct 2026. Score 15/100: the brand was not named in any of 3 category answers, the AI said it had no reliable information about PROMUNCH, and 22 of 22 products had no GTIN. Phase 1 fixes what is on our own site and feeds. Phase 2 (listicles, PR, marketplaces, comparison content) is separate.

| Task | Folder | What it is | Who acts |
|---|---|---|---|
| 1. GTIN on every variant | (Shopify admin) | Owner enters the EAN-13 in each variant's **Barcode** field. Everything below reads it from there. | Owner |
| 2. Product structured data | [theme/](theme/THEME_INSTALL.md) | `promunch-product-jsonld.liquid`: Product + one Offer per variant, GTIN only when the check digit is valid, Judge.me rating, optional protein. | Paste into theme |
| 3. Organization structured data | [theme/](theme/THEME_INSTALL.md) | `promunch-organization-jsonld.liquid` (Organization + WebSite), corrected FAQ and WebPage blocks. | Paste into theme |
| 4. Brand facts page + llms.txt | [brand-facts/](brand-facts/README.md) | About page body, llms.txt + page template, brand descriptions for every profile. | Paste into Shopify, fill [CONFIRM] items |
| 5. Feeds | [feeds/](feeds/MERCHANT_CENTER_SETUP.md) | Google Merchant Center via the Shopify Google & YouTube app; Meta catalogue feed now carries `gtin` (code in this repo). | Apply migration, deploy, connect Merchant Center |

## Order of work

1. Enter GTINs in Shopify (task 1).
2. Fill the [CONFIRM] items in `brand-facts/README.md`, then publish `/pages/about-promunch` (task 4). The Organization schema links to it.
3. Install the theme snippets and replace the old FAQ and WebPage blocks (tasks 2 and 3). Validate with the Google Rich Results Test.
4. Apply migration `promunch-email-agent/supabase/migrations/20261010120000_wa_catalog_items_barcode.sql`, then `supabase functions deploy shopify-catalog-sync`, then `vercel --prod` (task 5). Any order is safe; code degrades without the column.
5. Connect Google Merchant Center (task 5 guide).
6. Re-run the audit about 4 weeks after everything is live.

## Factual fixes found on the way

- The live FAQ JSON-LD says PROMUNCH snacks are "100% roasted (never fried)" and "completely gluten-free". False per the Master KB: Crunchies and Edamame are roasted, Sticks and Chips are fried; gluten-free is unconfirmed. Replaced in `theme/faq-jsonld-corrected.liquid`. Check the visible FAQ page and product descriptions for the same claims.
- The voice agent prompt in `docs/whatsapp/VOICE_AGENT_SETUP.md` calls the whole range "roasted soya snacks". Customer-facing; needs owner approval to change.
