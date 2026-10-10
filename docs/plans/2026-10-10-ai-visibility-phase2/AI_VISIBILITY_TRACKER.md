# AI visibility tracker (Reputation → AI visibility)

Built 10 Oct 2026, in response to the AI visibility audit of the same day: PROMUNCH scored 15/100, was named in 0 of 3 shopping answers and the AI said it had no reliable information about the brand. Phase 1 ([../2026-10-10-ai-visibility-phase1/README.md](../2026-10-10-ai-visibility-phase1/README.md)) fixes our own site and feeds. This tracker measures whether that work, and the phase 2 outreach and content, actually changes what AI assistants tell shoppers.

**Status:** code written, not committed, not deployed, never run against OpenAI or Supabase (no key or database in the build environment). The first manual run after deploy is the live test.

## What it does

Every Monday at 09:05 IST (and when an admin clicks **Run now**) the edge function `ai-visibility-tick` asks an AI assistant every active question in `ai_visibility_prompts`:

- OpenAI Responses API, built-in `web_search` tool, approximate user location India, no system prompt. The model decides when to search, like ChatGPT does for a shopper, so the answer reflects what is on the web that week.
- For each answer it stores the full text, the pages cited (`url_citation` annotations), whether a search actually ran, and token usage with a cost estimate.
- Brands are found by **deterministic string matching** (no model): a fixed list of 37 brands (PROMUNCH, the 19 the audit saw, and 17 snack brands we compete with on soya, namkeen, makhana and chips swaps, like Haldiram's, Too Yumm, Mr. Makhana and Snackible), case-insensitive, word-boundary aware. For us it accepts `PROMUNCH`, `Pro Munch`, `Pro-Munch`, `promunch.in`, `trypromunch.in`, but not `promunchies`. Link targets and bare URLs are ignored (a cited `amazon.in/...muscleblaze...` URL is not the answer naming the brand); link text and bare domains in the prose count. Two names that are also common words (`Dimension`, `Open Secret`) only match when capitalised.
- `promunch_rank` = PROMUNCH's position among the brands found, by first mention (1 = named first).

The dashboard tab shows:

1. **Named in X of Y AI answers**: share of shopping answers (kind `category`) naming PROMUNCH, with a line over the last 12 finished runs. Brand questions are not counted here (they name us by design).
2. **Which questions name us?** One row per shopping question: Named (with position) / Not named / No answer, the brands named in order, and the full answer plus cited pages on tap.
3. **What does AI say about PROMUNCH?** The brand questions, with a heuristic "Knows PROMUNCH / Does not know PROMUNCH" (it looks for phrases like "no reliable information", "could not verify", "not familiar"; the answer is always one tap away).
4. **Who gets named instead?** Shopping answers per brand, top 10 plus PROMUNCH.

Nothing here messages a customer or anyone else.

## Questions (seeded by the migration)

Shopping questions are `<question>. <India suffix>`, where the suffix is the audit's, verbatim: "I am shopping in India and want to buy online in India. Recommend specific brands that actually sell in India — Indian D2C brands and brands available on Indian marketplaces. Do not recommend brands a shopper in India cannot readily buy."

| key | kind | question |
|---|---|---|
| `audit_protein_snacks` | category | best protein snacks to buy online in India (audit) |
| `audit_healthy_snacks` | category | best healthy snacks to buy online in India (audit) |
| `audit_protein_under_499` | category | best protein snacks under ₹499 in India (audit) |
| `audit_brand_check` | brand | A shopper asks you about the brand "PROMUNCH" (promunch.in), which sells in India. What do they sell, and would you recommend buying from them? (audit, no suffix) |
| `soya_snacks`, `protein_namkeen`, `roasted_edamame`, `soya_chips_sticks`, `office_veg_protein`, `healthy_under_299`, `kids_tiffin`, `jain_protein`, `chips_alternative`, `weight_loss_roasted`, `chai_time_protein`, `gym_veg_protein`, `low_cal_crunchy`, `travel_snacks`, `amazon_protein_snacks` | category | niche questions where PROMUNCH can win (soya, namkeen, edamame, office, ₹299, tiffin, Jain, chips swap and so on) |
| `brand_compare` | brand | Is PROMUNCH a good brand for high protein soya snacks in India? How does it compare with other protein snack brands sold online in India? |

20 questions: 18 shopping, 2 brand. The exact wording of the three audit shopping questions was given as fragments, so they are stored as the fragment, a full stop, then the suffix. To change questions: edit rows in `ai_visibility_prompts` (set `active=false` rather than deleting, so history keeps its link). There is no editing UI in v1. Results keep a snapshot of the question text, so editing a prompt never rewrites history.

## Tables

Migration `promunch-email-agent/supabase/migrations/20261010130000_ai_visibility.sql` (idempotent, service-role only: RLS on, no policies, anon/authenticated revoked, same as the ORM tables).

| Table | What |
|---|---|
| `ai_visibility_prompts` | `id, key (unique slug), prompt, kind ('category'/'brand'), topic, active, sort, created_at` |
| `ai_visibility_runs` | one row per run and the **run lock**: `status` `running/done/partial/failed`, unique partial index on `status where status='running'` so a second start fails with 23505. `heartbeat_at` (a running row silent for 10 min is closed as dead), `trigger` cron/manual, `triggered_by`, `model`, `prompt_ids` (the planned list), counts `planned, answered, errors, category_answered, named`, `cost_usd`, `hops`, `error` |
| `ai_visibility_results` | one row per question per run (unique `run_id, prompt_id`): `prompt_text, kind, topic` snapshot, `provider, model, web_search, answer, promunch_named, promunch_rank, brands_named[], citations jsonb [{url,title}], error, input_tokens, output_tokens, search_calls, cost_usd, latency_ms` |

Run status: `done` = every planned question has a row; `partial` = stopped early with some answers (shown with a note); `failed` = no usable answers (left out of the trend).

## Edge function `ai-visibility-tick`

`promunch-email-agent/supabase/functions/ai-visibility-tick/index.ts`, pure helpers in `_shared/ai-visibility.ts`. `verify_jwt = false` + `requireInternal` (config.toml entry added).

- `POST {"trigger":"cron"|"manual","by":email}`: closes dead runs, takes the lock, plans up to `AI_VISIBILITY_MAX_PROMPTS` active questions in `sort` order, answers 200 at once, then works in the background (`EdgeRuntime.waitUntil`). Busy → 409 `{busy:true}`. No `OPENAI_API_KEY` → 500 and a `connector_events` error, no run row.
- Background: `AI_VISIBILITY_CONCURRENCY` calls at a time, 55 s timeout each. Stops starting new questions after 75 s and calls itself with `{"run_id","_continue":true,"hop"}` (at most 8 continuations), so a slow run never hits the edge wall clock.
- A failed answer (HTTP error, web search not available for the model, timeout, empty text) is stored on its row with the error; the run carries on. Partial and failed runs log a `reputation` connector event (throttled).

Request shape (from https://platform.openai.com/docs/guides/tools-web-search, checked 10 Oct 2026):

```json
POST https://api.openai.com/v1/responses
{ "model": "gpt-4.1-mini", "input": "<question>",
  "tools": [{ "type": "web_search", "user_location": { "type": "approximate", "country": "IN" } }],
  "max_output_tokens": 3000, "store": false }
```

Output parsing: `web_search_call` items (count = billed searches), `message.content[].output_text.text`, `annotations[]` of type `url_citation` (`url`, `title`; `utm_source=openai` stripped, de-duplicated, max 20).

## Next.js

| Route | Auth | What |
|---|---|---|
| `GET /api/orm/ai-visibility` | session (area `reputation`) | `{ running, latest, prompts[], competitors[], trend[], active_prompts }`. Math in `src/lib/orm/ai-visibility.ts` (`buildAiVisibilitySummary`). 503 with a plain message when the migration is not applied. |
| `POST /api/orm/ai-visibility/run` | `requireAdmin` | 409 if a run is live, else invokes the edge function with the service-role bearer (same as the ORM "Run now"). |

Both sit under `/api/orm`, already mapped to `reputation` in `src/lib/access.ts`; the tab is `/dashboard/reputation?tab=ai` (same page, nav entry "AI visibility" in `src/components/shell/nav.ts`). The UI polls every 10 s while a run is going.

## Tests

- `src/lib/orm/ai-visibility.test.ts` (vitest): matching vectors, run counts, summary, share of voice, brand recognition heuristic.
- `promunch-email-agent/supabase/functions/_shared/ai-visibility_test.ts` (deno): the same vectors plus request shape, response parsing, cost.
- Shared vectors: `src/lib/orm/ai-visibility-vectors.json`, including the full brand list. The brand list and matching code exist twice (Next and edge); both suites assert the same file, so they cannot drift silently. Change both copies and the vectors together.

## Environment (Supabase function secrets)

| Var | Default | What |
|---|---|---|
| `OPENAI_API_KEY` | (already set) | required |
| `AI_VISIBILITY_MODEL` | `gpt-4.1-mini` | any Responses API model that supports the `web_search` tool. `gpt-5-mini` also works (reasoning, may search more than once) |
| `AI_VISIBILITY_MAX_PROMPTS` | `25` (1 to 50) | hard cap of questions per run |
| `AI_VISIBILITY_CONCURRENCY` | `3` (1 to 6) | parallel OpenAI calls |

## Cost

OpenAI pricing (Oct 2026): web search is $10 per 1,000 calls plus search content tokens; for `gpt-4.1-mini` and `gpt-4o-mini` those are a fixed 8,000 input tokens per search. `gpt-4.1-mini` is $0.40 in / $1.60 out per million tokens.

Per question with one search: $0.01 + 8,300 × $0.40/M + ~700 × $1.60/M ≈ **$0.015**; with two searches ≈ $0.03. **Per run (20 questions): about $0.30 to $0.60. Weekly: about $1.30 to $2.60 a month**, plus any manual runs. Each row stores its own estimate (`cost_usd`), the run stores the sum, and the dashboard shows it. The estimate counts the 8,000-token block only when the reported input tokens are smaller, so it leans high rather than double counting.

## Deploy order

1. Paste `promunch-email-agent/supabase/migrations/20261010130000_ai_visibility.sql` into the SQL editor; run its verify queries (category 18, brand 2; RLS on).
2. `cd promunch-email-agent && supabase functions deploy ai-visibility-tick` (optional: `supabase secrets set AI_VISIBILITY_MODEL=...`).
3. `vercel --prod` (API routes + the AI visibility tab).
4. Paste `promunch-email-agent/supabase/migrations/20261010130100_ai_visibility_tick_cron.sql`; check `select jobname, schedule from cron.job where jobname = 'ai-visibility-tick';`.
5. First manual run: Reputation → AI visibility → **Run now** (admin). Wait 2 to 4 minutes; the page fills in. Check `select status, planned, answered, named, category_answered, cost_usd, error from ai_visibility_runs order by started_at desc limit 1;` and read two or three answers to confirm the brand matching looks right.

If the first run shows "No answer" on every row with an OpenAI 400 about tools, the chosen model does not support `web_search`: set `AI_VISIBILITY_MODEL` to `gpt-4.1-mini` or `gpt-5-mini`.

## Not in v1

- No question editor in the dashboard (edit `ai_visibility_prompts` in SQL).
- One provider (OpenAI). The `provider` column is there for Gemini or Perplexity later.
- One answer per question per run. AI answers vary from run to run; read the trend, not a single week.
