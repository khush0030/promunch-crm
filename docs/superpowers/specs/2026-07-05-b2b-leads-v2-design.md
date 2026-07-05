# B2B Leads v2 — Lists, Sequences, Templates, Analytics

Date: 2026-07-05 · Status: approved (user approved design + interactive mockup)

## Problem

The current /dashboard/leads page is hard to use: six status tabs over a 12-value
status machine, a two-level Scrapes→leads drill-down, per-lead AI drafts that each
need manual review, and no way to (a) keep named lists of leads, (b) see when a lead
was last contacted, (c) send a bulk campaign, or (d) run automatic follow-ups.

## Approved decisions

1. **Email content**: saved templates with `{variables}` + optional per-step AI polish
   of the opening line (gpt-4o-mini, grounded in lead enrichment + Master KB).
2. **Builder shape**: vertical timeline (Email → wait N days → Email), no branching.
3. **Send engine**: hourly Supabase pg_cron → HTTP call to `/api/cron/leads-tick`
   with `CRON_SECRET` bearer (Vault-sourced), same pattern as WA workers. Existing
   daily Vercel cron stays as backstop.
4. **UI scope**: full restructure. Tabs: **Lists | Sequences | Templates | Replies |
   Analytics**. Scrapes/To review/Skipped tabs removed. Full-width layout.

## Core concept

Everything hangs off **Lists**. A company search ("Find companies") ends by saving
results into a named list (auto-named "<category> — <city>", renameable). Bulk
campaign = enroll a list into a sequence. A one-shot blast is a 1-step sequence.

## Data model (new migration in promunch-email-agent/supabase/migrations, manual apply)

- `lead_lists` — id, name, description, source_search_id → lead_searches, archived,
  timestamps.
- `lead_list_members` — list_id, lead_id, added_at, unique(list_id, lead_id).
- `email_templates` — id, name, subject, body_text (supports `{name}`, `{company}`,
  `{city}`, `{category}`), archived, timestamps.
- `email_sequences` — id, name, status draft|active|paused|archived, stop_on_reply
  bool default true, ai_polish bool default true, timestamps.
- `email_sequence_steps` — id, sequence_id, position, template_id, wait_days
  (0 for first step), timestamps.
- `sequence_enrollments` — id, sequence_id, lead_id, contact_id, list_id, status
  active|completed|replied|bounced|stopped, current_step, next_send_at, timestamps,
  unique(sequence_id, lead_id).
- `outreach_drafts` + nullable `enrollment_id`, `step_position` — sequence sends
  flow through outreach_drafts so the Resend webhook, replies, bounces,
  suppressions and sent_at history keep working unchanged.
- `outreach_settings` + `send_window_start` (default 9), `send_window_end`
  (default 18) — IST hours.
- pg_cron job (hourly) calling the Vercel cron route via pg_net with Vault-stored
  secret.

"Last contacted" = max(outreach_drafts.sent_at) per lead; timeline = drafts +
outreach_events + outreach_replies.

## Send engine

New stage in `tick()` (src/lib/leads/engine.ts): `processSequences()`:

1. Load due enrollments (`status='active' and next_send_at <= now`), oldest first.
2. Guards, same as manual send: settings.paused, IST daily cap (shared across all
   sends), suppression check, send window (9–18 IST default).
3. Auto-stop: if lead is replied (and stop_on_reply) / bounced / suppressed →
   enrollment status updated, no send.
4. Render step template: variable substitution from lead + primary contact;
   optional AI polish rewrites only the first line using lead.enrichment /
   site_snippet, PROMUNCH all-caps + no-em-dash rules enforced in prompt.
5. Insert outreach_drafts row (enrollment_id, step_position), send via existing
   Resend path (from Parth), mark sent, log outreach_events.
6. Advance: current_step++, next_send_at = now + next step wait_days; last step →
   status completed.
7. Reply webhook (resend-inbound) additionally stops active enrollments for that
   lead. Bounce path (resend webhook) marks enrollments bounced.

Atomic claim on enrollment rows (status flip) prevents double sends if ticks
overlap — same pattern as the existing draft/send claims.

## API routes (all requireSession, matching existing /api/leads/*)

- `GET/POST /api/leads/lists`, `PATCH/DELETE /api/leads/lists/[id]`,
  `POST/DELETE /api/leads/lists/[id]/members`.
- `GET/POST /api/leads/templates`, `PATCH/DELETE /api/leads/templates/[id]`,
  `POST /api/leads/templates/generate` (offer description → 2–3 AI variants).
- `GET/POST /api/leads/sequences`, `PATCH/DELETE /api/leads/sequences/[id]`
  (name/status/steps replace), `POST /api/leads/sequences/[id]/enroll`
  ({list_id}) — enrolls eligible members (mx_ok contact, not suppressed, not
  already enrolled), returns counts of enrolled/skipped+reasons.
- `GET /api/leads/analytics?range=30d` — aggregates from outreach_drafts +
  outreach_events: headline rates, weekly sent/opened series, funnel, per-sequence
  and per-template stats.
- Search flow: `POST /api/leads/search` also creates the lead_lists row;
  engine adds discovered leads to that list as members.

## UI (src/app/dashboard/leads, components in src/components/leads)

Full-width warm-editorial (pm-) layout. Header: title, Settings, Find companies.
KPIs: sent today x/cap, in sequences now, replies this week, total leads.

- **Lists**: card grid (name, lead/verified counts, % contacted bar, sequence
  badge, last activity) + new-empty-list card. Detail: table (Company, Fit,
  Contact, Last contacted, Status), actions Rename / Add leads / Enroll in
  sequence. Row click → lead drawer: contacts, fit, contact-history timeline
  (sends with open/click pills, replies, list adds), suppress, manual one-off email.
- **Sequences**: index + vertical timeline builder (step cards with template
  picker + inline preview, wait-day chips, add-step), right rail: stop-on-reply,
  AI polish, send window, shared cap, enrollment stats.
- **Templates**: editor (name, subject, body, variable chips, live preview with a
  real sample lead) + "Draft with AI" producing 2–3 variants to keep.
- **Replies**: existing replies inbox as its own tab.
- **Analytics**: headline KPIs with deltas, weekly sends/opens line chart, funnel
  (sent→delivered→opened→clicked→replied), sequence report card (A–F), reply rate
  by template, 30/90/all range toggle.

Mockup (approved): warm pm- palette; chart palette #31875A/#B87A10/#3576B5/#C2492E
(validated for CVD/contrast).

## Out of scope / kept as-is

- Discovery pipeline (Places → scrape → MX → fit/enrichment) unchanged.
- Suppressions, daily cap, sender identity (Parth), Resend webhooks unchanged.
- No branching sequences, no per-email approval queue for sequence sends
  (templates are pre-approved copy), no replies-inbox threading changes.

## Testing

Vitest: template variable rendering (missing vars, PROMUNCH casing), schedule math
(wait_days → next_send_at, IST window), cap enforcement across manual + sequence
sends, auto-stop on reply/bounce, enrollment eligibility filter.

## Rollout

1. Commit code to main (repo convention), typecheck + tests green.
2. Manual: apply migration in Supabase dashboard SQL editor (includes pg_cron job).
3. `vercel --prod` (user-triggered).
4. Smoke: create list from search, 2-step sequence with 1-day wait on a test lead.
