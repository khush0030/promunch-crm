# 02 · Prior work and why today's app feels congested

## What was looked at
| Source | What it is | Status |
|---|---|---|
| `design/` (`promunch-design-tokens.css`, `promunch_prototype.html`, handoff) | July "warm editorial": Geist, dark green sidebar, green primary, cream canvas | Superseded by Sep tokens; still mirrored in some `pm-` classes |
| `docs/plans/2026-09-15-crm-redesign/` | Sep "Control Room": 34 screens, 17 sidebar items → 6 hubs, Archivo / Archivo Black / IBM Plex Mono, crimson + cyan + sun + orange hub colours | **Live today** (Phase 0–2 shipped) |
| `docs/plans/utility-prototype/` | 21 Sep "utility" proposal: 76 screens, one font, grey sections, 38-route checklist | Review only, not adopted |
| Branch `codex/premium-redesign-preview` | `git log` shows no redesign commits of its own: its tip (2b3e59f) is an older point of `main` (storefront domain fix, guided WhatsApp workspace 3df3ab4, email sender). `main` has moved on (voice, email studio). | Nothing to merge; the "guided workspace" ideas are already in `main` |
| Rejected influencer mockup | Owner feedback: too dense, off-brand | Lesson below |

## Keep (it works, the team knows it)
1. **The six-hub idea and ⌘K palette.** Grouping by job ("today, sell, talk, market, partners") is right; it just still lists too many things.
2. **Archivo Black for titles.** It is the live storefront display face; the Sep redesign already picked it. We keep it and swap body text to the site's **Assistant** and labels to the site's **JetBrains Mono**.
3. **Brand red `#AF272F`** as primary. Sep picked it correctly.
4. **Plain-English rule** ("Number not on WhatsApp", "paid to you") and **"one question per screen"** from the Sep audit.
5. **Guided bits from 3df3ab4**: plain summaries before launch, step headers, recipe cards, "no grades under 50 sends". We keep the *behaviour* and drop the chrome (glossary dotted underlines and "?" tips everywhere).
6. **Phone rules**: tables become cards, nothing scrolls sideways, bottom tab bar + More sheet.
7. **Atomic-send safety UX**: launch summaries, test send first, approval gates, typed confirmation for order-message edits. These are product invariants, not decoration.
8. Influencer stage groups (Briefing · Shipping · Creating · Review · Live · Done) and the health chips from the build spec.

## Why it feels congested (measured in code, 7 Oct)
| Cause | Evidence | Effect |
|---|---|---|
| **Text is too small** | Body token 13.5px, label 12.5px, caption 11.5px; 300+ inline `fontSize` values from 10px to 13.5px; 14 distinct sizes in use | Everything looks like fine print; nothing stands out, so everything competes |
| **Too many tabs per page** | WhatsApp 8 tabs, Brevo hub 7, Instagram 7, Leads 6 (+6 modals), Amazon 5, Settings 5, Admin 3, Inbox 4 chips | You must already know where a thing lives |
| **Competing colours** | Each hub has its own colour (crimson, cyan, sun, orange, grey) on a near-black sidebar; KPI icons use green/blue/gold/orange tones; status uses 4 more | No single "look here" signal; the page reads as confetti |
| **Too many numbers at once** | Home and Sales show 4–6 KPI tiles + 2 charts + tables above the fold; Amazon shows 90 days of everything | No hierarchy; the important number is not obvious |
| **Hand-styled one-offs** | 1,372 inline `style={{}}` blocks; three generations of classes (`pm-`, `pm2-`, legacy aliases, 368 `pm2-` rules) | Spacing, radius and alignment drift screen to screen |
| **Explanation chrome** | Glossary underlines, "?" popovers, help callouts, checklists on the same page as the work | The page explains itself instead of being obvious |
| **Dense tables** | 7–10 columns, 40px rows, actions as small icon buttons | Hard to scan, hard to tap on phone |
| **Parallel systems** | Three email systems reachable (Email Studio, Brevo hub, legacy campaigns/flows), two inbox lists (Conversations and Tickets) with different statuses | "Which one do I use?" |
| **Dark heavy sidebar** | 260px near-black panel with 16 visible + 10 hidden items, accordion hubs | The heaviest element on screen is navigation, not work |

## The rejected influencer mockup: lessons
- Dense board: 7 summary chips + 6 columns + filters + list toggle all visible at once.
- Off-brand: generic "pm" tones (gold, terra, blue dots) instead of PROMUNCH red/ink/paper.
- **Fix here**: one summary sentence ("4 things need you today") with at most 3 count tiles, board columns show only name, product, next date and one health chip; filters collapse behind one "Filter" button.

## Principles for this redesign
1. **One accent per view.** Red marks the single most important action or number. Sun yellow only ever means "Maya".
2. **Summary first, details on click.** Every page opens with one sentence and up to 3 numbers. Tables, logs and settings live one click deeper (drawer or detail page).
3. **Bigger and calmer.** 16px body, 60px rows, 24px card padding, 1200px max content width, generous white.
4. **At most 5 tabs on a page**, and pages with 1 job have no tabs.
5. **Same place, every page.** Title + one sentence left, period picker and one primary button right. Secondary actions in a "⋯" menu.
6. **Status is a word plus colour plus icon**, never colour alone.
7. **Retire, do not hide.** Old systems (Brevo hub, legacy email, Instagram off-state) are removed from navigation and redirected.
