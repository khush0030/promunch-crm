# Claude Code prompt — implement the PROMUNCH CRM redesign

We are restyling the entire PROMUNCH CRM to a new "warm editorial" design. This is a **presentation-layer redesign only**. The full visual target and spec already exist in the repo — read them before writing any code:

1. `design/promunch_prototype.html` — the visual target. A standalone, navigable mockup of EVERY page in the new design. Open it / read it. This is the source of truth for layout, hierarchy, components, and the exact look of each screen.
2. `design/PROMUNCH-redesign-handoff.md` — the implementation spec. Maps every prototype screen to its existing route file, names the data source already in the repo, lists the shared components to build, and gives the sidebar consolidation. Follow it exactly.
3. `design/promunch-design-tokens.css` — colour, type, radius, spacing tokens. The single source of truth. Put its contents into `src/app/globals.css` and read from these CSS variables everywhere.

## Hard rules (do not break these)

- **Do NOT change any data fetching, API routes, Supabase queries, server actions, webhooks, or business logic.** This is purely how the UI looks. If a page currently loads data a certain way, keep it — only replace the markup/styling it renders.
- **Keep every existing route reachable.** The sidebar regroups items (Dashboard · Inbox · Sales · Audience · System) and folds Integrations + Team into Settings tabs, but no page/route is deleted.
- **No hardcoded colours or font sizes in components.** Use the tokens from `promunch-design-tokens.css` (CSS variables or the Tailwind `@theme` mapping) for 100% of colour, radius, and type.
- Stack is fixed: Next.js App Router, React 19, Tailwind v4, Geist, `lucide-react`. The prototype uses Tabler icon names — map them to lucide equivalents (the handoff doc lists the mapping pattern).
- Match the prototype's responsive behaviour: verify each page at 1280px and 768px.

## Order of work — and STOP for review after Phase 1

**Phase 1 (do this, then stop and show me):**
1. Add the design tokens to `src/app/globals.css`.
2. Build the shared components in `src/components/` exactly as listed in the handoff doc: `Sidebar`, `PageHead`, `SectionLabel`, `KpiCard`, `Panel`, `DataTable`, `StatusBadge`, `Ring`, `MiniBar`/`Stat`, `AttentionItem`, `HealthPill`, `FilterChips`/`SearchBar`, `Tabs`, `EmptyState`, `InboxLayout`. Each must read tokens, accept props, and match the prototype's classes/look.
3. Rebuild the **Sidebar** (new simplified grouping + live count badges) and the **Dashboard** page to match `#v-dashboard` (the four banded sections: Performance, Revenue, Operations, Action — including the revenue trend chart and channel donut).
4. Run `npm run build` and `npm run lint`, fix any errors, and show me the Dashboard + Sidebar before continuing.

**After I approve Phase 1, continue in this order, one page at a time:**
- Phase 2 (daily core): Support Emails (list + `[id]` detail with the AI Send/Rewrite/Edit panel), WhatsApp (inbox 3-pane + tabs + templates), Order Confirmations, Contacts (list + `[id]` detail).
- Phase 3 (number-heavy): Shopify Attribution, Amazon, Analytics.
- Phase 4 (rest): Campaigns, Flows, B2B Leads, Settings (with Connections/Email/Brand/Team tabs).

## For each page

- Match the corresponding prototype view (`#v-<page>`) for layout and components.
- Reuse the shared components — do not invent new one-off styles.
- Keep the existing data wiring; just feed it into the new components.
- Charts: use the existing chart lib (or Chart.js as in the prototype). Match the style — soft area fills, green/gold series, dark `#1B2A20` tooltips, `₹…k` axis formatting.
- After each page: `npm run build`, `npm run lint`, and a quick visual check at 1280px and 768px. Commit per page with a clear message (e.g. `redesign: dashboard`, `redesign: support emails`).

## Acceptance criteria

- Every page visually matches its prototype view and uses only tokenised colours/type.
- The app builds and lints clean; no data/API/pipeline files were modified.
- All routes still reachable from the new sidebar; Integrations + Team live under Settings tabs.
- Responsive at 1280px and 768px.

Start with Phase 1 now. Read the three `design/` files first, then build the tokens + shared components + Sidebar + Dashboard, and stop for my review.
