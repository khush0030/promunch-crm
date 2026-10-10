# On-site content: 4 blog articles + FAQ expansion (AI visibility Phase 2)

Written 10 Oct 2026. Status: **drafts only. Nothing is published, nothing is committed.** No Shopify access from this container; every step below is for a human in Shopify admin.

Why: the 10 Oct 2026 audit found AI assistants answer "best protein snacks in India", "best healthy snacks in India" and "best protein snacks under ₹499" without naming PROMUNCH. AI answers often quote clear, factual comparison pages. These pages aim to be the honest, sourced comparison a shopper (or an AI) would cite: fair to other snack types, plain about which PROMUNCH snacks are roasted and which are fried, and with a source for every generic number.

PROMUNCH facts come only from `docs/plans/2026-10-10-ai-visibility-phase1/brand-facts/` (README, about-promunch-page.html, brand-descriptions.md, llms.txt). Anything else about PROMUNCH is a visible `[CONFIRM: ...]` marker.

## Files

| File | What it is | Words (body) |
|---|---|---|
| `01-protein-snacks-under-499.html` + `.md` | "Best High-Protein Snacks in India Under ₹499: A Guide". Protein per 100g and per ₹100, category by category (chana, makhana, bars, nuts, soya, edamame), where PROMUNCH fits | about 1,450 |
| `02-soya-vs-chickpea-vs-whey.html` + `.md` | "Soya vs Chickpea vs Whey: Protein Per Serving Compared". Per 100g, per serving, PDCAAS and DIAAS, ICMR-NIN RDA | about 1,050 |
| `03-roasted-vs-fried-snacks.html` + `.md` | "Roasted vs Fried Snacks: What Actually Changes". Fat, protein, acrylamide, labels; PROMUNCH roasted vs fried table | about 1,000 |
| `04-healthy-office-snacks-india.html` + `.md` | "Healthy Office Snacks in India: 10 Ideas With Protein Data". Table with protein per portion, fridge needs, pantry tips | about 1,150 |
| `faq-expansion.md` | 15 new FAQ Q&As for /pages/faqs, plus a JSON-LD fragment (12 entries) to append to the phase 1 FAQPage block | 15 Q&As |

Each `.html` is a Shopify-ready article body: `h2`, `h3`, `p`, `ul`, `ol`, `table`, `a` only. No `h1` (Shopify prints the article title as the H1), no scripts, no inline styles. Each `.md` holds the front matter (title, meta description, URL handle), internal link plan, suggested FAQ schema Q&As, the article's `[CONFIRM]` list and its sources.

## Publishing order

1. **Resolve the phase 1 brand facts first.** Publish `/pages/about-promunch` (phase 1) before any article, since every article links to it.
2. **FAQ expansion** (`faq-expansion.md`): add the Q&As to the visible FAQ page and the JSON-LD. Quick win, no new URLs.
3. **Article 3, Roasted vs fried.** It has the fewest open markers (fat per 100g and flavour lists, or drop the fat column) and it corrects the old "all roasted" story in public. Publish first.
4. **Article 2, Soya vs chickpea vs whey.** No open markers in the body. Publish second.
5. **Article 4, Office snacks.** No open markers in the body. Publish third.
6. **Article 1, Under ₹499 guide.** Publish last, because it needs current prices and protein per 100g for Crunchies, Sticks and Chips, plus a decision on the "under ₹499" claim. If that claim is false, rewrite the angle (for example "protein snacks under ₹599") before publishing.
7. After each article goes live, go back and turn the suggested cross-links in the earlier articles into real links (see table below).
8. Add the blog to the footer or main menu if it is not already linked, and confirm `/blogs/news` is active (phase 1 CONFIRM 23).

## How to publish one article (Shopify admin)

1. Online Store, Blog posts, Add blog post. Blog: `News`.
2. Title: the `title` from the article's `.md` front matter.
3. Content: click `<>` (Show HTML) and paste the whole `.html` file.
4. Resolve or delete every `[CONFIRM: ...]` marker on the page. Search the editor for `CONFIRM`.
5. Add the internal links listed in the `.md` (only the About link and bulk form link are live in the HTML).
6. Search engine listing: page title = `title`, meta description = `meta_description`, URL handle = `url_handle`.
7. Author: PROMUNCH team. Excerpt: the "Short answer" paragraph.
8. Optional: FAQ schema. Shopify article bodies should not carry scripts, so add Article FAQ JSON-LD through the theme (an article metafield rendered in `templates/article`) or a FAQ app, using the Q&As in the `.md`. The visible FAQ section in each article already matches those Q&As word for word.
9. Save as visible. Check the live page on a phone (tables scroll sideways on small screens in most themes; if not, ask for a theme CSS fix rather than adding inline styles).

## Internal linking

Every article links to `/pages/about-promunch`. Articles link to each other as below once all are live.

| From \ To | 01 Under ₹499 | 02 Soya vs chickpea vs whey | 03 Roasted vs fried | 04 Office snacks |
|---|---|---|---|---|
| 01 Under ₹499 | | "Soya and edamame snacks" section | "Where PROMUNCH fits" bullets | |
| 02 Soya vs chickpea vs whey | "So which should you choose?" | | "Where PROMUNCH fits" | |
| 03 Roasted vs fried | "How to read a snack label" | | | |
| 04 Office snacks | | Idea 7 or 10 | Idea 2 | |

Also link to the articles from: the FAQ page (a "Read more" line under the roasted vs fried and protein answers), and the About PROMUNCH page (a short "Guides" list at the end).

### Product and collection pages to link

| Page | URL | Status |
|---|---|---|
| About PROMUNCH | /pages/about-promunch | Phase 1 page, publish first |
| FAQs | /pages/faqs | Exists |
| All products | /collections/all | Exists (from llms.txt) |
| Best sellers | /collections/best-sellers | Exists (from llms.txt) |
| Roasted Edamame | /collections/roasted-edamame-beans-high-protein-healthy-snacks-for-weight-loss | Exists. See the warning below. |
| Combos and gift packs | /collections/combos-and-gift-packs | Exists |
| Bulk and corporate orders | /pages/bulk-orders | Exists |
| Soya Crunchies | [CONFIRM: collection URL] | Not in brand facts |
| Soya Sticks and Soya Chips | [CONFIRM: collection or product URLs] | Not in brand facts |
| Edamame Travel Combo | [CONFIRM: product URL] | Not in brand facts |

**Warning about the Roasted Edamame handle.** The live handle contains "healthy-snacks-for-weight-loss". That reads as a weight-loss claim, which our copy rules avoid and FSSAI claim rules restrict. Do not use the handle words as anchor text; use "Roasted Edamame". Consider renaming the handle to `roasted-edamame` with a URL redirect from the old one (Shopify offers the redirect when you change a handle). Owner decision; flagged, not changed.

## [CONFIRM] checklist (all files)

Resolve from the pack label or Shopify admin, or delete the line. Several repeat the phase 1 list; resolving them once in phase 1 resolves them here.

| # | What to confirm | Where it appears | Phase 1 ref |
|---|---|---|---|
| 1 | Current price of Roasted Edamame, Soya Crunchies, Soya Sticks, Soya Chips | 01 (PROMUNCH table) | #8 |
| 2 | "Most PROMUNCH packs cost under ₹499" | 01 (bullet) | #9 |
| 3 | Soya Crunchies protein per 100g | 01 (table), faq Q7 | #4 |
| 4 | Soya Sticks and Soya Chips protein per 100g, and whether they meet the FSSAI "high protein" threshold | 01 (table), faq Q7 | #7 |
| 5 | Fat per 100g for each line (or drop the column) | 03 (table) | new |
| 6 | Soya Sticks full flavour list | 03 (table), faq Q4 | #5 |
| 7 | Soya Chips full flavour list | 03 (table), faq Q4 | #6 |
| 8 | Vegetarian, vegan, gluten free status per line | faq Q8 | #10 |
| 9 | Order confirmation email and WhatsApp include the order status link | faq Q13 | new |
| 10 | Soya Crunchies collection URL | link plans in 01, 02, 03 `.md` | new |
| 11 | Soya Sticks and Chips product or collection URLs | link plan in 03 `.md` | new |
| 12 | Edamame Travel Combo product URL | link plan in 04 `.md` | new |

Articles 02 and 04 have no `[CONFIRM]` markers in the body.

## Generic figures to double-check before publishing

These are not PROMUNCH facts, but they are quoted, so a quick second check is worth it.

| Figure | Why it needs a second look |
|---|---|
| Roasted chana about 22g protein per 100g (ICMR-NIN, *Nutritive Value of Indian Foods*) | Found via a secondary summary; the NIN site blocks automated download. Check a print or PDF copy (roasted Bengal gram entry). |
| Makhana 8g to 12g protein per 100g | Published values vary (8.7% popped, 10 to 12%, 11.16%). The range is honest; do not narrow it to a single number without a primary source. |
| PDCAAS/DIAAS for chickpeas (0.52 / 0.67) | Taken from the ADPI 2025 guide table (a dairy industry body). Whey and soy values come from Rutherfurd et al. 2015 (peer reviewed). |

## Sources list (all articles)

Generic nutrition data:

- USDA FoodData Central, https://fdc.nal.usda.gov/ . Entries used: Egg, whole, raw, fresh (FDC 171287); Nuts, almonds (FDC 170567); Soybeans, mature seeds, dry roasted (FDC 172441); Soybeans, mature seeds, raw; Soy flour, defatted; Edamame, frozen, prepared; Chickpeas, mature seeds, raw; Chickpeas, mature seeds, cooked, boiled, without salt (FDC 173757); Peanuts, all types, dry-roasted, with salt; Yogurt, Greek, plain, nonfat (FDC 170894); Potatoes, flesh and skin, raw (FDC 170026); Snacks, potato chips, plain, salted. Values were read through mirrors that reproduce USDA data (myfooddata.com, medindia.net, urmc.rochester.edu, mealstack.io, proteinatlas.ca, bodypalapp.com, Wikipedia), because the USDA API is blocked from this container. Each `.md` lists the exact page.
- ICMR-NIN, *Nutritive Value of Indian Foods* (roasted Bengal gram).
- ICMR-NIN, *A Brief Note on Nutrient Requirements for Indians* (RDA 2020), https://www.nin.res.in/rdabook/brief_note.pdf
- Almond Board of California, almond composition chart (USDA SR28), https://www.almonds.org/sites/default/files/2020-04/almond_forms_nurtrient_chart_redesign.pdf
- Makhana: NIFTEM PMFME makhana write-up, https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/08/makhanawriteup.pdf ; Phytojournal 2019 8(2), https://phytojournal.com/archives/2019/vol8issue2/PartAB/8-1-196-886.pdf ; Asian Journal of Dairy and Food Research DR-2325, https://arccjournals.com/journal/asian-journal-of-dairy-and-food-research/DR-2325
- Whey: American Dairy Products Institute, https://adpi.org/ingredient-resources/whey-protein-concentrate
- Protein quality: Rutherfurd SM et al., J Nutr 2015;145(2):372-379, https://pubmed.ncbi.nlm.nih.gov/25644361 ; ADPI Protein Quality Guide 2025, https://adpi.org/wp-content/uploads/2025/07/ADPI-Protein-Quality-Guide_2025.pdf ; FAO Expert Consultation, Dietary protein quality evaluation in human nutrition (2013).
- Chickpea limiting amino acids: Acta Scientific Nutritional Health, https://actascientific.com/ASNH/pdf/ASNH-08-1464.pdf

Regulation and food safety:

- FSSAI, Food Safety and Standards (Advertising and Claims) Regulations, 2018, Schedule I (protein claim thresholds), https://www.fssai.gov.in/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf
- EFSA, Acrylamide, https://www.efsa.europa.eu/en/topics/topic/acrylamide and infographic https://www.efsa.europa.eu/en/discover/infographics/acrylamide-food
- US FDA, Acrylamide and Diet, Food Storage, and Food Preparation, https://www.fda.gov/food/process-contaminants-food/acrylamide-and-diet-food-storage-and-food-preparation

No competitor brand or product is named anywhere, so no competitor figures needed verifying.

## Copy checks done

- PROMUNCH in capitals in all copy (lowercase only in URLs and handles).
- No em dashes or en dashes in any file (checked with a script for U+2012 to U+2015).
- No mention of the old agency name.
- No "best" or "No. 1" claim about PROMUNCH. "Best" appears only in article 1's title, describing the search category, and in plain phrases like "best kept cool".
- No medical or weight-loss claims. Article 2 points readers to a doctor or dietitian for personal protein needs.
- Tagline "Your Munchy Pal" used once, at the end of each article.
- Every article states that Roasted Edamame and Soya Crunchies are roasted and Soya Sticks and Soya Chips are fried, or links to a page that does.
