# PROMUNCH screen coverage register

12 September 2026. Source inventory: 132 surfaces across 28 page-route files. The visual prototype expands these into 209 individual views, each available in laptop and mobile sizes. Important general states are accessible through the preview State selector.

[Open the visual review](2026-09-12-ui-redesign-review.html)

## Route coverage

| Current route | Coverage area |
|---|---|
| `/auth/set-password` | Access & shell |
| `/dashboard/amazon` | Amazon |
| `/dashboard/analytics` | Email marketing & automation |
| `/dashboard/assistant` | Assistant & administration |
| `/dashboard/audit-log` | Assistant & administration |
| `/dashboard/campaigns/[id]` | Email marketing & automation |
| `/dashboard/campaigns/new` | Email marketing & automation |
| `/dashboard/campaigns` | Email marketing & automation |
| `/dashboard/contacts/[id]` | Contacts |
| `/dashboard/contacts` | Contacts |
| `/dashboard/deals` | Deals |
| `/dashboard/flows/[id]` | Email marketing & automation |
| `/dashboard/flows/new` | Email marketing & automation |
| `/dashboard/flows` | Email marketing & automation |
| `/dashboard/instagram` | Instagram |
| `/dashboard/integrations` | Assistant & administration |
| `/dashboard/leads` | B2B leads |
| `/dashboard/order-confirmations` | Orders & Shopify |
| `/dashboard` | Home |
| `/dashboard/settings` | Assistant & administration |
| `/dashboard/shopify-attribution` | Orders & Shopify |
| `/dashboard/support-emails/[id]` | Email support |
| `/dashboard/support-emails` | Email support |
| `/dashboard/team` | Assistant & administration |
| `/dashboard/whatsapp` | WhatsApp inbox; WhatsApp marketing; WhatsApp automation & knowledge |
| `/login` | Access & shell |
| `/` | Access & shell |
| `/u/[token]` | Access & shell |

Also preserve `/auth/callback`, `/r/[code]` and their error/redirect outcomes. Short-link redirects are not admin screens; do not redesign their tracking behavior.

## Surface coverage

Each row below maps to visual views in the prototype. Source existence does not mean every proposed interaction already exists; proposed additions remain labelled in the kind column. Runtime verification is still required.

### Access & shell

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S001 | Sign in | Existing | Use current red wordmark, email and password, one Sign in action; secondary magic-link and account creation links. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S002 | Create account | Existing | Name, allowed work email, password and validation in one compact form; show confirmation-required outcome explicitly. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S003 | Magic-link request & sent confirmation | Existing | Explain email delivery, show destination address, allow retry with pending state and return to sign in. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S004 | Invitation / set password | Existing | Valid, expired, missing-session, weak-password, saving and success states; preserve existing invitation handling. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S005 | Root & auth callback redirects | Existing | Preserve / and /auth/callback navigation; expose recoverable auth errors without blank intermediate screens. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S006 | Desktop navigation & account menu | Existing | Current wordmark, grouped navigation, one active location, account and Help; move diagnostics into Settings. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S007 | Mobile navigation | Existing | Home, Inbox, Orders, More shortcuts; complete grouped menu under More; modal focus handling and route restoration. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S008 | Help & onboarding tour | Existing | Task-based help; resumable tour with skip and close; anchor mobile steps to visible controls. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S009 | Notifications & sound preferences | Existing | Plain unread/needs-attention meanings; sound selector and browser-permission states; settings in account menu. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S010 | Page loading / recoverable error / global error | Existing | Consistent skeleton, useful error and Retry; session expiry, offline, empty and forbidden remain distinguishable. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S011 | Unsubscribe success & invalid link | Existing | Current brand, clear email opt-out outcome; preserve idempotent behavior and no-login access. | Single column; visible labels; 48px primary controls; preserve destination after login. |
| S012 | Unknown route / unavailable record | Proposed | Branded not-found state with Back and relevant list link; distinguish deleted, denied and failed-to-load records. | Single column; visible labels; 48px primary controls; preserve destination after login. |

### Home

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S013 | Daily overview | Existing | Limit opening view to task queue and four period-labelled metrics; remove decorative sparklines and generated trend data. | Needs attention first; two compact metrics per row; reports below tasks. |
| S014 | Needs attention queue | Existing | Group missing confirmations, failed sends, urgent emails and tickets by required action; cap preview to five rows with View all. | Needs attention first; two compact metrics per row; reports below tasks. |
| S015 | Revenue & channel performance | Existing | Use real dated series only; one chart plus channel summary; label Shopify/Amazon periods and gross/net basis. | Needs attention first; two compact metrics per row; reports below tasks. |
| S016 | Operations & channel health | Existing | Compact current status; expand details on demand; never hardcode healthy when no telemetry supports it. | Needs attention first; two compact metrics per row; reports below tasks. |
| S017 | Full attention list | Proposed | Dedicated filtered worklist linked from Home, with owner, age and one next action per item. | Needs attention first; two compact metrics per row; reports below tasks. |

### Amazon

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S018 | Amazon overview | Existing, reorganized | Gross sales, fees, net payout and stock alerts only; use one selected period and per-source freshness; move long tables to dedicated sections. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S019 | Inventory & stock risk | Existing, reorganized | Product, fulfillable units, days of cover, inbound and risk; consolidate duplicate low-stock panels; show modelled loss as an estimate. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S020 | SKU economics | Existing, reorganized | Default columns Product, units, net per unit, landed cost, estimated contribution; secondary fees in detail; explicitly fixed 90-day window. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S021 | SKU detail & fee breakdown | Proposed | Expose referral/FBA/closing/other fees on tap, alongside full product name, SKU, refunds, velocity basis and missing-cost explanation. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S022 | Edit landed cost (COGS) | Existing, reorganized | Move inline field to focused edit sheet with currency/unit label, Save/Cancel, validation and unsaved state; preserve current calculation. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S023 | Settlements & reconciliation | Existing, reorganized | Separate settlement ledger and gross/net chart; label settlement period independently of finance-event period. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S024 | Settlement detail | Proposed | Readable breakdown of only fields already supplied; surface unreconciled/unknown values; do not invent bank-match functionality. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S025 | Recent orders | Existing, reorganized | Own section with order, date, fulfilment and amount; clearly label current recent-order limit; full history requires API pagination work. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |
| S026 | Sync status & result | Existing, reorganized | Compact freshness control; show orders, inventory and finance timestamps separately; progress/failure beside sync action. | Section selector replaces long tabs; summary cards open full-screen detail; primary work never requires sideways scrolling. |

### WhatsApp inbox

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S027 | Inbox & saved filters | Existing | Conversation search, All/Mine/Unassigned, status and archive; preserve last_activity_at ordering; clear unread and human-required badges. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S028 | Conversation | Existing | Quiet neutral canvas, legible messages, subtle outgoing tint, clear sender and delivery state; customer support tone in admin labels. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S029 | Customer & order context | Existing | Identity, contact link, purchase context, consent, tags and tickets in collapsible side panel; full-screen context on phone. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S030 | Tickets worklist | Existing | Open/pending/resolved/closed and urgency as text; rank next action and age; show ticket owner and related conversation. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S031 | Ticket handling / assignment / AI-human mode | Existing | Keep assignment, status and handoff controls near identity; preserve backend behavior and permissions; make mode changes explicit. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S032 | Message composer & draft generation | Existing | Visible Reply label, 16px text, separate draft generation from Send; preserve text across upload/error/navigation. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S033 | Template picker & variable preview | Existing | Search approved templates, fill named variables, show rendered customer message before sending; clearly explain closed-window limitation. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S034 | Attachment upload, preview & media viewing | Existing | Preview file before send; progress/retry/remove; image/audio/video/document surfaces with usable controls and accessible labels. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S035 | Share chat / archive / resolve | Existing | Secondary action menu; copy confirmation and predictable history; archive undo only where backend supports safe reversal. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S036 | Opted-out / closed window / failed delivery | Existing | Persistent reason beside composer; surface safe available actions and exact status; never use colour alone or imply send succeeded. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |
| S037 | Connection health details | Existing | One compact health control; expanded uptime, last inbound and failures in diagnostics view rather than permanent metrics strip. | One pane at a time: list → conversation → customer context; back restores list and draft; composer stays above keyboard. |

### WhatsApp marketing

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S038 | Template library | Existing | Compact searchable rows with name, purpose, category and approval status; preview on selection instead of all content expanded. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S039 | New / edit template | Existing | Staged Content → Media & buttons → Preview → Submit; preserve Meta constraints, variable examples and edit mode. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S040 | Template media upload & approval result | Existing | Upload/progress/error states; approved, pending, rejected and sync states with next action and available rejection reason. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S041 | Campaign list & status | Existing | Draft/scheduled/running/paused/completed/failed presentation; summary counts; expand one campaign at a time. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S042 | Campaign detail & recipient log | Existing | Progress funnel, schedule, controls and received/failed/duplicate recipient filters; distinguish exclusions from delivery failures. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S043 | Campaign edit / schedule / recurrence | Existing | Focused edit view; show timezone, repeat rule and next send; never hide whether an action launches immediately. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S044 | New campaign: audience | Existing, reorganized | Show tier/segment/tags eligibility, consent exclusions and eligible count; retain existing audience rules and defaults. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S045 | New campaign: content & personalization | Existing, reorganized | Template, media, variables and AI personalization with exact preview; keep personalization changes reviewable. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S046 | New campaign: test / review / launch | Existing, reorganized | Recipient count, exclusions, sample, schedule and repeat in a review summary; explicit send control and pending/result states. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S047 | Contact import & CSV column mapping | Existing | Separate import from campaign creation; preview phone/name/tags mappings, invalid rows, duplicates and consent provenance. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |
| S048 | Audience quality | Existing | Explain engaged versus imported contacts, suppression and delivery; preserve refresh states and distinguish disabled tiering from zero audience. | Full-screen staged editors; audience and rendered message reviewed sequentially; all scheduling controls touch accessible. |

### WhatsApp automation & knowledge

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S049 | Automation library | Existing, reorganized | Summarize flow name, trigger, state and last outcome; expand one flow for settings; preserve current journeys. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S050 | Order confirmation automation | Existing | Dedicated detail for enablement, template and timing; explain sent/delivered versus customer confirmation. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S051 | COD confirmation gate | Existing | Readable ordered reminder and needs-call steps; preserve gate timing and manual confirmation requirements. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S052 | Shipping update automation | Existing | Trigger and approved template settings; preserve Shopify order-status link source. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S053 | Abandoned-cart recovery automation | Existing | Show reminder/coupon sequence, stop conditions, active/recovered/expired outcomes and current templates in separate blocks. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S054 | Voice rescue automation settings | Existing | Show eligibility, delay, calling settings and status; link to Voice calls; existing customer contact rules remain intact. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S055 | Review request automation | Existing | Template, delay and skipped/cancelled outcomes in focused detail. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S056 | Restock reminder automation | Existing | Template, delay and outcome counts; no concurrent expanded journey diagrams. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S057 | Custom flows: list / new / edit | Existing | Name, supported trigger, ordered template/delay steps and saved state; separate review before activation. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S058 | Voice calls list | Existing | Contact, date, status, outcome and duration; filter/search; use plain names for raw provider statuses. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S059 | Voice call detail / transcript / recording | Existing | Outcome summary followed by transcript, recording and related cart/order; preserve masked list identity and do-not-call state. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S060 | Voice sync & partial failure | Existing | Explain syncing progress, stale dialing, partial do-not-call update failures and retry without treating errors as success. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S061 | Growth: storefront popup editor | Existing | Content, design, targeting/display and preview sections; desktop/mobile preview toggle; save and install kept distinct. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S062 | Growth: WhatsApp widget editor | Existing | Focused appearance/content form and preview; image upload, placement options and install feedback remain reachable. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S063 | Knowledge library | Existing | Searchable document list, upload status and source metadata; clarify documents feed the Master KB. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S064 | Knowledge upload / paste / delete | Existing | File and manual-text intake, indexing progress, errors and remove confirmation; readable document title and content preview where available. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S065 | WhatsApp analytics overview | Existing, reorganized | Four primary delivery/reply/revenue metrics; funnel, attribution and delivery problems below in distinct sections. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |
| S066 | WhatsApp analytics details | Existing | Retain campaign report cards, customer tiers, send-time view, live activity and failure categories behind drilldowns; explain each denominator. | Vertical steps and full-screen detail; no sideways flow canvas requirement; previews toggled separately from form. |

### Email support

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S067 | Support inbox & filters | Existing | Sender, subject, age, urgency and status; put scores and taxonomy in detail; filter drawer with active count. | List → thread → sender context; email and reply full width; latest content first; fixed reply action does not obscure text. |
| S068 | Support thread & incoming email | Existing | Readable conversation chronology and attachments/content treatment; subject can wrap; source identity stays visible. | List → thread → sender context; email and reply full width; latest content first; fixed reply action does not obscure text. |
| S069 | AI draft: review / edit / rewrite / send | Existing | Separate editable draft from received/sent messages; exact recipient and content review; preserve draft approval semantics. | List → thread → sender context; email and reply full width; latest content first; fixed reply action does not obscure text. |
| S070 | Sent replies & earlier revisions | Existing | Latest reply visible; older revisions collapsed with timestamp and status, never confused with sent email. | List → thread → sender context; email and reply full width; latest content first; fixed reply action does not obscure text. |
| S071 | Sender context / handling guidance / add B2B lead | Existing | Secondary context view; existing Add to B2B Leads action and status changes remain available. | List → thread → sender context; email and reply full width; latest content first; fixed reply action does not obscure text. |

### Orders & Shopify

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S072 | Order confirmation worklist | Existing | Prioritize missing/failed/needs-call; distinguish notification Sent from COD Customer confirmed; show period and eligibility. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |
| S073 | Manual retry & bulk missing-send review | Existing | Display exact eligible order count, exclusions, pending state and outcome; retain atomic claims and no duplicate sends. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |
| S074 | COD action detail | Existing | Customer, order, gate state, reason and permitted next action; explicit confirmation for release/cancellation actions. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |
| S075 | Shopify overview | Existing | One selected-period summary, creator segment and coverage; move competing Today/7d/30d/All-time cards to comparison view. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |
| S076 | Shopify channels & attribution coverage | Existing | Ranked source table, revenue/orders/share and first-touch definition; explain unattributed versus zero sales. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |
| S077 | Shopify campaign & referrer reports | Existing | Dedicated drilldown for UTM campaigns and referrers; retain creator exclusion and consistent currency/period labels. | Prioritized order cards; separate delivery and COD status lines; attribution tables become ranked lists. |

### Instagram

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S078 | Instagram inbox / needs human / spam | Existing | Inbox with saved filters rather than parallel product sections; clear classification and unread status. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S079 | Instagram conversation & reply | Existing | Shared conversation layout; sender identity, classification, handoff/analyze controls and send pending/error. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S080 | Collaboration pipeline | Existing | List/board with next step and creator; reduce classification jargon; details on selection. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S081 | Discovery search / hashtag search | Existing | Focused query and eligibility form; explicit search progress and result count. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S082 | Discovery candidate list & enrichment | Existing | Follower fit, available contact, selection and enrichment/draft actions; detailed reasoning on expansion. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S083 | Pitch queue: review / send / skip | Existing | One creator and complete proposed pitch per screen; visible outcome and pending/error feedback. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S084 | Tasks & fulfilment worklist | Existing | Task type, creator, due date and completion action; expose fulfilment/tracking detail only when relevant. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |
| S085 | Instagram settings | Existing | Separate automation switches and barter/follower criteria into labelled sections; preserve actual connection availability. | Single thread or candidate at a time; stage and filter selectors; no wide table dependence. |

### B2B leads

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S086 | Lead lists & create / rename / delete | Existing | Lists with purpose, sendable count and next step; list actions in menu with clear result states. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S087 | Lead list detail & recipient selection | Existing | Company, contact availability, fit and outreach state; column chooser for secondary fields; bulk selection count. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S088 | Find companies / search configuration | Existing | Category, city, product and target grouped in steps; explain run state and avoid a wall of choices. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S089 | Lead pipeline progress & email finding | Existing | Readable Searching → Enriching → Ready status; progress/errors contextual to list; retain reveal and bulk-email finding. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S090 | Lead detail / evidence / draft / outreach actions | Existing | Company overview, evidence, contact details and draft in separate sections; safe next action; source email/reply history preserved. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S091 | List picker | Existing | Search list names and show counts; one selection and Continue. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S092 | Outreach wizard: recipients | Existing | Ready, missing email, already in sequence, replied and suppressed groups; show exclusions explicitly. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S093 | Outreach wizard: content / sequence | Existing | Products, saved email or AI draft, quick send versus sequence; use correct founder sender details. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S094 | Outreach wizard: personalized preview | Existing | Exact rendered email for chosen recipient; step through examples without losing content; later steps clearly indicated. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S095 | Outreach wizard: launch / results | Existing | Send window, cap, recipients and sequence review; pending/success/partial failure; explicit launch. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S096 | Sequences list / create | Existing | Name, stage, enrolled count and next action; name dialog with validation. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S097 | Sequence editor & enrolled recipients | Existing | Vertical delay/email steps, save, pause/activate and enrolment list; remove drag-only dependencies. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S098 | Saved emails: library / editor | Existing | Searchable templates; subject/body/variables; focused editor with preview and unsaved indicator. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S099 | Saved emails: AI drafting | Existing | Product-grounded brief, pending/error and editable result; approved content separate from generated draft. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S100 | Replies inbox | Existing | Prioritized replies linked to lead and deal context; show stopped-sequence status. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S101 | Outreach analytics | Existing | Separate sends/opens/funnel/sequence/template comparisons; label periods and sample size; avoid decorative charts. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |
| S102 | Outreach settings & guide | Existing | Sender, schedule, caps and configuration in a settings view; task guide available on demand, not repeated over every list. | Searchable lists and full-screen lead/editor views; wizard one step at a time; sticky footer with Back and primary action. |

### Deals

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S103 | Deal board & inquiry/active/closed filters | Existing | Stage, company, value, next action and due date; list alternative with search/kind/follow-up filters. | Stage selector and vertical list; detail full screen; status change possible without dragging. |
| S104 | Deal details & next step | Existing | Summary, owner of next step, due date and stage; focus on what happens next. | Stage selector and vertical list; detail full screen; status change possible without dragging. |
| S105 | Deal edit & email history | Existing | Separate edit form and expandable source emails; retain linked evidence, updates and save/error states. | Stage selector and vertical list; detail full screen; status change possible without dragging. |

### Contacts

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S106 | Contact directory & advanced filters | Existing | Identity, channel availability, lifecycle, last purchase and LTV; advanced order/spend/date/audience filters on demand. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S107 | Add contact | Existing | Name, email and phone with visible optional/required rules matching API; phone-only identity supported. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S108 | Contact import & result | Existing | Preview import source, progress and outcome; no implied marketing consent from import. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S109 | Contact overview | Existing | Identity, consent and key purchase facts; no huge KPI wall before contact actions. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S110 | Contact orders & activity | Existing | Chronological real orders and channel activity; correct Shopify data source and empty/unmatched explanations. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S111 | Contact audience & custom properties | Existing | Lists, segments and properties grouped; lifecycle separated from consent; maintain null-safe email and anonymization. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |
| S112 | Contact status / delete actions | Existing | Plain effect, permission-aware actions and confirmation; preserve GDPR behavior and consent history. | Identity cards with phone fallback; filters in sheet; contact tabs become a selector; orders open readable detail. |

### Email marketing & automation

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S113 | Email campaign list | Existing | Rename ambiguous Campaigns navigation to Email campaigns; status filtering and date/revenue/open sorting remain. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S114 | Email campaign create: setup | Existing | Name, audience, subject and preview text in logical steps; email eligibility and exclusions visible. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S115 | Email campaign create: content / preview / schedule | Existing | Add readable editor and safe rendered preview; keep HTML source as advanced mode; schedule and draft save distinct. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S116 | Email campaign save success | Existing | Link to campaign detail and state, with clear next action. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S117 | Email campaign detail / lifecycle controls | Existing | Performance funnel, health and content; edit/start/pause/schedule only as currently supported; clear pending/failed states. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S118 | Email flows list | Existing | Rename Flows to Email automations; show trigger, state and last result, keep template entry points. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S119 | Email flow creation / template selection | Existing | Choose supported template or custom flow; save as draft, then edit. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S120 | Email flow settings & step editor | Existing | Name, trigger, coupon, ordered steps, timing and content; readable activate/pause/delete controls and result states. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |
| S121 | Email analytics | Existing | Explicit email scope, selected period, actual revenue/sends/growth/health; drill into campaigns and flows; remove unsupported comparison claims. | Full-width email preview separate from editor; vertical flow steps; summaries before detail; schedule in explicit timezone. |

### Assistant & administration

| ID | Surface | Status | Redesign | Phone behavior |
|---|---|---|---|---|
| S122 | Ask Maya welcome & conversation history | Existing | Task examples and recent chats; avoid oversized decorative welcome; mobile history drawer. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S123 | Ask Maya conversation / streaming / copy | Existing | Readable answers and provenance, progress/stop/retry states; input above keyboard and safe scroll behavior. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S124 | Assistant tool results / tables / errors | Existing | Summary first, details on demand; scroll contained tables; explain unavailable evidence and action outcomes. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S125 | Settings connections & diagnostic detail | Existing | Integration name, connection/freshness status and next action; advanced events/log details on demand. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S126 | Shopify connection / disconnect / catalog sync | Existing | Focused connection card with progress, last sync and explicit disconnect effect; preserve current permissions. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S127 | API keys list & edit/rotation | Existing | Owner-only provider status, masked values, explicit save/remove and migration-required state; never expose keys in previews. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S128 | Email sender settings | Existing | Readable sender identity, reply-to and domain status; distinguish saved values from editable fields. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S129 | Brand settings & logo upload | Existing | Preview current approved logo, filename and dimensions; upload validation and save result; no stretching or crop. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S130 | Team list / invite / role / remove | Existing | Admin/member meanings; invite form, pending/success/error and permission-aware role/removal controls. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S131 | Audit log list / action filter / details | Existing | Actor, action, target and time first; expanded metadata secondary; sensitive data stays protected. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |
| S132 | Legacy Team and Integrations URLs | Existing redirects | Preserve /dashboard/team → Settings Team and /dashboard/integrations → Settings Connections, including browser history. | History and context in sheets; settings subsections single column; long values wrap; owner-only controls preserve server checks. |

