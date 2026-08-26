# Cron topology — single map of everything scheduled

Three scheduling systems exist. Everything below is now captured in source;
the pg_cron set is canonically defined in
`promunch-email-agent/supabase/migrations/20260705100000_cron_jobs_canonical.sql`
(idempotent — re-run it any time; it upserts by jobname).

## 1. Vercel crons (`vercel.json`) — daily only

Hobby plan blocks sub-daily crons, so only two daily kickers live here:

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/leads-tick` | 30 4 * * * | B2B lead-gen pipeline tick |
| `/api/cron/wa-campaign-tick` | 0 6 * * * | Daily campaign-firing safety net |

Both routes require `Authorization: Bearer <CRON_SECRET>` and fail closed
(401 if `CRON_SECRET` unset).

## 2. Supabase pg_cron — the real workhorse (18 jobs)

All jobs pull their bearer from Vault **at run time** (`service_role_key` for
edge functions, `cron_secret` for Next.js routes) — no secret is stored in a
job definition, and key rotation doesn't require re-scheduling.

| Job | Schedule | Target |
|---|---|---|
| wa-jobs-tick | every 1 min | edge fn `wa-jobs-tick` |
| gmail-poll-every-2min | every 2 min | edge fn `gmail-poll` |
| wa-campaign-worker | every 2 min | edge fn `wa-campaign-worker` |
| wa-health | every 10 min | edge fn `wa-health` |
| amazon-poll | every 15 min | edge fn `amazon-poll` |
| nudge-pending-15min | every 15 min | edge fn `nudge-pending` |
| wa-journey-tick | every 15 min | edge fn `wa-journey-tick` |
| wa-ticket-watchdog-reping | every 15 min | edge fn `wa-ticket-watchdog` |
| **wa-campaign-tick** | **every 15 min** | **Next.js `/api/cron/wa-campaign-tick`** (sub-daily, so pg_cron not Vercel) |
| wa-rfm-tick-nightly | 01:30 UTC | edge fn `wa-rfm-tick` |
| wa-ticket-watchdog-digest | 03:30 UTC | edge fn `wa-ticket-watchdog?mode=digest` |
| amazon-settlements | 05:00 UTC | edge fn `amazon-poll?only=settlements` |
| gmail-watch-renew-daily | 06:00 UTC | edge fn `gmail-watch-renew` |
| shopify-daily-summary | 18:29 UTC | edge fn `shopify-daily-summary` |
| shopify-catalog-sync-nightly | 19:30 UTC | edge fn `shopify-catalog-sync` |
| shopify-weekly-recap | Sun 18:29 UTC | edge fn `shopify-daily-summary?period=week` |
| shopify-monthly-recap | 28-31 18:29 UTC | edge fn `shopify-daily-summary?period=month` |
| wa-weekly-summary | Mon 03:30 UTC | edge fn `wa-weekly-summary` |

Verify live state: `select jobname, schedule, active from cron.job order by jobname;`

## 3. Self-continuation (no scheduler)

`wa-campaign-send` re-invokes itself in batches until a campaign completes
(atomic claim on `wa_messages` prevents duplicates — see
`wa-campaign-durable-engine` design). It is *started* by the campaign worker
/ tick above, not by cron directly.

## ⚠️ Split-brain: campaign firing has three overlapping mechanisms

1. Vercel daily `/api/cron/wa-campaign-tick` (06:00 UTC safety net)
2. pg_cron `wa-campaign-tick` every 15 min (the real trigger)
3. pg_cron `wa-campaign-worker` every 2 min (drains sending campaigns)

This is intentional redundancy; correctness relies on the DB send-lock +
atomic claim, NOT on only-one-firing. Do not "clean up" one of them without
re-reading the durable-engine design.

## History / superseded files

`promunch-email-agent/scripts/*-cron.sql` and `scripts/m3-gate-cron-auth.sql`
were the hand-applied originals. The canonical migration supersedes them all;
they are kept for history. The m3 script is still referenced by
`docs/runbooks/SECURITY_CRITICALS_RUNBOOK.md` — running either yields the same jobs
(the migration additionally covers `shopify-catalog-sync-nightly` and
`wa-campaign-tick`, and moves `wa-campaign-tick`'s CRON_SECRET into Vault).

## 2026-07-18 update (production hardening audit)

The canonical migration `20260705100000` is no longer the complete list. Current
truth = it PLUS these later additions (verify live with
`select jobname, schedule from cron.job order by jobname;`):

| Job | Schedule | Added by |
|---|---|---|
| `deal-scan-every-30min` | `*/30 * * * *` → edge `deal-scan` | `20260717130000_deal_pipeline.sql` |
| `b2b-leads-tick` | `5 * * * *` → Next `/api/cron/leads-tick` (cron_secret) | `20260706130000_b2b_lists_sequences.sql` |
| `wa-confirmation-sweep` | `*/15 * * * *` → edge (order-confirmation safety net; customer-visible — see migration header) | `20260718123000_cron_additions.sql` |
| `wa-watchdog` | `*/10 * * * *` → edge (Slack alert when wa-health heartbeats stop) | `20260718123000_cron_additions.sql` |

**Vercel cron added (2026-08-26):** `/api/cron/wa-engagement-tiers` at
`30 20 * * *` — re-derives the `tier:*` engagement tag on every `wa_contacts`
row via `recompute_wa_engagement_tags()` (migration
`supabase/migrations/014_wa_engagement_tiers_and_consent.sql`). Tiers move
slowly, so daily fits the Hobby limit; see
[docs/whatsapp/AUDIENCE_QUALITY.md](../whatsapp/AUDIENCE_QUALITY.md). Moving it
next to `wa-rfm-tick` on pg_cron would be tidier if a sub-daily cadence is ever
wanted.

**Vercel crons changed:** both Hobby slots now run `/api/cron/wa-watchdog`
(03:00 + 15:00 UTC) — the INDEPENDENT dead-man's switch that catches pg_cron
dying entirely. The previous Vercel jobs (`leads-tick` daily, `wa-campaign-tick`
daily) were redundant: pg_cron already fires both routes more frequently. If
pg_cron dies, campaigns/leads pause too — but now Slack gets paged within ~12h
instead of never.

**Rotation reminder:** the Vault secrets `service_role_key` and `cron_secret`
authorize every pg_cron job. Rotating either key without
`vault.update_secret(...)` turns the whole schedule into silent 401s — the
Vercel watchdog is what catches that now.

## 2026-08-20 update (Disk IO budget rescue)

Supabase flagged the project for depleting its **Disk IO budget**. It was not a
code bug — three log tables had grown unbounded since May and one dashboard RPC
read the worst of them 24 times per call.

| Table | Before | After |
|---|---|---|
| `cron.job_run_details` | 293,454 rows / 132 MB, never vacuumed, never analyzed (planner thought 1,786 rows) | 7-day retention, 12 MB |
| `public.email_logs` | 174,627 rows / 132 MB (116k of them `received`/`skipped`) | 30-day retention on the noise events, 32 MB |
| `public.connector_events` | 76,988 rows / 45 MB (66k `level='info'`) | 30-day retention on info, 16 MB |
| `net._http_response` | 257 MB of bloat holding 967 live rows | 1.1 MB |

Total 566 MB → 61 MB; whole database now 160 MB.

`assistant_cron_status()` was the biggest single reader: a lateral
`order by start_time desc limit 1` per cron job meant 24 scans of the 132 MB
`cron.job_run_details` per call (~3.7 GB of reads across five calls). It is now
one bounded `distinct on (jobid)` pass over a 2-day window —
**1,490 ms / 95k buffers → 51 ms / 2,067 buffers**. A job that has not run in
2 days now reports `last_status = null`, which reads as stale on the dashboard
exactly like a failure. `cron.job_run_details` cannot be indexed (owned by
`supabase_admin`), which is why the fix is on the query side.

Two new pg_cron jobs keep it from coming back (migration
`promunch-email-agent/supabase/migrations/20260820070000_io_retention.sql`):

| Job | Schedule | What |
|---|---|---|
| `purge-operational-logs` | `10 3 * * *` | `public.purge_operational_logs()` — 7d cron history, 30d `received`/`skipped` email logs, 30d info connector events. Per-table exception handling: a failing purge never takes the job down |
| `vacuum-hot-log-tables` | `40 3 * * 0` | Weekly plain `VACUUM (ANALYZE)` (never FULL, no exclusive lock) over those tables plus `net._http_response` |

Kept forever on purpose: `email_logs` `drafted`/`sent`/`failed`/`feedback` (the
audit trail) and `connector_events` `warn`/`error` (what the alerting reads).

Cron cadence was deliberately NOT reduced — `wa-jobs-tick` at 1 min and friends
guard customer replies and order confirmations. The log growth was the problem,
not the heartbeat.

If the IO warning returns, check in this order: `pg_stat_statements` ordered by
`shared_blks_dirtied`, then table sizes vs live rows (bloat), then
`cron.job_run_details` row count — do not start by reading application code.
