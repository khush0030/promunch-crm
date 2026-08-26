# Sarvam voice agent for abandoned-cart recovery — design spec

Date: 2026-08-26. Status: approved design, implementation pending.

## Goal

When WhatsApp cart-recovery fails (no reply, or Meta marketing cap #131049 stands the run down), place one AI voice call (Sarvam Voice Agents, Hinglish) that reminds the customer of their cart, answers questions from Master KB facts, and, if the customer asks, sends the Shopify checkout link (from the checkout NOTE) on WhatsApp mid-call.

## Decisions (user-approved)

| Topic | Decision |
|---|---|
| Trigger | Only after WA fails: no inbound reply within `cart_voice_delay_hours` after WA step 2, or WA run stood down by cap. Never call a customer who already replied or ordered. |
| Telephony | Rent Indian number from Sarvam (KYC in indus.sarvam.ai). |
| Call window | 10:00 to 20:00 IST default, dashboard-editable. Agent starts in Hindi/Hinglish, follows customer language. |
| Link on WhatsApp | New UTILITY template `cart_link_requested` (Meta approval needed). Free text used instead only when a 24h window is open. |
| DND | Agent honours "do not call": `wa_contacts.voice_dnd=true` + push to Sarvam org DND list. WA opted-out contacts skipped. No NCPR scrub in v1. |
| Architecture | Voice is a third step row inside the existing `abandoned_checkout` journey (`wa_journey_runs`), plus a `voice_calls` ledger. |

## Sarvam facts relied on (docs.sarvam.ai, Aug 2026)

- Instant Outbound: `POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds`, header `X-API-Key`. Body: `app_config {app_id, app_version, connection_config {connection_id, agent_phone_number}, agent_variables, app_type:"agent", app_overrides {initial_language_name}}`, `user_config {user_phone_number}`, `webhook_config {url, metadata}`. Response `{attempt_id}`.
- Post-call webhook POST to `webhook_config.url`: `attempt_id`, `status` (connected | no_answer | busy | failed), `duration`, `interaction_id`, `failure_reason`, `final_agent_variables`, `interaction_transcript[{role,en_text}]`, `webhook_config` echoed (our metadata). No signature header documented.
- HTTPS tool: agent calls our URL mid-call, bearer/api_key auth, agent variables via `@var`, timeout up to 30 s, response saved into variables.
- DND: org-wide suppression list in dashboard; compliance is ours.

## Components

### 1. Enrolment (`shopify-wa/index.ts`, `handleCheckout`)

Add a third step to the `steps` array when `flows.voice_call_enabled` and a phone exists:

```
{ template: "voice_cart_call", channel: "voice",
  next_action_at: step2_at + cart_voice_delay_hours,
  context: { channel:"voice", template:"voice_cart_call", name, checkout_url, items:[{title,qty}], total, coupon } }
```

`context.template = "voice_cart_call"` is distinct, so the per-customer partial unique index allows this third live row. Refresh-in-place path updates this row's `context` (new cart) but not its timing, same as WA rows. Deadline = same `deadline_at` as the WA rows.

### 2. Dispatch (`wa-journey-tick/index.ts`)

New branch before `callWaSend`, keyed on `run.context.channel === "voice"`. Existing guards (deadline expiry, open-ticket defer, WA opt-out cancel, order-converted) stay in front of it. Voice-specific eligibility, evaluated in a pure helper `_shared/voice-eligibility.ts` so it is unit-testable:

1. `voice_call_enabled` true, else defer 6h.
2. Cart total >= `voice_min_cart_value`.
3. `wa_contacts.voice_dnd` false and `opted_in` true.
4. No inbound from this `wa_id` since the WA step-1 row was created (customer already engaged on WA → cancel voice row, `status='cancelled'`, `last_error='wa_engaged'`).
5. WA condition: either the WA rows for this customer have `delivered_at` set and no reply, or `tpl_stood_down` / `tpl_cap_attempts >= 2` (cap-blocked). If WA step 2 is still pending and not stood down, defer 1h.
6. Now inside `[voice_call_start_hour, voice_call_end_hour)` IST, else `next_action_at` = next window open.
7. No `voice_calls` row for this `wa_id` with `created_at > now - 7d` (one call per customer per 7 days), and none for this `order_ref` (one call per cart).

Passing all: atomic claim `UPDATE wa_journey_runs SET status='completed' WHERE id=$1 AND status='active'` (existing inline pattern), then insert `voice_calls` row `status='dialing'`, then invoke `voice-call-start`. If `voice-call-start` fails, `voice_calls.status='start_failed'`, run reset to `active` with `next_action_at=+1h`, `attempts+1`; after 3 attempts run `status='failed'` + `logConnector('voice_start_failed')`.

### 3. Edge function `voice-call-start` (internal, `requireInternal`)

Input `{call_id}`. Loads `voice_calls` + run context. Builds Sarvam body:

- `agent_variables`: `customer_name`, `cart_items` ("2x Peri Peri Crunchies, 1x Masala Sticks"), `cart_total` ("Rs 748"), `coupon_code`, `checkout_url`, `call_id`, `phone`.
- `app_overrides.initial_language_name`: `voice_language` setting (default `Hindi`).
- `user_config.user_phone_number`: `+` + `wa_id`.
- `webhook_config`: `url = {SUPABASE_URL}/functions/v1/voice-webhook`, `metadata = {call_id, run_id, wa_id, token: <random 32 hex stored on voice_calls.webhook_token>}`.

Stores `attempt_id`. Secrets: `SARVAM_API_KEY` via `_shared/app-secrets.ts` (rotatable in Settings → API keys, env fallback); `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE` as function secrets.

### 4. Edge function `voice-webhook` (public, `verify_jwt=false`)

No provider signature exists. Verification: `metadata.call_id` must match a `voice_calls` row in `dialing` state whose `webhook_token` equals `metadata.token` (constant-time compare) and whose `attempt_id` equals payload `attempt_id`. Otherwise 401 + `logConnector('voice_webhook_rejected')`. Idempotent: a second delivery for a finished row returns 200 without changes.

On accept, write `status`, `duration_s`, `failure_reason`, `transcript`, `agent_vars = final_agent_variables`, `outcome = final_agent_variables.outcome` (enum set by agent: `will_buy | asked_link | not_interested | do_not_call | callback_later | unknown`). Then:

- `connected`: set the journey run `delivered_at = now()` (honest attribution: counts as `recovered` only if an order follows, existing logic).
- `outcome = do_not_call`: `wa_contacts.voice_dnd = true`; POST number to Sarvam DND list (best effort, logged).
- `no_answer | busy`: one retry: new `voice_calls` row scheduled via run row reset to `active`, `next_action_at = +2h`, `context.voice_attempts = 1`. Second no-answer → run `status='expired'`, `last_error='voice_no_answer'`.
- `failed`: run `status='failed'`, `last_error = failure_reason`, `logConnector`.

### 5. Edge function `voice-tool-wa-link` (HTTPS tool target)

Auth: `Authorization: Bearer {INTERNAL_FN_SECRET}` configured in the Sarvam tool (uses `requireInternal`). Body `{call_id, phone}`. Steps:

1. Load `voice_calls` by `call_id`; phone must match; call must be `dialing`. Else 400 `{ok:false, message:"Could not send the link."}`.
2. Atomic claim `claimSend("voice_link:" + call_id)` (one link per call, ever).
3. If `sessionOpen(wa_contacts.last_inbound_at)`: `wa-send` `kind:"text"` "Hi {name}, here is your PROMUNCH checkout link from our call: {url}". Else `wa-send` template `cart_link_requested` (UTILITY) with vars `{1: name, 2: url}`. Both with `sent_by: "voice:cart_link"`, `journey_run_id`.
4. On success `voice_calls.link_sent_at = now()`; respond `{ok:true, message:"Link sent on WhatsApp"}` which the agent reads back. On Meta failure respond `{ok:false, message:"Could not send right now"}` and release claim.

### 6. Data (migration `promunch-email-agent/supabase/migrations/20260826200000_voice_cart_recovery.sql`)

```
create table voice_calls (
  id uuid pk default gen_random_uuid(),
  run_id uuid references wa_journey_runs(id) on delete set null,
  wa_id text not null, order_ref text, attempt_id text, interaction_id text,
  webhook_token text not null,
  status text not null check (status in ('dialing','connected','no_answer','busy','failed','start_failed','unknown')),
  outcome text, duration_s int, failure_reason text,
  transcript jsonb, agent_vars jsonb, link_sent_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
index (wa_id, created_at desc); index (order_ref); index (status) where status='dialing';
alter table wa_contacts add column voice_dnd boolean not null default false;
alter table wa_flow_settings add column voice_call_enabled boolean not null default false,
  add column cart_voice_delay_hours int not null default 6,
  add column voice_min_cart_value numeric not null default 0,
  add column voice_call_start_hour int not null default 10,
  add column voice_call_end_hour int not null default 20,
  add column voice_language text not null default 'Hindi';
```

`voice_calls` gets the same nightly purge policy as other log tables (transcripts older than 180 days trimmed to `transcript = null`). Sweep in tick: `voice_calls` in `dialing` older than 2h → `status='unknown'`, run left `completed`, no redial.

`wa-template-create`: add `cart_link_requested` (UTILITY, en): "Hi {{1}}, here is the PROMUNCH checkout link you asked for on our call: {{2}}. Your Munchy Pal". No STOP footer (utility).

### 7. Dashboard

- Flows tab (`FlowsView.tsx`): "Voice call rescue" card: enabled toggle, delay hours, min cart value, start/end hour, language select. `PUT /api/whatsapp/flows` gains the six fields with bounds (delay 1..72, hours 0..23 with start < end, min value >= 0, language in Sarvam enum).
- Cart-recovery tile (`/api/whatsapp/cart-recovery`): calls placed, connected, links sent, recovered-after-call.
- Contact 360 (WhatsApp thread side panel): call log list with outcome, duration, expandable transcript. Route `GET /api/whatsapp/voice-calls?wa_id=`.

### 8. Sarvam agent (configured in indus.sarvam.ai by user; prompt drafted in `docs/whatsapp/VOICE_AGENT_SETUP.md`)

Prompt facts come from Master KB: product names, chips and sticks fried / Crunchies roasted, free shipping >= Rs 599 else Rs 99, COD + Rs 50, prepaid 5% off. Brand "PROMUNCH", tagline "Your Munchy Pal", no em dashes, no Oltaflock. States: greet (name, cart) → answer questions → offer WhatsApp link (tool `send_whatsapp_link` → `voice-tool-wa-link`) → close. Must set `outcome` variable before end-call. "Do not call" → set `outcome=do_not_call`, apologise, end call. Max call length 3 min. Setup doc also covers: renting number (KYC), copying org/workspace/app/connection ids, setting function secrets, submitting the UTILITY template.

### 9. Safety and rollout

- Ships with `voice_call_enabled=false`. Nothing dials until toggled.
- Never dial twice for one cart; never more than one call per customer per 7 days; never outside window; never a WA-opted-out or `voice_dnd` contact.
- Live test: enable only for an allowlist env `VOICE_TEST_WA_IDS` first (owner number), full end-to-end (call, ask for link, receive WhatsApp), then remove allowlist.
- Deploy order: migration (SQL editor) → function secrets → deploy `voice-call-start`, `voice-webhook`, `voice-tool-wa-link`, `wa-journey-tick`, `shopify-wa`, `wa-template-create` → submit template → `vercel --prod` → configure Sarvam tool URL → live test → toggle on.

### 10. Tests

- `_shared/voice-eligibility.test.ts`: window math in IST across midnight, each eligibility rule, 7-day and per-cart dedup.
- `voice-webhook` verification: wrong token, wrong attempt_id, replay of finished call.
- App: flows route validation bounds. `npm run test`, `npm run build`, `deno check` on all touched functions.

## Out of scope (v1)

NCPR/TRAI scrub, callbacks scheduling (`callback_later` only recorded), inbound calls, voice for COD confirmation or review asks, Sarvam Campaigns batch API.
