# Production Hardening Audit — 2026-07-18

Full-platform audit (6 parallel deep audits: frontend, API routes, edge functions, data/ops, security/config, architecture inventory) followed by a same-day fix pass. Companion docs written from this audit: [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) and [docs/architecture/AI_CHANGE_PLAYBOOK.md](../architecture/AI_CHANGE_PLAYBOOK.md).

**Headline:** the owner's "pages randomly break and I have to open VS Code" experience had one dominant root cause (expired session → 401 JSON fed into React state → render crash → the only error boundary replaced the whole app) plus a silent-failure ops layer (the dead-man's switch and the confirmation sweep were never scheduled; most May–June tables shipped with no RLS). All fixed in code; DB-side items ship as four hand-apply migrations.

## Fixed in this pass

### Critical
| # | Finding | Fix |
|---|---|---|
| C1 | **Email approve path had no atomic claim** (`_shared/approve.ts`) — Slack retries fire whenever the ack takes >3s, so Approve-button + typed-approve + retry races double-sent customer emails | Guarded `status='sending'` claim; Slack event retries now dropped globally (`slack-events`) |
| C2 | **`kb-ingest`/`kb-embed`/`wa-template-create` accepted the public anon key** (`verify_jwt` passes any project JWT) — internet-writable Master KB = customer-facing bot poisoning; live Meta template copy rewritable | `requireInternal` added to all 12 exposed functions (also: `wa-confirmation-sweep`, `b2b-send`, `shopify-consent-set`, `shopify-catalog-sync`, `wa-campaign-report`, `wa-meta-info`, `wa-register`, `wa-watchdog`, `ig-jobs-tick`) |
| C3 | **Dead-man's switch never scheduled** — if pg_cron (or its Vault bearer) dies, ALL automation stops silently | Both Vercel cron slots now run `/api/cron/wa-watchdog` (03:00 + 15:00 UTC; their old jobs were redundant with existing pg_cron copies); pg_cron watchdog every 10 min in migration `20260718123000` |
| C4 | **May–June tables had no RLS/grants** — incl. `oauth_tokens` (plaintext Gmail refresh token → mailbox takeover), `wa_messages` (chat transcripts), `email_threads`, entire B2B pipeline; writable with the anon key | Migration `20260718120000_rls_lockdown.sql` (34 staff-read tables + 8 service-role-only). **Rotate the Google refresh token after applying** |

### High
| # | Finding | Fix |
|---|---|---|
| H1 | Role self-escalation: roles in `user_metadata` (self-editable via anon key) + unknown role defaulted to admin | Roles now read from `app_metadata` only, fail-closed to Member, owner email always Admin; team route writes app_metadata; backfill migration `008_roles_app_metadata.sql` |
| H2 | Email campaign double-blast: `campaigns/[id]/send` had read-then-act status check | Atomic claim (guarded update) |
| H3 | GDPR re-identification: anonymize left `shopify_customer_id`, and no upsert path checked `anonymized_at` — next order re-populated the erased row | Scrub includes shopify_customer_id + WA profile/message-body scrub + opt-out; edge upsert skips anonymized rows |
| H4 | `wa-confirmation-sweep` scheduled nowhere (the §0 "missed message is recoverable" premise was false) + unauthenticated + leaked customer phones in responses | Auth + phone masking fixed; schedule ships in `20260718123000` (see "Needs your decision") |
| H5 | Dead §0-violating `order_confirmation` branch in `wa-jobs-tick` (unclaimed send, retired template, duplicate journey enrolment) one insert away from live | Deleted |
| H6 | Next.js 16.1.7 carried published middleware-bypass/DoS/cache-poisoning advisories — middleware is this app's entire auth | Upgraded to 16.2.10; `npm audit fix` cleared undici/svix; remaining: 1 moderate (postcss bundled inside Next — upstream) |
| H7 | Frontend 401-crash class: 21 files fed error JSON into state; no route error boundaries; pages hung forever or masked errors as empty data | `error.tsx`/`loading.tsx` at the dashboard segment, shared `apiFetch()` (401→login redirect), 15 files retrofitted with real error/retry states |
| H8 | Missing hot-path indexes (wa_messages template/status + sent_by, shopify_orders customer_email + order_number, COD scan) | Migration `20260718122000_hot_indexes.sql` |
| H9 | `wa_threads.last_activity_at` never existed — inbox ordering silently regressed to creation order | Migration `20260718121000`: column + backfill + index + trigger on wa_messages (no edge code change needed) |

### Medium (fixed)
- Campaign audience read silently capped at 1000 contacts (`wa-campaign-send`) — paginated; >1000-contact campaigns would have marked completed with recipients unreached.
- Concurrent duplicate webhook deliveries could double-send deterministic replies (STOP/START confirms, checkout links) — the `wa_messages` insert is now the atomic gate (23505 → bail before side effects).
- `wa-send` ignored ledger-write failures — a lost ledger row is a dedup blind spot; now alerts loudly.
- COD needs-call ops ping was marked sent even when it failed — now released for retry.
- `gmail-webhook` fail-open without `PUBSUB_VERIFICATION_TOKEN` + attacker-movable Gmail cursor (silent inbound-email loss) — fails closed, timing-safe, cursor never advanced from caller input.
- `_shared/slack.ts` HMAC key became the literal string "undefined" when the signing secret was unset (forgeable) — fails closed.
- ~15 API routes 500'd on malformed JSON bodies — `parseBody` helper; mass-assignment on `wa_templates` PATCH — allowlisted; PostgREST `.or()` injection in 4 search endpoints — `sanitizeSearch`; `/api/email/send` from-spoofing — domain-restricted.
- AI-reply enqueue failure was silent (dropped inbound) — now pages Slack.

## Apply-by-hand items (migrations, in order)

1. `supabase/migrations/008_roles_app_metadata.sql` — role backfill (apply BEFORE deploying the app or admins temporarily drop to Member tier; owner unaffected).
2. `promunch-email-agent/supabase/migrations/20260718120000_rls_lockdown.sql` — RLS lockdown. Then **rotate the Google OAuth refresh token** (assume `oauth_tokens` was reachable).
3. `20260718121000_wa_threads_last_activity.sql` — inbox ordering.
4. `20260718122000_hot_indexes.sql` — indexes.
5. `20260718123000_cron_additions.sql` — watchdog + confirmation sweep (**see decision below**).

## Needs your decision (customer-visible)

**Scheduling `wa-confirmation-sweep` (in migration 5).** Effect: orders from the last 24h whose instant WhatsApp confirmation genuinely failed will get it late instead of never (24h lookback, 5-attempt cap, ledger dedup — a confirmed order can never be re-confirmed). This is the designed safety net and closes the "missed confirmations are invisible" hole; it is held for your explicit OK per the WhatsApp-change rule. To decline for now: comment out its one line in the migration.

## Known-open (documented, not fixed — by size/risk)

- **Consent is per-channel:** WhatsApp STOP doesn't unsubscribe email and vice versa. Needs a product decision on unified consent.
- **`contacts.total_orders/total_spent` are max()-merged** — refunds/cancellations never reduce them.
- **Dashboard home KPI fallback still reads the legacy `orders` table**; GDPR export reads it too. Migrate both to `shopify_orders`.
- **Send-helper duplication:** 9 near-copies of the "call wa-send with retry" helper across edge functions (2 identical twins in the order-confirmation path retry ambiguous failures toward re-send — §0 prefers silence). Consolidation into `_shared/` needs a careful, sign-off'd refactor.
- **Facet endpoints** load up to 50k rows into JS per page load and silently undercount beyond; `import/shopify` accumulates the whole order table (`maxDuration` will eventually trip). Move to SQL aggregation.
- **No rate limiting** on the public `/r/[code]` redirect (click-log flooding) or expensive admin triggers.
- **`check-migrations.sh` only checks filename collisions** — it cannot detect what's actually applied in prod. A real drift check needs a live-DB comparison.
- **`wa-ticket-watchdog?mode=digest`** cron posts JSON to nobody (Slack digest removed) — delete the job or restore a sink.
- **Sentry runs only when `NEXT_PUBLIC_SENTRY_DSN` is set** — set it to activate the already-wired error tracking; edge functions have no Sentry (they page via connector_events/Slack instead).
- Assistant conversations are team-shared (any member can read/delete any) — acceptable for an internal tool, noted.

## Path to "Interakt/Klaviyo-grade" (roadmap sketch)

The platform already has the right bones (channel chokepoints, claims/ledgers, config-over-code journey timings, dashboard-managed templates). What closes the gap:

1. **Reliability floor (this audit)** — boundaries, fail-closed auth, RLS, watchdog. Done/pending migrations above.
2. **One generic automation engine** — today WhatsApp journeys, email flows, and B2B sequences are three separate engines. Konsolidate on one `flows` model (trigger → wait/branch → action) with channel adapters; the WA journey claim pattern becomes the shared executor.
3. **Segments as first-class** — RFM tags + audience filters exist; promote to a saved-segment builder usable by every channel (one audience model, per-channel consent).
4. **Observability as product** — the Integrations page + connector_events is the seed of a real status/health screen: per-pipeline last-run/last-error tiles fed by `cron.job_run_details`, so "is something broken" never requires VS Code.
5. **Unified customer timeline** — customer-link.ts already stitches identities; surface one timeline (orders, WA, email, IG, tickets) on the contact page as the canonical 360.
