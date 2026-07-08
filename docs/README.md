# docs/ — index

Rule: every doc lives in exactly one subfolder below. Superseded docs move to `archive/`. Update this index when adding or moving anything.

## runbooks/ — how to operate + deploy

| Doc | What it answers |
|---|---|
| [DEPLOY_GUIDE.md](runbooks/DEPLOY_GUIDE.md) | Full production deploy sequence: key rotation, Vercel env, Vault secrets, edge functions, app, migrations, rollback |
| [MIGRATIONS.md](runbooks/MIGRATIONS.md) | Where SQL migrations live, naming conventions, hand-apply process (dashboard SQL editor), known duplicate timestamps |
| [CRON_TOPOLOGY.md](runbooks/CRON_TOPOLOGY.md) | Single map of everything scheduled: Vercel daily crons, 18 pg_cron jobs, self-chaining functions, campaign-firing split-brain notes |
| [SECURITY_CRITICALS_RUNBOOK.md](runbooks/SECURITY_CRITICALS_RUNBOOK.md) | The 4 security criticals, fixes, and the service_role key rotation procedure |

## whatsapp/ — flagship channel

| Doc | What it answers |
|---|---|
| [META_WHATSAPP_TEMPLATE_RULES.md](whatsapp/META_WHATSAPP_TEMPLATE_RULES.md) | Meta template/component rules, media headers, error codes (#132012, #131049) |
| [WA_CAMPAIGN_HANDOFF.md](whatsapp/WA_CAMPAIGN_HANDOFF.md) | Campaign engine: send lock, worker cron, Meta daily tier, failure handling |
| [whatsapp-customer-flow.md](whatsapp/whatsapp-customer-flow.md) | Customer journey design across the WhatsApp lifecycle |

Deeper WhatsApp ops docs live with the functions: `promunch-email-agent/docs/WHATSAPP_SETUP.md`, `promunch-email-agent/docs/WHATSAPP_ORDERING.md`.

## instagram/ — DM pipeline (built, not yet live)

| Doc | What it answers |
|---|---|
| [instagram-guide-for-team.md](instagram/instagram-guide-for-team.md) | Non-technical team guide to the Instagram inbox + collab pipeline |
| [instagram-influencer-pipeline.md](instagram/instagram-influencer-pipeline.md) | Full technical spec of the ig-* function stack |

## integrations/

| Doc | What it answers |
|---|---|
| [amazon-integration-setup.md](integrations/amazon-integration-setup.md) | Amazon SP-API setup (India = EU endpoint, no SigV4), polling + Slack channels |

## plans/ — dated feature plans and design specs

| Doc | What it answers |
|---|---|
| [2026-07-05-b2b-leads-v2.md](plans/2026-07-05-b2b-leads-v2.md) | B2B leads v2 implementation plan (lists/sequences/templates/analytics) |
| [2026-07-05-b2b-leads-v2-design.md](plans/2026-07-05-b2b-leads-v2-design.md) | B2B leads v2 design spec |

## audits/ — point-in-time audit deliverables

| Doc | What it answers |
|---|---|
| [PROMUNCH_CRM_Architecture_Audit.html](audits/PROMUNCH_CRM_Architecture_Audit.html) | Jul 2026 full architecture + security audit report |

## archive/ — superseded, historical only

Do not follow anything here; kept for context. Old redesign specs/mockups (pre warm-editorial), the original Claude Code brief, June 2026 WhatsApp template copy worksheets, and the superseded `wa-campaign-pgcron.sql` (replaced by the canonical pg_cron migration `20260705100000_cron_jobs_canonical.sql`).
