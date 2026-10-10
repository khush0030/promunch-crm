# Which GTIN goes on which Shopify listing

Built 10 Oct 2026 from 28 pack photos (`gtins.csv`, `pack-facts.md`) and the live store (`promunch.in/products.json`, 24 listings, 1 variant each).

## The rule

A GTIN names one exact sellable item. The barcode on a single 100g pack is NOT the GTIN of a "Pack of 2" or a mixed combo. Putting it there tells Google and Meta the listing is one pack at the combo price, which causes price mismatches and disapprovals.

- **Single pack listing** → enter that pack's GTIN in Shopify Barcode.
- **Same item x N (multipack)** → either a new GTIN for the multipack, or the single pack GTIN plus `multipack = N` in Google Merchant Center (supplemental feed). Do NOT leave it as a plain single-pack GTIN.
- **Mixed combo / gift box (bundle)** → a new GTIN for the combo, or the main item's GTIN plus `is_bundle = yes` in Merchant Center.

PROMUNCH's GS1 prefix is `8908002854xxx`, so new numbers for combos come from the same allotment in GS1 India DataKart.

## Listing by listing

| # | Listing (price) | What it is | Barcode to enter now | Better long term |
|---|---|---|---|---|
| 1 | Noodle Masala Soya Crunchies 270gm (₹260) | single pack | **8908002854794** | done |
| 2 | Soya Sticks Chatpata Masala 100gm x 2 (₹300) | multipack 2 x 8908002854381 | leave blank, or 8908002854381 + `multipack 2` in GMC | new GS1 GTIN |
| 3 | Roasted Edamame Masala Mania, Pack of 2 (₹400) | multipack | leave blank | new GS1 GTIN; [CONFIRM] pack size inside |
| 4 | Roasted Edamame Indori Chatka, Pack of 2 (₹400) | multipack | leave blank | same |
| 5 | Himalayan Rock Salt Edamame, Pack of 2 (₹400) | multipack | leave blank | same |
| 6 | Masala Mania Roasted Edamame Snacks (₹570, SKU 3PK) | multipack of 3 | leave blank | same |
| 7 | Indori Chatka Roasted Edamame Snacks (₹570, SKU 3PK) | multipack of 3 | leave blank | same |
| 8 | Himalayan Rock Salt Roasted Edamame Snacks (₹570) | multipack of 3 | leave blank | same |
| 9 | Edamame Travel Combo, 25g x 9 (₹450) | bundle of 3 flavours | leave blank | new GS1 GTIN |
| 10 | Roasted Edamame Beans Combo (₹570) | bundle | leave blank | new GS1 GTIN |
| 11-13 | Variety Pack Crunchies / Protein Snacks, 150g x 3 (₹450), 3 listings | bundles | leave blank | new GS1 GTIN each |
| 14 | Assorted Flavored Pack 150g x 4 (₹570) | bundle | leave blank | new GS1 GTIN |
| 15 | Assorted Flavored Pack 270g x 4 (₹1040) | bundle | leave blank | new GS1 GTIN |
| 16 | Travel Combo Pack of 12, 30g (₹360) | bundle | leave blank | new GS1 GTIN |
| 17 | Ultimate Munch Combo 30g x 7 (₹207, out of stock) | bundle | leave blank | new GS1 GTIN |
| 18 | Soya Sticks combo Chatpata + Cream & Onion x 2 (₹300) | bundle | leave blank | new GS1 GTIN |
| 19 | Sticks + Chips combo, pack of 3 (₹450) | bundle | leave blank | new GS1 GTIN |
| 20 | Big Bite Munch Combo (₹1050) | bundle | leave blank | new GS1 GTIN |
| 21 | Diwali Snack Box (₹555) | gift box | leave blank | new GS1 GTIN if sold year round |
| 22 | Corporate Diwali Gift Hamper (₹999) | gift box | leave blank | same |
| 23-24 | VAMA Soya Mini Chunks / Soya Flour dual packs (₹440) | VAMA brand, multipack | leave blank | use VAMA's own barcode x 2 rules; not photographed |

## Single packs that have a GTIN but no listing

These have verified GTINs and an MRP printed, yet the store does not sell them on their own:

| Pack | MRP | GTIN |
|---|---|---|
| Crunchies 150g: Tangy Pudina / Peri Peri / Noodle Masala / Cheese & Onion | ₹150 | 8908002854824 / 8908002854503 / 8908002854589 / 8908002854596 |
| Crunchies 270g: Peri Peri / Cheese & Onion | ₹260 | 8908002854787 / 8908002854800 |
| Sticks 100g: Cream & Onion / Chatpata Masala | ₹150 | 8908002854398 / 8908002854381 |
| Fried line 100g, pink and maroon packs (name not in photo) | ₹150 | 8908002854138 / 8908002854404 |
| Edamame 150g: Indori Chatka / Masala Mania / Himalayan Rock Salt | ₹250 | 8908002854954 / 8908002854213 / 8908002854350 |
| 30g packs (Crunchies x 4, Sticks x 2, fried pink/maroon) | not printed | see `gtins.csv` |

Listing even a few of these (₹150 to ₹260) would give the store real "under ₹499" products with clean GTINs, which is exactly the shopping question the audit asked. Business call: below ₹599 the customer pays ₹99 shipping.

## Open questions for the owner

1. Pink and maroon fried packs: which product and flavour is each? (One is probably Soya Chips Peri Peri.)
2. Edamame unsized packs: which GTIN of each pair is the 25g pack and which the bigger one (8908002854534 vs 8908002854930 Rock Salt; 8908002854527 vs 8908002854923 Indori Chatka; 8908002854510 vs 8908002854916 Masala Mania)?
3. 150g pack 8908002854589: confirm Noodle Masala (identified by colour only, lowest confidence).
4. What is inside the Edamame "Pack of 2" (₹400) and "3PK" (₹570) listings?
