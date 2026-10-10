# PROMUNCH theme: structured data install guide (AI visibility, Phase 1)

Date: 10 Oct 2026. Time needed: about 30 to 45 minutes. No coding knowledge needed, just careful copy and paste.

## What this does and why

Search engines and AI assistants (Google, ChatGPT, Perplexity, Gemini) read a hidden block of facts on each page called "structured data" (JSON-LD). The 10 Oct audit found that AI tools do not recognise PROMUNCH, that no product shows a GTIN (barcode), and that the current theme tells them two false things:

1. The FAQ data says PROMUNCH snacks are "100% roasted (never fried)". That is wrong. The roasted lines are Soya Crunchies and Roasted Edamame (roasted in olive oil). Soya Sticks and Soya Chips are FRIED.
2. The FAQ data and the WebPage data say the snacks are "gluten-free" for the whole range. That is not confirmed for every product, so it comes out.

After this install, every page tells AI tools clearly who PROMUNCH is (brand, founder, slogan, social profiles), and every product page gives the exact name, price, stock, barcode (GTIN) and rating.

## Files in this folder

| File | What it is | Where it goes |
|---|---|---|
| `snippets/promunch-product-jsonld.liquid` | Product data: name, description, images, price per variant, stock, SKU, GTIN from the Barcode field, star rating, protein | New snippet in the theme |
| `snippets/promunch-organization-jsonld.liquid` | Brand data: PROMUNCH, logo, "Your Munchy Pal", founder Parth Mutha, social links, website | New snippet in the theme |
| `faq-jsonld-corrected.liquid` | Corrected FAQ data | Replaces the old FAQ block inside `layout/theme.liquid` |
| `webpage-jsonld-corrected.liquid` | Corrected WebPage data | Replaces the old WebPage block inside `layout/theme.liquid` |

Open each file in a plain text editor (or on GitHub, click "Raw") and copy ALL of it, including the grey comment lines at the top. The comments do not show on the site.

---

## Step 1. Back up the theme (do not skip)

1. Shopify admin, go to **Online Store > Themes**.
2. On the live theme (the one under "Current theme"), click the **three dots (...)** button, then **Duplicate**. Wait until a copy called "Copy of ..." appears in the theme library. Rename it to `BACKUP before schema 2026-10-10` (three dots > Rename).
3. Optional extra safety: three dots > **Download theme file**. Shopify emails you a zip.

You will edit the LIVE theme. The copy is your safety net.

## Step 2. Create the two new snippets

1. On the live theme, click **three dots (...) > Edit code**.
2. In the file list on the left, find the **Snippets** folder. Click **Add a new snippet** (or the "+" next to Snippets).
3. Name it exactly `promunch-product-jsonld` (Shopify adds `.liquid` itself). Click **Done**.
4. Delete anything Shopify pre-filled in the new file. Paste the full contents of `snippets/promunch-product-jsonld.liquid`. Click **Save**.
5. Repeat for a second snippet named exactly `promunch-organization-jsonld`, pasting `snippets/promunch-organization-jsonld.liquid`.
6. In `promunch-organization-jsonld.liquid`, fill in the links you have (see the Placeholder checklist below). Paste each link between the single quotes in place of `PASTE_LINK_HERE`. Leave a line as `PASTE_LINK_HERE` if you do not have that link yet. It is then simply left out, and nothing breaks. Click **Save**.

## Step 3. Tell the theme to use the snippets

1. In Edit code, open **Layout > theme.liquid**.
2. Click inside the code and press **Ctrl+F** (Mac: **Cmd+F**). Search for `</head>`. There is exactly one.
3. Click at the start of the `</head>` line and press Enter to make an empty line above it. Paste these 4 lines on that empty line, so they sit directly above `</head>`:

```liquid
{%- render 'promunch-organization-jsonld' -%}
{%- if template contains 'product' -%}
  {%- render 'promunch-product-jsonld', product: product -%}
{%- endif -%}
```

4. Do not click Save yet. Continue to Step 4 in the same file.

## Step 4. Replace the two wrong blocks in theme.liquid

Still in `layout/theme.liquid`. Our copy of the live file (saved 7 Oct 2026) has these blocks around lines 377 to 455, a little above `</head>`. Line numbers may have moved, so find them with Ctrl+F.

### 4a. WebPage block

Search for `gluten-free and soya-based`. Select the WHOLE block below, from the opening `<script` line to its closing `</script>` line, and delete it:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "PROMUNCH - Protein Rich Healthy Snacks",
  "url": "https://promunch.in",
  "description": "Discover healthy gluten-free and soya-based snacks with PROMUNCH."
}
</script>
```

In the same spot, paste the full contents of `webpage-jsonld-corrected.liquid`.

### 4b. Leave the BreadcrumbList block as it is

The next block (`"@type": "BreadcrumbList"`) is correct. Do not touch it.

### 4c. FAQ block

Search for `never fried`. Select the WHOLE block below, from the line `{% if page.handle == 'faqs' or template contains 'faq' %}` down to and including its `{% endif %}` line, and delete it:

```liquid
{% if page.handle == 'faqs' or template contains 'faq' %}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What are PROMUNCH snacks made of?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "PROMUNCH snacks are made from premium quality roasted edamame and soya beans, offering a high-protein, healthy snacking alternative."
      }
    },
    {
      "@type": "Question",
      "name": "Are PROMUNCH snacks gluten-free and fried or roasted?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, PROMUNCH snacks are 100% roasted (never fried) and completely gluten-free."
      }
    }
  ]
}
</script>
{% endif %}
```

In the same spot, paste the full contents of `faq-jsonld-corrected.liquid`.

Now click **Save**. If Shopify shows a red error message, read it, fix the paste (usually a missing or doubled line at the start or end of a block), or use Rollback (Step 9).

### 4d. Fix the visible FAQ page too

Google and AI tools compare the hidden FAQ data with the text people see. Go to **Online Store > Pages > FAQs** (promunch.in/pages/faqs) and make sure the visible page:

- does NOT say "never fried", "100% roasted" or "completely gluten-free" for the whole range;
- includes the same answers as `faq-jsonld-corrected.liquid` (you can copy the answer sentences straight from that file).

If the FAQ page is built from a theme section instead of the page editor, edit it in **Online Store > Themes > Customize** on the FAQs page.

## Step 5. Remove duplicate Product and Organization data

Each page must have only ONE Product and ONE Organization. Your theme or an app may already add its own. We do not have a copy of your product template, so check these places.

### 5a. The product section (most likely)

1. In Edit code, open **Sections > main-product.liquid** (if it does not exist, try `product-template.liquid`, `main-product-*.liquid`, or the section your product template uses).
2. Press Ctrl+F and search, one at a time, for:
   - `structured_data`
   - `"@type": "Product"`
   - `"@type":"Product"`
   - `application/ld+json`
3. In a Dawn-based theme you will usually find this:

```liquid
<script type="application/ld+json">
  {{ product | structured_data }}
</script>
```

   Turn it off by putting `{% comment %}` on a new line ABOVE the `<script` line and `{% endcomment %}` on a new line BELOW the `</script>` line. Save. (Commenting out is safer than deleting: to undo, just remove the two comment lines.)

   If you instead find a long hand-written block with `"@type": "Product"` inside `<script type="application/ld+json"> ... </script>`, comment out that whole script block the same way.

4. Also check these files the same way: `snippets/` files with names like `structured-data`, `schema`, `json-ld`, `product-schema`, `seo`; and `templates/product.liquid` if it exists.

### 5b. The header (duplicate Organization)

Dawn-based themes add their own Organization data in **Sections > header.liquid**. Search that file for `"@type": "Organization"`. It usually looks like:

```liquid
<script type="application/ld+json">
  {
    "@context": "http://schema.org",
    "@type": "Organization",
    "name": {{ shop.name | json }},
    ...
  }
</script>
```

Comment out that whole script block with `{% comment %}` above and `{% endcomment %}` below. Right after it there is often a second block with `"@type": "WebSite"` inside `{%- if request.page_type == 'index' -%}`. Comment out that script block too (our Organization snippet already includes the WebSite). Save.

### 5c. Apps (Judge.me and SEO apps)

1. Open a product page on promunch.in in Chrome, right-click > **View page source** (or Ctrl+U). Press Ctrl+F and search for `Product"`. Look at each hit near `"@type"`. Also search `ProductGroup` and `Organization"`.
2. After Steps 3 to 5b, you should find exactly one `"@type": "Product"` (ours, it contains `"name": "PROMUNCH"` under `brand`) and exactly one `"@type": "Organization"` with `"@id": "https://promunch.in/#organization"`. The `seller` inside each offer also says Organization; that is part of our Product and is fine.
3. If you see another Product block, it comes from an app. Common ones:
   - **Judge.me**: in the Judge.me app settings, look for a rich snippets / Google structured data / SEO option and turn off Judge.me's own product snippet. Our snippet already shows Judge.me stars, because it reads the review metafields Judge.me syncs to Shopify (see Step 6). [CONFIRM: exact Judge.me menu name; check Judge.me help for "rich snippets".]
   - **SEO apps** (for example Smart SEO, TinyIMG, Booster, JSON-LD for SEO): turn off their Product and Organization schema, or turn the app embed off in **Online Store > Themes > Customize > App embeds**.

## Step 6. Metafields (reviews and protein)

### Reviews (stars)

1. Go to **Settings > Custom data > Products**.
2. You should see **Product rating** (`reviews.rating`) and **Product rating count** (`reviews.rating_count`). Judge.me fills these when its Shopify metafield sync is on.
3. If they are missing, turn on the metafield / "Shopify product rating" sync in Judge.me settings. [CONFIRM: sync is on and the values show on a product with reviews.]

Stars are only added when a product has at least 1 rating. Nothing is invented.

### Protein (optional but recommended for AI answers)

1. **Settings > Custom data > Products > Add definition**.
2. Name: `Protein per pack`. Namespace and key: `custom.protein_per_pack` (type it exactly). Type: **Single line text**. Save.
3. Open each product (**Products >** the product) and scroll to **Metafields**. Type the protein exactly as printed on the pack label, including the basis, for example `45.3 g per 100 g`. Leave it empty if you are not sure; empty products are simply skipped.

## Step 7. GTIN (barcode) check

The product snippet reads each variant's **Barcode** field. It only publishes a GTIN when the barcode:

- has 8, 12, 13 or 14 digits (spaces and hyphens are ignored), and
- passes the standard GS1 check digit test.

A typo is silently left out instead of being published wrong. So if a product does not show a GTIN in the test in Step 8, re-check that variant's Barcode against the pack. Indian EAN codes start with `890` and have 13 digits.

## Step 8. Validate

Wait 1 to 2 minutes after saving, then test these pages:

- a product with ONE variant
- a product with SEVERAL variants (packs or sizes)
- the homepage `https://promunch.in`
- `https://promunch.in/pages/faqs`

For each page:

1. **Google Rich Results Test**: https://search.google.com/test/rich-results . Paste the live URL, click **Test URL**.
   - Product pages: you should see **Product snippets** and/or **Merchant listings** with exactly 1 item, no red errors. Click in and check `brand` = PROMUNCH, `gtin13` present on variants that have a barcode, `aggregateRating` present on products with reviews.
   - Yellow warnings such as "Missing field shippingDetails" or "hasMerchantReturnPolicy" are optional and can be ignored for now.
   - FAQ page: Google only shows FAQ rich results for government and health sites, so it may say "not eligible". That is fine. AI tools still read it. Use the next tool to check it.
2. **Schema.org validator**: https://validator.schema.org . Paste the URL, click **Run test**. You should see 0 errors and, on a product page, one each of: Product, Organization, WebSite, WebPage, BreadcrumbList. On the FAQ page you should also see FAQPage. If you see two Product or two Organization entries, go back to Step 5.

## Step 9. Rollback (if anything looks broken)

- **One file**: in Edit code, open the file, click the **Older versions** dropdown at the top of the editor, pick the version from before today, and Save.
- **Everything**: Online Store > Themes > on `BACKUP before schema 2026-10-10` click **Publish**. The site is back to how it was before Step 2.
- **Just switch the new data off**: delete the 4 lines you added in Step 3 and Save. The new snippets then do nothing.

---

## Placeholder checklist (owner to fill)

In `snippets/promunch-organization-jsonld.liquid` (replace `PASTE_LINK_HERE`, keep the quotes, must start with `https://`):

- [ ] `pm_link_amazon_store`: PROMUNCH Amazon India brand store URL
- [ ] `pm_link_linkedin_company`: PROMUNCH LinkedIn company page
- [ ] `pm_link_forbes_article`: Forbes 30 Under 30 Asia 2025 page or article on Parth Mutha
- [ ] `pm_link_globalindian_article`: globalindian.com article on Parth Mutha / PROMUNCH
- [ ] `pm_link_parth_linkedin`: Parth Mutha's personal LinkedIn (goes on the founder)
- [ ] `pm_link_about_page`: pre-filled with `https://promunch.in/pages/about-promunch` (the brand facts page from `../brand-facts/`). Publish that page BEFORE this snippet goes live, or set this line to `PASTE_LINK_HERE` until it is live, so the schema never points at a missing page.

Already filled from the repo (check they still work): Instagram `https://www.instagram.com/promunch.snacks/`, Facebook `https://www.facebook.com/promunch.snacks`, YouTube `https://www.youtube.com/@PromunchYourMunchyPal` (the last two are the links in the promunch.in site footer, per `src/lib/email/brand-tokens.ts`). To remove one, replace it with `PASTE_LINK_HERE`.

In Shopify admin:

- [ ] Barcode (EAN-13) on every variant (in progress)
- [ ] `custom.protein_per_pack` metafield created and filled from pack labels (Step 6)

## [CONFIRM] items (facts to check before or right after install)

- [ ] **[CONFIRM: gluten-free]** Some Shopify product URLs and Amazon titles say "gluten free" (Himalayan Rock Salt Edamame, Roasted Soya Crunchies), but it is not confirmed for the whole range (Soya Sticks and Soya Chips). It is NOT in any snippet. If a product is certified gluten-free per its label, say so in that product's own description, not range-wide.
- [ ] **[CONFIRM: vegan]** One product URL says "vegan". Not used anywhere. Same rule as above.
- [ ] **[CONFIRM: protein numbers in the FAQ]** "42 to 45 g per 100 g" for Roasted Edamame and "45.3 g per 100 g" for Himalayan Rock Salt were owner-confirmed on 30 Sep 2026 for the email flows. Check against current pack labels.
- [ ] **[CONFIRM: Amazon India]** The FAQ says PROMUNCH is sold on promunch.in and Amazon India.
- [ ] **[CONFIRM: address]** The Organization uses the address from the PROMUNCH email footer: 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001. Remove the `address` block if you do not want it public in this form.
- [ ] **[CONFIRM: founding year and award]** 2021 (from Parth's founder email) and Forbes 30 Under 30 Asia 2025 (verified 30 Sep 2026).
- [ ] **[CONFIRM: contact]** The Organization lists customer service as `hello@promunch.in` (the inbox the team reads, per `src/lib/resend.ts`) and WhatsApp `https://wa.me/919981310247` (the PROMUNCH WhatsApp sender +91 99813 10247). Remove the `contactPoint` block if either should not be public.
- [ ] **[CONFIRM: product descriptions]** The product snippet copies each product's own description, so AI tools will repeat it. Check the Soya Sticks and Soya Chips product pages (and any combo that includes them) do not say "roasted", "never fried" or "gluten-free".
- [ ] **[CONFIRM: homepage meta description]** Online Store > Preferences > Homepage meta description. Remove any "gluten-free" or "never fried" claim there too. (Our WebPage block uses a fixed accurate sentence on the homepage, and each page's own meta description elsewhere.)
- [ ] **[CONFIRM: Judge.me]** Metafield sync on (Step 6) and Judge.me's own product snippet off (Step 5c).

## Notes for whoever maintains this later

- Facts in these snippets match the brand facts page (`../brand-facts/README.md` lists the source in the repo for each fact). If a fact changes, change it in both places so AI tools see one story.

- Organization `@id` is `https://promunch.in/#organization`. The Product's `seller` and the WebPage `publisher` point at it, so keep it identical everywhere.
- Price is `variant.price / 100` in the shopper's currency (`cart.currency.iso_code`, default INR).
- Product-level `sku` and GTIN are only added when the product has a single variant. Multi-variant products carry them per Offer.
- A later improvement could switch multi-variant products to Google's `ProductGroup` + `hasVariant` format and add `shippingDetails` / `hasMerchantReturnPolicy`. Not needed for Phase 1.
- Tested 10 Oct 2026 by rendering every snippet with liquidjs against fixture products (single and multi-variant, valid GTIN-8/12/13/14, bad check digit, wrong length, letters, empty barcode, spaces and hyphens, reviews on/off/zero, no images, empty description, out of stock) and parsing the output as JSON. All cases produced valid JSON.
