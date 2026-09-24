# PROMUNCH CRM: actual workflows and redesign foundations

Date: 21 September 2026. Status: read-only investigation and design recommendations, not implementation.

## Scope and evidence

Indexed 714 source/migration files (95,443 lines), including 38 application page files, 158 API handlers, 98 SQL migrations, and 58 edge-function entry points. Traced the implementation paths for navigation, sales, Amazon, inbox/customer context, deals, lead discovery/outreach, email engines, configuration, and background processing. This is a repository-wide inventory plus focused workflow review, not a claim that every line was manually audited.

Read the live PostgREST schema and exact counts for all 85 exposed relations. Read selected non-secret configuration, operational status, inventory, costs, settlements, and contact-quality fields. Retrieved Brevo campaign, template, and contact metadata through read-only API calls. Reused the earlier full stored deal-email extraction. No customer messages, provider lookups that consume credits, job triggers, database mutations, or production changes were made.

Limits: exposed REST relations are not the entire PostgreSQL catalog. Live pg_cron schedules, deployed function versions, bank receipts, provider account automations, and complete Gmail archive coverage remain unverified. Brevo webhook reads returned HTTP 400 even with the types used by the app; registration status is therefore unknown. No live browser usability session was performed.

Existing tests: 41 files / 638 tests passed. Migration filename check passed; this does not prove all SQL was applied. No application code changed, so no new production build was run.

## What actually powers the app

| Workflow | Actual flow | Live evidence |
|---|---|---|
| Website/HYPD sales | Shopify webhooks → shopify_orders → metrics APIs → Home/Sales | 1,296 orders; legacy orders has 472 and is not the correct source |
| Amazon | amazon-poll → orders/items, latest inventory, finance events; settlement ingest → report lines | 5,014 orders, 5,224 order items, 166 inventory records, 4,319 finance item events |
| WhatsApp | Meta webhook → contacts/threads/messages → claimed jobs → KB-grounded reply/send; journeys run separately | 1,487 contacts, 1,469 threads, 10,668 messages, 2,283 journey runs |
| Support email | Gmail push/poll → email_threads/draft_revisions → approval/send | 549 thread records, 37,468 draft revisions, 3 sent_replies; counts are not unique conversations or verified send totals |
| Deals | Gmail scan → classification/extraction → deal_emails + deals → views | 371 deals, 2,366 ledger emails; latest scan had no stored error |
| B2B discovery | Places search → saved list → website extraction → MX checks → AI drafts | 25 lists, 772 leads, 1,274 contact records, 417 drafts |
| B2B sends/replies | Resend sends using outreach_settings → webhook reply capture → lead status; sequences can send automatically | 4 drafts sent, 3 marked replied but the 3 reply records are simulated; no sequence/enrollment records |
| Brevo marketing | CRM → Brevo API for campaigns/templates/reporting; separate sync and order-event bridge | Brevo API: 7 campaigns (3 sent, 3 drafts, 1 cancelled), 4 active templates, 596 contacts |
| CRM cart email | Shopify checkout events → flows/enrollments → email-flow-tick → Resend → email_sends | 1 active abandoned-cart flow, 94 enrollments, 320 sent records; last send on 21 September |
| Instagram/creators | Frontend and edge implementation exist | Zero threads, messages, jobs, or reply claims; user confirms backend is not live |

Key ownership distinction: Brevo campaigns, CRM cart-recovery emails, Gmail support, Resend B2B outreach, and WhatsApp journeys are separate systems. They should have coherent navigation but must not be consolidated by deleting their sending engines.

## Findings that change the redesign

### 1. Homepage metrics need corrected definitions

`src/lib/metrics/period.ts` only offers rolling 7/30/90/365-day windows. It does not implement Today in India time. Add an IST midnight-to-now view, with an explicitly comparable prior period.

`sales-aggregate.ts` combines Shopify order-date revenue with Amazon finance-event posted-date revenue, while Amazon order counts use purchase date. This is unsuitable as an unexplained same-day sales measure. Use order-date measures for trading performance and finance-date measures for settled financial reporting, clearly identifying delayed/unpriced orders and refund handling.

Current top products are Shopify-only and grouped by title, not a cross-channel SKU identity. Current repeat percentage is repeat Shopify orders divided by Shopify revenue orders; it is not unique returning customers or all-channel repeat rate. Implement the agreed buyer-based metric with reliable historical identity, or retain a correctly named interim metric. Do not assume Amazon customer identity is available.

Live Shopify order identity coverage: 118/1,296 have an email and 1,278/1,296 have a phone. Phone/Shopify customer identity must be first-class in customer context and repeat metrics.

### 2. Stock forecasting needs a shared product model

The only exposed inventory/catalog relations are amazon_inventory and wa_catalog_items. Amazon ingestion overwrites current balances; no dedicated historical inventory snapshot relation was found. Sales velocity is finance-event units / 30 calendar days, not in-stock-day demand. A long stockout can therefore diminish apparent demand and eventually disappear from the current stockout selection.

Shopify catalog has 23 variant records, 21 distinct nonempty SKUs. Only five of the 166 Amazon inventory SKU strings match those Shopify SKU strings exactly. This does not prove the products are different: pack mappings, old listings, and naming differ. A reviewed product/flavour/pack mapping is needed before subtracting warehouse units from Amazon needs. Shopify's aggregate inventoryQuantity is not a verified warehouse-location allocation ledger.

Add product groups, channel SKU/variant identities, units-per-pack conversion, warehouse reservations, carton sizes, shipment records/expected sellable dates, and inventory snapshots. Confirm full lead time: 7–10 days after appointment is only the user's provisional post-appointment estimate. Preparation and appointment wait remain unknown.

Forecast daily demand using observed available days when history supports it; display a labelled conservative estimate otherwise. Suggested units = target demand through lead time plus desired coverage and safety buffer, less usable FBA inventory and inbound expected in time; constrain allocation by warehouse stock available after website commitments, convert pack units, and round to cartons. Do not subtract all inbound indiscriminately. Rank urgent candidates by estimated recoverable positive contribution profit, with revenue shown separately and uncertainty visible.

### 3. Profit is incomplete and visual signs are misleading

Only three SKU costs are stored. This is not the same as three currently selling products; calculate sales-weighted coverage before reporting completeness. Current overall profit subtracts costs only where known; unknown costs inflate what is labelled profit. Stock's lostProfitPerDay falls back to net receipts before product cost. Missing cost must remain unknown, not zero or profit.

Per-SKU economics use the selected period, while demand is fixed at 30 days. A stockout with no sales in the selected short period can show zero estimated loss even if it sold within 30 days. Decouple forecasting economics from the display filter and use a documented historical basis.

`Profit.tsx` clamps negative retained amounts to a tiny positive green bar segment and colours retained amounts green. Use signed bars and red loss states. Top total-profit ranking and per-unit breakdown are separate measures; expose both. Agree whether the metric is contribution after Amazon fees/product cost or includes advertising, freight, returns, and tax adjustments before naming it net profit.

### 4. Payout matching is only internal report reconciliation

46 stored settlements and 81,697 report lines exist. All 46 have reconciled=true and zero stored variance. The ingest sums Amazon's own report lines and compares them with that same report's deposit summary. It does not independently validate contractual fees or bank receipt.

Separate three checks: report totals match, expected commercial charges match, and bank receipt verified. Ingest uses a tolerance below ₹1; UI metrics use ₹50. Agree one defined tolerance per check. Preserve signed differences; don't label every mismatch 'short' or explain it as a reserve without evidence. Current UI fetches only the latest 12 settlements and 50 orders; provide period-correct pagination and order/fee drill-down using the existing line data. Categorise adjustments without double-counting refund principal inside both sales and refunds.

### 5. Inbox context is available but compressed

The WhatsApp customer endpoint already returns order items, payment, fulfilment, status/tracking links, and contact matching. `WaConversation` reduces this to a narrow customer shape for a compact facts strip. Build the agreed visible right panel from the richer existing response. Do not invent a new disconnected customer system.

The endpoint returns at most 10 orders and calls that result length order_count. Avoid displaying a limited list count as lifetime purchase count. Some failed context requests become null/empty without an explicit error; distinguish unavailable context from a new customer with no orders.

32 WhatsApp threads have open ticket status; four have human status, and none has assigned_to set. Those are different concepts, not automatically a bug, but filtering must prioritise unresolved tickets independently of bot/human status. Define owner, priority, waiting-on-customer versus waiting-on-team, and an agreed response threshold. Ticket age is not always customer waiting time.

### 6. Deals overcrowding starts in classification

The extraction prompt defines any commercial conversation, including cold pitches and vendors, as a deal. The user instead wants buyer interest. Domain matching can combine separate opportunities, and mergeStage only advances automatically, so a false Samples sent stage can persist after later evidence contradicts it.

Current dormancy is 45 days; the user wants a default last-activity window of 60 days. A visibility filter and a lifecycle stage should be separate. GET returns up to 500 deals, and the client has no 60-day filter. Add server-side filtering/pagination and retain search for history.

The existing deterministic reminder already uses five days after outbound, seven days after sample dispatch, and two days after inbound. Proposed improvements are conversation ownership, receipt-based sample feedback, explicit dates, stage-specific reminders, and evidence-backed stage transitions, not merely adding a timer.

Table first, board optional. Company, stage, value when known, last interaction, next action and due date. Detailed fields for amount/currency and due date need a real model; today's commercials JSON/free-text next_step is not an adequate substitute. Allow multiple opportunities for one company and preserve previous wins. See the separate email follow-up analysis for evidence and limitations.

### 7. B2B 'verified buyer' is not yet the current dataset

All 1,274 lead contacts came from mailto/regex extraction. 1,242 pass MX and 32 fail; all mailbox_status and decision_category fields are null. MX confirms a mail-receiving domain, not a valid person's mailbox or procurement role. Hunter and Anymail Finder adapters exist but both provider rows are disabled with zero credit caps; usage ledger is empty.

The existing search target caps discovered companies, not verified decision-makers. To fulfil '10 people from 10 companies', continue researching until ten unique qualified companies each have one verified relevant person, or report a shortfall and reason. Deduplicate by company/domain and person, expose verification source/date, and make missing-provider setup explicit.

Current lists, template generation, wizard, draft review, and sequence controls overlap. Recompose them into Find → Verify → Draft → Review → Send → Replies. Do not activate the sequence sender for the user's initial workflow: it generates and sends later steps without per-email approval. Reviewed drafts must have durable approval tied to the actual draft version, with batch sending of only approved versions.

B2B reply_to is parth@trypromunch.in; the deal scanner reads hello@promunch.in. The current Resend inbound route records outreach replies and stops sequences but does not create deals. A verified reply-capture and interest-to-deal bridge is required. Zero real records in outreach_replies does not prove the business receives no replies elsewhere.

### 8. Brevo is connected, but CRM event integration is not live

Brevo read APIs work and campaigns exist. CRM brevo_settings: sync_target=test, events_enabled=false, sms_enabled=false, last sync count=1. Event claims, webhook events, CRM campaign test/send ledgers are empty. These facts do not imply Brevo-native automations are inactive; those workflows were not independently enumerated.

Keep campaigns, reporting, relevant coupons, and supported automation controls. Display the actual owner/source of each automation. Keep the active Resend abandoned-cart engine until an explicit, deduplicated migration replaces it. Replenishment is enabled in WhatsApp settings at 30 days; do not assume that proves a Brevo replenishment email workflow exists.

### 9. Remove misleading controls as well as pages

Settings has hardcoded connection/sender health and brand defaults. Brand save writes settings_brand, and Shopify disconnect writes settings_audit; neither relation appears in the exposed schema inventory. The code does not inspect Supabase returned errors before showing success, and disconnect does not actually disconnect Shopify. Remove or implement these controls; don't restyle them as working features.

Old email campaign tables are empty and old analytics reads that legacy engine. Retire duplicate campaign/reporting destinations. Keep existing /team and /integrations redirects into Settings. Hidden legacy nav entries still appear in the command palette. Retirement must update search, links, and deep-link behaviour as well as the sidebar.

Instagram settings are enabled-looking despite zero operational records and user-confirmed non-live backend. Treat capability as unavailable until verified. Avoid using an empty dataset alone as a reason to delete a working feature.

## Proposed feature disposition

| Destination | Decision |
|---|---|
| Home; all-channel and website sales | Keep, correct metrics and simplify |
| Amazon products, stock, profit, payouts, orders | Keep, expose as discoverable destinations |
| Customer conversations and tickets | Keep, shared inbox/context and prioritisation |
| Support email old routes | Consolidate into inbox/email after action/history parity |
| Contacts | Keep customer detail; expose marketing audience in context |
| Deals and B2B Leads | Keep, rebuild workflow presentation and missing bridges |
| WhatsApp campaigns, templates, journeys, KB, popup | Keep working capabilities; group settings/tools within their task |
| Brevo campaigns, reports, coupons | Keep; capability-aware controls |
| Legacy campaigns and legacy analytics | Retire duplicate screens |
| Legacy email flow control | Consolidate active cart flow controls; preserve engine |
| SMS and creator partnerships | Remove from everyday navigation; retain dormant implementation |
| Team, connections, activity, keys | Settings/tools; honest health and functioning controls only |
| Ask Maya | Secondary tool; user has not yet decided its prominence |

## Recommended implementation order

1. Confirm metric definitions, product identities, automation ownership, and unresolved operating inputs. Make data gaps explicit in the specification.
2. Produce compact 13-inch laptop wireframes for Home, Inbox, Amazon Stock/Profit/Payouts, Deals and B2B. White surfaces, visible pale-grey sections, dark readable text, semantic colours plus labels. Review these with the user before a broad visual rollout.
3. Build one shared set of tables, status labels, detail panels, period controls, and navigation. Keep multiple sidebar groups expandable and remember state. Retire obsolete destinations comprehensively.
4. Correct sales/customer context definitions; ship Home and Inbox with trusted counts and meaningful exceptions.
5. Add SKU mapping, cost completeness and inventory history; ship Amazon forecasting with stated uncertainty, then deeper independent reconciliation when expected-fee/bank inputs exist.
6. Fix deal qualification/evidence, introduce the 60-day table and sample substatuses, and connect verified outreach/replies to the pipeline.
7. Consolidate email controls while preserving working send owners; hide unavailable capabilities and remove simulated data from operational metrics through a reviewed cleanup.

## Open inputs for the founder/team

- Full restock lead time, target stock coverage, safety buffer, carton sizes, warehouse location and website reserve policy.
- Product/pack mapping and per-SKU costs; what profit includes.
- Independent expected Amazon fee basis and bank data, if bank reconciliation is desired.
- Customer-support overdue threshold and working hours.
- Which Brevo-native journeys are live, and whether the CRM should eventually own their editing.
- Final navigation prominence and layout feedback. Preserve all decisions already made in the conversation.

## Verification boundaries

This audit changed documentation only. It did not fix classifications, activate finders, change messaging, retire routes, or deploy. Source and data disagree with several older handoff documents; use this evidence alongside current code, not stale instructions that still describe retired providers or old cron arrangements.

## Appendix: database relation inventory

Counts reflect the read-only snapshot; large event and message tables were counted rather than exported.

| Relation | Records |
|---|---:|
| `amazon_finance_events` | 4,121 |
| `amazon_finance_item_events` | 4,319 |
| `amazon_inventory` | 166 |
| `amazon_order_items` | 5,224 |
| `amazon_orders` | 5,014 |
| `amazon_report_state` | 51 |
| `amazon_settlement_lines` | 81,697 |
| `amazon_settlements` | 46 |
| `amazon_sku_costs` | 3 |
| `amazon_sync_state` | 3 |
| `app_secrets` | 4 |
| `assistant_conversations` | 5 |
| `assistant_messages` | 10 |
| `audit_log` | 14 |
| `brand_knowledge` | 66 |
| `brevo_campaign_sends` | 0 |
| `brevo_campaign_tests` | 0 |
| `brevo_event_claims` | 0 |
| `brevo_events` | 0 |
| `brevo_settings` | 1 |
| `campaign_emails` | 0 |
| `campaigns` | 0 |
| `connector_events` | 31,858 |
| `contacts` | 2,288 |
| `deal_emails` | 2,366 |
| `deal_scan_state` | 1 |
| `deals` | 371 |
| `draft_revisions` | 37,468 |
| `email_events` | 0 |
| `email_logs` | 88,132 |
| `email_message_claims` | 1,360 |
| `email_sends` | 320 |
| `email_sequence_steps` | 0 |
| `email_sequences` | 0 |
| `email_templates` | 0 |
| `email_threads` | 549 |
| `finder_providers` | 2 |
| `flow_enrollments` | 94 |
| `flows` | 1 |
| `gmail_watch` | 1 |
| `ig_jobs` | 0 |
| `ig_messages` | 0 |
| `ig_reply_claims` | 0 |
| `ig_settings` | 1 |
| `ig_threads` | 0 |
| `kb_chunks` | 36 |
| `kb_documents` | 2 |
| `lead_contacts` | 1,274 |
| `lead_list_members` | 794 |
| `lead_lists` | 25 |
| `lead_searches` | 25 |
| `leads` | 772 |
| `nitro_events` | 1 |
| `oauth_tokens` | 1 |
| `orders` | 472 |
| `outreach_drafts` | 417 |
| `outreach_events` | 20 |
| `outreach_replies` | 3 |
| `outreach_settings` | 1 |
| `provider_usage_events` | 0 |
| `sent_replies` | 3 |
| `sequence_enrollments` | 0 |
| `shopify_attribution_summary` | 5 |
| `shopify_orders` | 1,296 |
| `suppressions` | 8 |
| `voice_calls` | 6 |
| `wa_campaigns` | 1 |
| `wa_catalog_items` | 23 |
| `wa_confirmation_claims` | 2,971 |
| `wa_consent_events` | 0 |
| `wa_contact_engagement` | 1,487 |
| `wa_contacts` | 1,487 |
| `wa_custom_flows` | 0 |
| `wa_customer_rfm` | 899 |
| `wa_flow_settings` | 1 |
| `wa_jobs` | 429 |
| `wa_journey_runs` | 2,283 |
| `wa_link_clicks` | 0 |
| `wa_manual_send_claims` | 19 |
| `wa_marketing_suppression` | 151 |
| `wa_messages` | 10,668 |
| `wa_reply_claims` | 346 |
| `wa_short_links` | 3 |
| `wa_templates` | 16 |
| `wa_threads` | 1,469 |

## Appendix: dashboard page inventory

Routes below were inventoried, including aliases and nested editors. Component-level workflows were traced in the main findings.

- `/dashboard/analytics`
- `/dashboard/assistant`
- `/dashboard/attention`
- `/dashboard/audit-log`
- `/dashboard/campaigns/[id]`
- `/dashboard/campaigns/new`
- `/dashboard/campaigns`
- `/dashboard/contacts/[id]`
- `/dashboard/contacts`
- `/dashboard/deals`
- `/dashboard/flows/[id]`
- `/dashboard/flows/new`
- `/dashboard/flows`
- `/dashboard/inbox/[id]`
- `/dashboard/inbox/email`
- `/dashboard/inbox`
- `/dashboard/inbox/tickets`
- `/dashboard/instagram`
- `/dashboard/integrations`
- `/dashboard/leads`
- `/dashboard/marketing/email/[id]/edit`
- `/dashboard/marketing/email/[id]`
- `/dashboard/marketing/email/new`
- `/dashboard/marketing/email`
- `/dashboard`
- `/dashboard/sales/amazon`
- `/dashboard/sales/orders`
- `/dashboard/sales`
- `/dashboard/sales/web`
- `/dashboard/settings`
- `/dashboard/support-emails/[id]`
- `/dashboard/support-emails`
- `/dashboard/team`
- `/dashboard/whatsapp`
