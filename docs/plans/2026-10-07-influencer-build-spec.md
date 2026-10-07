# Influencer Delivery Tracker: build spec (v1)

Companion to [2026-10-07-influencer-automation.md](2026-10-07-influencer-automation.md) §4A. This is the contract every build workstream codes against. Schema: `supabase/migrations/018_influencers.sql` (source of truth for column names).

## Locked product decisions (owner, 2026-10-07)

- Barter only. No fees anywhere in v1 UI/copy.
- Every draft needs approval before posting (`requires_draft_approval` always true in v1; no toggle in UI).
- Draft due = delivery date + `draft_due_days` (per deal, 7 to 15, default 10 from `influencer_settings.default_draft_due_days`).
- Same PROMUNCH WhatsApp number. **v1 does NOT edit `wa-webhook` or any WA reply behaviour.** Creators act through the portal page; WhatsApp messages carry a URL button to it. Creator replies on WA land in the normal inbox exactly as today.
- Dispatch = Shopify ₹0 order tagged `Influencer`.
- Ad rights per deal, default `none`.
- Copy: PROMUNCH in caps, no em dashes in any creator-facing text, tagline "Your Munchy Pal" where a sign-off fits. Product facts only from Master KB (`kb_documents`).

## Stages

`agreed → brief_draft → brief_sent → brief_acknowledged → dispatched → delivered → draft_submitted ⇄ changes_requested → draft_approved → posted → completed`; exits `cancelled`, `ghosted`.

Health (computed, not stored), shown as a chip everywhere:
- **Overdue**: draft not submitted and now > draft_due_at; or approved, not posted and now > go_live_at + 2d.
- **At risk**: draft due within 2 days and not submitted; or brief unacknowledged > 72h; or delivery unconfirmed > 8d after dispatch.
- **Waiting on us**: brief_draft > 24h, agreed/acknowledged with no dispatch > 48h, draft_submitted > 24h unreviewed.
- **On track**: otherwise.

Put this logic in ONE shared pure module `src/lib/influencers/health.ts` (+ test). Edge side duplicates the minimal subset it needs in `_shared/influencers.ts`.

## Creator portal `/c/[code]`

Public, mobile-first, PROMUNCH-branded page. Code = deal.code (unguessable). Shows: creator name, kit contents, the latest SENT brief (concept, hooks, script, must-say, checklist, don'ts, format, dates, usage rights if any), and a status-aware action card:
- brief_sent → "I've read the brief and I'm in" (ack) + "Request a change" (free text → team task/event)
- brief_acknowledged/dispatched → "My box arrived" (sets delivered_at, computes draft_due_at)
- delivered/changes_requested → "Submit my draft": paste link (Drive/IG/YouTube unlisted) or upload video (≤ 200MB, signed upload URL to bucket `influencer-drafts`), optional note
- draft_submitted → "We're reviewing your draft" (+ review notes history)
- draft_approved → go-live date + checklist + "Submit post link"
- posted/completed → thank-you
Every action writes `influencer_events` (channel `portal`, actor `creator`). Public API routes live under `/api/public/collab/[code]/*` (middleware already treats `/api/public/*` as public — verify). Rate-limit / validate code length; never expose other deals or addresses beyond the creator's own city.

## Dashboard `/dashboard/influencers`

Tabs: **Board** (default), **Creators**, **Kits**, **Settings**.
- Board: summary strip (Due today · Overdue · At risk · Waiting on us · Briefs to approve · Drafts to review · Kits to ship), then kanban by stage group (Briefing · Shipping · Creating · Review · Live · Done) with cards (avatar initial, @handle, tier, kit, next date, health chip). Filter: health, owner, tier. List toggle.
- Add collab (modal/drawer): find-or-create creator by handle; phone (required), address, niche, followers/ER (manual or "Fetch" later), kit (suggested by rules), deliverables, draft_due_days (7 to 15, default 10), go-live date optional, usage rights (default none), notes.
- Deal drawer/page: header (creator, health chip, stage stepper), timeline (influencer_events), Brief panel (Generate with AI → edit → Approve → Send; version history; ack status), Dispatch panel (kit, address, "Create Shopify order" button, order link, delivered), Drafts panel (versions, play/open, Approve / Request changes with note → revision_count++), Post panel (post_url, views), reminders list (scheduled/sent with times), quick actions (copy portal link, mark ghosted, cancel).
- Creators tab: table (handle, tier, followers, ER, niche, deals, on-time %, last contact, status) + creator profile (metrics, address, all deals, reliability).
- Kits tab: kits CRUD (items = Shopify variant ids + qty) + rules (tier/niche → kit, priority).
- Settings: influencer_settings form (engine/digest switches, defaults, nudge offsets, SLAs).
Use the warm-editorial `pm-` components in `src/components/pm/`, React Query for data, existing page patterns (look at `src/app/dashboard/instagram` and `src/app/dashboard/deals`). Map `/dashboard/influencers` and `/api/influencers` to the existing `partners` module in `src/lib/access.ts` (its hint already says "creators"); map every new page + route, sidebar entry under the Marketing/Growth group.

## API (session-gated) `/api/influencers/*`

- `GET/POST /api/influencers` (list with deal counts + reliability; create)
- `GET/PATCH /api/influencers/[id]`, `PUT /api/influencers/[id]/address`
- `GET/POST /api/influencers/deals` (list w/ health; create = Add collab, generates `code` via crypto random 12 chars, schedules nothing yet)
- `GET/PATCH /api/influencers/deals/[id]` (stage changes write events)
- `POST /api/influencers/deals/[id]/brief/generate` (OpenAI, KB-grounded via existing KB helper, returns new draft version)
- `PATCH /api/influencers/deals/[id]/brief/[briefId]` (edit content while draft), `POST .../approve`, `POST .../send` (only approved; marks previous sent superseded, stage → brief_sent, invokes edge `influencer-send` kind `brief_ready`)
- `POST /api/influencers/deals/[id]/dispatch` (creates Shopify ₹0 order; idempotent: refuses if shopify_order_id set)
- `POST /api/influencers/deals/[id]/drafts/[draftId]/review` ({decision, note})
- `GET/POST/PATCH/DELETE /api/influencers/kits`, `/api/influencers/kit-rules`
- `GET/PATCH /api/influencers/settings`
- `GET /api/influencers/summary` (board strip counts)
Use the existing admin Supabase client + `requireSession` patterns used by sibling routes.

## Edge functions (promunch-email-agent)

- `influencer-send` (internal-only, `requireInternal`): `{reminder_id}` OR `{deal_id, kind}`; resolves creator phone, template + params, calls `wa-send` (never Meta directly), records wa_message_id, writes event. Respects `influencer_settings.engine_enabled` for automated nudges; manual sends from the dashboard (brief_ready) are allowed when engine is off? NO: everything creator-facing is gated by engine_enabled; dashboard shows "Engine off: copy link instead".
- `influencer-tick` (pg_cron every 15 min): (1) ARM: for each open deal, upsert the reminder rows its current stage implies (insert … on conflict do nothing on (deal_id, kind, step)); cancel scheduled rows whose gate is already satisfied. (2) DRAIN: due scheduled rows → `claim_influencer_reminder` → creator rows via influencer-send, team rows become `done`-able tasks + WhatsApp ping to owner/ops for escalations. (3) Stage auto-moves: posted not verified etc.; `ghosted` after post_due ghosted_after_days. (4) Shopify fulfilment poll for dispatched deals (order fulfilled → event; delivered stays creator-confirmed). (5) Daily digest at digest_hour_ist (dedup via a reminder row kind `digest`, deal_id null is not allowed — use `influencer_settings`-anchored dedup row in `connector_events` or a dedicated date key; implementer chooses, must be exactly-once per day).
- Cron migration under `promunch-email-agent/supabase/migrations/` following `20260705100000_cron_jobs_canonical.sql` pattern (Vault bearer).
- WhatsApp templates (UTILITY, en, each with one URL button `https://promunch-crm.vercel.app/c/{{1}}` — use SITE_APP_URL convention): `influencer_brief_ready`, `influencer_brief_reminder`, `influencer_box_check`, `influencer_draft_reminder`, `influencer_draft_overdue`, `influencer_draft_feedback`, `influencer_post_reminder`, `influencer_post_fix`. Write their definitions (body copy, variables, examples) to `docs/whatsapp/influencer-templates.md` and as a JSON seed usable by `wa-template-create`. They must be submitted to Meta before engine_enabled goes on.

## Shopify dispatch

₹0 order via Admin GraphQL `draftOrderCreate` (line items from kit, 100% applied discount, shipping address from influencer_addresses, tags `Influencer`, `influencer:<handle>`, note with deal code) then `draftOrderComplete` (payment pending false). Store order id/name/status URL on the deal. Must not create a second order (check shopify_order_id first + lock). Make sure revenue metrics already exclude these: check how HYPD ₹0.01 / `is_creator` exclusion works and extend it to tag `Influencer` / total 0. Do NOT modify `shopify-webhook`'s order upsert path beyond an additive is_creator rule, and flag any such change for review.

## Invariants for every workstream

- Never message a creator twice: only `influencer-send` sends, only after a claim or an idempotency check.
- No edits to `wa-webhook`, `wa-ai-reply`, `shopify-wa`, campaign code.
- Do not deploy, do not apply migrations, do not commit. Leave changes in the worktree; report files touched.
- Run: `npx tsc --noEmit` (or `npm run build` if cheap), `npx vitest run <your tests>`, `npx eslint <your files>`, `deno check` for edge fns.
