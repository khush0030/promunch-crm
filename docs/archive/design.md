# PROMUNCH CRM — Design Reference

> A snapshot of the app as it exists today, written for a UI/prototyping tool (Stitch) to
> understand the current product and improve its interface. This describes **what is built
> now** — the layout, design system, every screen, and the component vocabulary — not a wishlist.

---

## 1. What the product is

**PROMUNCH CRM** is an internal marketing + customer-operations console for the food/snacks
brand **ProMunch** ("Your Munchy Pal"). It is a single-tenant, team-internal tool — not a
public SaaS. Staff use it to:

- Run and track **email** campaigns and automated **flows** (sequences).
- Operate a **WhatsApp** business channel: a live AI chatbot inbox, support tickets, message
  templates, broadcast campaigns, and a knowledge base.
- Triage inbound **support emails** with AI categorization and draft replies.
- Make sure every order gets a WhatsApp **order confirmation** (a coverage tracker).
- Browse **contacts** (synced from Shopify + Klaviyo) with rich filtering.
- See **analytics** for email/flow performance and **Shopify attribution** (where orders
  come from — UTM source, campaign, referrer).
- Manage **integrations**, **team** members, and **settings**.

The tone is **warm, soft, editorial** — not a cold enterprise dashboard. Cream/paper
backgrounds, a single muted-red brand accent, generous whitespace, rounded cards, restrained
type. It should feel calm and considered, like a well-set magazine page.

---

## 2. Tech & rendering context

- **Next.js 16** (App Router) + **React 19**, TypeScript.
- **Tailwind v4** is installed, but the UI is driven almost entirely by a **hand-written design
  system in [`src/app/globals.css`](src/app/globals.css)** using CSS variables and semantic
  class names (`.card`, `.kpi`, `.btn`, `.tbl`, `.pill`, …). Most components consume these
  classes, not utility classes. **Treat `globals.css` as the source of truth for styling.**
- Fonts: **Geist Sans** (UI) and **Geist Mono** (code/IDs/numbers), via `geist/font`.
- Icons: **lucide-react**, plus inline hand-drawn SVGs in the sidebar (1.8px stroke, currentColor).
- Data: **Supabase** (Postgres + auth). **Resend** for email. WhatsApp via Meta Cloud API
  (through Supabase edge functions). No charting library — charts are CSS (donuts, bars).

---

## 3. Brand identity

| Element | Value |
|---|---|
| Product name | **PROMUNCH** (always uppercase in display) / sub-label **CRM** |
| Tagline | "Your Munchy Pal" |
| Logo | `public/pm-logo-square.png`, rounded square (radius 8). Sidebar shows logo + `PROMUNCH` / `CRM` stacked |
| Brand mark fallback | Gradient square `linear-gradient(135deg, #b9303f, #d6566a)`, white initials |
| Accent color | **`#b9303f`** — a muted, slightly dusty red/crimson. The single hero color. Used for primary buttons, active states, links-as-accent, brand gradient |

---

## 4. Design system (tokens)

All tokens live as CSS variables in [`src/app/globals.css`](src/app/globals.css#L1). Light mode
only (no dark mode today).

### Color

| Role | Token | Hex |
|---|---|---|
| App background / canvas | `--bg`, `--canvas` | `#faf8f4` (warm cream/paper) |
| Card surface | `--card-bg` | `#ffffff` |
| Text primary | `--text` | `#39342c` (warm near-black) |
| Text secondary | `--text-2` | `#857d6f` |
| Text tertiary / muted | `--text-3` | `#aaa193` |
| Border | `--border` | `#ebe5d9` |
| Border stronger | `--border-2` | `#e2dccd` |
| Hover fill | `--hover` | `#efe9de` |
| Hover stronger | `--hover-2` | `#e7e0d2` |
| **Accent** | `--accent` | `#b9303f` |
| Accent soft (bg) | `--accent-soft` | `#f5e7e1` |
| Green / soft | `--green` / `--green-soft` | `#5a8c52` / `#ecf0e2` |
| Amber / soft | `--amber` / `--amber-soft` | `#bb8a2c` / `#f6eed9` |
| Blue / soft | `--blue` / `--blue-soft` | `#5b7e96` / `#e9eef0` |

Status colors are always a **soft tinted background + saturated text** pair (used in pills and
KPI icon chips). Green = good/positive, amber = warning/pending, blue = info/neutral, accent =
alert/attention.

### Sidebar palette (its own warmer scale)

Background `--side-bg: #f2ede3` (a shade darker than canvas, so the sidebar recedes). Active nav
item is a **white pill with a soft shadow** sitting on that warm background. Active icon turns
accent red. Section headers are tiny uppercase muted labels.

### Type

- Base: 14px, line-height 1.5, letter-spacing `-0.006em`, Geist Sans, antialiased.
- `--h1-size: 25px`, weight 600, tracking `-0.018em` — page titles.
- `--kpi-size: 28px`, weight 600 — big metric numbers.
- Card titles: 13px / 600. Sub text: 13.5px in `--text-2`.
- Field labels & table headers: 11px, uppercase, letter-spacing `0.04em`, muted — a recurring
  "small caps" motif.
- Numbers use `font-variant-numeric: tabular-nums`.

### Shape & elevation

- Radii: `--radius: 14px` (cards), `--radius-sm: 10px` (buttons, inputs, tiles),
  `--radius-pill: 999px` (pills/chips).
- Card border: `1px solid #efe9dd`. Card shadow: very soft, warm-tinted, two-layer
  (`0 1px 2px` + `0 8px 22px` at ~5–6% brown alpha). Elevation is whisper-quiet.
- Custom scrollbars: thin (10px), rounded, sand-colored thumb.

---

## 5. App shell / layout

Defined in [`src/app/dashboard/layout.tsx`](src/app/dashboard/layout.tsx) +
[`src/components/Sidebar.tsx`](src/components/Sidebar.tsx).

```
┌─────────────┬───────────────────────────────────────────┐
│  SIDEBAR    │  MAIN (canvas)                             │
│  248px      │  .page  → padding 34px 44px, max-w 1180px  │
│  sticky     │                                            │
│  full-height│   .page-head: H1 + sub  ........  actions  │
│             │                                            │
│  brand      │   content: KPI grid / cards / tables       │
│  nav groups │                                            │
│  user card  │                                            │
└─────────────┴───────────────────────────────────────────┘
```

- **Sidebar (248px, sticky, full viewport height):** brand block at top → scrollable grouped
  nav → user card pinned at bottom (avatar with initials, name, email, sign-out icon).
- **Nav groups are collapsible** (chevron, state saved to `localStorage`). Each item: icon +
  label, optional right-aligned **count badge** (pill).
- **Main:** every screen is wrapped in `.page` (centered, max-width 1180px) and opens with a
  `.page-head` — an `<h1>` (often with a small colored `.head-icon` chip), a `.sub` one-liner,
  and right-aligned action buttons.

### Navigation map

The sidebar groups all routes (`src/components/Sidebar.tsx`):

| Group | Items |
|---|---|
| **Overview** | Dashboard |
| **Inbox** | Support Emails `[pending badge]` · WhatsApp · Order Confirmations `[missing badge]` |
| **Audience** | Contacts `[total badge]` |
| **Marketing** | Campaigns · Flows · Analytics · Shopify Attribution |
| **System** | Integrations · Team · Settings |

Badge counts are loaded live in the layout: pending support threads, missing order
confirmations (last 24h), total contacts.

---

## 6. Core component vocabulary

These classes recur across every screen — the reusable kit Stitch should preserve/extend:

- **Card** (`.card` + `.card-pad`): white, rounded 14px, soft shadow. Header = `.card-title`
  (+ optional `.card-sub`).
- **KPI tile** (`.kpi`): colored soft-bg icon chip (top-left) → small label → big tabular value
  → `.delta` line (`.up` green / `.down` accent / `.flat` muted). Laid out 4-across in `.kpi-grid`.
- **Button** (`.btn`): default = white + border; `.primary` = accent fill, white text;
  `.ghost` = transparent; `.sm` = compact. 6px gap icon+label.
- **Table** (`.tbl`): uppercase muted header row, 1px row separators, hover-highlight on
  `.clickable` rows, `.cell-main` (name + sub) pattern, `.num` for right/tabular figures.
- **Pill / tag** (`.pill .green|.amber|.blue|.grey|.accent`, `.tag`): status badges; pills use
  the soft-bg+saturated-text pairs, often with a leading `.dot`.
- **Tabs** (`.tabs` / `.tab`): underline-style tab bar (active = accent underline). **Chips**
  (`.chips` / `.chip`): pill-shaped filter toggles (active = accent-soft fill).
- **Inputs** (`.field` + label, `.input`, `.search`): inputs sit on a `--hover` fill, go white
  + accent border on focus. Search is a pill with a leading magnifier icon.
- **Empty state** (`.empty`): dashed-border card, centered icon chip, heading, one line of
  copy, a CTA button.
- **Donut** (`.donut` / `.hole`): CSS conic donut with a value in the hole + a legend list
  (`.legend-row`). Used for channel/health breakdowns.
- **Health tile / bar / stat-line**: small metric tiles with progress `.bar` and label/value
  `.stat-line` rows — used on Analytics & Settings.
- **Toast** (`src/components/ui/Toast.tsx`): app-wide toast provider for action feedback.
- **Avatar** (`src/components/ui/Avatar.tsx`): circular initials on accent fill.
- **ConnectorBanner / NeedsAttention**: contextual banners flagging broken integrations or
  items needing action.

---

## 7. Screen-by-screen

> Path format: route → what it shows. All open with `.page-head` (H1 + sub).

### Auth — `/login`
Tabbed auth card: **Sign in / Sign up / Magic link**. Email + password fields; domain-restricted
(only allowed company domains). Magic-link sends a Supabase OTP email. Also: `/auth/set-password`
(invited-teammate flow), `/auth/callback`, `/auth/signout`.

### Dashboard — `/dashboard`
The home overview. Sub: "Overview of your CRM activity · {period}". Contains:
- **KPI grid (4)**: Revenue (green) · Active subscribers (blue) · Email open rate (accent) ·
  Flow revenue (amber). Each with delta line. Unconnected metrics show a "Connect" tile instead.
- **List health** card and **Channels** card (donut/breakdown).
- **Recent campaigns** table (Campaign / Sent / Open / Click / Revenue).
- **Active flows** card.
- Refresh action + period selector.

### Support Emails — `/dashboard/support-emails` (+ `/[id]`)
AI-triaged inbound support inbox. Search bar + table: From / Subject / Category / Urgency /
Score / Status / Received. Detail page (`/[id]`) shows the thread, AI categorization, and a
draft reply. Pending count drives the sidebar badge. Faceted filtering via API.

### WhatsApp — `/dashboard/whatsapp` (the largest screen, ~1900 lines)
A full WhatsApp workspace with a **tab bar**: **Inbox · Tickets · Templates · Campaigns · KB**.
- **Inbox / Tickets**: two-pane chat — left = searchable thread list, right = conversation with
  a message composer ("Type a message…"), AI-agent replies, and a template picker (fills
  `{{1}}`-style variables before sending). Tickets = filtered to support threads.
- **Templates**: list of Meta-approved message templates; create/edit/resubmit a template
  (name like `diwali_offer_2026`, body with variables + example values), submit to Meta, sync
  status.
- **Campaigns**: build a WhatsApp broadcast against an approved template + audience; needs an
  approved template first (empty-state guides the user).
- **KB**: knowledge-base documents (title + pasted FAQ/policy/product text) that feed the AI agent.

### Order Confirmations — `/dashboard/order-confirmations`
Coverage tracker so no order ships without a WhatsApp confirmation. Period chips (e.g. 24h/7d).
Table: Order / Customer / Placed / Total / Confirmation status / action. Outstanding count
drives the sidebar badge.

### Contacts — `/dashboard/contacts` (+ `/[id]`)
The audience list (synced from Shopify/Klaviyo). Search + a filter panel (order count ranges,
days-since filters). Table: Name / Email / Orders / Lifetime value / Last order / Status /
Lists & Segments. Paginated. Detail page (`/[id]`) = full customer profile incl. a WhatsApp
action.

### Campaigns — `/dashboard/campaigns` (+ `/new`, `/[id]`)
Email campaign manager. Tab filter (status) + table: Campaign / Status / Sent / Open / Click /
Revenue / Date. `/new` = composer; `/[id]` = campaign detail with a send action.

### Flows — `/dashboard/flows` (+ `/[id]`)
Automated email sequences. Cards per flow with stats. Templates to start from: **Abandoned
cart**, **Welcome series**, **Post-purchase**. Detail page per flow.

### Analytics — `/dashboard/analytics`
Performance overview. **Top campaigns** table, **Top flows** table (Flow / Trigger / Revenue /
Conv.), **Email health** (deliverability tiles + bars), **Subscriber growth** chart.

### Shopify Attribution — `/dashboard/shopify-attribution`
Where orders come from. Sub: "UTM source, campaign & referrer". Three tables: **Traffic by
channel** (Channel / Medium / Orders / New / Revenue / Share-bar), **Top campaigns** (Campaign /
Source / Orders / Revenue), **Top referrers** (Referrer / Orders / Revenue). Read-only analytics
(order PII deliberately not exposed).

### Integrations — `/dashboard/integrations`
Connected services as `.conn-row` cards (logo chip + name + status) — Shopify, Klaviyo, Gmail,
Resend, WhatsApp, etc. Plus a **connector event log** table (When / Connector / Level / Message).

### Team — `/dashboard/team`
Invite + manage teammates. Invite form (email like `teammate@promunch.in` + full name + role),
member list. Invited users complete `/auth/set-password`.

### Settings — `/dashboard/settings`
Stacked config cards: **Shopify connection**, **Email sending** (Resend/domain), **Brand
settings**, **Team members** table (Member / Email / Role).

---

## 8. Responsive / mobile

Single breakpoint at **768px** ([`globals.css`](src/app/globals.css) media query):

- Sidebar becomes an **off-canvas drawer** (slides in from left, dark overlay behind).
- A fixed **56px mobile header** appears: hamburger (left) + centered logo + spacer.
- `.page` padding drops to 16px.
- KPI grid → 2 columns; all `.grid-2` / `.grid-3` → single column.

`isMobile` is detected in the dashboard layout via window width and passed to the sidebar.

---

## 9. Design intent & opportunities for Stitch

What defines the look today, to keep:
- **Warm paper canvas + single muted-red accent.** Color is used sparingly; status tints are
  soft. Avoid loud, saturated, or pure-white-cold palettes.
- **Soft, low-contrast elevation.** Cards float gently; nothing is harsh.
- **Small-caps labels, tabular numbers, editorial restraint.**
- **Consistent page rhythm:** page-head → KPIs → cards/tables, max-width 1180px.

Where the UI is thinnest / most worth improving:
- **WhatsApp screen** carries enormous functionality (5 tabs, chat, template builder) in one
  very long file with many **inline styles** rather than the shared class system — the least
  consistent surface visually.
- **Charts are CSS-only** (donuts, bars) — limited expressiveness for Analytics & Attribution.
- **Empty / connect / loading states** exist but are minimal.
- **Mobile** is functional (drawer + stacked grids) but not deeply designed beyond reflow.
- **No dark mode.**

> When proposing UI, reuse the token names and component classes in §4–6 so output drops into
> the existing `globals.css` system cleanly.
