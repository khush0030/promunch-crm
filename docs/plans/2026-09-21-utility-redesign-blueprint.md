# PROMUNCH CRM utility redesign blueprint

Status: first consolidated blueprint for layout review. No implementation or deployment authorised by this document alone. The user requested collaborative planning before implementation.

Evidence: [project audit](../audits/2026-09-21-project-flow-redesign-audit.md) and [email analysis](../audits/2026-09-21-email-followup-redesign.md). These record source/live-data findings and their limits. Existing design files describe the current implementation; this proposal supersedes their visual direction only when approved for implementation.

## 1. Agreed product brief

A daily utility for founders and team members to understand business volume, performance, priorities, and next actions. Primary desktop is a 13-inch laptop. Responsive web experience, not a separate native app. Shopify and Amazon Seller Central are the main external tools currently consulted.

White/light default, visible pale-grey sections, dark readable text, compact useful layouts. One font family; no decorative display typography. Few headline KPIs, purposeful charts and inline bars, tables for comparisons, details on demand. Colour communicates status consistently and always has a text/icon equivalent. Do not use pale text to achieve a lighter appearance.

## 2. Navigation

Mobile bottom destinations confirmed: Home, Inbox, Amazon, More. More contains Sales, Deals, B2B outreach, Marketing, Customers, and Settings/tools. Final desktop grouping below is proposed, not yet independently approved.

| Desktop section | Destinations |
|---|---|
| Home | Business overview |
| Sales | All channels, Website, Orders & COD |
| Amazon | Products, Stock & replenishment, Product profit, Payouts, Orders |
| Customer support | Inbox, Tickets |
| B2B | Find & contact companies, Deals |
| Marketing | WhatsApp campaigns, Email campaigns, Automations, Coupons |
| Customers | Customer list and profiles |
| Settings & tools | Connections, Team, Templates, Bot knowledge, Storefront popup, Activity, API keys, Ask Maya |

Multiple groups may stay open; remember collapse choices. Use distinct page labels/icons rather than one shared icon for every page in a group. Important Amazon destinations must be discoverable before entering Amazon. Avoid duplicate visible destinations to the same workflow. Retired pages must also disappear from search and shortcuts, with intentional old-URL handling.

## 3. Home

Desktop arrangement:

```
Home                                  Updated …
Sales today + order count | Repeat customers | Top product
Priority issues: up to three actionable rows
Sales trend                           Sales by channel
What changed: compact visual comparisons
```

Sales today is all-channel rupee revenue plus order count, midnight-to-now IST. Show source freshness; use the same order-date basis across channels. Partial/unpriced Amazon orders must remain visibly provisional. Prior comparison is the same elapsed portion of yesterday when available, not yesterday's complete day.

Repeat customers: proposed definition is unique buyers in the selected period who purchased before that period, divided by identified buyers in that period; default 30 days. The precise definition and identity coverage need approval before implementation. Show coverage, never imply Amazon cross-channel identity exists if it does not. Existing repeat-order metric cannot simply be relabelled.

Top product: revenue default, units alongside, Revenue/Units toggle, 7/30/90-day selector. Explicit product/flavour grouping with SKU drill-down; cross-channel identity mapping required. Product selector must not silently change Sales today. Each block labels its own period.

Priority order: high-profit unavailable products, customers overdue for help, and stock projected to run out before replenishment. Each row: status, affected item/customer, measurable impact or wait, one next action. Show all issues via one link. Unknown data is not a healthy state. When clear, show a concise healthy state instead of manufactured alerts.

What changed: no wall of generated text. Use a small comparison bar or sparkline, one factual sentence, and a link to the underlying filtered view. One to three material observations, no duplicate KPI narration. Only assert causes supported by joined evidence; label hypotheses. Targets are not part of confirmed scope.

Mobile: stacked summary blocks and priority rows first, followed by compact trend/channel views. No whole-page horizontal scroll.

## 4. Customer inbox

Desktop: conversation list | message thread | visible customer/order panel. Default filter is unresolved help and urgent tickets, independently of whether the bot currently owns a conversation. Prioritise urgency and waiting time; keep bot-handled/all conversations accessible.

Conversation row: customer name, one status, preview, waiting time, channel icon. Thread: clear customer/team/bot authorship, messages, composer, one clear primary action. Technical AI metadata, tags, and seldom-used controls move into detail menus.

Right panel: identity, relevant/latest order, payment and fulfilment status, ordered items, Shopify order-status link, previous orders expandable. Use existing customer API fields. Distinguish no orders, failed lookup, ambiguous identity, and loading. Do not confuse a ten-order result limit with lifetime order count. Allow selecting the relevant order rather than always assuming the newest order caused the conversation.

Mobile: list → conversation → Customer & order view, preserving selection, scroll, draft, and back navigation. Do not squeeze three columns onto a phone. At intermediate laptop widths, preserve readable text and a usable composer; exact widths need prototype verification.

SLA and business hours remain open inputs. Do not change customer-facing bot behaviour as part of a visual redesign.

## 5. Amazon

### Products

Rank products by revenue by default; display units and period comparison. Expand product/flavour into pack/SKU variants. Small product image, readable name, aligned numbers, inline revenue comparison bars. Link each row to its stock and profit context. Do not use long Amazon listing titles as the main display name.

### Stock & replenishment

Default columns: Product | Priority | Units / days left | Incoming | Profit at risk | Suggested units.

Product groups expand to SKUs; forecasts and shipment recommendations are always SKU/pack-specific. Coverage bar shows days left against full replenishment lead time. Priority labels: Restock now, Send soon, Healthy, Needs data. Subtle status tint plus explicit label. Red is reserved for actionable risk, not every empty historical listing.

Expanded detail: revenue at risk, demand trend, stock history, unit economics, warehouse availability, inbound arrival assumptions, recommended quantity calculation and confidence. Rank actionable shortages by estimated recoverable positive contribution profit; unknown costs appear in a needs-data queue rather than ranking as zero-profit products.

Forecast prerequisites: reviewed Shopify/Amazon product and pack mapping; historical availability; SKU cost coverage; lead time including preparation/appointment; coverage target; safety stock; carton size; warehouse reservations. Post-appointment availability is provisionally 7–10 days, not a verified full lead time. Estimates must be labelled and must not count all inbound stock as immediately available.

### Product profit

Default: highest total contribution profit first. Product rows show total profit, units sold, profit per unit and margin. An inline unit-economics visual explains selling price, Amazon charges, product cost and remainder. Use signed visuals for losses. Identify loss-makers and the highest total-profit product without crowding the page with KPI cards. Missing cost is unknown. Cost basis, taxes, advertising and freight treatment need definition; do not call incomplete contribution net profit.

### Payouts

Settlement table first: period, reported payout, deductions, reconciliation state and difference. Expand to visual sales → adjustments/deductions → payout bridge, fee categories, linked orders and raw supporting lines.

Three separate states: Amazon report totals match; charges match our expected terms; bank receipt verified. Existing data proves only the first. Preserve signed differences, use one explicit tolerance per check, and do not assume reserves explain discrepancies. Date filters must load every relevant settlement, not only the most recent twelve.

### Orders

Compact searchable order table with status, date, product summary and value. Server pagination and period filters. Order detail links to items, charges, refunds, and settlement where data permits. Mobile rows retain status/value/date and expand for details.

## 6. Deals

Table default; selectable Kanban retained with remembered preference. Default active window: last meaningful email activity within 60 days. Keep historical search; visibility window is separate from dormant/closed lifecycle state.

Columns agreed: Company | Stage | Deal value | Last interaction | Next action and due date. Unknown amounts remain unknown. Side panel contains contact, concise summary, email history, sample information, supporting evidence and corrections. Server filtering/pagination avoids endless lists.

Proposed stage rules: Interested → Samples agreed → Samples sent → Commercial discussion → Won. Commercial discussion may skip sampling. Accepting samples qualifies interest. Samples agreed has awaiting-address/ready-to-dispatch substatus; samples sent has in-transit/received-awaiting-feedback substatus. Only dispatch evidence advances to sent; only receipt evidence starts a sample-evaluation timer. Lost/dormant and closed opportunities are outside the active default.

Automatic classification must cite email evidence and distinguish buyer intent from our offer, bounces, signatures, and quoted history. Clear buyer interest creates/updates an opportunity; ambiguity becomes review. Preserve manual correction and separate multiple opportunities at one company.

Follow-ups are recommendations/drafts: provisional five days for unanswered outreach, three for commercials after our response, seven for internal evaluation absent a promised date. Explicit dates override. Buyer questions become immediate team actions; undelivered samples require delivery checks. See the email analysis for why these are initial policies rather than proven optimal timing.

## 7. B2B outreach

One guided workflow: Find companies → Verify decision-makers → Draft → Review → Send → Track replies.

Target means ten verified people at ten distinct suitable companies, preferably procurement/partnership decision-makers. Continue discovery to fill that target or explain the shortfall. Deduplicate by company/person; show source, role, verification method/date, and limitations. MX checks alone are not mailbox verification. Finder providers need activation/configuration before promising verified results.

Each email is reviewed individually, then personalised approved drafts are batch-approved/sent. Editing an approved draft invalidates its approval. Later fully automated outreach is future scope. Existing automatic sequence sending must not become the default by accident.

Replies need verified capture for the outreach mailbox and a bridge into Deals based on interest. Current reply_to differs from the Deals mailbox; map this explicitly. Exclude simulated replies from operational analytics. Retain suppression, consent requirements where applicable, and atomic dedup protections.

## 8. Email and feature cleanup

Keep Brevo campaign creation/sending/reporting, coupons, and only automation management actually supported by the connected integration. Surface provider-native editing through clear external links when appropriate. Distinguish connected, test-only, active, and unavailable capabilities without scattering setup controls through daily workflows.

Retire duplicate legacy campaign/reporting pages. Preserve and consolidate control of the active CRM/Resend abandoned-cart flow until a separately planned migration establishes a single replacement owner. Keep WhatsApp journeys separate from email despite similar names. Remove SMS and non-live creator partnerships from everyday navigation. Keep B2B and Deals prominent.

Audit every Settings action before retaining it. Replace hardcoded success/health indicators and nonfunctional save/disconnect controls with verified functionality or remove them. Preserve real history; screen retirement does not imply deleting records.

## 9. Visual and interaction rules

- One font family; proposed normal table/body text 14–16px, secondary labels at least 12–13px with sufficient contrast. Validate on the actual laptop width rather than shrinking text to fit.
- One clear page title and primary action. No oversized greetings or decorative section labels.
- White main surface, discernible neutral section surfaces, consistent borders, restrained spacing. Dense information remains aligned and grouped.
- Semantic status colour plus text/icon: red urgent/loss, amber upcoming risk, green healthy/profit, grey unknown/inactive. Chart series colours do not imply urgency.
- Consistent money, units, date and period formatting. Tooltips supplement rather than hide essential explanations.
- Show loading, genuinely empty, error/retry, and stale-data states distinctly. Preserve context during refresh/filter changes.
- Tables on desktop become purposeful summary rows on phones; expansion reveals remaining columns. Forms preserve entered work. Touch actions and keyboard/focus states are first-class.

## 10. Review and rollout gates

1. Review wireframes with realistic example data for Home, Inbox and Stock first. Then Profit/Payouts, Deals and B2B.
2. Settle metric definitions and required operational inputs. Use explicit unknown states wherever inputs remain missing.
3. Build shared layout/navigation/components and retire duplicate entry points.
4. Implement page groups incrementally with relevant API/data fixes, preserving existing messaging ownership and access control.
5. Verify at 13-inch laptop widths and phone widths. A user should identify today's revenue/orders, the most urgent replenishment and why, an unresolved customer's order, a payout discrepancy, and a deal's next action without reading a long explanation.
6. Run required build/test/lint checks and specific data/messaging regression checks for changed paths. Validate migration application separately from filename checks. Commit/push to main per repository rules; report deployment separately and deploy only within authorised scope.

## Remaining decisions

Founder inputs: restock preparation/appointment time, stock cover target, cartons, reserve policy, SKU mappings, cost basis. Team inputs: support waiting threshold/business hours, independently expected Amazon fees and bank data if needed, exact live Brevo-native journeys. User review: actual screen layouts, final desktop grouping, final repeat-customer definition. These do not block visual prototypes with clearly labelled illustrative data.


## Visual direction selected

The user selected **B · Bold brand** from the three interactive prototype options. This is the default direction for further refinement: stronger PROMUNCH color blocks, prominent KPI numbers, polished primary buttons and a light utility layout. Retain distinct urgency labels and mobile readability. The selection applies to the design proposal; production implementation and deployment have not occurred.
