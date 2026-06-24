# Instagram Inbound DM Automation + Collab CRM — Plan

Status: **Phase 1 + Phase 2 BUILT (2026-06-24) — not yet deployed (Meta app + secrets pending)**

## Phase 2 — what shipped (code complete, passes tsc + eslint)

Collab scoring + AI barter-terms draft for human approval:
- `ig-analyze/` edge fn — Business Discovery enrich (followers, ER, bio, recent captions — no
  scraping) → composite **fit score 0–100** (follower-band fit 0–40 + engagement rate 0–35 +
  AI niche match 0–25) → AI-drafted barter terms grounded in `ig_settings.barter_terms` + Master
  KB. Writes score + reason + draft to `ig_threads`. (Avg reel views excluded — not exposed by
  Business Discovery for arbitrary accounts; noted in `fit_reason`.)
- `_shared/instagram.ts` — `businessDiscovery` extended to return biography + recent captions.
- Migration `20260624170000_instagram_collab_scoring.sql` — adds `biography`, `niche_score`,
  `fit_score`, `fit_reason`, `collab_draft`, `collab_draft_at` to `ig_threads`.
- Next API: `api/instagram/threads/[id]/analyze` (POST, proxies to ig-analyze).
- UI: collab threads show a score badge + metrics + "Analyze & draft" button + the AI barter
  draft with "Use as reply"; the Collabs tab is ranked by `fit_score`.
- `config.toml` — `ig-analyze` registered (verify_jwt=false).

Deploy: apply the new migration, then `supabase functions deploy ig-analyze` (same Meta/OpenAI
secrets as Phase 1).



## Phase 1 — what shipped (code complete, passes tsc + eslint)

Edge functions (`promunch-email-agent/supabase/functions/`):
- `_shared/instagram.ts` — Graph API client: `sendDM`, `privateReply`, `markSeen`,
  `replyToComment`, `businessDiscovery` (official by-handle metrics, no scraping), `verifySignature`.
- `ig-webhook/` — inbound DM (`entry[].messaging[]`) + comment (`changes[].field=comments`)
  receiver; GET verify + signed POST; dedup on mid/comment id; enqueues `ig_jobs` + fast-path.
- `ig-ai-reply/` — triage (collab|order|spam|unknown) → KB-grounded reply → escalate; atomic
  per-turn claim (`claim_ig_reply`); Business-Discovery enrich + Slack escalation for collabs.
- `ig-send/` — outbound chokepoint (text DM + Private Reply); records `ig_messages`; Slack-alerts failures.
- `ig-jobs-tick/` — durable retry net (mirrors wa-jobs-tick); dead-letters to a human.
- `_shared/connector-log.ts` — added `instagram` connector (label + `IG_SLACK_CHANNEL_ID` routing).
- `config.toml` — `verify_jwt=false` registered for the 4 ig-* functions.

DB migration `supabase/migrations/20260624140000_instagram_dm.sql`:
- `ig_threads`, `ig_messages`, `ig_jobs`, `ig_settings` (+ seed row 1), `ig_reply_claims`
  + `claim_ig_reply` / `mark_ig_reply_sent` / `release_ig_reply` RPCs.

Next.js (`src/`):
- API: `api/instagram/threads` (GET list+counts), `threads/[id]` (GET), `threads/[id]/reply`
  (POST human reply), `threads/[id]/stage` (PATCH pipeline/status/ticket), `settings` (GET/PATCH).
  All gated by `requireSession`.
- UI: `dashboard/instagram/page.tsx` + `instagram.module.css` — inbox + collab pipeline +
  needs-human + spam tabs, conversation view with reply box, stage bar, settings panel.
- Sidebar nav link added under Inbox.

### Deploy steps (when Meta app + secrets are ready)
1. Apply the migration via Supabase dashboard SQL editor.
2. `supabase secrets set` the env vars in §5 (INSTAGRAM_*, IG_SLACK_CHANNEL_ID).
3. `supabase functions deploy ig-webhook ig-send ig-ai-reply ig-jobs-tick`
4. `supabase functions schedule create ig-jobs-tick "* * * * *"`
5. Subscribe the Meta webhook (`messages` + `comments`) to the ig-webhook URL with the verify token.
6. `vercel --prod` for the dashboard + API routes.

---

(original spec below)

Status: **spec / not built**
Author intent: PROMUNCH's Instagram gets too many DMs/comments to handle (clutter). Automate
inbound triage + replies via the **official Meta Graph API**, surface real barter/collab
inquiries into a CRM. No scraping, no Apify, no cold outreach.

This is the WhatsApp inbound pattern (`wa-webhook` → `wa-ai-reply` → `wa-send`) ported to
Instagram. Reuse that architecture; do not reinvent.

---

## 1. Scope decisions (locked)

- **Inbound only.** No outbound cold DM (official API forbids it; unofficial = ban risk).
- **No Apify / no scraping.** Discovery via Apify is dropped.
- **Bot behavior = full hybrid:**
  - AI auto-replies to routine inbound DMs (product/order Qs) from the Master KB — same brain
    as the WhatsApp chatbot.
  - AI auto-triages + labels every DM (collab | product/order | spam).
  - Real barter/collab inquiries are escalated to a human + logged in the collab CRM (AI does
    not commit terms autonomously).
  - Comments on PROMUNCH posts/reels are handled too (Private Reply DM where useful).
- **Tracked in a new `/dashboard/instagram` page** — inbox + collab pipeline (clone of leads).
- **Micro band = 20k–100k followers** (only used to score/flag collab inquiries; min 20k).

---

## 2. Hard platform constraints

1. **No official cold DM.** Cannot DM someone who never messaged us. Unofficial automation =
   brand-account ban risk. We never do this.
2. **24h window.** After an influencer DMs us, we can freely message for 24h (same as WhatsApp).
   Outside the window, only template/Private-Reply paths exist.
3. **Private Replies (comments).** When someone comments on a PROMUNCH post/reel we may send
   **one** DM in reply, within 7 days. This is the only "first contact" the bot initiates.
4. **Meta app + review required.** IG Business account on a Facebook Page;
   `instagram_manage_messages` + `instagram_manage_comments` perms; long-lived token. Same
   onboarding friction as the WhatsApp Cloud API.
5. **Business Discovery API** (optional, later) — query a *known* public creator handle for
   official public metrics (followers, media, ER). Free, official, no scraping. Enrich-by-handle,
   not search. Only relevant if we later want to score collab inquiries automatically.

---

## 3. Architecture

```
INBOUND DM
  someone DMs PROMUNCH IG
    → ig-webhook (messages field, signature-verified)
    → enqueue ig_jobs row + fast-path ig-ai-reply  (durable ledger, atomic claim)
    → ig-ai-reply (OpenAI gpt-4o-mini, Master KB brain):
        classify → collab | product/order | spam
          • product/order  → auto-reply from KB
          • collab/barter   → reply with intro + barter terms, ESCALATE (Slack + CRM flag)
          • spam/irrelevant → label, no reply
    → ig-send dispatches reply (24h window)

INBOUND COMMENT
  comment on PROMUNCH post/reel
    → ig-webhook (comments field)
    → ig-ai-reply: if collab-intent or FAQ → Private Reply (one DM)
    → otherwise label only

CRM
  every thread + classification lands in /dashboard/instagram
  collab inquiries form a pipeline: new → in-convo → terms-sent → agreed → shipped → posted
```

No discovery, no scraping. The CRM fills from inbound traffic.

---

## 4. Build phases

### Phase 1 — IG inbox + AI triage/reply (the core)  [Meta-gated]

**Edge functions** (`promunch-email-agent/supabase/functions/`):
- `ig-webhook/index.ts` — clone `wa-webhook`. GET verify (challenge), POST receive. Subscribe
  Meta `messages` + `comments` fields. Verify signature. Parse DM vs comment, sender handle,
  text/media. Enqueue via `ig_jobs` + fast-path POST to `ig-ai-reply`.
- `ig-ai-reply/index.ts` — clone `wa-ai-reply`. OpenAI gpt-4o-mini. Pull thread context from
  `ig_threads`/`ig_messages`. System prompt = Master KB (`getKnowledgeBase()`), PROMUNCH copy
  rules (all-caps PROMUNCH, no em dashes), Parth/founder voice for collab. Output:
  `{ classification, reply_text|null, escalate: bool }`.
- `ig-send/index.ts` + `_shared/instagram.ts` — outbound dispatcher: `sendDM()`,
  `privateReply(comment_id)`, `markRead()`, `verifySignature()`. Single Graph API call point
  (mirror `_shared/whatsapp.ts`).
- `ig-jobs-tick/index.ts` — retry safety net for `ig_jobs` (clone `wa-jobs-tick`).

**DB tables** (apply via Supabase dashboard SQL editor; mirror wa_* + leads):
- `ig_threads` — `id`, `ig_user_id` (sender), `handle`, `full_name`, `last_activity_at`,
  `classification` (collab|order|spam|unknown), `collab_stage`
  (new|in_convo|terms_sent|agreed|shipped|posted|declined), `followers` (nullable, from
  Business Discovery), `assigned_to`, `created_at`, `updated_at`.
- `ig_messages` — `id`, `thread_id` FK, `direction` (in|out), `kind` (dm|comment|private_reply),
  `text`, `media_url`, `ig_message_id`, `status` (sent|delivered|read|failed), `sent_by`
  (ai|human + dedupe suffix), `created_at`. Dedup pattern from `wa_messages`.
- `ig_jobs` — durable ledger: `id`, `thread_id`, `payload`, `status` (pending|done|failed),
  `attempts`, `claimed_at`. Atomic claim = never double-reply.
- `ig_settings` — single row id=1: `paused`, `auto_reply_enabled`, `auto_reply_scope`
  (routine_only|all), `escalate_to_slack` (bool), `slack_channel`, `min_followers` (default
  20000), `max_followers` (default 100000), `business_hours`.

**API routes** (`src/app/api/instagram/`):
- `threads/route.ts` GET — list threads, filter by classification/stage, sort by
  `last_activity_at`.
- `threads/[id]/route.ts` GET — thread + messages.
- `threads/[id]/reply/route.ts` POST — human manual reply (calls `ig-send`).
- `threads/[id]/stage/route.ts` PATCH — move collab pipeline stage / reassign.
- `settings/route.ts` GET/PATCH — `ig_settings`.

**Dashboard** `src/app/dashboard/instagram/page.tsx` + `instagram.module.css`:
- **Inbox tab** — thread list with classification labels (collab / order / spam), unread,
  AI-handled badge, sorted by last activity. Click → conversation view, human can take over.
- **Collab pipeline tab** — kanban/list of collab-classified threads by `collab_stage`.
- **Settings** — pause, auto-reply scope, Slack escalation toggle, follower band.
- KPI bar: open threads, auto-handled today, collab inquiries pending, spam filtered.

### Phase 2 — collab scoring + optional enrich  (small, later)
- On a collab inquiry, call **Business Discovery API** by handle → followers + ER → flag
  whether they fit the 20k–100k micro band. Official, no scraping.
- Auto-draft barter terms grounded in `ig_settings.barter_terms` + Master KB for human approval.

---

## 5. Ops / env checklist

| Item | Phase | Notes |
|------|-------|-------|
| Meta app + IG Business account on FB Page | 1 | required before anything sends |
| App review: `instagram_manage_messages`, `instagram_manage_comments` | 1 | review process |
| `IG_ACCESS_TOKEN` (long-lived / never-expire) | 1 | watch rotation like WA token |
| Webhook verify token + subscribe `messages`+`comments` | 1 | |
| Deploy `ig-webhook`/`ig-ai-reply`/`ig-send`/`ig-jobs-tick` | 1 | Supabase CLI |
| Apply ig_* migrations via dashboard SQL editor | 1 | per project deploy constraint |
| `vercel --prod` for dashboard + API routes | 1 | no git auto-deploy |
| Slack channel for collab escalations | 1 | reuse Maya bot |

No `APIFY_TOKEN`. No Google Places. No scraping infra.

---

## 6. Open items to confirm before build

- Auto-reply scope default: routine-only (escalate collabs) vs reply-to-all? (leaning
  routine-only + escalate, safest).
- Slack channel name for collab escalations.
- Barter terms text (what the bot/human offers — product value, deliverables expected).
- Confirm micro band min = 20k (only used for scoring inquiries).
