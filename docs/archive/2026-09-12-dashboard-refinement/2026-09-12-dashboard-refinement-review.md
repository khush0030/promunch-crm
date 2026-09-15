# PROMUNCH dashboard refinement: visual review

Status: proposed, awaiting screen-by-screen approval. No application code, data, customer messaging or production deployment changed.

This revision replaces the broad redesign direction for review. Keep the existing dashboard, Geist typography, route locations and sidebar groups. Change the palette to current PROMUNCH red (#AF272F), warm white (#F4F1EA), white cards and dark readable text. Keep semantic status colours distinct from primary actions.

[Open the visual review](../audits/2026-09-12-dashboard-refinement-review.html). Select a page or interaction, switch between Laptop and Mobile, then record approval or feedback for that individual device. Notes save in this browser; Export review notes creates a portable review file. Marking a preview approved does not deploy anything.

## Scope

The review contains 209 app page/section/interaction compositions and one component reference. These are not 209 new routes. The existing inventory identifies 28 page routes and 132 source surfaces; forms, selected records and expanded sections are presented independently so they can be reviewed. All figures and customer records in the previews are fictional layout examples, not an authenticated production audit.

The existing navigation remains Overview, Inbox, Sales, Audience and System. WhatsApp, Instagram, B2B and Settings retain their module tabs. Mobile uses the existing menu and focuses on one conversation, record or form at a time.

Review coverage includes access and account states; Dashboard; Amazon; WhatsApp inbox, tickets, templates, campaigns, flows, voice, growth, analytics and knowledge; support email; order confirmations; Shopify; Instagram; B2B lists, discovery, outreach, sequences, templates, replies and settings; deals; contacts; email campaigns and automations; analytics; Ask Maya; connections, API keys, email sender, brand, team and audit log. Loading, empty, error and access-restricted states are available in the review selector.

## What changes

- **Dashboard:** four clearly scoped metrics, actionable work near the top, simple channel comparisons with matching periods. Remove decorative sparklines and generated trends. Keep channel-health detail secondary.
- **Amazon:** gross sales, fee share, net payout before product costs, and current stock-risk count. Put SKU stock cover first. Keep economics, settlements, payout breakdown and orders available in expandable sections on the existing page. The separate detail previews represent these sections, not a navigation redesign.
- **Stock visibility:** show available units, estimated cover and inbound separately. Zero available stock remains visible even without sales history. Unknown inventory must say unavailable. No sales history must say no demand estimate. Use the same cover scale and explicit status labels on laptop and mobile.
- **WhatsApp and other inboxes:** calmer neutral backgrounds, restrained brand accents, readable conversation text and clear ownership/actions. Keep customer context available without crowding the conversation. This is a visual proposal, not a change to bot replies or send behaviour.
- **Lists, forms and settings:** retain the task and fields; give the primary action priority. Move optional explanations and history behind clearly named details. On mobile, use readable records and single-column forms instead of shrinking desktop tables.
- **Reports:** visual marks must represent recorded values, with a period, units and definition. The sample charts illustrate presentation only. Rates require compatible counts and a stated denominator; no decorative chart may substitute for missing data.

## Before implementation

Approval applies to the specific screen and device reviewed. Implement only the accepted changes, preserve permissions and workflows, then verify using real API shapes. Financial data may be unavailable or stale; previews do not establish live values. Amazon inventory-only SKUs must be included even when they have no finance events. Stock estimates need an explicit 30-day basis or labelled 90-day fallback.

The broader first proposal is superseded by this refinement direction. Its old proposed navigation and font changes are not approved requirements.
