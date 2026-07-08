# PROMUNCH CRM — WhatsApp Marketing Work: Full Context Handoff

_Last updated: 2026-06-29. Paste this into a fresh chat to continue without re-reading the long thread._

## Repos & deploy
- **Dashboard (Next.js 16, App Router):** `/Users/khush/Projects/promunch-crm` → deploy with `vercel --prod --yes`. Vercel **Hobby plan** (daily-only crons). Org `oltaflock-ai`, prod URL **promunch-crm.vercel.app**.
- **Edge functions (Supabase/Deno):** `/Users/khush/Projects/promunch-crm/promunch-email-agent/supabase/functions` → deploy with `supabase functions deploy <name> --project-ref hlykspakpewuilttnydm`. Project ref **hlykspakpewuilttnydm**. CLI is linked.
- **Migrations:** run manually in the Supabase SQL editor (no `db push`).
- **Commit straight to main.** Local `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` (used for one-off node scripts).
- **CRON_SECRET** (Vercel prod, created this session): `1ddea5a4491fce69343616f9ed196b247f8cf5408657e9f410acdd4076a6be85`

## What was built & deployed this session (all on main)
1. **WhatsApp Analytics tab** (`/dashboard/whatsapp` → Analytics): headline KPIs, delivery funnel, failure translator, campaign A–F report cards, smart hints, live activity feed, weekly Slack recap (`wa-weekly-summary` edge fn + pg_cron Mon 09:00 IST). Routes under `src/app/api/whatsapp/analytics/*`.
2. **UTM conversion tracking (Option A, chosen over redirect):** `wa-send` appends `utm_source=whatsapp&utm_medium=…` to promunch.in/shopify links in free-text (`_shared/links.ts appendUtm`). Conversion view reads `shopify_orders` UTM cols (matches `utm_source` OR `utm_medium` contains "whatsapp"). The `/r/` redirect + click tables exist but are ABANDONED/inert.
3. **Recurring campaigns:** `repeat_rule`/`repeat_until`/`parent_campaign_id` on `wa_campaigns`; UI selector + badge.
4. **Agent roles + chat assignment:** `wa_threads.assigned_to`; inbox Mine/Unassigned filter + assignee picker; roles in auth `user_metadata.role` (owner/admin/agent, missing=admin); settings role dropdowns; team writes gated to admins.
5. **Recipient view:** "Recipients" button on each campaign card → `GET /api/whatsapp/campaigns/[id]/recipients` (per-contact status + duplicate flags).
6. **Per-campaign click tracking (inert):** dynamic-button code in `wa-campaign-send` — needs a Meta dynamic-button template re-approval to ever activate.
7. **Invited** parth.mutha@vippysoya.com to the app (auth user created, role=admin).

## INCIDENT this session (resolved)
- "Edamame Launch v2" (939 audience) **messaged 86 customers more than once.** Cause: `wa-campaign-send` had no concurrency lock; a manual resume + self-chain ran concurrently and re-sent. Halted (status `cancelled`).
- **Fixed with an atomic send lock** (`wa_campaigns.send_lock_at`, migration `20260629120000`): guarded UPDATE, one sender per campaign, fails closed if column missing. **PROVEN**: 8 concurrent claims → 1 wins; end-to-end scheduled test auto-fired in 78s with 0 dupes. Duplicates now structurally impossible.
- Also fixed: `MAX_STATIC` 300→50 + `EdgeRuntime.waitUntil` on the self-chain (300-batch overran the edge wall-clock and froze mid-list at 75/939).

## Durable campaign engine (deployed)
- **`wa-campaign-worker`** edge fn = pg_cron heartbeat every 2 min (Supabase-native, NO Vercel, NO secret): promotes due scheduled+recurring campaigns, re-kicks stalled ones (self-heals), Slack-alerts >12min stalls, leaves cap-deferred campaigns dormant until `resume_at`. Scheduled via `scripts/wa-campaign-worker-cron.sql` (**cron job 22, already running**). Replaced the broken Vercel `wa-campaign-tick` (now just a daily backstop in vercel.json).
- **Cap-aware multi-day sending** (deployed, commit d2d8573): sender classifies the ledger — `reached` (never re-send), `permanentFail` (give up), `triedToday` (attempt each contact <=1x/day). #131049 cap failures are retried on later days. When the day's eligible set is exhausted or a batch is wholly capped → set `resume_at` = next 12:00 IST, stay `sending`. Completes only when all reached/permanently-failed.

## DONE — daily auto-sender is live (2026-06-29)
1. ~~**Run this migration**~~ ✅ APPLIED via Management API: `alter table wa_campaigns add column if not exists resume_at timestamptz;` (`send_lock_at` migration `20260629120000` already applied. pg_net ON. Worker cron job 22 running.)
2. ~~**Flip Edamame v2**~~ ✅ DONE: campaign `cd1dbabb-a233-4b6b-9772-81cd606e490e` set `status='sending'`, `resume_at='2026-06-30T06:30:00Z'` (12:00 IST), `send_lock_at`/`last_error` cleared. Worker sends ~380/day, retries capped next day, skips already-reached, auto-completes in ~2–3 days.

## Key facts / deliverability
- **Meta daily messaging tier ≈ 380/day** for this number. As of 2026-06-29 today's cap is **exhausted** (~379 delivered in last 24h, then #131049 on everything). Tier is set by Meta, identical on every platform — no app can exceed it.
- **Tier upgrade is automatic**: reach 2× current tier in unique customers within 7 rolling days + keep quality green → bumps 250→1K→10K. Number is **verified + GREEN quality**. ~380/day of real volume drives the upgrade; check **WhatsApp Manager → Phone numbers → Messaging limit** in ~3–7 days.
- **#131049 "healthy ecosystem"** = per-user marketing cap, NOT a bug. Hard rule (CLAUDE.md section 0): never message a customer twice.

## Deferred (not built)
Carousel templates; WhatsApp Pay (needs payment onboarding); visual flow builder; baking `utm_source=whatsapp` into campaign template buttons (Meta re-approval; `edamame_launch` edit was rate-limited 24h but the conversion view already matches its existing `utm_medium=whatsapp`).

## Useful
- Diagnostic: `GET https://hlykspakpewuilttnydm.supabase.co/functions/v1/wa-meta-info` → number quality/verification (tier not exposed by Meta API; use WhatsApp Manager UI).
- Memory files: `wa-analytics-dashboard.md`, `wa-campaign-durable-engine.md` in the project memory.

## IMMEDIATE NEXT STEP
Run the `resume_at` migration above → tell the new chat: **"migration done, flip Edamame v2 onto the daily auto-sender."**
