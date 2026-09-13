# PROMUNCH CRM migration: final 24-hour verification

Window: September 12 13:04:15 UTC to September 13 13:04:15 UTC (18:34 IST on both dates). Final read: 2026-09-13T13:08:11.362Z.

**Overall: operational verification failed.** The domain and authentication migration works, but the CRM does not qualify for an all-clear. Both hosts returned HTTP 200 at final check, all 30 schedules remained enabled, and live email/order/webhook activity continued. Persistent failures predate the domain change; their presence does not establish that the migration caused them.

## Confirmed failures

- Campaign scheduling: **48/96 failed**, 48/96 HTTP 200.
- Email flow scheduling: **50/96 failed**, 46/96 HTTP 200.
- Both returned HTTP 500 at 13:00 UTC on September 13. Diagnostic markers identify Gateway Timeout during database access; the campaign marker identifies the initial read specifically. The underlying gateway/network/database cause remains unverified.
- All 24 lead-job calls and the three Vercel daily calls returned HTTP 200. These counts use 219 distinct request IDs covering the full window, fetched in bounded intervals because the large CLI export repeated pages.
- Retained Supabase HTTP responses from 07:11 to 13:04 UTC: 898 HTTP 2xx and 147 transport timeouts out of 1045. This covers all HTTP jobs, not just the two routes. Earlier evidence showed five-second timeouts including DNS resolution. Do not equate these outbound scheduler timeouts with the cause of Vercel's database Gateway Timeout.

## Domain and authentication

PASS for the previously completed invitation, password reset, login/reload/logout, consumed-link rejection, allowed callbacks, and Secure host-only cookies on admin.promunch.in. The user confirmed receipt of both test emails; temporary test accounts were removed. Both domains remain attached. Authentication fixes and diagnostic logging were deployed before monitoring; this report changes no production code. See [migration runbook](../../runbooks/DOMAIN_MIGRATION_VERIFICATION.md).

## Daily Vercel jobs

| Job | Result | Evidence and limit |
|---|---|
| wa-watchdog, Sep12 15:00 UTC | PASS (HTTP/observed health) | HTTP 200 at 15:00:44; fresh health events, no new stale event. Response body and alert delivery not independently verified. |
| wa-watchdog, Sep13 03:00 UTC | PASS (HTTP/observed health) | HTTP 200 at 03:00:46; no new stale event. Alert delivery not tested. |
| wa-engagement-tiers, Sep12 20:30 UTC | PASS (application response) | HTTP 200 at 20:30:31; handler returns502 on recomputation RPC failure. |

## All Supabase schedules

PASS labels are scoped to the evidence described. Scheduler success alone remains UNVERIFIED for end-to-end execution. Weekly vacuum was due and ran; other weekly/monthly jobs marked NOT DUE below were outside the window.

| Job | Verification | Evidence |
|---|---|---|
| amazon-poll | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| amazon-settlements | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| b2b-leads-tick | PASS (HTTP) | 24/24 calls HTTP 200; downstream lead processing not independently audited. |
| deal-scan-every-30min | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| email-flow-tick | FAIL | 50/96 HTTP 500; Gateway Timeout in email flow database access. |
| gmail-poll-every-2min | FAIL (intermittent) | auth_missing/poll_failed at Sep12 22:30 UTC; later poll_ok and email processing confirmed. |
| gmail-watch-renew-daily | PASS (application) | watch_renewed event Sep13 06:00:05 UTC. |
| kb-embed-nightly | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| nudge-pending-15min | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| purge-operational-logs | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| shopify-catalog-sync | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| shopify-catalog-sync-nightly | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| shopify-daily-summary | PASS (correlated application evidence) | Sep12 18:29 UTC HTTP 200/ok:true response matched count,ok,period,total schema and schedule; independently observed Slack delivery unverified. |
| shopify-monthly-recap | NOT DUE | Monthly date outside window. |
| shopify-webhooks-ensure | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| shopify-weekly-recap | NOT DUE | Sunday18:29 UTC occurs after cutoff. |
| vacuum-hot-log-tables | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| voice-transcript-purge | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-campaign-tick | FAIL | 48/96 HTTP 500; Gateway Timeout on initial campaign read. |
| wa-campaign-worker | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-confirmation-sweep | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-health | PASS (observed health) | Recurring health_ok events, latest 13:00:01 UTC; not proof every dispatch completed. |
| wa-jobs-tick | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-journey-tick | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-rfm-tick-nightly | PASS (application) | rfm_recompute event Sep13 01:30:06 UTC. |
| wa-ticket-watchdog-digest | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-ticket-watchdog-reping | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-unanswered | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-watchdog | UNVERIFIED | Latest due scheduler execution succeeded; HTTP, application or resulting DB outcome not independently verified. |
| wa-weekly-summary | NOT DUE | Monday03:30 UTC outside window. |

## Providers and customer-facing integrations

| Integration | Result | Evidence and limit |
|---|---|---|
| Supabase Auth / Resend staff emails | PASS (tested flows) | Invitation and recovery completed on new host; user confirmed inbox receipt. Broad marketing delivery not tested. |
| Gmail | FAIL (intermittent), recovered activity | Service-account401 unauthorized_client observed; OAuth fallback configured. auth_missing and poll_failed at Sep12 22:30 UTC; later successful polls, drafts and email processing. Watch renewal succeeded 06:00 UTC. |
| WhatsApp / Meta | FAIL (some deliveries); receipt path active | New existing-category131049 at 05:15 UTC and 131026 at 07:15 UTC. Real webhook receipt and confirmation_sent events at 07:37 and 10:49 UTC. A sent event is not proof of delivered/read. |
| Shopify order integration | PASS (observed live flow), other paths UNVERIFIED | Order refresh, confirmation, Slack post, webhook receipt and duplicate-skip events observed. Catalog and webhook-registration job completion not independently verified. |
| Slack | PASS (observed posts), alerts UNVERIFIED | email_slack/shopify_slack post_ok events; no independent full alert-delivery test. |
| Amazon polling / settlements | UNVERIFIED | Dispatch succeeded; provider reconciliation/results not independently verified. |
| Other connectors (Instagram, B2B provider delivery, voice) | UNVERIFIED | Insufficient provider-specific end-to-end evidence. Absence of recorded traffic is not a failure or a pass. |

## Evidence limits and follow-up

The monitor encountered automatic approval-review timeouts and temporary-file loss. Available Vercel logs were recovered for the complete window. Older SQL observations remain in task history; they were not represented as newly exported raw evidence. Some daily Supabase HTTP responses expired before final inspection, so their end-to-end outcomes remain unverified.

The migration can continue serving traffic, but operational sign-off remains open: diagnose and fix the database gateway timeouts, resolve Gmail service-account authorization/fallback reliability, and verify the jobs marked UNVERIFIED. Do not replay entire send workers to test fixes; preserve existing atomic claims and duplicate prevention. These fixes were not performed by the read-only monitor.

The scheduled 24-hour verification is complete and its heartbeat is paused. This means the observation task ended, not that the failures were fixed.

[Raw final evidence](final-evidence.json) includes all 219 unique request records, final health metadata, and per-job classifications. Earlier durable snapshots are in this directory.
