# PROMUNCH CRM — UI Implementation Brief (for Claude Code)

> **Prompt to paste into Claude Code** (run it from inside the `promunch-crm` repo):
>
> *"Read `CLAUDE_CODE_BRIEF.md` in the repo root. Implement **Phase 1 only**, then stop and show me the diff before going further. Work on a new branch `ui/phase-1-quick-wins`. Do not change routing, data fetching, API contracts, or database schema — these are presentation-layer changes. Reuse the existing design system in `src/app/globals.css` and the existing `Toast` component; do not add new dependencies."*

---

## Context

PROMUNCH CRM is a Next.js 16 / React 19 / Supabase app. The warm/editorial design system already exists in `src/app/globals.css` (tokens, `.card`, `.kpi`, `.pill`, `.tbl`, `.chip`, `.empty`) and the grouped sidebar is in `src/components/Sidebar.tsx`. **This is not a restyle.** These are targeted UX fixes — redundant controls, missing signals, one real bug.

**Ground rules for every task below:**
- Do not change routes, data fetching, API request/response shapes, or DB schema.
- Reuse `globals.css` classes and CSS variables. Do not introduce inline colours or a new styling library.
- Keep all existing functionality working exactly as before.
- The 10-page sidebar and its 5 groups stay exactly as they are.
- A visual target for the redesigned screens exists at `promunch-crm-redesign-mockup.html` (in the PROMUNCH project folder) — match its intent, not pixel-for-pixel.

Work in phases. **Do Phase 1, stop, show the diff.** Then Phase 2 on approval, etc.

---

## PHASE 1 — Bug fix + quick wins (branch: `ui/phase-1-quick-wins`)

Low-risk, isolated, no schema work.

### 1.1 — Fix WhatsApp "Not connected" bug
**File:** `src/app/dashboard/page.tsx` — `detectChannels()` (~lines 110–121).

The WhatsApp channel status is derived from a row count on the `wa_contacts` table, so it reports "Not connected" even when WhatsApp is live (the inbox runs off `wa_threads` + the Cloud API). Change the WhatsApp detection to use the same source of truth the WhatsApp page's `StatusMeter` uses — the `/api/whatsapp/health` endpoint — or, failing that, count `wa_threads` instead of `wa_contacts`.

**Acceptance:** when WhatsApp is operational, the Dashboard "Channels" card shows it as connected/healthy, consistent with the WhatsApp page header.

### 1.2 — Remove duplicated controls in the WhatsApp conversation header
**File:** `src/app/dashboard/whatsapp/page.tsx` — `ConversationPane` header (~lines 505–555).

The open conversation's header renders status / ticket / priority as **`Pill` components** (~lines 512–521) *and* repeats all three as **`<select>` dropdowns** (~lines 544–552+). Remove the three `Pill`s from this header; keep the `<select>` dropdowns (they are the actionable controls). Leave the escalation-reason line and the "resolve" button intact.
*Do not* touch the pills on the conversation **list** rows (~lines 361–370) — those are read-only context and should stay.

**Acceptance:** the open conversation header shows each of status/ticket/priority once, as a dropdown. No visual duplication.

### 1.3 — Make "Outbound 24h — N failed" clickable
**File:** `src/app/dashboard/whatsapp/page.tsx` — `StatusMeter` (~lines 147–175).

The failed-outbound count renders in accent red but is inert. Make it a button: clicking it filters `InboxView` to the failed-outbound messages (add a filter state the InboxView already can express, or a query the list supports). Each failed item should expose a Retry action if one isn't already present.

**Acceptance:** clicking the failed count navigates the user to the failed messages; nothing happens silently.

### 1.4 — Replace `alert()` with the existing Toast
**File:** `src/app/dashboard/whatsapp/page.tsx` — calls at ~lines 468, 490, 979, 1365, 1381, 1515, 1672.

The app already has a toast system: `ToastProvider` is mounted in `src/app/dashboard/layout.tsx` and the hook lives in `src/components/ui/Toast.tsx` (see `flows/page.tsx` / `settings/page.tsx` for `useToast()` usage). Replace every raw `alert(...)` in the WhatsApp page with `toast.push({ kind: "error" | "success" | "info", text: ... })`.

**Acceptance:** no `alert()` remains in `whatsapp/page.tsx`; feedback uses toasts, matching the rest of the app.

### 1.5 — Use the standard empty state on Contacts
**File:** `src/app/dashboard/contacts/page.tsx` — the hand-rolled "No contacts yet" block (~lines 408–418).

Replace the inline-styled empty block with the existing `.empty` component pattern from `globals.css` (dashed border, `.ico` tile, `h3`, `p`, primary button) — see `flows/page.tsx` (~lines 230–246) and `campaigns/page.tsx` (~lines 212–227) for correct usage.

**Acceptance:** the Contacts empty state visually matches the Flows/Campaigns empty states.

**→ Stop here. Show the diff for Phase 1 before continuing.**

---

## PHASE 2 — Dashboard (branch: `ui/phase-2-dashboard`)

### 2.1 — Add a "Needs attention" section
**File:** `src/app/dashboard/page.tsx` — render a new section directly above the `kpi-grid` (~line 348), below `<ConnectorBanner />`.

A card listing items that need a human: failed WhatsApp sends (`/api/whatsapp/health` → `failedOutbound24h`), degraded integrations (already fetched by `/api/integrations`), and unresolved high-priority threads (`email_threads` / `wa_threads` with high priority + unresolved). Each row: a coloured dot, one-line description, and one action button linking to the relevant page. If there is nothing to show, render nothing. Use existing `.card`, `.pill`, `.btn` classes. See the `dashboard` screen in the mockup for layout.

**Acceptance:** when there are failed sends or degraded integrations, they appear as actionable rows at the top of the Dashboard.

### 2.2 — "Connect to unlock" KPI cards
**File:** `src/app/dashboard/page.tsx` — KPI grid (~lines 348–419).

When there are zero orders **ever** (not just zero in the selected range), render the Revenue and Flow-revenue tiles as a soft "Connect Shopify to see revenue →" card linking to `/dashboard/integrations` (or Settings), instead of a literal `₹0`. Keep the real tiles when data exists.

**Acceptance:** with no Shopify data, dead-metric tiles invite a connection instead of showing a misleading ₹0.

### 2.3 — Make `ConnectorBanner` rows actionable
**File:** `src/components/ConnectorBanner.tsx` (~lines 64–70).

Replace the `<ul>` of bullet points with one row per broken connector, each with its own "Fix" link/button to `/dashboard/integrations`. Keep the component returning `null` when healthy.

**Acceptance:** each degraded integration is its own row with its own fix action.

**→ Stop. Show the diff for Phase 2.**

---

## PHASE 3 — Page-level polish (branch: `ui/phase-3-pages`)

- **WhatsApp `StatusMeter`** (`whatsapp/page.tsx` ~lines 147–175): collapse the six-stat strip into a single status pill ("WhatsApp · Operational") that expands on click to reveal uptime detail.
- **Contacts segment filters** (`contacts/page.tsx`): the filter chips are status-only (`filters`, ~line 34). Add the common Klaviyo segments/lists as additional filter chips wired to the existing `/api/contacts` query params. Lists/segments currently appear only as row `.tag`s (~lines 384–401).
- **Contacts import menu** (`contacts/page.tsx` ~lines 176–193): collapse the two always-on import buttons into one "Import / Sync ▾" menu.
- **Support Emails** (`support-emails/page.tsx`): make "Pending" (awaiting reply) the first, counted filter; add `lead_category` values as filter chips (currently only row tags, ~lines 199–207).
- **Contact detail** (`contacts/[id]/page.tsx`): merge "Order history" and "Recent email events" into one interleaved activity timeline ordered by date. See the `contactdetail` screen in the mockup.

**→ Stop. Show the diff for Phase 3.**

---

## PHASE 4 — Unified customer record (SEPARATE TASK — do not start without explicit go-ahead)

This is a **backend/data** change, not UI, and is higher-risk. A CRM `contact` (keyed by email) and a WhatsApp `wa_contact` (keyed by phone) are never linked, so the WhatsApp `CustomerPanel` can't resolve a CRM contact and contact profiles look empty. The work: a matching layer on email + phone so each person is one record carrying orders, messages (both channels), and email engagement. Scope this as its own design doc with migration review before any code. **Do not bundle it into the phases above.**

---

## Out of scope

- Sidebar restructure — keep all 10 pages and 5 groups.
- New styling libraries or dependencies.
- Routing, API, or schema changes (except Phase 4, which is gated separately).
