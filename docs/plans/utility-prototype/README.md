# PROMUNCH utility redesign review

Open `index.html` in a browser, or serve this folder locally. The current local review URL is http://127.0.0.1:8765/index.html.

This is a reviewable design proposal, not a replacement for the production app. It contains 76 screen designs that adapt to desktop and mobile, plus a checklist mapping all 38 current page routes. Several current routes intentionally consolidate into one destination; inactive features have an explicit retirement decision rather than new everyday navigation.

## Review controls

The bar above the app is for design review only:

- Screen: jump to any page, detail view or process step.
- Desktop / Mobile 390 / Mobile 360: compare responsive layouts.
- State: inspect normal, loading, empty, error, stale-data and permission patterns.
- Page & flow checklist: inspect the route inventory and ten primary process maps.

The app itself uses a simple light theme, one font, readable grey sections and status colors accompanied by text. Mobile tables become labelled records. Desktop support keeps customer and order details visible; mobile breaks that into linked views.

## Review these journeys first

1. Home → urgent SKU → replenishment calculation → shipment review.
2. Inbox → customer conversation → customer/order details → ticket.
3. Amazon → profit → costs; payouts → independent fee difference → order.
4. Outreach → find → verify → draft → review every email → batch approval → replies → deal.
5. Deals → table or board → next action → sample evidence.
6. Email campaign → audience → content → preview → review/schedule → report.
7. WhatsApp campaign → opted-in audience → approved template → review → report.

A draft edit clears its review approval. Batch approval is blocked until all ten emails are reviewed. Changes to sample draft content persist for the browser session. Search filters work on list rows. Sample replies, assignment, import mapping/review and confirmation dialogs demonstrate interaction. Shipment quantity carries into review and checks whole cartons and transferable stock.

## Scope and limits

All business figures, people and companies in the UI are illustrative. No production API is called. No actual email, WhatsApp message, stock transfer, invitation, credential change or financial reconciliation occurs.

These are screen designs with selective interactions, not a fully functioning app. Several period/status selectors, settings controls, provider actions and forms demonstrate layout only. Shared failure states are generic patterns, not individually written exception handling for all integrations. Dispatch, credential rotation and provider submissions show explanatory dialogs; their full forms and provider-specific validation remain implementation detail work. Forecast inputs other than planned shipment quantity are illustrative and do not recalculate live.

Some explanatory notes intentionally expose the data prerequisites for review. During implementation, move internal integration details into reviewer/developer documentation and retain concise user-facing availability messages.

## Data decisions still needed before implementation

- Full warehouse-to-sellable lead time, including appointment wait. The worked example assumes an appointment today and ten days afterward; founder confirmation is still required.
- Warehouse SKU/location mapping, reservations, usable stock and dated incoming shipments.
- A stockout-aware demand model, outlier/promotion handling and forecast backtesting.
- Product cost coverage and a consistent contribution-profit definition.
- Unified order-date revenue, taxes, shipping, discounts, cancellations and refunds across channels.
- Repeat rate is unique buyers in the period with a purchase before the period; Shopify-only until cross-channel identity is reliable.
- Independent expected Amazon fees and separate bank reconciliation evidence.
- B2B mailbox verification and reply routing from Parth to the Deals workflow.
- Real Brevo automation capabilities and health, while preserving active legacy cart recovery.
- Business-hour response deadlines and role permissions.

Refer to the [blueprint](../2026-09-21-utility-redesign-blueprint.md), [project audit](../../audits/2026-09-21-project-flow-redesign-audit.md), and [email history analysis](../../audits/2026-09-21-email-followup-redesign.md) for supporting evidence.

## Verification

- 76 screens rendered at 1366, 390 and 360 pixels: 228 checks, no horizontal document overflow or JavaScript page errors.
- Every current `page.tsx` route mapped to a prototype destination or explicit consolidation/retirement decision.
- Batch gate verified before and after individual review of ten drafts.
- Order search filtered to one matching row.
- Loading, empty, error, stale and no-permission states inspected on Stock.
- Desktop and mobile UI visually inspected in the in-app browser.
- Prototype JavaScript syntax and targeted ESLint checks passed.
- Existing test suite: 41 files, 638 tests passed.
- Full repository lint: 218 existing errors and 44 warnings outside this prototype after fixing the prototype registry warning.
- Production build remained at optimization without a completion result and was stopped. Build success is unverified; no production app files were changed.
- Draft edits clear approval and persist locally; shipment quantities carry into the review step.

No production changes deployed. Review artifacts are local and uncommitted.

## PROMUNCH brand pass

The prototype now uses the existing PROMUNCH assets from `public/pm-logo-wide.png` and `public/pm-logo-48.png`, copied without modification into `assets/`. The shared brand stylesheet applies to all 76 screens, including account and email preview screens. The review shell and checklist also carry the brand styling.

The palette follows the app’s existing brand tokens: red `#AF272F`, cyan `#0A9CB8`, yellow `#FFC905`, and orange `#E86A24`. Darker variants support readable text. Neutral light surfaces and a single font retain the utility layout. Status colors are separate from branding and always paired with labels.

Added visual cues: compact metric icons, section icons, colored chart series with labels, product marks, selected-navigation indicators, process-step colors and pipeline lane accents. No additional KPIs were introduced.

Brand verification: all 76 screens checked at 1366, 390 and 360 pixels, with no horizontal page overflow, missing logo assets or JavaScript page errors. Targeted prototype lint and syntax checks passed. Desktop and mobile home screens were visually reviewed. Production code was not changed or deployed by this pass.

## Selected direction: B · Bold brand

The user selected Bold brand. It is now the default for the review shell and standalone screens. Continue refinement with strong PROMUNCH color blocks, prominent KPI values and clear primary buttons, preserving simple layouts, readable status labels and mobile usability. A and C remain available for comparison.

## Three visual directions

Open `compare.html` to compare Soft depth, Bold brand, and Compact utility. The comparison previews six representative pages at desktop or mobile sizes. Each Explore link opens the full 76-screen prototype with that direction. The Style selector changes it without changing the chosen screen. Narrow browser panels stack the three previews vertically; the A/B/C links jump between them.

KPI cards now include clearer value hierarchy, supporting visual summaries on Home (channel mix, repeat-buyer ring and product rank), and distinct icon treatments. Buttons have directional icons, clearer primary/secondary emphasis, coordinated action areas, and focus/hover/pressed states with reduced-motion support.

Verified all 76 screens in all three styles at 1366px and 360px: 456 render/overflow/style checks passed with no JavaScript page errors. Prototype lint passed. Production code remains unchanged; review files are local and uncommitted.

## Selected Bold direction: visual refinement

The `refinement.css` layer refines B across the prototype: balanced red/cyan/yellow KPI surfaces, quieter panel headers, consistent spacing, proportional type, understated secondary buttons, coordinated form actions, and simpler navigation. Primary actions retain brand emphasis. The chart now has currency-axis labels, a clearer baseline, daily points and an area fill. Home channel bars use the actual shares of the illustrative revenue total, and the contribution bar explicitly labels its denominator.

Validation: 228 render checks across all 76 screens at 1366px, 390px and 360px passed without document overflow, broken images or JavaScript page errors. Targeted JavaScript lint and syntax passed. Desktop home visually inspected. Production app code and deployment are unchanged.

### Control polish, 21 September

Shared custom select menus replace native dropdowns inside the application, including Inbox priority/owner, product ranking, and deal stage. Menus support arrow keys, Home/End, typeahead, Enter, Escape, Tab and outside-click dismissal. Native form values and existing change handlers remain connected. Review-shell selectors and date pickers remain browser controls.

Updated button proportions, compact back links, lighter form text, grouped product filters, and bounded bank-confirmation fields. All 76 screens checked at 1366px and 360px without horizontal overflow; six core screens also checked at 390px. Keyboard selection and product ranking verified. Scoped JavaScript lint and syntax checks passed. This is an uncommitted local prototype update, not a production deployment.

### Premium surfaces and connected navigation

Cost entry now separates amber product cost, blue packaging, purple fees, and green contribution, with red for loss. The illustrative calculator updates as cost inputs change and explicitly leaves profit uncalculated when inputs are missing. Shared writing surfaces add a recognizable composer header, comfortable text spacing, a draft/internal label, and character count. Stock pack sizes expand into structured SKU details. Bank forms, support email, website sales, and dialogs share the refined surfaces.

Website sales and Support email are directly reachable from the sidebar and retain their section tabs. Support replies link back to the email list. Parent sections remain highlighted on detail screens, and changing the review URL hash updates the preview frame. Verified Sales → Website → All channels and Support email → Reply → Back inside the same review shell.

Verification: all 76 screens checked at 1366, 390 and 360 pixels with no horizontal overflow or runtime errors. Cost preview checked for positive contribution (₹120), loss (−₹50), and missing-input state. Changed JavaScript passes syntax and scoped lint checks. Local prototype only; uncommitted and not deployed.

### Maya conversational workspace

Maya now has a dedicated welcome screen, four suggested business questions, an expanding composer, inline conversation turns, follow-up prompts, and a New chat control. Visual answer examples cover restocking, sales, profit, and support, with metric cards, comparisons, assumptions, and links to relevant CRM screens. All answers are explicitly illustrative; arbitrary input selects a topic example or shows the prototype limitation. No live model, business query, or external action is connected. Conversations live in memory for the current page session.

Verified welcome and answer layouts at 1366, 390 and 360 pixels without horizontal overflow, plus follow-up submission, Enter-to-send, New chat reset, and disabled empty submission. JavaScript syntax and scoped lint checks pass. Local prototype only, uncommitted and not deployed.

### Outreach workspace refinement

Find uses selectable sector cards and a live search brief. Draft pairs a campaign brief and fixed founder sender with an illustrative recipient-style email example. Review replaces the collapsed list with a company queue, one visible editor, per-draft review state, and a progress bar. The mobile queue scrolls horizontally above the editor. Sample results remain ten fixed companies; no discovery, generation, or sending service is connected.

Verified Find, Draft and Review at 1366, 390 and 360 pixels without horizontal overflow. Company switching, review progress, edit invalidation, onward navigation, and blocking batch approval before all ten reviews passed. Changed JavaScript passes scoped lint and syntax checks. Local prototype only, uncommitted and not deployed.

### Stock and ticket operations polish

Stock now emphasizes the two urgent SKUs and their combined illustrative daily contribution at risk. Each pack-size SKU has a listing control; a saved exact Amazon India /dp/ URL opens in a new tab and is editable. Links persist only in this browser's local storage. No real ASIN mapping was available for these fictional preview SKUs, so none is fabricated. Production should populate the link from the SKU's existing ASIN.

Ticket details separate the issue, next action, owner/status fields, internal note, customer summary and delivery progress. Both screens checked at 1366, 390 and 360 pixels with no horizontal overflow. Listing URL validation and local persistence verified with a temporary test value, then restored; no Amazon page opened during that test. Scoped lint and syntax checks passed. Local prototype only, uncommitted and not deployed.

### Visual process refinement

Version visual8 adds three selectable WhatsApp journey diagrams with trigger, timing/request check, eligibility condition, and branching outcomes. Email recovery uses the same visual language. Journey detail selectors are compact so the diagram appears earlier. These are illustrative read-only process overviews, not live configuration editors.

Outreach lists now show stage progress and focused next actions; deals use a company identity, conversation bubbles, next-action strip and sample progress tracker. Coupons use distinct offer cards and correctly matched conditions dialogs. Verified eight page/variant layouts at desktop, 390 and 360 pixels without horizontal overflow, journey switching through the review iframe, and coupon detail selection. JavaScript syntax and scoped lint pass. Local prototype changes remain uncommitted and are not deployed.

### Pipeline and follow-up refinement

Version pipeline9 shares opportunity data across the deal table and board. Added pipeline totals, stage colors, company monograms, quote status, next-action cards and useful empty states. Aster opens the existing detailed workspace; other companies open correctly named illustrative summaries. Follow-ups use contextual day markers, editable sample draft previews and a cumulative observed-reply chart that preserves the original audit caveat. No sending is connected.

All three routes checked at 1366, 390 and 360 pixels with no horizontal overflow. Search, North Pharma summary and contextual follow-up draft verified. Syntax and scoped lint pass; browser console has no errors. Local, uncommitted prototype only; not deployed.

### Navigation and shared surfaces

Version navigation10 unifies sidebar ownership, related pages, breadcrumbs and a searchable All pages directory. Added direct section links for previously buried tools, automatic parent-section highlighting, compact collapsible groups and return links on every workspace screen. Directory search reveals matching child pages. Mobile More opens the same directory. Shared panels, icons, tabs and page headings receive consistent polish. Journey parameters now survive the review wrapper and refresh.

Audited every non-account screen for render errors, breadcrumb presence and valid internal link targets: no failures. All workspace pages are reachable through the directory. Checked directory at 1366/390/360 with no horizontal overflow, nested-page search, journey refresh and sidebar navigation to Website sales. Scoped lint passed. Local prototype only, uncommitted and not deployed.

### Amazon sales channel

Version sales11 adds a dedicated Amazon sales overview, now targeted by the Amazon tab in both All-channel and Website sales. Added to Sales navigation and the page directory. Displays illustrative 30-day revenue, orders, top product, revenue trend, product revenue breakdown, rankings, average order value and operational links. Returning buyers explicitly remains unavailable pending verified Amazon buyer identity coverage. Product management remains a separate destination. All metrics are sample data.

Verified Website → Amazon sales → Website navigation inside the review frame, correct active route and metrics, syntax/scoped lint, and responsive layouts at 1366/390/360. Local, uncommitted prototype only; not deployed.

### Average order value and channel identities

Version channels13 includes the metrics12 additions: average order value in the Home and Website top KPIs, plus a ranked website product table with revenue, units and visual revenue share. All new product values are illustrative.

Channel performance now uses three visual cards with revenue, orders, share bars and navigation. Amazon is amber, Website is red, and HYPD is teal. Shared channel breakdowns, homepage mix and source legends use the same identities. Channel names and sales figures are larger and bolder. Syntax and scoped lint pass. Local prototype only, uncommitted and not deployed.

### Adaptive desktop preview and typography directions

Version viewport14 removes the fixed desktop preview width and height. Desktop fills the browser below the review toolbar; Open full app offers a view without review controls. Mobile modes retain explicit phone widths. Three live typography options use native fonts with fallbacks: Modern (Avenir Next), Clean (system sans), and Editorial (Georgia headings with system body). Selection persists across navigation and refresh. Headings, navigation and tables have a larger readable hierarchy.

Verified desktop frame fills 1440 × 900 and 1920 × 1080 available space, all three font selections update actual page typography, and the product page has no horizontal overflow in desktop or phone preview. Local, uncommitted prototype; not deployed.

### Readability and navigation control

Version readability15 fixes duplicate Home/Priority issues selection, removes detail-page sidebar duplication while retaining breadcrumbs and the directory, and preserves manually chosen section expansion without opening or closing other sections automatically. Larger 14px secondary text, 16px table content, 36px KPIs and a dedicated 40px Amazon AOV value rebalance desktop panels. Content width is capped at 1800px on very large displays while the application shell remains full viewport. Revenue charts use directly labeled daily bars and explicitly identify illustrative data. Writing surfaces and conversation spacing are enlarged and refined.

Verified sales, website, Amazon sales, inbox and conversation layouts at 1440 and 390 pixels without horizontal overflow. Syntax/scoped lint passed. Local, uncommitted prototype only; not deployed.

### Full-width layout and surface-aware contrast

Version contrast16 removes the readability15 main-content width cap and centered chart limit. Content fills the area beside the sidebar with a 24px desktop gutter; headings, cards and chart labels are left aligned. KPI supporting copy now uses white on brand red and dark surface-specific colors on cyan, yellow and green, without reduced opacity. Other shared secondary labels are darker. Measured KPI text/background contrast is at least 6.07:1 across the configured gradient endpoints and solid fills. Verified the main region starts at the sidebar edge at 2560px, with correct computed card text colors. Local, uncommitted prototype only; not deployed.

### Compact sidebar and paired sales charts

Version layout17 removes stray closing-brace text left in the sidebar template, restores compact 13px navigation with tighter rows, and places revenue trend beside channel revenue on desktop. Charts stack on smaller screens. Verified equal chart top positions at 1440 and 2560 pixels, stacked mobile charts at 390, no horizontal overflow, and no stray braces. Syntax and scoped lint pass. Local, uncommitted prototype only; not deployed.

### WhatsApp layout pass (whatsapp18)

Rebuilt journeys, templates, storefront popup and performance with scoped responsive layouts. Journey cards include trigger/check/outcome summaries, template cards show illustrative message previews and correct details, popup content updates a side-by-side preview and saves only to localStorage, and performance pairs color-coded outcomes with next actions. No live WhatsApp behavior or production data changed.

Validation: JavaScript syntax and scoped ESLint passed. Browser checked all four routes at 1440, 390 and 360 pixels with no horizontal overflow or page errors; popup editing/local save and template details verified. Screenshot capture timed out in the browser tool. Production build/deployment not performed for this static preview pass.

### Maya core workspace preview (maya19)

Design-preview scope confirmed by user. Added global Ask Maya access, a full-width conversation/evidence layout, readable typography and a 14-month sales-diagnostic example that explicitly reports unavailable history instead of inventing a decline or cause. Existing production code was inspected but not edited: query_orders currently limits windows to 365 days and six 1,000-row pages without exposing truncation. A future data integration pass must address coverage, permissions, metric definitions and source evidence before claiming accurate long-range explanations.

Validation: scoped ESLint and syntax checks passed; browser verified the diagnostic prompt, new-chat reset and no horizontal overflow at 1440/390/360px, with no page errors. Local preview only, no deployment.

### Outreach workspace (outreach20)

Unified the seven outreach overview/process screens with consistent stage navigation, sector colors, readable secondary text, compact summaries and team handoff guidance. Rebuilt verification, approval and replies around clear next actions. Review draft edits persist in sessionStorage and invalidate prior review confirmation. All verification and approval states remain illustrative; no real email sending or team access was introduced.

Validation: scoped ESLint passed; all seven routes checked at 1440/390/360px without horizontal overflow or page errors. Editing a reviewed draft clears review status; incomplete batch approval remains blocked. Local preview only, uncommitted and not deployed.

### Customer workspace (customers21)

Rebuilt the customer directory, profile, support-ticket queue and conversation workspace. Added scoped colored metrics, a labeled sample customer-mix chart, activity timelines, separate chat panels and a dedicated composer. Customer selection now preserves Aarav/Riya/Dev context through profile and conversation links. Search and filters work locally; ticket details show the selected ticket. Composer drafts are stored per customer in sessionStorage; sample replies are appended safely as text and never sent externally.

Validation: syntax/scoped ESLint passed; five routes at 1440/390/360px had no horizontal overflow or page errors. Riya selection, directory search and sample reply insertion verified. No production behavior changed; local and uncommitted, not deployed.

### Email reply workspace (email22)

Rebuilt email reply review with separate incoming-message and reply-editor surfaces, editable subject, readable body, order-progress context, customer summary and reply guidance. Draft content persists in sessionStorage and preview renders the exact edited text safely. Recipient address and support mailbox are explicitly unavailable; all actions remain local previews with no email send integration.

Validation: JavaScript syntax and scoped ESLint passed. Initial browser loads hit a local-server connection reset for app.js. After retrying that asset, browser verified no horizontal overflow at 1440/390/360px, exact reply preview and draft persistence across navigation. Local, uncommitted and not deployed.

### Country and city targeting (locations23)

Find companies now has a country selector, 20 popular Indian city chips with multi-selection, All India and Select all 20 controls, and manual city entry for other countries. The search brief reflects country, cities, company count and roles immediately. This remains illustrative discovery only.

Validation: JavaScript syntax passed; city toggling, select-all, nationwide reset, country switching, manual cities and company count verified in the browser. India and international layouts checked at 1440/390/360px without horizontal overflow. One unrelated customer stylesheet request encountered the local server's intermittent connection reset. Local preview, uncommitted and not deployed.

### Outreach funnel (funnel24)

Replaced the thin monochrome funnel with three stage cards: burgundy Delivered, blue Replied and green Qualified. Matching proportional bars, explicit denominators, stage-to-stage conversion, definitions and follow-up links clarify the sample. The comparable one-email/one-reply-per-company sample assumption is stated. No live reporting connection added.

Validation: syntax and scoped ESLint passed. All three stages render at 1440/390/360px without horizontal overflow. Local preview only, uncommitted and not deployed.
