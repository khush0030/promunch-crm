# docs/ — index

Rule: every doc lives in exactly one subfolder below. Superseded docs move to `archive/`. Update this index when adding or moving anything.

## architecture/ — system map + how to change it (START HERE)

| Doc | What it answers |
|---|---|
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | The whole platform on one page: deployables, modules, routes, edge functions, tables, external services, cron topology, the three sacred data flows, where to look when something breaks |
| [AI_CHANGE_PLAYBOOK.md](architecture/AI_CHANGE_PLAYBOOK.md) | How any AI agent (or human) safely changes the app: recipes per change type, verification gate, deploy sequence, production debugging order |

## runbooks/ — how to operate + deploy

| Doc | What it answers |
|---|---|
| [DEPLOY_GUIDE.md](runbooks/DEPLOY_GUIDE.md) | Full production deploy sequence: key rotation, Vercel env, Vault secrets, edge functions, app, migrations, rollback |
| [MIGRATIONS.md](runbooks/MIGRATIONS.md) | Where SQL migrations live, naming conventions, hand-apply process (dashboard SQL editor), known duplicate timestamps |
| [CRON_TOPOLOGY.md](runbooks/CRON_TOPOLOGY.md) | Single map of everything scheduled: Vercel daily crons, 26 pg_cron jobs, self-chaining functions, campaign-firing split-brain notes, log retention + Disk IO rescue |
| [SECURITY_CRITICALS_RUNBOOK.md](runbooks/SECURITY_CRITICALS_RUNBOOK.md) | The 4 security criticals, fixes, and the service_role key rotation procedure |

## whatsapp/ — flagship channel

| Doc | What it answers |
|---|---|
| [META_WHATSAPP_TEMPLATE_RULES.md](whatsapp/META_WHATSAPP_TEMPLATE_RULES.md) | Meta template/component rules, media headers, error codes (#132012, #131049) |
| [WA_CAMPAIGN_HANDOFF.md](whatsapp/WA_CAMPAIGN_HANDOFF.md) | Campaign engine: send lock, worker cron, Meta daily tier, failure handling |
| [whatsapp-customer-flow.md](whatsapp/whatsapp-customer-flow.md) | Customer journey design across the WhatsApp lifecycle |
| [AUDIENCE_QUALITY.md](whatsapp/AUDIENCE_QUALITY.md) | Engagement tiers (`tier:*` tags), why 1,410 "opted-in" contacts are really 73 engaged, the campaign audience default, and the storefront consent trail |
| [MM_LITE_MIGRATION.md](whatsapp/MM_LITE_MIGRATION.md) | Marketing Messages (MM Lite) API: what was verified from Meta's docs, the `WA_MM_LITE_ENABLED` flag + Cloud API fallback, Meta onboarding steps, rollout and rollback |

Deeper WhatsApp ops docs live with the functions: `promunch-email-agent/docs/WHATSAPP_SETUP.md`, `promunch-email-agent/docs/WHATSAPP_ORDERING.md`.

## instagram/ — DM pipeline (built, not yet live)

| Doc | What it answers |
|---|---|
| [instagram-guide-for-team.md](instagram/instagram-guide-for-team.md) | Non-technical team guide to the Instagram inbox + collab pipeline |
| [instagram-influencer-pipeline.md](instagram/instagram-influencer-pipeline.md) | Full technical spec of the ig-* function stack (incl. Discovery + follow-up engine, 2026-07-21) |
| [META_APP_SETUP.md](instagram/META_APP_SETUP.md) | Step-by-step Meta Developers app setup: webhooks, system-user token, app review incl. Human Agent |

## integrations/

| Doc | What it answers |
|---|---|
| [amazon-integration-setup.md](integrations/amazon-integration-setup.md) | Amazon SP-API setup (India = EU endpoint, no SigV4), polling + Slack channels |

## plans/ — dated feature plans and design specs

| Doc | What it answers |
|---|---|
| [2026-07-05-b2b-leads-v2.md](plans/2026-07-05-b2b-leads-v2.md) | B2B leads v2 implementation plan (lists/sequences/templates/analytics) |
| [2026-07-05-b2b-leads-v2-design.md](plans/2026-07-05-b2b-leads-v2-design.md) | B2B leads v2 design spec |
| [2026-07-17-deal-pipeline.md](plans/2026-07-17-deal-pipeline.md) | Deal pipeline: AI scan of hello@promunch.in → /dashboard/deals stage tracker (architecture + ops checklist) |
| [2026-08-26-sarvam-voice-cart-recovery-design.md](plans/2026-08-26-sarvam-voice-cart-recovery-design.md) | Sarvam voice agent rescue call for abandoned carts after WhatsApp fails (design spec) |
| [2026-08-26-sarvam-voice-cart-recovery.md](plans/2026-08-26-sarvam-voice-cart-recovery.md) | Sarvam voice cart recovery implementation plan (10 tasks) |

## audits/ — point-in-time audit deliverables

| Doc | What it answers |
|---|---|
| [2026-07-18-production-hardening-audit.md](audits/2026-07-18-production-hardening-audit.md) | Full-platform audit + same-day fix pass: criticals fixed, migrations to apply, known-open items, Interakt/Klaviyo roadmap |
| [PROMUNCH_CRM_Architecture_Audit.html](audits/PROMUNCH_CRM_Architecture_Audit.html) | Jul 2026 full architecture + security audit report |

## archive/ — superseded, historical only

Do not follow anything here; kept for context. Old redesign specs/mockups (pre warm-editorial), the original Claude Code brief, June 2026 WhatsApp template copy worksheets, and the superseded `wa-campaign-pgcron.sql` (replaced by the canonical pg_cron migration `20260705100000_cron_jobs_canonical.sql`).
