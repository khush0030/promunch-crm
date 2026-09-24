# PROMUNCH UI: modular implementation contract

Status: proposed. Applies after approval of the visual pack. No production code changed by this document.

## Visual identity

The visual pack now uses the current PROMUNCH wordmark, Archivo Black page headings, Assistant body text, red actions, neutral content surfaces and separate status colours. It includes a component reference at `D001`. Typography is intentionally more expressive at the page heading and more restrained within the work area. Use actual font assets and retain required font licensing when implementing.

## Module boundaries

Each feature owns its data adapter and its business-specific content. Shared UI owns layout, controls, accessibility and responsive behavior. A reusable component must not decide who is eligible to receive a message, who can confirm a COD order, how profit is calculated, or which users can manage secrets.

| Shared component family | Responsibility | Used in |
|---|---|---|
| AppShell / GroupedNavigation / MobileNavigation | Current location, grouped links, account utilities, focus and responsive layout | Every signed-in screen |
| PageHeader / ActionBar | Title, purpose and a single primary task | All modules |
| Metric / ChartFrame / FreshnessIndicator | Readable values, units, time basis, honest missing/partial data | Home, Amazon, Shopify, reports |
| RecordList / DataTable / MobileRecordCard | Same records and actions, different layout by space | Orders, contacts, inventory, leads, team, audit log |
| RecordDetail / PropertyList / ActivityTimeline | Identity, next action and secondary context | Customer, deal, lead, SKU, order and call details |
| InboxShell / ConversationList / Conversation / ContextPanel | List/thread/context layout and navigation | WhatsApp, email and Instagram |
| MessageComposer / AttachmentPreview / TemplatePicker | Draft input, previews, pending/error rendering | Support channels |
| FormField / Select / Textarea / Upload / FormActions | Labels, help, validation, editing and explicit save/cancel | All forms |
| StepEditor / ReviewSummary | Sequence steps and review of an outgoing action | Campaigns, templates, automations and outreach |
| Dialog / Sheet / ConfirmAction | Focus management, escape/back, exact action effect | Short edits and consequential actions |
| StatusBadge / Notice / EmptyState / ErrorState / Skeleton | Consistent state meanings and recovery | Every data-dependent view |

## Feature structure

Retain existing routes and progressively introduce feature-owned components under the current component organisation. Do not rewrite every route at once. A module should contain a screen container, a data adapter and small view components; its server and messaging rules remain in existing API and edge-function ownership.

A record list supplies columns, a stable row identifier, a mobile summary and allowed row actions. The list component chooses desktop table versus mobile card based on available width. A developer should not implement separate business behavior for the phone view.

An inbox supplies conversation records, a selected record, messages, composer state and context slots. The shell changes panes by available width; it preserves selected record, query and scroll. The channel adapter supplies its send restrictions. Email has its own draft/revision content; WhatsApp supplies consent/window/mode state; Instagram supplies classification and collaboration context. The common visual layout does not merge channel semantics.

A metric requires label, value, unit, period, source/freshness and optional real comparison. Missing data and measured zero are separate. A chart receives observations; it never invents a shape from a total. A status badge takes a semantic state, not an arbitrary brand colour.

A form uses one validation model on both layouts. Longer editors become full-screen pages on phone. Dialogs remain for short decisions. ReviewSummary receives the actual recipient/entity, eligibility summary, content and execution timing so it cannot substitute a generic “Are you sure?” for a consequential action.

## Navigation contract

Primary groups are Home, Inbox, Sales & orders, CRM, Marketing, Automations, Reports and Settings. The current group expands automatically; other groups remain available. Phone shortcuts are Home, Inbox, Orders and More. More contains every area, not a reduced feature set. Ask Maya, help, account and notifications stay reachable.

Keep legacy URLs and WhatsApp shared-chat links. Persist meaningful section/filter/selection state in validated URL state. Back returns to the previous list with its filters and position. Avoid opening long editors inside nested overlays.

## Rules that prevent future crowding

- Add a new metric to a detailed report unless it changes the main decision on the overview.
- Add an action to the relevant row/detail or menu unless it is the primary job of the page.
- Show a maximum of four top-level KPIs on overview pages; no compulsory KPI strip on inboxes and worklists.
- Add a new feature to the appropriate navigation group, not a new permanent peer tab across all channel work.
- Reuse tokens and component variants. A channel logo does not create a new colour system.
- Every new surface is added to the coverage register with laptop, phone and relevant state review.
- Display only data the existing or newly scoped API can supply. Do not add decorative data, inert exports or implied operational capability.

## Adoption and review

Build the component reference in the application first, then migrate Home, Amazon and WhatsApp Inbox. This exercises metrics, records, forms and conversations before the rarer modules. Continue across the full inventory rather than calling the redesign complete after three pages.

Every component needs keyboard and screen-reader semantics appropriate to its role, including associated labels, focus restoration, announced errors and status text. Validate 320–1440px reflow and actual phone keyboard behavior. A reusable style is not automatically an accessible component.

The HTML prototype uses reusable renderers to keep the review consistent. It is a design artifact, not the production React architecture, and simulated controls must be replaced with existing tested contracts during implementation.
