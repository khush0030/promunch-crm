# PROMUNCH CRM — Redesign Handoff

This is the implementation spec for the warm-editorial redesign. Give it to the dev/agent **together with** `promunch_prototype.html` (the visual target) and `promunch-design-tokens.css` (the source of truth for colour, type, spacing). The prototype is the design; this doc tells you where each piece goes in the existing Next.js app and what data drives it.

**Golden rule:** keep all existing data fetching, API routes, and Supabase logic exactly as they are. This is a **presentation-layer** change. Replace markup + styling to match the prototype; do not touch the pipelines.

---

## Stack & conventions

- Next.js 16 (App Router) · React 19 · Tailwind v4 · Geist font · `lucide-react` icons.
- Add `promunch-design-tokens.css` contents to `src/app/globals.css`. Use the CSS variables (or the `@theme` Tailwind mapping) everywhere — no hardcoded hex.
- The prototype uses **Tabler** icons for convenience; the app uses **lucide-react**. Map by name (e.g. `ti-layout-dashboard` → `LayoutDashboard`, `ti-brand-whatsapp` → `MessageCircle`, `ti-circle-check` → `CircleCheck`, `ti-chart-area-line` → `AreaChart`).
- Charts in the prototype use Chart.js. The app may use Chart.js **or** recharts — either is fine; match the visual (soft area fills, green/gold series, `#1B2A20` tooltips, `₹…k` y-axis).

---

## Build shared components first

Build these once in `src/components/`, then every page composes them. Class names below map 1:1 to the prototype CSS.

| Component | Prototype class | Notes |
|---|---|---|
| `Sidebar` | `.side`, `.nav`, `.navgroup`, `.badge` | The simplified 4-group nav + System. Red badge = live count (unread emails, failed WA). Active item: `--pm-side-active-bg`. |
| `PageHead` | `.pagehead` | h1 (700) + subtitle (`--pm-muted`) left; actions (`.ranges`, `.btn`) right. |
| `SectionLabel` | `.sectlab` | Uppercase band label that groups rows ("Performance", "Revenue", "Operations", "Action"). |
| `KpiCard` | `.kpi` | label + icon chip, big number (800), delta (`.up`/`.down`), optional sparkline. Props: `label, value, delta, sub, tone, spark`. |
| `Panel` | `.panel`, `.phead`, `.csub` | Generic raised card with title row + caption. Wrap charts, lists, tables-in-card. |
| `DataTable` | `.tablewrap`, `table.tbl` | Cream header, hairline rows, hover. Use for Support, Orders, Contacts, Amazon, Leads. |
| `StatusBadge` | `.badge2` + `.bg-green/gold/terra/gray/blue` | Soft-fill pill. Confirmed=green, Pending=gold, Missing/Failed=terra, Not-eligible=gray. |
| `Ring` | `.ring` + `data-ring` | Conic-gradient coverage donut (green=done, terra=missing, gray=ineligible). |
| `MiniBar` / `Stat` | `.mbar`, `.statline` | Horizontal progress bars and 3-up stat blocks for ops cards. |
| `AttentionItem` | `.att` | Icon + text + small action button for "Needs attention". |
| `HealthPill` | `.pill` | Dot + name + status pill for channel/connection lists. |
| `FilterChips` / `SearchBar` | `.chips`, `.chip`, `.search` | List-page toolbars. |
| `Tabs` | `.tabs`, `.tab` | WhatsApp + Settings sub-navigation. |
| `EmptyState` | `.empty` | Icon, title, copy, CTA. |
| `InboxLayout` | `.inbox` (3 columns) | List / thread / context — used by WhatsApp inbox (and Tickets). |

---

## Page-by-page

Routes are under `src/app/dashboard/`. Each row: the prototype view to match, the existing route file, the data source already in the repo, and what to change.

### Dashboard — `page.tsx`
Prototype `#v-dashboard`. Data: `api/needs-attention`, Shopify + Amazon summaries, WhatsApp health (`connector_events`), order-confirmation coverage.
Change: replace the flat cream cards with the 4 banded sections — **Performance** (4 KpiCards + sparklines), **Revenue** (trend line + channel donut), **Operations** (coverage Ring, WA 24h MiniBars, support Stat), **Action** (AttentionItems + HealthPills). This is the highest-priority screen.

### Support Emails — `support-emails/page.tsx` + `[id]/page.tsx`
Prototype `#v-support` (list) and `#v-support-detail`. Data: `api/support-emails`, `api/support-emails/[id]`, `facets`.
List: SearchBar + status FilterChips + category tags + DataTable (From avatar, Subject+preview, Category/Urgency StatusBadges, Score, Status, Received).
Detail: 2-col — left = meta strip + incoming email + **AI-drafted reply** card with `Send / Rewrite / Edit` buttons; right = sender context + "how to handle" + "Add to B2B Leads".

### WhatsApp — `whatsapp/page.tsx`
Prototype `#v-whatsapp`. Data: `api/whatsapp/threads`, `templates`, `campaigns`, `kb`, `health`.
Tabs: Inbox / Tickets / Templates / Campaigns / Knowledge Base. Inbox = 3-pane InboxLayout (conversation list · thread bubbles · CRM contact + order + ticket context). Templates = card grid with category StatusBadge + Meta-approved state. Keep the `Template / AI draft / Send` composer.

### Order Confirmations — `order-confirmations/page.tsx`
Prototype `#v-orders`. Data: `api/whatsapp/confirmations`.
4 KpiCards (Coverage % — colour terra when <50; Missing; Confirmed; Not eligible) + time-range chips + "Send all missing (N)" primary button + DataTable of orders with a per-row **Resend** for missing.

### Shopify — `shopify-attribution/page.tsx`
Prototype `#v-shopify`. Data: existing Shopify attribution query.
4 KpiCards (revenue, AOV, customers, top channel) + "Traffic by channel" DataTable with inline share bars + Top campaigns / Top referrers Panels.

### Amazon — `amazon/page.tsx` (route shown in app)
Prototype `#v-amazon`. Data: SP-API settlement/finance.
4 KpiCards (Gross, Fees −terra, Net +green, Promotions) + gross-vs-net bar chart + Low FBA stock list (0-left = terra badge) + settlement reconciliation DataTable.

### B2B Leads — `b2b-leads/` (route shown in app)
Prototype `#v-leads`. Data: leads table (seeded from wholesale/partnership support emails).
3 KpiCards (open, in-conversation, pipeline ₹) + DataTable (Company, Contact, Source, Stage badge, Value).

### Contacts — `contacts/page.tsx` + `[id]/page.tsx`
Prototype `#v-contacts` + `#v-contacts-detail`. Data: `api/contacts`, `facets`, `[id]`.
List: SearchBar + status FilterChips + DataTable (avatar+name, email, orders, LTV, status, lists/segments tags).
Detail: header with actions + 4 KpiCards (orders, LTV, AOV, last purchase) + Activity timeline Panel (EmptyState when none) + Audience tags Panel.

### Campaigns — `campaigns/page.tsx` (+ `new`, `[id]`)
Prototype `#v-campaigns`. Status Tabs (All/Sent/Scheduled/Draft) + EmptyState with Create CTA. Builder (`new`) reuses Panels + fields.

### Flows — `flows/page.tsx` (+ `[id]`)
Prototype `#v-flows`. EmptyState + 3 template MiniCards (Abandoned cart, Welcome series, Post-purchase).

### Analytics — `analytics/page.tsx`
Prototype `#v-analytics`. 4 KpiCards (email revenue, sent, rev/email, list growth) + subscriber-growth line chart + Email-health MiniBars + active-subscriber stat.

### Settings — `settings/page.tsx` (merges Integrations + Team)
Prototype `#v-settings`. Tabs: Connections / Email / Brand / Team. Connections = HealthPills (this replaces the separate Integrations page in the simplified nav). Email + Brand = read-style field cards. Team = DataTable with role/status badges.

---

## Sidebar consolidation (nav change)

Old: 5 groups, ~14 flat items. New: **Dashboard** · **Inbox** (Support Emails, WhatsApp) · **Sales** (Order Confirmations, Shopify, Amazon, B2B Leads) · **Audience** (Contacts, Campaigns, Flows, Analytics) · **System** (Settings). Integrations + Team fold into Settings tabs. Keep every route reachable — only the grouping changes.

---

## Suggested order of work

1. Tokens into `globals.css` + build the shared components.
2. Sidebar + Dashboard (the everyday screen).
3. Support Emails, WhatsApp, Order Confirmations, Contacts (daily-use core).
4. Shopify, Amazon, Analytics (number-heavy).
5. Campaigns, Flows, B2B Leads, Settings.

Verify each page against its prototype view at 1280px and 768px before moving on.
