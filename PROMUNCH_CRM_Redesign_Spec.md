# PROMUNCH CRM — UI Redesign Brief

**For: Claude Code** · run this inside the `promunch-crm` repository.

## 1. What to do

Restyle the existing PROMUNCH CRM web app to a new visual design — **warm, soft, minimal, editorial** (Notion-like). This is a **visual + sidebar-IA redesign only**. Do not change routing, data fetching, business logic, component behaviour, state, or API calls. Every existing feature must keep working exactly as before.

## 2. Reference prototype — match this

A complete, pixel-accurate static prototype is in the same folder as this file:

> **`PROMUNCH_CRM_Redesign_Final.html`**

Open it in a browser. It shows all 8 screens (Dashboard, Customer Support Emails, WhatsApp, Contacts, Campaigns, Flows, Analytics, Settings) in the exact target look, with the new grouped sidebar. **Treat it as the source of truth** — its inline CSS is the design system. When in doubt, copy the prototype's values.

Both this `.md` file and the `.html` prototype should be available to you.

## 3. Tech context

- The app is deployed on Vercel — assume **Next.js + React**. Detect the actual styling approach in the repo (Tailwind, CSS Modules, styled-components, plain CSS) and implement the tokens below in whatever system is already in use. Do **not** introduce a new styling library.
- **Light theme only.** No dark mode.
- First, read the repo structure and report back which screens/components map to the 8 prototype screens before making changes.

## 4. Typography

- Font: **Geist** (UI) + **Geist Mono** (for monospace values such as hex codes).
- Install via the `geist` npm package and `next/font`, or Google Fonts as a fallback.
- Base: 14px, line-height 1.5, letter-spacing −0.006em, `-webkit-font-smoothing: antialiased`.

## 5. Design tokens

Define these centrally (CSS custom properties on `:root`, or the Tailwind theme). Names mirror the prototype.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--canvas` | `#faf8f4` | App background (warm paper) |
| `--card-bg` | `#ffffff` | Cards, panels, table surface |
| `--text` | `#39342c` | Primary text |
| `--text-2` | `#857d6f` | Secondary text |
| `--text-3` | `#aaa193` | Tertiary / muted text, placeholders |
| `--border` | `#ebe5d9` | Hairline dividers, table row lines |
| `--border-2` | `#e2dccd` | Input / button borders |
| `--hover` | `#efe9de` | Hover background, input fill |
| `--hover-2` | `#e7e0d2` | Track / subtle fill |
| `--accent` | `#b9303f` | Primary accent (PROMUNCH crimson, warm-shifted) |
| `--accent-soft` | `#f5e7e1` | Accent backgrounds, soft pills |
| `--green` / `--green-soft` | `#5a8c52` / `#ecf0e2` | Positive / success |
| `--amber` / `--amber-soft` | `#bb8a2c` / `#f6eed9` | Warning / pending |
| `--blue` / `--blue-soft` | `#5b7e96` / `#e9eef0` | Info / neutral category |
| `--radius` | `14px` | Cards, large containers |
| `--radius-sm` | `10px` | Buttons, inputs, small tiles |
| `--radius-pill` | `999px` | Pills, chips, status badges |
| `--card-border` | `1px solid #efe9dd` | Card border |
| `--card-shadow` | `0 1px 2px rgba(67,55,32,.05), 0 8px 22px rgba(67,55,32,.06)` | Soft floating-card shadow |

Sidebar-specific tokens:

| Token | Value |
|---|---|
| `--side-bg` | `#f2ede3` |
| `--side-text` | `#857d6f` |
| `--side-text-strong` | `#39342c` |
| `--side-hover` | `#e8e2d6` |
| `--side-active-bg` | `#ffffff` |
| `--side-active-text` | `#39342c` |
| `--side-border` | `#e6e0d3` |
| `--side-icon` | `#aaa193` |
| `--side-active-icon` | `#b9303f` |

## 6. Component specs

Build/restyle these shared primitives first, then apply across screens.

- **Cards** — `--card-bg`, `--card-border`, `--radius`, `--card-shadow`. They gently float on the warm canvas. Padding ~20–22px.
- **KPI cards** — small soft-tinted icon square (30–32px, `--radius-sm`) top-left; 12.5px muted label; ~28px value, weight 600, letter-spacing −0.025em; 11.5px delta line (green for positive, muted for neutral).
- **Tables** — uppercase 11px muted headers; rows separated by `--border` hairlines; row hover = `--hover`; tabular-nums for numeric columns; small initial-avatar in the first cell.
- **Pills / status badges** — `--radius-pill`, soft background + matching text colour (green/amber/blue/grey/accent variants). 11.5px, weight 500.
- **Buttons** — default: white, `--border-2`, `--radius-sm`; primary: `--accent` background, white text; ghost: transparent. 13px, weight 500.
- **Inputs / search** — `--hover` fill, `--border-2` border, `--radius-sm`; focus → white fill + `--accent` border.
- **Tabs** — underline style; active tab has `--accent` underline. **Chips** — pill-shaped; active chip = `--accent-soft` bg + `--accent` text.
- **Empty states** — dashed `--border-2` border, soft icon tile, title + one muted sentence + primary button.

## 7. Sidebar — new information architecture

Replace the current flat sidebar with **collapsible grouped sections**. Each group has an uppercase 11px label with a chevron; clicking the label collapses/expands the group. Order and contents:

1. **Overview** — Dashboard
2. **Inbox** — Customer Support Emails *(badge: 7)*, WhatsApp
3. **Audience** — Contacts *(badge: count, e.g. 1,032)*
4. **Marketing** — Campaigns, Flows, Analytics
5. **System** — Settings

Behaviour:
- Active nav item: white background (`--side-active-bg`), subtle shadow, crimson icon.
- Inactive item: `--side-text`, hover = `--side-hover`.
- Chevron rotates −90° when the group is collapsed; collapsed groups hide their items.
- Persist each group's collapsed/expanded state in `localStorage` so it survives reloads.
- Keep the PROMUNCH logo lockup at top and the user profile block pinned at the bottom.

## 8. Suggested implementation order

1. Add the Geist font.
2. Define the design tokens centrally.
3. Restyle shared primitives (Button, Card, Pill/Badge, Table, Input, Tabs, EmptyState).
4. Rebuild the sidebar with the grouped, collapsible structure above.
5. Restyle each of the 8 screens to match the prototype.
6. Compare every screen side-by-side with `PROMUNCH_CRM_Redesign_Final.html`.

## 9. Acceptance criteria

- Each of the 8 screens visually matches the prototype.
- The sidebar uses the 5 grouped sections; groups collapse/expand and the state persists.
- All existing functionality, routes, and data behave exactly as before — nothing removed or broken.
- Geist is applied app-wide; light theme only.

## 10. Out of scope

Data connections (Amazon SP-API, Resend migration, direct WhatsApp, Klaviyo removal) are **not** part of this task — visual redesign only.
