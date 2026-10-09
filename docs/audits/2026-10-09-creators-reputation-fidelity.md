# Creators + Reputation: fidelity audit (9 Oct 2026)

Scope: `/dashboard/influencers` (Creators desk, all tabs and drawers), `/dashboard/instagram` (Instagram DMs, discovery, follow-ups) and `/dashboard/reputation` (ORM feed) on branch `redesign/app-v2`, compared with the prototype `docs/plans/2026-10-07-app-redesign/influencers.html` (screens `inf-board`, `inf-deal`, `inf-creators`, `inf-kits`, `inf-settings` + overlays), the IA `04-ia.md` row 5 ("Creators: Board · Creators · Kits · Settings", sources "Influencers, Instagram discovery"), the screen inventory row for Instagram ("Retire for now; DMs return as an Inbox channel; Discovery folds into Creators") and `docs/plans/2026-10-07-influencer-build-spec.md`. Reputation has no prototype screen; its contract is `docs/plans/2026-10-08-orm-build-spec.md` §7, judged against the shared redesign patterns.

Owner decision for this pass (9 Oct): **Instagram is folded INTO Creators**, and Creators becomes one guided pipeline: **Find · Outreach · Collabs · Settings**. Customer Instagram DMs stay in Inbox (Live chats, IG channel), never duplicated in Creators.

Live data seen while auditing (prod via local dev): 1 open collab (`@promunch_test`, Creating, on track), 0 briefs / drafts / boxes waiting. Every `/api/instagram/*` read answers 500 `Could not find the table 'public.ig_prospects'`: the Instagram tables were never migrated in prod, which is why `/dashboard/instagram` redirects to Home today.

## 1. Creators, screen by screen

| Prototype / spec | What it shows | What was built (before this pass) | Gap |
|---|---|---|---|
| Header (all Creators screens) | eyebrow `★ Creators desk`, UPPERCASE title, one sentence with the key number in bold ("4 things need you today: 2 drafts, 1 brief, 1 box"), ONE primary action | Legacy `PageHead` (no eyebrow), sentence present, Add collab button; tabs drawn by the page with the older `Tabs` component, not the shell section tabs | Header pattern differs from every rebuilt page (Inbox, B2B); tabs not in the sidebar/section-tab system, so the nav and deep links do not know them |
| Tab set | IA: Board · Creators · Kits · Settings. Owner now: Find · Outreach · Collabs · Settings | Board · Library · Kits · Settings | Find and Outreach missing entirely (they lived on the hidden Instagram page) |
| `inf-board` | Three headline numbers (Needs you, Overdue, Posting this week), then the kanban Briefing · Shipping · Creating · Review · Live with calm cards (initial, handle, niche · size, next step, health as coloured text) | Close: KPI trio, a 7-chip filter row, Board/List seg, search, health and tier selects, kanban with 6 groups | Matches in spirit. Missing: a sense of the whole pipeline (where a collab came from, what is next) and one clear next action. Chip row + KPI trio repeat the same counts |
| `inf-deal` drawer | Stage stepper, "Your move" card with one decision, brief / box / timeline / reminders panels, creator record | DealDrawer + DealPanels cover all of it (brief AI, approve, send, dispatch, drafts review, post, timeline, reminders) | No change needed in this pass (send paths and approvals untouched by rule) |
| `inf-creators` Library | Table: creator, followers, niche, collabs, on-time % | CreatorsTab with drawer | Fine; lives as a sub view of Collabs now |
| `inf-kits` | Kit cards (products, who it suits) + rules | KitsTab | Fine; sub view of Collabs |
| `inf-settings` | Reminder engine switch, draft due default, nudge schedule, digest, "what creators receive" previews | SettingsTab matches | Instagram bot settings (pause, auto reply, follower band, barter terms) were on the Instagram page; now belong here |
| Instagram Discovery (old page tab) | Apify search by keyword / hashtag, paste handles, filter scored prospects, prospect drawer (fit, bio, last 3 posts, AI pitch DM / email), bulk "Draft & queue pitches" tap-through queue | Old `instagram.module.css` look: dense 8-column table, filled score / stage pills, a side panel inside the page, inline-styled filter inputs | Pre-redesign styling (filled pills, boxes in boxes), table scrolls sideways at 390 px, empty and error states read "No prospects yet" even when the backend is missing |
| Instagram Collabs + Tasks (old page tabs) | IG threads classified as collab with fit score, analyze & draft, stage bar (New → Posted); follow-up approval queue (IG DM / email / WhatsApp / manual lanes) | Full DM client (thread list + composer) duplicating Inbox; Tasks as bordered cards | DM reading/replying duplicated Inbox. The collab-only parts (score, suggested terms, stage) had no home outside that page |
| Instagram Inbox / Needs human / Spam tabs | Customer DMs | Same page | Belong in Inbox (already there as the IG channel). Not carried into Creators |

### UX friction (old flow)

- The pipeline was split over two pages, one of them hidden: find and pitch a creator on `/dashboard/instagram`, then re-type them into **Add collab** on `/dashboard/influencers`. No page showed the whole path or how many creators sat at each step.
- Seven Instagram tabs mixed customer support (Inbox, Needs human, Spam) with creator outreach (Collabs, Discovery, Tasks).
- With the Instagram tables missing, every Instagram tab only showed red error toasts; nothing explained that the part is simply not switched on yet.
- At 390 px the discovery table and the thread view both scrolled sideways.

## 2. Reputation

| Pattern | Expected (shared redesign) | Built | Gap |
|---|---|---|---|
| Page wrapper | Shell tokens, fonts and components from `globals.css` + `redesign.css` like every other page | Wrapped in `REDESIGN_SCOPE` from `influencers/fonts.ts` + `influencers/redesign-scope.css`: a generated, `.pm-rd`-scoped copy of `redesign.css` with its own Assistant / JetBrains Mono fonts, made for `main` before the redesign merged | On this branch the copy double-loads the tokens and swaps the app fonts for one page only. Remove; delete both files and the generator script |
| Header | eyebrow, UPPERCASE title, one sentence with the key number bold | Legacy `PageHead` + page-drawn `Tabs` | Header pattern; Feed / Overview / Settings should be shell section tabs (deep-linkable from nav, consistent with B2B) |
| Body | Gutter padding from `--pm3-gutter`, hairline sections | Body padded by the legacy `.pm-page` | Spacing differs from rebuilt pages |
| Feed, drawer, Overview, Settings | Calm rules: status as coloured text + dot, hairlines, one red action | Already follow them (`reputation.module.css`) | None; keep |

## 3. What this pass builds

1. **Creators = one guided pipeline.** Shell section tabs **Find · Outreach · Collabs · Settings** (`nav.ts` pages with `?tab=`), header eyebrow → title → sentence → one primary action per tab:
   - **Find** (Instagram discovery, restyled): search by niche or hashtag, score pasted handles, stage tiles (New · Shortlisted · Contacted · In convo · Rejected) with counts, calm prospect list (list rows on phones), prospect drawer with the AI pitch, bulk pitch queue. Same API calls and bodies as `DiscoveryTab`.
   - **Outreach**: follow-ups waiting on you (same approve / skip / confirm calls as `TasksTab`), collab chats with stage + fit score and a drawer for analyze & draft and the stage stepper (same `/api/instagram/threads/*` calls). Reading and replying happens in **Inbox** (link to the conversation), not here.
   - **Collabs**: a "How it flows" stepper (Find → Outreach → Brief → Box → Draft review → Live) with counts per stage and the next step marked, then the existing Board / Library / Kits as sub views.
   - **Settings**: the desk settings plus the Instagram bot settings moved from the old page.
   - When the Instagram tables are missing, Find and Outreach show one calm "not switched on yet" state instead of error toasts.
2. `/dashboard/instagram` redirects to `/dashboard/influencers?tab=outreach` (next.config.ts), the old page and `src/components/instagram/*` move under `src/components/creators/`.
3. **Reputation** drops the scoped wrapper, uses `PageHeader` + shell section tabs (Feed · Overview · Settings) and gutter body padding. `influencers/fonts.ts`, `influencers/redesign-scope.css` and `scripts/scope-redesign-css.mjs` are deleted.
4. The creator portal `/c/[code]` is untouched.

## 4. Left for later (needs backend or a decision)

- Instagram tables are still not migrated in prod; Find and Outreach stay in their "not switched on" state until they are (migration + `ig-*` crons + `APIFY_TOKEN`).
- "Turn a contacted prospect into a collab" in one tap (prefill Add collab from a prospect) needs the prospect id carried into `POST /api/influencers/deals`; not done to keep POST payloads unchanged.
- Payment step: barter only in v1 (spec), so the flow ends at Live / Done; no payment column.
- Sidebar badge for Creators ("waiting on us") needs an attention count from `/api/metrics/attention`.
