# Sarvam voice agent setup — abandoned-cart rescue calls

> **v2 (Oct 1 2026):** calls are now call-first (cart) plus a COD confirmation agent, driven by `voice-tick`. The v1 sections below describe the original WhatsApp-first flow; the "v2" section at the end is the current truth for timing, dispatch and the COD agent. Where they disagree, v2 wins.

Design spec: [docs/plans/2026-08-26-sarvam-voice-cart-recovery-design.md](../plans/2026-08-26-sarvam-voice-cart-recovery-design.md). This doc is the operational setup guide: what to configure in indus.sarvam.ai, what secrets to set, and the deploy order that keeps the feature safely OFF until every piece is live.

**Ships disabled.** `wa_flow_settings.voice_call_enabled` defaults to `false` (migration `20260826200000_voice_cart_recovery.sql`). Nothing dials a customer until that flag is flipped on — see §7 for the hard ordering rule.

Feature shape, one paragraph: when a WhatsApp cart-recovery run fails to land (no reply, or Meta's marketing cap #131049 stands the run down), `wa-journey-tick` places a Sarvam AI voice call through **Instant Outbound** (`voice-call-start`). The call reminds the customer of their cart in Hindi/Hinglish, answers questions from the same facts WhatsApp uses, and can send the checkout link on WhatsApp mid-call via an HTTPS tool (`voice-tool-wa-link`). Sarvam POSTs the outcome to `voice-webhook` when the call ends.

---

## 1. Prereqs: KYC + rent a number

1. Sign in to **indus.sarvam.ai** (Sarvam's voice-agent console).
2. Complete telephony KYC if not already done (required before any number can dial out in India).
3. **Deploy → Phone Numbers → Add Connection → Rent from Sarvam.** Pick an Indian number for the agent to call from.
4. Once the number is live, collect these six values — you'll need every one of them in §2–§5:

| Value | Where to find it |
|---|---|
| `org_id` | Dashboard URL (`.../orgs/<org_id>/...`) or Settings |
| `workspace_id` | Dashboard URL (`.../workspaces/<workspace_id>/...`) or Settings |
| `app_id` | The voice agent ("app") you build in §3–§4 — Settings/Overview once created |
| `app_version` | Starts at `1`; bumps each time you publish a new version of the agent |
| `connection_id` | Deploy → Phone Numbers → the connection you just rented |
| `agent_phone_number` | The rented number itself, E.164 (`+91...`) |

**Placeholders used below** (never invented — fill in from your own dashboard): `<SARVAM_ORG_ID>`, `<SARVAM_WORKSPACE_ID>`, `<SARVAM_APP_ID>`, `<SARVAM_CONNECTION_ID>`, `<SARVAM_AGENT_PHONE>` (e.g. `+9198XXXXXXXX`), `<PROJECT_REF>` (this project's Supabase ref, `hlykspakpewuilttnydm`), `<VOICE_TOOL_SECRET>` (a shared secret you generate for the mid-call tool — see §5).

## 2. Function secrets

Run from `promunch-email-agent/`:

```bash
supabase secrets set \
  SARVAM_ORG_ID=<SARVAM_ORG_ID> \
  SARVAM_WORKSPACE_ID=<SARVAM_WORKSPACE_ID> \
  SARVAM_APP_ID=<SARVAM_APP_ID> \
  SARVAM_APP_VERSION=1 \
  SARVAM_CONNECTION_ID=<SARVAM_CONNECTION_ID> \
  SARVAM_AGENT_PHONE=<SARVAM_AGENT_PHONE>
```

`SARVAM_API_KEY` is read through `getAppSecret()` (`_shared/app-secrets.ts`), the same rotation path as every other provider key: dashboard-saved value first, `Deno.env` fallback. It is **not yet wired into Settings → API keys** (no entry in the Next.js secrets provider list) — for now set it as a plain function secret:

```bash
supabase secrets set SARVAM_API_KEY=<your Sarvam API key>
```

Wiring it into the owner-editable Settings UI is optional follow-up work, not required for this feature to run.

`voice-tool-wa-link` is the ONLY endpoint Sarvam calls, and it has its own dedicated secret, `VOICE_TOOL_SECRET`. Generate and set it:

```bash
supabase secrets set VOICE_TOOL_SECRET=$(openssl rand -hex 24)
```

> **Never set `INTERNAL_FN_SECRET` on this project.** `requireInternal` prefers it over the injected `SUPABASE_SERVICE_ROLE_KEY`, but every function-to-function caller (`wa-journey-tick` -> `wa-send`, `voice-call-start`, the confirmation sweep, the campaign sender) authenticates with that injected key. Setting `INTERNAL_FN_SECRET` would 401 all of them at once and silently stop every outbound message. `voice-tool-wa-link` deliberately does NOT use `requireInternal` for this reason: a third-party tool runner should never hold a credential that opens the rest of the internal surface.

Use that same value as the bearer token in the HTTPS tool config in §5.

## 3. Agent variables (Variables tab)

Create the voice agent ("app") in indus.sarvam.ai, then define its variables.

**Inputs** (type string, default empty): `customer_name`, `cart_items`, `cart_value`, `discount_code`, `gender`, `call_id`.

`call_id` is the only one you must add beyond the agent's own content variables. We deliberately do NOT pass `checkout_url` or `phone`: `voice-tool-wa-link` reads the link and the number straight off the `voice_calls` row, so passing them through the agent would mean two more dashboard variables to keep in sync and a second copy of the customer's number sitting in a third-party transcript. The agent never reads the URL aloud either, since a link spoken over a phone is useless.

These names must match the agent EXACTLY. Sending a variable the agent has not declared is a HARD FAILURE: Sarvam returns `422 Invalid Parameter -- Agent variables {...} not found in agent variables of app <id>` and does not dial (verified live, Aug 27 2026). The `voice_calls` row is recorded `start_failed` with that message in `failure_reason`, and the tick retries up to 3 times before retiring the run. The reverse is harmless: the agent may declare variables we never send. `call_id` is load-bearing: the `send_whatsapp_link` tool passes it back to `voice-tool-wa-link`, which is how that endpoint identifies the live call. `gender` is declared by the agent but always sent empty (we hold no gender data and never guess).

These are populated per call by `voice-call-start` from the journey run's context (`_shared/... `: `customer_name` from the enrolment name, `cart_items` as `"2x Peri Peri Crunchies, 1x Masala Sticks"`, `cart_value` as `"Rs 748"`, `discount_code` from the Flows tab coupon, `call_id` so the WhatsApp-link tool can identify the live call. The checkout link itself comes from the Shopify checkout NOTE and stays server-side, on the `voice_calls` row).

**Output**: `call_disposition` — Enum `will_buy, asked_link, not_interested, do_not_call, callback_later, unknown`. The extraction prompt MUST emit exactly these six values.

Extraction prompt:
```
Classify the customer's final intent. do_not_call if they asked not to be called again. asked_link if they asked for the link on WhatsApp. will_buy if they said they will complete the order. callback_later if they asked to be called another time. not_interested if they declined. Otherwise unknown.
```

`voice-webhook` reads this back as `final_agent_variables.call_disposition` (falling back to `outcome` for older agents); any value outside the enum above is coerced to `unknown` before it reaches the `voice_calls.outcome` column (which has no CHECK constraint on outcome, but the webhook still normalizes defensively).

## 4. System prompt

Paste this verbatim into the agent's system prompt field. It already encodes every PROMUNCH copy rule (all-caps brand name, "Your Munchy Pal" sign-off, no em dashes, never say "Oltaflock") and the same shipping/payment facts WhatsApp and email use — do not paraphrase it.

```
You are Maya from PROMUNCH, a friendly Indian snack brand making high-protein roasted soya snacks. You are calling @customer_name because they left @cart_items (total @cart_value) in their cart on promunch.in. Speak naturally in the customer's language (start in Hindi with easy English words, switch fully to English if they do). Keep the call under 3 minutes.
Goal: help them finish the order. Offer to send the checkout link on WhatsApp; if they say yes, call the send_whatsapp_link tool and confirm "sent, please check WhatsApp". Mention coupon @discount_code only if they hesitate on price.
Facts you may state: PROMUNCH Crunchies are roasted soya; chips and sticks are fried; free shipping on orders of Rs 599 or more, otherwise Rs 99; cash on delivery adds Rs 50; prepaid orders get 5 percent off. If asked anything else, say you will have the team message them on WhatsApp.
If the customer says not to call again, apologise, promise no more calls, and end the call. If they are busy, offer to call later and end politely. Never argue, never mention being an AI unless asked, never use the word Oltaflock. Sign off with "Your Munchy Pal".
```

Any future edit to this prompt is a WhatsApp/customer-reply-behavior change under AGENTS.md §4.2 — get explicit approval before changing what the agent says on a live call, same as the WA bot's KB-grounded replies.

## 5. HTTPS tool: `send_whatsapp_link`

Configure one HTTPS tool on the agent:

| Field | Value |
|---|---|
| Name | `send_whatsapp_link` |
| Method | `POST` |
| URL | `https://<PROJECT_REF>.supabase.co/functions/v1/voice-tool-wa-link` |
| Auth type | Bearer |
| Auth value | `<VOICE_TOOL_SECRET>` (the value you set in §2 — never the service-role key) |
| Body | `{"call_id":"@call_id"}` |
| Timeout | 20 s |
| Fallback message | "I could not send it right now, our team will message you on WhatsApp" |
| Description | "Send the customer their saved cart checkout link on WhatsApp. Use when the customer agrees to receive the link." |

`voice-tool-wa-link` takes an atomic `claimSend("voice_link:" + call_id)` before sending — one link per call, ever, so an agent retry (or a duplicate tool call) can never double-message the customer. It replies `{ok:true/false, message:"..."}`, which is what the agent reads back to the customer, and it never lets a network-level throw escape uncaught (a thrown fetch there would strand the claim for the full call and break the tool's response contract).

## 6. Template submission

The tool falls back to a UTILITY template when there is no open 24h WhatsApp session with the customer. Deploy the template-management function and submit it:

```bash
supabase functions deploy wa-template-create
```

Then from the dashboard Templates tab, submit `cart_link_requested` (UTILITY, English):

> Hi {{1}}, here is the PROMUNCH checkout link you asked for on our call: {{2}}. Your Munchy Pal

No STOP footer — utility templates carry no marketing opt-out language. Wait for Meta to mark it **APPROVED** before relying on it; until then, the link only sends successfully inside an open 24h session (free text).

## 7. Deploy order and live test

**Hard ordering rule.** `wa-journey-tick` must be deployed **before** `shopify-wa`, and `voice_call_enabled` must stay `false` until both are live **and** the migration is applied. `shopify-wa` is what enrols the third (voice) step onto a journey run; the old `wa-journey-tick` code doesn't know how to dispatch a `channel:"voice"` row and will fall through to the WhatsApp branch, sending the customer an extra WA nudge instead of dialing them. Deploying the tick first means any voice row that lands, lands on code that already knows what to do with it.

Full order (spec §9):

1. Paste `20260826200000_voice_cart_recovery.sql` in the Supabase SQL editor. Verify with `bash scripts/check-migrations.sh`.
2. Set the `SARVAM_*` and `VOICE_TOOL_SECRET` function secrets (§2).
3. `supabase functions deploy voice-call-start voice-webhook voice-tool-wa-link wa-journey-tick shopify-wa wa-template-create` — **in that order**, or at minimum `wa-journey-tick` before `shopify-wa`.
4. Submit `cart_link_requested` to Meta (§6); wait for approval.
5. `vercel --prod`.
6. Configure the Sarvam tool + variables + prompt per §3–§5.
7. Live test, then toggle on.

**Live test:** set `voice_call_enabled=true` (Flows tab), `voice_min_cart_value=0`, and enrol a real cart from the owner's own phone with the WA path disabled (or wait for the WA leg to stand down naturally). Expect a call inside the configured window (`voice_call_start_hour`–`voice_call_end_hour` IST, default 10–20). During the call, ask for the link and confirm it lands on WhatsApp. Afterward check the `voice_calls` row (status, transcript, outcome) and the Contact 360 call log in the WhatsApp thread side panel.

Before the first real rollout to the full audience, `VOICE_TEST_WA_IDS` (an edge function env var, comma-separated wa_ids) restricts dialing to an allowlist — everyone else's cart voice row is cancelled (v2) and COD orders are filtered out of the voice pass. Keep it set to the owner's number through the live test, then unset it.

## 8. DND / TRAI note

This feature only respects two suppression lists: our own `wa_contacts.voice_dnd` flag (set the moment a customer says "don't call again," `call_disposition=do_not_call`) and Sarvam's own org-wide DND list (best-effort push from `voice-webhook`; if the push fails it's logged, not silently dropped, but the local `voice_dnd` flag is what actually gates dialing either way). Neither is a substitute for **India's DLT/TRAI regime**: promotional outbound calling formally requires DLT registration and (depending on classification) a 140-series number, which this setup does not implement. Treat `voice_call_enabled` as a controlled, low-volume pilot, not a compliant bulk-calling channel:

- Keep `voice_min_cart_value` conservative (only call for carts worth the compliance exposure).
- Keep the call window narrow and IST-appropriate (default 10:00–20:00).
- Never call a WA-opted-out contact or a `voice_dnd` contact (already enforced in `_shared/voice-eligibility.ts`, but know that this is the only protection in place).
- Revisit before any wide rollout: NCPR/TRAI scrubbing is explicitly out of scope for v1 (see the design spec's "Out of scope" section).

## Known implementation drift from the design spec

Two places where what shipped differs from the original plan — this doc, not the plan, reflects the truth on `main`:

1. **A swept "unknown" call can still be finalised by a late webhook.** The tick sweeps any `voice_calls` row stuck in `dialing` for 6+ hours to `status='unknown'` so it stops blocking the per-cart and 7-day dedup guards (never redialed from there). But `unknown` is not a dead end: `verifyVoiceWebhook` (`_shared/voice-webhook-verify.ts`) still accepts a webhook against a row in `dialing` **or** `unknown` — a "swept" row just means "no webhook arrived yet," and a late Sarvam delivery (including a `do_not_call` outcome that must still set `voice_dnd`) can land and finalise it after the sweep.
2. **The cart-recovery funnel reports two separate voice metrics, not one.** `GET /api/whatsapp/cart-recovery` returns `voice.recovered` (the cart converted, the call connected, and no WA message was ever delivered for that cart — the call is the only channel that reached the customer) and `voice.assistedRecovered` (the cart converted, the call connected, **and** a WA message also delivered — credit is split, not claimed) as distinct fields. This is an honest-attribution choice: there is no reliable "which channel actually gets credit for this order" signal in the schema (the design spec proposed one; on inspection no such timestamp exists — `wa_journey_runs.updated_at` is a generic touch-trigger column, not a dedicated conversion moment, and repurposing it would repeat the exact WA-attribution inflation bug fixed on 2026-07-25), so the funnel reports both numbers side by side instead of collapsing them into one that would overclaim.

## v2: call-first cart + COD confirmation (Oct 1 2026)

Design: [docs/plans/2026-10-01-voice-agent-cart-cod-design.md](../plans/2026-10-01-voice-agent-cart-cod-design.md). Plan: [docs/plans/2026-10-01-voice-agent-cart-cod.md](../plans/2026-10-01-voice-agent-cart-cod.md).

### Two agents

| Agent | Purpose | Secrets |
|---|---|---|
| Cart Recovery Assistant | Calls a few minutes after checkout goes quiet; can send the cart link via `send_whatsapp_link` | `SARVAM_APP_ID`, `SARVAM_APP_VERSION` |
| COD Confirmation | Confirms a pending COD order | `SARVAM_COD_APP_ID`, `SARVAM_COD_APP_VERSION` |

`SARVAM_COD_APP_ID` and `SARVAM_COD_APP_VERSION` are edge function secrets. The Next.js side (voice sync and recording routes) also reads `SARVAM_COD_APP_ID` from Vercel env, so set it in both places.

### Dispatch: `voice-tick` (pg_cron, every minute)

`wa-journey-tick` no longer handles voice rows. `voice-tick` runs three passes:

1. **Cart pass:** dials voice journey rows due about `cart_voice_delay_minutes` after the checkout goes quiet. One real dial per cart, inside the IST window only (outside it, no call and the WA flow continues).
2. **COD pass:** pending COD orders after the confirmation reminder plus `cod_voice_delay_hours`, up to `cod_voice_max_attempts`, `cod_voice_retry_hours` apart. Spacing is enforced inside the atomic claim via `shopify_orders.voice_last_dial_at`, so two ticks can never double-dial.
3. **Reconcile pass:** fetches Sarvam analytics for rows stuck `dialing`. Rows without an `attempt_id` become `unknown` after 30 minutes; anything still `dialing` after 2 hours becomes `unknown`.

Only a definite Sarvam refusal (4xx, or not configured) gives a COD attempt back. 5xx and timeouts count as a used attempt (the call may have gone out).

WA interplay: `wa-journey-tick` refuses to send a WA cart nudge if a cart call reached the customer, and defers while one is dialing. The inbound weave (`window-asks.ts`) applies the same rule.

### COD agent configuration

**Inputs:** `customer_name`, `order_ref`, `order_items`, `order_value`, `call_id`, `gender`. Undeclared variables are a hard 422 (see the v1 §3 note), so declare exactly these.

**Outputs:** `call_disposition` in {`confirmed`, `cancel_requested`, `callback_later`, `unclear`, `do_not_call`}, plus `call_summary`.

**HTTPS tool `cod_confirm`:** POST `https://hlykspakpewuilttnydm.supabase.co/functions/v1/voice-tool-cod`, header `Authorization: Bearer <VOICE_TOOL_SECRET>` (same secret as `voice-tool-wa-link`), body `{call_id, action}` where `action` is `"confirm"` or `"cancel_request"`.

- `confirm` releases the COD fulfillment hold and sets `confirmed_via='voice'`.
- `cancel_request` parks the order as `needs_call`, opens an urgent WA ticket and sends one ops ping. **The agent never cancels an order**; ops decide.

Prompt rules: confirm the order (`{order_items}`, `{order_value}`); call the tool with `confirm` on a yes and `cancel_request` on a cancel; never promise refunds or discounts; product facts only from the Master KB upload; no em dashes.

### Flags

- `voice_call_enabled` (cart) and `cod_voice_enabled` (COD). Both default OFF. COD also requires `cod_gate_enabled`.
- `VOICE_TEST_WA_IDS` (edge env, comma-separated wa_ids) restricts dialing to an allowlist for BOTH cart and COD.
- Timings live in `wa_flow_settings` (Flows tab): `cart_voice_delay_minutes`, `cod_voice_delay_hours`, `cod_voice_max_attempts`, `cod_voice_retry_hours`, `voice_call_start_hour`, `voice_call_end_hour`.

### Deploy order and rollout

Migration FIRST: the Voice tab routes select the new `purpose` column, so deploying Next before the migration breaks them.

1. Apply `20261001120000_voice_cart_cod.sql` (SQL editor); verify columns.
2. Create/update both Sarvam agents; set `SARVAM_COD_APP_ID`, `SARVAM_COD_APP_VERSION` and the new `SARVAM_APP_VERSION`: `supabase secrets set ... --project-ref hlykspakpewuilttnydm`.
3. Deploy in order: `voice-tick voice-tool-cod voice-call-start voice-webhook voice-tool-wa-link wa-jobs-tick`, then `wa-journey-tick wa-ai-reply`, then `shopify-wa`.
4. Apply `20261001120100_voice_tick_cron.sql` AFTER `voice-tick` is deployed; confirm `cron.job_run_details` shows voice-tick 200s.
5. Vercel: deploy from a detached worktree of the pushed commit with `.vercel` copied in (the shared checkout drifts); check `vercel ls promunch-crm`. Set `SARVAM_COD_APP_ID` in Vercel env.
6. Set `VOICE_TEST_WA_IDS` to the owner's number.

### Live test

- **Cart pre-checks (owner phone):** the owner's WhatsApp thread has no open or pending ticket; `wa_contacts.voice_dnd=false` and `opted_in=true`; and there are no active `abandoned_checkout` runs for that wa_id. Cancel leftovers with:
  `update wa_journey_runs set status='cancelled', last_error='manual: live-test reset' where wa_id='<owner wa_id>' and journey_key='abandoned_checkout' and status='active';`
- **Cart, test 1 (UNANSWERED) first:** flip `voice_call_enabled`, abandon a real cart with the owner phone, let the call ring out without answering. Expect: no call answered, and the WA reminder arrives at +1h. Then clear the runs with the SQL above.
- **Cart, test 2 (ANSWERED):** abandon a fresh cart, answer, ask for the link. Expect exactly one link on WhatsApp and the pending WA nudges cancelled. Note `connected_within_7d` blocks further cart calls to the same number for 7 days after an answered call. To see why a run was cancelled or skipped: `select id, status, last_error, next_action_at from wa_journey_runs where wa_id='<owner wa_id>' and journey_key='abandoned_checkout' order by created_at desc;` (`last_error` carries the reason).
- **COD:** do NOT lower `cod_reminder_delay_hours` globally, it affects every real COD order. Instead place a real COD order with the owner phone and backdate it so the call is due: `update shopify_orders set confirmation_sent_at = confirmation_sent_at - interval '8 hours' where shopify_id = <id>;` (6h reminder + 2h voice delay). Answer and say yes: Shopify hold released, `confirmed_via='voice'`. Second order (same backdating), say cancel: order is `needs_call`, an urgent ticket appears, and a REAL ops ping goes to OPS_WA_ID (Narendra). Warn Narendra before this test.
- Unset `VOICE_TEST_WA_IDS` only with owner go-ahead.

### Configured state (Oct 1 2026)

| Agent | Sarvam app id | Committed version in use | Tool |
|---|---|---|---|
| Cart Recovery Assistant - PROMUNCH | `Conversatio-f80ceadc-9535` | 4 (`SARVAM_APP_VERSION=4`) | `send_whatsapp_link` -> `voice-tool-wa-link` |
| COD Confirmation - PROMUNCH | `COD-Confirm-b1eefecd-11d2` | 1 (`SARVAM_COD_APP_VERSION=1`) | `cod_confirm` -> `voice-tool-cod` |

- Both tools authenticate with a Bearer token from the Sarvam workspace secret `PROMUNCH_VOICE_TOOL_SECRET`, which holds the same value as the `VOICE_TOOL_SECRET` function secret (rotated Oct 1). Rotate both together.
- Create or edit these tools with `configure_app_tool` (registry row). `create_api_tool` refuses to attach a secret to a non-allow-listed URL.
- Both tools use `resp_template: {{ message }}`, so the agent speaks the endpoint's own sentence. On a non-2xx response Sarvam does NOT pass `on_failure` to the model; it passes `http status <N>`. Both prompts therefore spell out that any `http status` result means the tool failed and nothing was sent or recorded.
- `SARVAM_COD_APP_ID` is set as an edge secret and in Vercel production env.
- Text tests (`send_chat`) run with empty variables, so the agent may invent order numbers or amounts there. Real calls always carry them (`voice-call-start` fills fallbacks). Tool calls from chat tests send an empty `call_id` and get a harmless 400.
