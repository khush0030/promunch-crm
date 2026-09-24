# PROMUNCH CRM: complete UI redesign plan

**Date:** 12 September 2026  
**Status:** proposed design and source audit, not implemented or deployed.  
**Visual scope:** 209 app views plus one component reference × laptop/mobile = 420 layouts. These are interactive design mockups, not production functionality.

**Companion review:** [Interactive audit and screen explorer](../audits/2026-09-12-ui-redesign-review.html) · [Screen inventory](../audits/2026-09-12-ui-screen-inventory.json)

## 1. Decision

Rebuild the interface around the work someone came to do. Give each page a clear purpose, make important information readable, and move secondary detail into sections and record views. Apply the current PROMUNCH red wordmark and restrained red accents to white and warm-neutral surfaces. Make the phone experience a first-class workflow with the same essential capabilities.

This is a complete planning package for the existing app, including 28 page-route files, redirects, and 132 inventoried screens or interaction surfaces. A surface may be a tab, an editor, a dialog, or a closely related state family; 132 is not a count of unique URLs or every possible state combination. Each inventory row specifies its source, proposed treatment and mobile behavior. New views are identified as proposed; existing capabilities reorganized into views retain their existing status.

The next implementation should begin with shared components, Home, Amazon and WhatsApp Inbox. Cosmetic changes alone will leave the crowding intact.

## 2. Audit coverage and evidence limits

Reviewed the route tree; navigation and shared shell; shared components and design tokens; page and feature-component structures; conditional views, forms and editors; mobile rules; relevant data presentation and permission logic; current architecture and active design handoff. Inspected the live public website using an isolated browser and its delivered HTML/CSS on the audit date. Inspected the CRM's current local logo asset and live sign-in entry.

The live CRM redirected the audit browser to sign-in. Therefore this is a **source-based application audit plus live public-brand verification**, not a completed authenticated visual or accessibility certification. Desktop/tablet layout risks are grounded in code; their exact rendered impact with production data still needs verification. No credentials, customer messages, campaign launches, configuration changes or production writes were used for this audit. The existing browser session was left alone.

Known positives to retain: existing phone list/conversation/details navigation in WhatsApp, 16px mobile composer input, focus-trapped WhatsApp dialogs, linkable WhatsApp conversations, retry states in several modules, semantic shared components, and legacy Settings redirects. Mobile support exists today; it needs consistent completion and testing.

The old design handoff remains the active implementation reference until this proposal is accepted. It is not silently superseded. On implementation, reconcile its tokens and reference prototype, move superseded material to docs/archive, and update the documentation index. Its old five-tab WhatsApp map and simplified Amazon map no longer cover current functionality.

## 3. Current brand, verified against the website

Source: [PROMUNCH website](https://promunch.in/), delivered styles and browser inspection, 12 September 2026. Current header logo: [PROMUNCH wordmark asset](https://promunch.in/cdn/shop/files/promuch.png?v=1784261565&width=600).

| Element | Verified current website / app | Proposed admin treatment |
|---|---|---|
| Logo | Website: red full PROMUNCH wordmark. CRM Sidebar and Login: `pm-logo-square.png`, a multicolour PM mark. | Use the actual current wordmark, preserve its aspect ratio, and verify a small-size brand asset before changing the favicon. Do not recreate the lettering with typed text. |
| Primary website accent | `#AF272F`; deeper accent `#8E1F26` in current homepage styles. Other theme colours also exist. | Red for primary actions, selected navigation and restrained highlights. White sidebar with a pale-red active row is the default proposal. |
| Main surfaces | White `#FFFFFF`; warm neutral `#F4F1EA` appears in the theme. | White content, warm-neutral canvas, subtle borders, very limited shadows. |
| Main text | `#1A1714`, secondary `#4A453F` in homepage styles. | Reuse these high-contrast text roles. Avoid faint captions for essential facts. |
| Typography | Website uses Archivo Black for display and Assistant for body/navigation. | Use Assistant at 16px for interface reading and Archivo Black for confident page headings. Keep dense tables in Assistant. The visual pack uses both current brand faces. |
| Product colours | Multiple packaging/marketing colours, energetic imagery. | Keep product imagery where it identifies a SKU; use colour sparingly in daily work. No hero banners, games or packaging motifs behind operational data. |
| Tone | PROMUNCH identity and Your Munchy Pal tagline. | Clear professional admin labels; sentence case for controls. Brand remains PROMUNCH. Customer-facing copy has no em dashes. |

Do not copy all storefront colours into an admin status system. Brand red cannot simultaneously mean every active control and every emergency. Danger uses a distinct pale-red status container, icon and explicit label; primary buttons are clearly action controls. Successful and pending states use separately defined semantic colours.

### Proposed tokens and density limits

- Canvas `#F4F1EA`; surface `#FFFFFF`; primary text `#1A1714`; secondary text `#4A453F`; primary action `#AF272F`; hover `#8E1F26`; selected surface `#FBECEE`.
- Proposed status pairs: success `#276749` / `#EDF7F0`, warning `#805600` / `#FFF4D6`, danger `#9B1C20` / `#FFF0F0`, information `#245B78` / `#EDF4FA`. Verify rendered combinations and disabled/focus states before rollout.
- Body 16px / 1.5 line height; table text 14–16px desktop and 16px on phone; labels 14px; essential metadata at least 13px; page title 28px desktop and 24px mobile. Do not shrink text to make a crowded layout fit.
- Space on a 4/8px scale: page gutters 24–32px desktop and 16px mobile; section gaps 24–32px; panel padding 20–24px; 48–56px ordinary data rows.
- Most pages: one title, one short purpose sentence, one primary action, one filter bar and one principal workspace. A maximum of four primary KPIs on overview screens; worklists need no compulsory KPI row.
- Keep secondary metrics in a report section. Do not replace a large dashboard with dozens of equally weighted cards. Avoid arbitrary card heights that clip names or messages.
- Indian locale numbers, explicit ₹ currency, consistent rounding and timezone. Full precision available when it matters; a dash means unavailable, 0 means measured zero.

White text on the proposed primary red measures approximately 6.66:1. Existing `--pm-hint` on white measures 3.14:1, and existing gold text on gold-soft measures 2.62:1. These are token-pair calculations, not a claim that every rendered component uses that pair. Essential small text using those combinations needs replacement. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## 4. Findings ranked by impact

| Priority | Finding and evidence | User impact | Required change |
|---|---|---|---|
| P0 | `dashboard/page.tsx:340` builds trendSeries using distribute(total), and `components/pm/KpiCard.tsx:14` supplies fixed spark shapes. | Charts can look like observed trends when they are generated. | Use actual dated observations or remove the plot. No decorative trends next to financial metrics. |
| P0 | `order-confirmations/page.tsx:71` labels message status `sent` as Confirmed, while separate COD gate status also has confirmed. | Staff may confuse notification transmission with customer approval. | Show Notification: Sent/Delivered/Read separately from COD: Pending/Customer confirmed/Needs call. Preserve underlying states. |
| P1 | `amazon/page.tsx:363–427` places four KPIs, stock-risk table, eight-column economics table, chart, low-stock list, settlements and orders on one surface. | Routine checks require processing unrelated information. | Split into Overview, Inventory, SKU economics, Settlements and Orders. |
| P1 | `amazon/page.tsx:244` economics shows mixed 90-day and 30-day measures while the page has a global period selector. | Period selection can imply more than it controls. | Scope date labels to the actual dataset. Fixed 90-day analysis must be explicit. |
| P1 | `amazon/page.tsx:372` says Net kept / what you actually keep while costs are handled separately in SKU economics. | Payout may be interpreted as profit. | Use Net payout; explain fees/refunds basis and excluded COGS/other expenses. Never label contribution as final profit without the required cost data. |
| P1 | `amazon/page.tsx:193` reports the freshest timestamp across sync sections. | A fresh source can hide a stale source. | Per-section last successful sync and stale indicator; operational timestamps distinct from data coverage. |
| P1 | `whatsapp/page.tsx:171` has nine peer tabs across support, marketing, automation, knowledge and analytics. | Navigation is difficult to scan, especially on phone. | Group these tasks into functional areas while preserving deep links. |
| P1 | `InboxView.tsx:169` has 320px + flexible + 304px panes above a 768px breakpoint. | Narrow desktop/tablet space can squeeze the message pane after sidebar space. | Layout by available content width; two panes on tablet, one on phone; optional context on desktop. |
| P1 | `globals.css:440` specifies 13.5px body, 12.5px labels and 11.5px captions. | Dense content and hierarchy are hard to read. | Increase type and space together; reduce the amount shown at once. |
| P1 | `globals.css:688` retains horizontal tables and smaller 34px controls on phone. | Some data and row actions require sideways movement and precise taps. | Mobile record cards and focused details; 44px minimum interaction targets as project standard, 48px preferred. |
| P1 | `VoiceView.tsx:101` uses a seven-column grid; call query errors are not separately surfaced in its main loading/data handling. | Calls risk cramped presentation or an apparent empty list during failure. | Mobile cards, explicit error/retry and partial sync state. |
| P1 | `analytics/page.tsx:35–58` defaults query counts/data to zero/empty; delivery rate is divided by all events; campaigns selected by creation date. | Displayed business meaning can be unclear or misleading. | Define cohort, denominator and date basis; handle failure separately. Changes to metric queries are a dedicated data task, not a styling change. |
| P1 | `dashboard/page.tsx:324` inserts an Email healthy row with static SPF/DKIM/DMARC text. | A positive health signal may not be backed by a live check. | Show configured/unverified until supported by telemetry. |
| P2 | `Sidebar.tsx:48–87` exposes 16 route links, with repeated Campaigns/Flows meanings across modules. | Staff must infer the channel and location. | Group tasks, label channel explicitly, move audit tools into Settings. |
| P2 | WhatsApp mixes shared tokens with channel-green/blue literals and personal-chat styling (`styles.ts`, `InboxView.tsx:586`). | The experience feels different from the rest of the CRM. | Shared neutral inbox design, branded actions, quieter bubble treatment and precise state labels. |
| P2 | `contacts/page.tsx:30` gives VIP the danger tone, also used for At Risk. | Colour does not consistently describe status. | Separate lifecycle classification from urgency and consent. |
| P2 | WhatsApp `Field` renders a text div rather than a semantic form label (`primitives.tsx:79`). | Visual label may not be programmatically tied to input. | Shared labelled form component with associated control ID, help text and inline errors. |
| P2 | Existing modal implementation has useful focus trapping, but source style uses `88vh` and a fixed overlay. | Phone keyboard and long-form behavior still need testing. | Full-screen long editors, dynamic viewport height, visible close/back, draft preservation and focused validation. |

P0 here means highest redesign priority because users may interpret displayed information incorrectly. It does not certify a security incident or request changes to customer messaging behavior.

## 5. Navigation and location model

| Primary area | Destinations | Notes |
|---|---|---|
| Home | Daily overview, full attention queue | Work to do first; reports secondary. |
| Inbox | WhatsApp, Support email, Instagram, Tickets | Tickets remains connected to WhatsApp; channel switch is explicit. |
| Orders & sales | Order confirmations, Shopify, Amazon | Amazon has its own five-section subnavigation. |
| CRM | Contacts, B2B leads, Deals | Preserve identity and link between entities. |
| Marketing | Email campaigns, WhatsApp campaigns, Templates, Growth tools | Explicit channel on every list and create action. |
| Automations | Email automations, WhatsApp journeys, Voice rescue | Separate configuration from execution history. |
| Reports | Email analytics, WhatsApp analytics; links to Shopify/Amazon reports | A lightweight navigation index, not a new combined attribution engine. |
| Settings | Connections, Knowledge base, API keys, Email sender, Brand, Team, Audit log | Knowledge base also has a direct shortcut from WhatsApp context. |
| Utility | Ask Maya, Help, Account/notifications | Maya remains reachable without dominating navigation. |

Desktop: show section names and expand the current group, with everyday shortcuts for Home, WhatsApp and order confirmations. Do not expose all nested links permanently. Maintain selected location and breadcrumb.

Phone: Home / Inbox / Orders / More, with text labels. More opens all modules and search within navigation. A selected conversation or editor uses a focused screen with back navigation; bottom navigation may collapse during keyboard editing without losing a way back. Switching channel should not erase an unsent draft.

Keep existing URLs initially. Persist tab/filter state in a validated query parameter; retain WhatsApp `?tab=` and `?thread=` links and Settings hash compatibility. Add alias redirects only when there is a final destination map. `/dashboard/integrations` and `/dashboard/team` already redirect and must continue to work. New record views can initially use query-state drawers, then gain routes when a stable identifier and access check exist.

## 6. Priority screen specifications

### Home

Opening hierarchy: page title/date → Needs attention with at most five actionable items → four metrics → one real trend/report entry point. A short healthy-state message replaces the queue when nothing needs work. Do not force a full operations dashboard above the task list.

Metrics specify their time basis and data source. An unavailable Amazon feed does not silently become ₹0 or make combined revenue look complete. Show partial-data status and preserve last good results with their timestamp. All-time AOV must not be presented as selected-period AOV. Each item opens its exact filtered worklist.

### Amazon

Overview answers: What sold? What did Amazon deduct? What payout remains? What stock issue needs attention? Use Gross sales, Amazon fees, Net payout and Products at risk. Promotions become a supporting line in the payout breakdown. A single compact stock alert links to Inventory.

Inventory shows Product, Available, Days of cover, Inbound, Risk. Open a SKU for full title, SKU/FBA/MFN context, sales velocity basis and estimate assumptions. Treat estimated lost sales as modelled opportunity, not booked loss. No alarming headline of projected monthly loss before users understand its basis. Keep visible factual stock risk.

SKU economics shows Product, Units, Net/unit, Landed cost/unit, Contribution/unit; expand fees, price and refunds in detail. Missing COGS displays Add cost and unavailable contribution, never zero cost or artificial profit. Landed-cost editing has visible Save/Cancel and a clear success/error outcome. The 90-day window is explicit.

Settlements has its own period labels, reconciliation table and chart. Net deposits are distinct from gross sales. An optional detail view presents only the current available fields. A future bank matching or transaction search feature needs backend scope and is not implied by this redesign.

Orders starts with current recent orders. A full order history, additional filters or pagination must be separately implemented if absent from the current API. Do not put inert Search or Export controls in the design and call them functional.

Phone: overview cards, inventory cards ranked by risk, tap for details and cost editing. Settlement cards show period, net and status first. Full-table comparison may remain available in a contained scroll area as an optional advanced view, never the only way to perform the primary task.

### WhatsApp

Inbox first: filter/search and compact connection state, with no marketing metrics above messages. Default wide layout is conversation list plus thread. Context is optional and automatically collapses before the message area becomes cramped. Messages have readable body type, clear sender, timestamp and delivery indicator. Keep professional interface copy without rewriting customer conversations or bot persona.

Conversation header: name/phone fallback, assignment, AI/human mode, consent/window state and a secondary action menu. Reply remains visually separate from template selection and AI draft generation. Explain restrictions beside the composer. Keep the existing closed-window, opt-out, attachment and send-failure behavior visible.

Phone: list → conversation → context with Back and preserved search/scroll/draft. Do not display the list and thread side-by-side. Use dynamic viewport sizing and safe-area padding. The open keyboard cannot cover Send, attachment preview or error feedback. Long URLs, Hindi text, audio/video controls and attachment failures are acceptance cases.

Marketing, Templates, Journeys, Voice calls, Growth, Reports and Knowledge remain reachable through grouped navigation and contextual links; their existing nine-tab arrangement is removed from the main inbox. Creating campaigns is a focused audience → content → review workflow, not a long modal squeezed above chat.

### Remaining modules

The full surface inventory below is mandatory scope. Shared patterns apply consistently: email and Instagram use the same thread hierarchy; contact/deal/lead detail begins with identity and next action; analytics separates overview from breakdown; settings exposes configuration one subsection at a time; campaign/flow editing uses a visible step model and preview. Existing draft, review, eligibility, suppression, delivery and permission states must survive presentation changes.

## 7. Mobile and accessibility specification

Use available container width rather than only device name. Suggested behavior: below 768px single pane; 768–1199px two-pane inbox only when the available content width supports it, otherwise list/detail; 1200px+ optional third context pane. At 320px and 360px, reduce metric columns to one if labels or values no longer fit. Never shrink the text.

Test widths 320, 360, 390, 430, 768, 1024 and 1440px, plus landscape phone. Test actual iOS Safari and Android Chrome with keyboard open, dynamic text and browser chrome. CSS screenshots alone do not prove keyboard compatibility.

Use 44×44px minimum project touch targets, 48px preferred and adequate separation. This is a project comfort standard; WCAG 2.2 AA's target criterion has a 24px minimum with defined exceptions, so do not mislabel 44px as the AA requirement. [W3C target guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Normal text needs at least 4.5:1 contrast; large text at least 3:1. Keyboard navigation must expose focus, descriptive labels, logical headings, skip-to-content and visible validation. Status needs text as well as colour. Dialogs restore focus to their trigger; no stacked long-form modals. Reduced-motion preferences are respected. Provide a textual data summary for charts and usable tap interactions.

At 400% zoom on a 1280px viewport, ordinary content must reflow to the equivalent of 320px without losing functionality. Essential data comparisons can have contained two-dimensional scrolling, but individual text and the rest of the page must remain usable. [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## 8. State, role and interaction coverage

Apply this matrix to every relevant surface in the inventory; avoid creating a fake screen for each combination.

| State family | Required visible behavior | Verification |
|---|---|---|
| Loading / refreshing | Stable skeleton initially; keep previous results during refresh with freshness state. | Slow connection and delayed requests. |
| Empty / no matches | Distinguish no records from filters hiding records; one next action. | New workspace, zero results, Clear filters. |
| Error / partial / stale | Explain failed source, Retry and last successful data; never silently replace failure with zero. | 401, 403, 404, 429, 500, offline, one failed parallel feed. |
| Permission | Member, admin and owner appropriate controls and denial state. | Server permissions remain authoritative; hidden UI is not authorization. |
| Editing / unsaved / validation | Save/Cancel, field errors, meaningful dirty state and restore draft where feasible. | Back, reload, close, long forms and invalid inputs. |
| Sending / saving / uploading | Disable duplicate action; show progress, success, failure and uncertain result. | Double tap, timeout after server acceptance, navigation during mutation. |
| Sensitive action | Exact recipient/entity and effect before execution. | Launch campaign, delete, unsubscribe, disconnect, role change and order actions. |
| Large / irregular data | Pagination or bounded loading, full detail access, no broken identity. | Long names, missing email, ₹ values, zero/missing COGS, mixed scripts and large histories. |
| Message states | AI/human, assignment, opt-out, open/closed window, queued/sent/delivered/read/failed. | Preserve all existing customer contact restrictions and statuses. |
| Integration states | Configured, connected, degraded, stale, disconnected and unknown differ. | No activity is not automatically disconnected; no telemetry is not healthy. |

Existing roles are effectively member and admin, with owner-only secret controls. Design for these actual tiers, not invented departmental permissions. A future granular role system is a separate scope decision.

## 9. Components and implementation boundaries

Build or revise PageHeader, grouped navigation, mobile drawer, accessible Tabs/section selector, FilterBar/filter sheet, DataTable/mobile record list, RecordDetail, Metric, StatusBadge, Empty/Error/Loading states, FormField, Dialog/Sheet, StepEditor, MessageComposer, ConfirmAction, FreshnessIndicator and ChartFrame. Preserve the existing WhatsApp dialog focus handling while standardizing it across modules.

Replace legacy and inline style fragments incrementally with semantic tokens. Update `design/promunch-design-tokens.css` and the mirrored `globals.css` together once the direction is approved. Separate brand-action and success tokens instead of making `--pm-green` mean both. Do not swap all green values for red: delivery-success badges must stay semantically successful.

Presentation scope: layout, typography, assets, navigation labels, accessible controls, mobile cards, and clearer state rendering. Separate data tasks: actual daily-series endpoints, metric denominator/cohort corrections, source-specific freshness, missing pagination/detail API support and draft persistence if backend storage is needed. Preserve all existing API contracts until a separately tested change is required.

Customer operations invariants remain: no duplicate messaging; Master KB grounding; STOP and START; explicit cancellation; opt-in audience restrictions; nullable email; Shopify order-status links; creator seed exclusion; GDPR anonymization; owner-only key management. This plan proposes no bot reply-behavior changes. If implementation later requires those changes, describe the exact customer-visible effect and get the approval required by AGENTS.md before editing that behavior.

## 10. Phased delivery with exit gates

Estimates are planning ranges for one experienced frontend engineer with design review and shared QA, not commitments. Data/API corrections can alter duration. Approximately 5–8 working weeks for the full scope, depending on visual review and data gaps; stages can overlap only where dependencies allow.

| Stage | Work | Indicative effort | Exit gate |
|---|---|---|---|
| 0. Baseline & design decisions | Authenticated screenshots, brand assets, metric definitions, confirm navigation and priority prototypes. | 2–3 days | Route inventory matched to visible live app; current deployment revision recorded; brand and priority layouts reviewable. |
| 1. Foundation | Tokens, typography, logo, shell, navigation, tables/cards, forms, states. | 3–5 days | Representative table, long form and inbox work at all widths and with keyboard navigation. |
| 2. Daily operations | Home, Amazon five sections, WhatsApp inbox/tickets/context, order confirmations. | 5–8 days | Essential tasks completed on phone; real metrics and honest unavailable states; no messaging regression. |
| 3. Customer workspace | Email support, contacts, Instagram, leads and deals. | 5–8 days | Every list/detail/editor mapped; draft and back navigation preserved; role checks verified. |
| 4. Marketing & automation | Email/WhatsApp campaigns, templates, journeys, voice, growth, knowledge and reports. | 6–10 days | Review/launch, consent, closed-window, suppression and state flows preserved; long editors usable on phone. |
| 5. Administration & release | Maya, team, keys/settings, account/public pages, full regression and live verification. | 3–5 days | All inventory rows signed off; no P0/P1 readability/task blockers; rollback ready. |

Prioritize customer operations even if some rare configuration work is slower on phone initially; it must remain available and correctly reflowed. Do not permanently remove capabilities under the label mobile simplification.

## 11. Acceptance and release checklist

1. Every one of the 28 page-route files and all 132 inventory rows has desktop and mobile review status, owner and linked evidence before completion. Record any discovered surface as a new row rather than treating the current inventory as infallible.
2. Amazon opens with four summary metrics and at most one compact attention block; economics, settlements and order tables are absent from Overview. Stock estimates and payout definitions are visible and accurate.
3. WhatsApp inbox opens directly into support work; all nine original tab capabilities remain reachable in the new navigation. At phone sizes there is one active pane and working Back behavior.
4. In an observed user test, identify the next required action within 10 seconds; open a stock-risk item from Amazon within two navigation actions; reach a customer's order context from chat within two actions. These are target tasks, not measured results of this audit.
5. No fake charts, unsupported deltas or hardcoded healthy status. Every metric states period/basis and handles partial/unavailable data.
6. Test longest realistic names and messages, phone-only contacts, missing image, zero rows, 1000+ records, missing landed costs, consent restrictions, API failures and expired sessions. Test iOS/Android keyboard and attachment controls.
7. Pass relevant build, test and lint gates; changes to edge functions get Deno checks; migration collision check if schema work is introduced. These checks are implementation release gates, not claimed as run for this documentation-only package.
8. Compare old/new response and eligibility behavior using deterministic tests. Any external test message requires explicit authorization; use non-sending fixtures for design testing.
9. Commit/push to main under repo policy, deploy manually, then verify the released views. Use a reversible rollout toggle for new navigation/layout if appropriate and retain a known-good deployment. A git push alone is not a deployment.
10. Report source commit and live deployment separately. Maintain a per-module completion checklist; the project is not finished after Home, Amazon and WhatsApp alone.

## 12. Evidence and follow-up gaps

The interactive review contains 209 individual visual views with fictional data, each available as a laptop or mobile layout, plus a searchable complete inventory. It includes local review checkboxes and exportable feedback. The State selector exposes loading, empty, error and access-denied layouts; screen-specific branches have their own entries. Those layouts are design proposals, not screenshots of a deployed redesign. Current public-brand evidence is stored separately from the concepts.

Remaining evidence required during implementation: authenticated screenshots and actual role states; exact deployment/source parity; real device interaction; representative large datasets; true freshness/metric API contracts; brand-font legibility at real device sizes; current favicon/small-logo choice. No blanket claim of full accessibility conformance or live-app visual correctness is made by this source audit.


**Modular implementation:** [UI component architecture](2026-09-12-ui-component-architecture.md) defines shared components, business-logic boundaries and consistent team navigation.


## Prototype verification completed

All 210 review views rendered at 1240px laptop and 390px phone widths (420 layouts) with no script errors or page-width overflow in the browser check. Eight representative views also passed overflow checks at 320, 768 and 1024px. Checked public-page shell separation, general state rendering, Amazon navigation/search, live template preview, visible phone reply controls, simulated send confirmation and local feedback persistence. Representative screenshots and the verification record are in `docs/audits/2026-09-12-ui-assets/`. These checks apply to the design artifact; production functionality, real-device keyboards and full accessibility remain implementation checks.
