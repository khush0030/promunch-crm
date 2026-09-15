# docs/ — index

Rule: every doc lives in exactly one subfolder below. Superseded docs move to `archive/`. Update this index when adding or moving anything.

## architecture/ — system map + how to change it (START HERE)

| Doc | What it answers |
|---|---|
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | The whole platform on one page: deployables, modules, routes, edge functions, tables, external services, cron topology, the three sacred data flows, where to look when something breaks |
| [PROMUNCH_WHATSAPP_CURRENT_STATE.md](architecture/PROMUNCH_WHATSAPP_CURRENT_STATE.md) | September 2026 WhatsApp architecture audit: message owners, live flow settings and schedules, preservation boundaries and unresolved risks |
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
| [CART_RECOVERY_DELIVERY.md](whatsapp/CART_RECOVERY_DELIVERY.md) | Customer-requested storefront carts, one template attempt per cart, cart priority, verification and staged activation |
| [VOICE_AGENT_SETUP.md](whatsapp/VOICE_AGENT_SETUP.md) | Sarvam AI voice agent for abandoned-cart rescue calls: number rental + KYC, function secrets, agent variables/prompt/tool config, template submission, deploy order, DND/TRAI caveats |

Deeper WhatsApp ops docs live with the functions: `promunch-email-agent/docs/WHATSAPP_SETUP.md`, `promunch-email-agent/docs/WHATSAPP_ORDERING.md`.

## instagram/ — DM pipeline (built, not yet live)

| Doc | What it answers |
|---|---|
| [instagram-guide-for-team.md](instagram/instagram-guide-for-team.md) | Non-technical team guide to the Instagram inbox + collab pipeline |
| [instagram-influencer-pipeline.md](instagram/instagram-influencer-pipeline.md) | Full technical spec of the ig-* function stack (incl. Discovery + follow-up engine, 2026-07-21) |
| [META_APP_SETUP.md](instagram/META_APP_SETUP.md) | Step-by-step Meta Developers app setup: webhooks, system-user token, app review incl. Human Agent |

## Domain migration

- [Domain migration verification](runbooks/DOMAIN_MIGRATION_VERIFICATION.md): live configuration, authentication checks, daily-cycle monitor and rollback.

## integrations/

| Doc | What it answers |
|---|---|
| [amazon-integration-setup.md](integrations/amazon-integration-setup.md) | Amazon SP-API setup (India = EU endpoint, no SigV4), polling + Slack channels |

## plans/ — dated feature plans and design specs

| Doc | What it answers |
|---|---|
| [2026-09-15 CRM redesign](plans/2026-09-15-crm-redesign/IMPLEMENTATION_PLAN.md) | APPROVED 15 Sep: 6-hub navigation, PROMUNCH brand system, 34 screens laptop + phone (prototype: `index.html` + `screens.js` in the same folder, live at https://claude.ai/artifact/Wej9SQVrLomK5jGNp84PSZ); Phase 0-1 implementation plan |
| [2026-09-15-b2b-buyer-discovery.md](plans/2026-09-15-b2b-buyer-discovery.md) | Buyer Finder proposal: Apollo + ZeroBounce, named decision makers, UI/backend design, costs, deliverability safeguards and coverage pilot |
| [UI component architecture](archive/2026-09-12-broad-ui-proposal/plans/2026-09-12-ui-component-architecture.md) | Shared component responsibilities, module boundaries and rules against future crowding |
| [2026-09-12-complete-ui-redesign-plan.md](archive/2026-09-12-broad-ui-proposal/plans/2026-09-12-complete-ui-redesign-plan.md) | Complete CRM UI audit, brand alignment, mobile specification and implementation sequence |
| [2026-07-05-b2b-leads-v2.md](plans/2026-07-05-b2b-leads-v2.md) | B2B leads v2 implementation plan (lists/sequences/templates/analytics) |
| [2026-07-05-b2b-leads-v2-design.md](plans/2026-07-05-b2b-leads-v2-design.md) | B2B leads v2 design spec |
| [2026-07-17-deal-pipeline.md](plans/2026-07-17-deal-pipeline.md) | Deal pipeline: AI scan of hello@promunch.in → /dashboard/deals stage tracker (architecture + ops checklist) |
| [2026-08-26-sarvam-voice-cart-recovery-design.md](plans/2026-08-26-sarvam-voice-cart-recovery-design.md) | Sarvam voice agent rescue call for abandoned carts after WhatsApp fails (design spec) |
| [2026-09-05-wa-inbox-alerts-and-share-links.md](plans/2026-09-05-wa-inbox-alerts-and-share-links.md) | WhatsApp inbox sound/browser alerts for Human-mode chats + shareable ?thread= deep links (design spec) |
| [2026-08-26-sarvam-voice-cart-recovery.md](plans/2026-08-26-sarvam-voice-cart-recovery.md) | Sarvam voice cart recovery implementation plan (10 tasks) |
| [2026-08-27-custom-domain-migration.md](plans/2026-08-27-custom-domain-migration.md) | Contingency runbook for moving off `promunch-crm.vercel.app` to a custom domain (not decided, not started) |
| [2026-09-05-wa-bot-quality-audit.md](plans/2026-09-05-wa-bot-quality-audit.md) | WhatsApp bot quality audit (Aug 15 to Sep 3 convos): stale KB embeddings, KB gaps, loop/escalation failures, phased fix plan |

## audits/ — point-in-time audit deliverables

| Doc | What it answers |
|---|---|
| [Domain migration final verification](audits/2026-09-13-domain-migration-evidence/REPORT.md) | Full-day results: domain/auth verified; operational failures and unverified jobs remain |
| [12 Sep dashboard refinement (superseded)](archive/2026-09-12-dashboard-refinement/2026-09-12-dashboard-refinement-review.html) | Earlier proposal that kept the old navigation and Geist; replaced by the 15 Sep redesign |
| [Earlier broad UI proposal (superseded)](archive/2026-09-12-broad-ui-proposal/audits/2026-09-12-ui-redesign-review.html) | Interactive visual review: 209 app views plus a component reference, laptop/mobile previews, states and local approval notes |
| [UI coverage register](archive/2026-09-12-broad-ui-proposal/audits/2026-09-12-ui-screen-coverage.md) | All 28 page routes and 132 source surfaces mapped to the redesign |
| [Source surface inventory](archive/2026-09-12-broad-ui-proposal/audits/2026-09-12-ui-screen-inventory.json) / [Visual manifest](archive/2026-09-12-broad-ui-proposal/audits/2026-09-12-ui-prototype-manifest.json) | Structured inventories for keeping implementation scope complete |
| [2026-07-18-production-hardening-audit.md](audits/2026-07-18-production-hardening-audit.md) | Full-platform audit + same-day fix pass: criticals fixed, migrations to apply, known-open items, Interakt/Klaviyo roadmap |
| [PROMUNCH_CRM_Architecture_Audit.html](audits/PROMUNCH_CRM_Architecture_Audit.html) | Jul 2026 full architecture + security audit report |

## archive/ — superseded, historical only

Do not follow anything here; kept for context. Old redesign specs/mockups (pre warm-editorial), the original Claude Code brief, June 2026 WhatsApp template copy worksheets, and the superseded `wa-campaign-pgcron.sql` (replaced by the canonical pg_cron migration `20260705100000_cron_jobs_canonical.sql`).
