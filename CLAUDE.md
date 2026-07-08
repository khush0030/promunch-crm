# CLAUDE.md — PROMUNCH CRM

All project instructions live in one canonical file, shared by every agent:

@AGENTS.md

Claude-specific notes on top of that:

- **Working on edge functions?** Read [promunch-email-agent/CLAUDE.md](promunch-email-agent/CLAUDE.md) first. Its §0 (never message a customer twice) is a hard invariant.
- **Before any WhatsApp reply-behavior change:** stop, describe the customer-visible effect, and get explicit user approval. Do not edit or deploy first (AGENTS.md §4.2).
- **Deploys are manual.** Committing to `main` ships nothing: the app needs `vercel --prod`, functions need `supabase functions deploy <name>`, migrations are pasted into the Supabase dashboard SQL editor. Always report committed vs deployed status separately.
- **Copy guardrails in anything you write:** PROMUNCH in all caps, no em dashes in customer-facing copy, never mention Oltaflock, tagline "Your Munchy Pal".
- **File hygiene:** new docs go in the right `docs/` subfolder (update `docs/README.md`), superseded material goes to `docs/archive/`, nothing loose at repo root.
