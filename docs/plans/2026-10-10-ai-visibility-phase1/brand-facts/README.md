# Brand facts page + llms.txt (AI visibility Phase 1, task 4)

Written 10 Oct 2026. Status: **content only, nothing installed.** This container cannot reach promunch.in and has no Shopify access, so every step below is for a human in Shopify admin.

Why: the 10 Oct 2026 AI discovery audit scored PROMUNCH 15/100. Asked "What does PROMUNCH sell?", the AI said it had no reliable information. These files give AI tools one clear, true, quotable source, and the same words for every profile.

**Before publishing anything, resolve every `[CONFIRM: ...]` marker.** They are visible on purpose. AI tools repeat what they read, so a wrong fact here is worse than a missing one. Search each file for `CONFIRM` and either fill in the true value from the pack label / Shopify admin, or delete the line.

## Files

| File | What it is | Where it goes |
|---|---|---|
| `about-promunch-page.html` | Body HTML for the brand facts page: one-line summary, quick facts, product table (roasted vs fried), who it is for, where to buy, shipping and payment, founder story, press, contact. Plain semantic HTML, no scripts, no styles. | Shopify page, handle `about-promunch` |
| `llms.txt` | The llms.txt file: H1, blockquote summary, key facts, then link sections (key pages, policies, Amazon, socials). Same facts as the page. | Source text for the template below |
| `page.llms-txt.liquid` | Shopify page template that prints the llms.txt text with no theme layout (`{%- layout none -%}`). Its body is a byte-for-byte copy of `llms.txt` plus a Liquid comment header. | Theme code, `templates/page.llms-txt.liquid` |
| `brand-descriptions.md` | The same positioning in four lengths (one-liner, short, long, 5 FAQ pairs) and a table of where to paste each. | Instagram, Amazon, LinkedIn, GBP, FAQ page, press kit |

If you edit `llms.txt`, regenerate the template so the two stay identical (keep the first 6 header lines of the `.liquid` file, replace the rest with `llms.txt`).

## Install steps (Shopify admin)

### A. Brand facts page

1. Resolve the `[CONFIRM]` markers in `about-promunch-page.html`.
2. Online Store, Pages, Add page. Title: `About PROMUNCH`.
3. In the content editor, click the `<>` (Show HTML) button and paste the whole file.
4. Search engine listing: handle `about-promunch` (URL becomes `promunch.in/pages/about-promunch`). Page title: `About PROMUNCH: high-protein soya snacks from India`. Meta description: the one-liner from `brand-descriptions.md`.
5. Theme template: `Default page`. Visibility: Visible. Save.
6. If an older `about-us` page exists, either redirect it to `/pages/about-promunch` (step C) or make sure its facts match. Two pages with different facts confuse AI tools.
7. **Link it from the footer:** Online Store, Navigation, Footer menu, Add menu item `About PROMUNCH` linking to the page. A footer link makes the page reachable from every page of the site, which helps crawlers find it.
8. **Organization schema:** another agent is writing the theme JSON-LD in `../theme/`. The Organization block should point at this page and use the same facts: `name` PROMUNCH, `url` https://promunch.in, `founder` Parth Mutha, `foundingDate` 2021, `address` Dewas, Madhya Pradesh 455001, IN, `slogan` Your Munchy Pal, `sameAs` the Instagram, Facebook and YouTube URLs below plus the Amazon store once confirmed, and the about page URL as `mainEntityOfPage` (or a `subjectOf`/link from the page). Do not put any `[CONFIRM]` value into the schema until it is resolved.

### B. llms.txt template and page

1. First check: `curl -sI https://promunch.in/llms.txt`. If it already returns 200 with real content (Shopify or an app may serve one), compare it before changing anything. A URL redirect only fires on paths that would otherwise 404.
2. Resolve the `[CONFIRM]` markers in `llms.txt`, then regenerate `page.llms-txt.liquid`.
3. Online Store, Themes, on the live theme click `...`, Edit code.
4. Templates folder, Add a new template. Type: `page`. Format: `liquid` (not JSON). Name: `llms-txt`. This creates `templates/page.llms-txt.liquid`.
5. Replace its contents with the whole of `page.llms-txt.liquid`. Save.
6. Online Store, Pages, Add page. Title: `llms.txt`. Content: leave empty (the template ignores it). Handle: `llms-txt`. Theme template: `llms-txt`. Visible. Save.
7. Check `https://promunch.in/pages/llms-txt` shows the plain text with no header or footer.

### C. Redirect /llms.txt

1. Online Store, Navigation, URL Redirects (in some admin versions: Navigation, then "View URL redirects"), Create URL redirect.
2. Redirect from: `/llms.txt`. Redirect to: `/pages/llms-txt`. Save.
3. Verify: `curl -sI https://promunch.in/llms.txt` should show a 301 with `location: /pages/llms-txt`, and `curl -sL https://promunch.in/llms.txt | head` should print `# PROMUNCH`.

When the theme is changed or a new theme is published, copy `templates/page.llms-txt.liquid` into the new theme too, or the page falls back to the default layout.

## Honest limits

- **It is not a true root file.** Shopify does not let you upload arbitrary files to the domain root. This setup serves the text at `/pages/llms-txt` with `Content-Type: text/html`, and `/llms.txt` is a 301 redirect to it. A tool that only accepts `text/plain` at exactly `/llms.txt` without following redirects will not read it.
- **Better options, and why not now:** (1) a Shopify app proxy cannot help, because app proxies only serve under prefixes such as `/apps/`, not the root; (2) an edge worker or reverse proxy in front of promunch.in could serve a real `text/plain` file at `/llms.txt`, but that means changing DNS for the live store, which is too risky for Phase 1. Revisit if Shopify adds native support.
- **llms.txt is an emerging convention, not a standard.** It is a proposal (llmstxt.org) that some tools read. There is no public evidence that it is a ranking factor or that the major AI assistants fetch it when answering. Treat it as cheap insurance. The about page, the footer link, the Organization schema and consistent third-party descriptions are the parts more likely to matter.
- The `llms-txt` page will appear in Shopify's pages sitemap. That is harmless. To hide it from search results, set the page metafield `seo.hidden` to `1`; it is still reachable by URL.
- Make sure `robots.txt` does not block AI crawlers from `/pages/` (the theme agent covers robots rules).

## [CONFIRM] checklist

Each item says where the marker appears and what the repo already hints. Repo hints are not confirmed facts; check the pack label or Shopify admin.

| # | What to confirm | Appears in | Repo hint |
|---|---|---|---|
| 1 | Legal entity name | page (Quick facts) | `promunch-email-agent/CLAUDE.md` §1 says "Vippy Industries Limited". Delete the line if you do not want it public. |
| 2 | Roasted Edamame single pack size in grams | page (table) | Test fixtures and Amazon test data mention "100g" and "Pack of 2"; not authoritative. |
| 3 | Noodle Masala Soya Crunchies pack size: 270g or 300g | page (table) | Shopify handle says `300-g`; image file and review page say 270g (`src/lib/email/flow-templates.ts`). |
| 4 | Soya Crunchies protein per 100g | page (table) | Bot test answer from the KB: "crunchies 15.2g/30g" (`docs/plans/2026-09-05-wa-bot-quality-audit.md`). |
| 5 | Soya Sticks full flavour list | page (table) | Chatpata Masala, Cream & Onion (Shopify combo handle in `flow-templates.ts`). |
| 6 | Soya Chips full flavour list | page (table) | Peri Peri. |
| 7 | Soya Sticks and Soya Chips protein per 100g, and whether they qualify for a "high protein" claim | page (table) | KB has a Chips protein figure of 3.55 (unit not recorded in the audit). If Sticks/Chips do not meet the FSSAI "high protein" claim threshold, keep "high-protein" for the brand but never apply it to those SKUs. |
| 8 | Current price for each line | page (table) | 30 Sep 2026 comment: Edamame Combo and Rock Salt x3 ₹600, Big Bite Munch Combo ₹1050. B2B scoring prompt says "₹399 to 499 packs" (`src/lib/leads/fit.ts`), unverified. Consider "from ₹X" so it does not go stale. |
| 9 | "Most PROMUNCH packs cost under ₹499" (the budget positioning) | brand-descriptions (Long) | Not verifiable from the repo. Delete the sentence if untrue. |
| 10 | Gluten free, vegan, vegetarian status per line | page (Good to know) | Shopify handles call Edamame Rock Salt and Crunchies "gluten-free" and Noodle Masala "vegan"; leads prompt says "vegan". Pack labels must back it before it goes on the page. |
| 11 | Green vegetarian mark on every product | page (Who it is for) | Not in repo. |
| 12 | Main ingredients and shelf life per line | page (Good to know) | Not in repo (beyond "roasted in olive oil" for Edamame). |
| 13 | FSSAI licence number | page (Good to know) | Not in repo. |
| 14 | Amazon brand store URL | page, llms.txt | KB has it (added 5 Sep 2026) but it is not in the repo. |
| 15 | HYPD store URL and whether to list HYPD | page (Where to buy) | HYPD is a live sales channel (`source_name` 341128478721); URL not in repo. |
| 16 | Standard delivery time | page (Shipping) | The Master KB has "the standard timeline"; not in repo. |
| 17 | Press and partnerships email | page (Contact) | parth@trypromunch.in is the B2B sender (AGENTS.md §5). `src/lib/resend.ts` notes trypromunch.in inbound is an SES endpoint, so confirm a human reads it, or use hello@promunch.in. |
| 18 | Forbes article URL | page (Founder, Press) | Credential checked 30 Sep 2026 per BU MET news + LinkedIn (`src/lib/email/brand-blocks.ts`). |
| 19 | Global Indian article URL | page (Founder, Press) | Title from the audit brief. |
| 20 | The Vegan Indians article URL | page (Press) | Its title says "4x More Protein Than an Egg". The page uses neutral link text on purpose; that claim is not verified. Only show the full title if the label supports it. |
| 21 | BodyFuel India listing URL, and that it still stocks PROMUNCH | page (Press) | From the audit brief only. |
| 22 | Shopify policy pages exist at the standard paths | llms.txt (Policies) | Standard Shopify paths; not checked live. |
| 23 | Blog `/blogs/news` is active | llms.txt (Optional) | One Google Alert fixture links a blog post. |
| 24 | X, LinkedIn, Google Business Profile, HYPD profiles exist | brand-descriptions (paste table) | Not in repo. |

Left out on purpose (not supported by the repo): kids' tiffin as a use case, "4x more protein than an egg", city of manufacture, certifications, and Beetroot Chips (B2B only, never D2C, per the 5 Sep 2026 owner decision).

## Sources per fact

| Fact used | Source in repo |
|---|---|
| Crunchies roasted; Sticks and Chips fried; never call the whole range roasted | `AGENTS.md` §5; `src/lib/influencers/brief-prompt.ts:75`; `src/lib/email-studio/templates.ts:4-6`; `src/lib/email/flow-templates.ts:116-118` |
| Roasted Edamame roasted in olive oil; olive oil is Edamame only | `src/lib/email/flow-templates.ts:119-122`; `docs/plans/2026-10-07-app-redesign/01-brand.md:92` |
| Edamame flavours: Himalayan Rock Salt, Indori Chatka, Masala Mania | `src/lib/email/flow-templates.ts:697,733`; `promunch-email-agent/supabase/functions/_shared/orm-enrich.ts:87` |
| Edamame protein 42 to 45g per 100g; Rock Salt 45.3g | `src/lib/email/flow-templates.ts:119-122,605` (owner, 30 Sep 2026); KB corrections in `docs/plans/2026-09-05-wa-bot-quality-audit.md:143` |
| Crunchies flavours: Tangy Pudina, Peri Peri, Cheese & Onion, Noodle Masala | `src/lib/email/flow-templates.ts:123-124,480,699` |
| Crunchies 150g packs; Sticks and Chips 80g; Travel Combo 9 x 25g; Big Bite Munch Combo pack of 7 | Shopify product handles in `src/lib/email/flow-templates.ts:160-198` |
| Only Tangy Pudina Soya Crunchies is Jain friendly | `promunch-email-agent/supabase/functions/wa-ai-reply/prompt.ts:33`; audit doc line 139 |
| Free shipping ≥ ₹599 else ₹99; COD +₹50; prepaid 5% off | `AGENTS.md` §5; `docs/whatsapp/VOICE_AGENT_SETUP.md:91` |
| Order tracking via order status page | `AGENTS.md` §5 |
| Founder Parth Mutha; founded 2021; Forbes 30 Under 30 Asia 2025; "fried namkeen and chips with very little protein" story | `src/lib/email/flow-templates.ts:288-289,454-455`; `src/lib/email/brand-blocks.ts:28-39` |
| Based in Dewas, Madhya Pradesh; full address | `src/lib/email/brand-tokens.ts:86` (footer address, "the real PROMUNCH address") |
| Tagline "Your Munchy Pal" | `AGENTS.md` §5; `src/lib/email/brand-tokens.ts:81` |
| Instagram, Facebook, YouTube URLs | `src/lib/email/brand-tokens.ts:96-100` ("as linked from the promunch.in site footer") |
| Customer email hello@promunch.in | `src/lib/resend.ts:20-32` (owner decision, 29 Sep 2026) |
| WhatsApp +91 99813 10247 | `docs/architecture/PROMUNCH_WHATSAPP_CURRENT_STATE.md:52`; `supabase/migrations/20261007200000_bulk_inquiries.sql:76` |
| Support hours Mon to Fri 10 to 6, Sat 10 to 5 | `docs/plans/2026-09-05-wa-bot-quality-audit.md:139,145` |
| Sold on promunch.in and Amazon (and HYPD) | `CLAUDE.md` (Amazon SP-API, HYPD channel map); `src/app/dashboard/sales/channels/page.tsx:34` |
| Use cases: office, after a workout, gifting, office pantry, events, resale | `src/lib/email/flow-templates.ts:603`; `src/lib/bulk-inquiry/schema.ts:8-14`; `src/lib/bulk-inquiry/embed-script.ts:111-117` |
| Serving ideas: bhel, upma, soup, salad, wraps, sandwiches | `src/lib/email/flow-templates.ts:125,603` |
| Store URLs: /collections/all, /collections/best-sellers, edamame collection, /collections/combos-and-gift-packs, /pages/faqs, /pages/bulk-orders | `src/lib/email/flow-templates.ts:151-158`; `src/lib/bulk-inquiry/embed-script.ts:2` |
| Edamame is young soybean | General botany (not a PROMUNCH claim) |

## Contradictions found in existing repo copy

Fix these so every channel says the same thing (not edited here; this task writes only to this folder):

1. **Whole range called "roasted":** `CLAUDE.md:9`, `AGENTS.md:11` and `README.md:193` say "high-protein roasted soya snacks". Internal only, but agents copy it.
2. **Customer-facing voice agent prompt says the whole range is roasted:** `docs/whatsapp/VOICE_AGENT_SETUP.md:89` and `docs/plans/2026-08-26-sarvam-voice-cart-recovery.md:1299` ("a friendly Indian snack brand making high-protein roasted soya snacks"). If the live Sarvam agent uses this text, Maya can tell callers fried Sticks and Chips are roasted.
3. **"Only Crunchies are roasted"** in `AGENTS.md` §5 and `src/lib/influencers/brief-prompt.ts:75` ignores Roasted Edamame, which is also roasted (in olive oil). `src/lib/email-studio/templates.ts:5` has it right ("only Crunchies and Edamame are roasted").
4. **Ambiguous bulk form copy:** `src/lib/bulk-inquiry/embed-script.ts:111` "High-protein roasted edamame and soya snacks" can read as all soya snacks being roasted.
5. **Marketing sender:** `AGENTS.md` §5 says hello@trypromunch.in; `src/lib/resend.ts:20` says customer email is ALWAYS hello@promunch.in (owner decision, 29 Sep 2026). This folder uses hello@promunch.in.
6. **Indori Chatka protein:** KB corrected to 42.9g per 100g (audit doc line 143), email copy says 42g. The range "42 to 45g" used here is true either way.
7. **Noodle Masala pack size:** 270g (image, review page) vs 300g (Shopify handle). See CONFIRM 3.
8. **Crunchies flavour name:** live copy says Cheese & Onion; some test fixtures and a sample SQL say "Cream & Onion Crunchies". Cream & Onion looks like a Sticks flavour. Used Cheese & Onion for Crunchies here.

## Copy checks done

PROMUNCH in capitals in all copy (lowercase only in URLs and handles), no em dashes or en dashes in any file, no mention of the old agency name, no "best" or "No. 1" claims, tagline "Your Munchy Pal" kept, short declarative sentences.
