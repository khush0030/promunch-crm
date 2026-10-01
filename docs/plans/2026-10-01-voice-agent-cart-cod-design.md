# Voice agent: 15-minute cart call + COD confirmation call

Date: 2026-10-01. Status: design approved by owner, not built.
Supersedes the call *timing* of `docs/plans/2026-08-26-sarvam-voice-cart-recovery-design.md`
(the late "rescue after WhatsApp fails" call). Everything else in that design
(voice_calls ledger, voice-call-start, voice-webhook, voice-tool-wa-link,
voice_dnd, VOICE_TEST_WA_IDS) is reused.

## 1. Goal

Phone the customer with the Sarvam voice agent in two situations, and fold the
result back into the existing WhatsApp and email flows:

1. **Abandoned cart:** call ~15 minutes after the checkout goes quiet without an order.
2. **Unconfirmed COD order:** call when the COD gate's WhatsApp Confirm/Cancel
   buttons and the reminder have both gone unanswered.

Non-goals (v1): calling marketing-campaign non-responders, B2B leads or open
tickets (TRAI unsolicited-commercial-call risk on regular 79xx numbers); inbound
calls; agent cancelling orders itself.

## 2. Customer-visible behaviour

**Cart.** A customer leaves checkout at 15:00. At ~15:15 (IST 10:00-20:00 only)
PROMUNCH's agent calls once.
- Reached (connected and talked >= 20s): if they want it, the agent sends the
  checkout link on WhatsApp during the call (existing `send_whatsapp_link` tool,
  one link per call). Both WhatsApp cart nudges are then cancelled. Cart
  emails continue unchanged.
- Not reached (no answer / busy / failed / < 20s): no retry. The WhatsApp nudges
  (1h, +6h) and cart emails run exactly as today.
- 15-minute mark outside 10:00-20:00 IST, cart below `voice_min_cart_value`,
  opted out, `voice_dnd`, or connected on another cart within 7 days: no call,
  normal WhatsApp + email flow.
- They order before the call: no call (existing `exitFlowsOnCheckout`).

**COD.** Order placed, hold applied, WhatsApp buttons sent; reminder at +6h.
At reminder + `cod_voice_delay_hours` (default 2h, i.e. ~8h after ordering) the
COD agent calls, inside 10:00-20:00 IST, up to `cod_voice_max_attempts` (2),
`cod_voice_retry_hours` (3h) apart.
- "Yes, send it": the agent calls the `cod_confirm` tool, which releases the
  hold exactly like the WhatsApp Confirm button (`confirmed_via='voice'`). No
  WhatsApp message is sent (the agent confirms out loud; the 24h window is
  usually closed anyway).
- "Cancel it": the tool raises an urgent ticket + ops WhatsApp ping (Narendra),
  order moves to `needs_call` with note "Customer asked to cancel on voice call".
  Ops cancels by hand. The agent never cancels.
- Unclear / callback later / no answer after the last attempt: order moves to
  `needs_call` immediately and ops gets the same one-time WhatsApp ping the 24h
  sweep sends (shared `escalateNeedsCall()`, same `cod_needs_call:<ref>` claim).
- Customer taps the WhatsApp button before the call: order is no longer
  `pending`, no call.

Both agents: PROMUNCH all-caps in scripts, answers grounded in the Master KB,
`voice_language` (Hindi default, switches to English on request). Saying "don't
call me" sets `wa_contacts.voice_dnd` and adds the number to Sarvam's DND list.

## 3. Architecture

Extends the existing voice pipeline. One new edge function, one new tool
function, changes to five existing ones.

```
checkouts/create|update ─► shopify-wa ── enrol/refresh voice run (+15m) ──┐
                                                                         ▼
COD order pending ─────────────────────────────────────────────► voice-tick (pg_cron, every minute)
                                                                  │  eligibility + atomic claim
                                                                  ▼
                                                     voice-call-start ─► Sarvam outbound
                                                                  │
               mid-call tools: voice-tool-wa-link (cart) / voice-tool-cod (COD)
                                                                  │
            outcome: voice-webhook  OR  voice-tick reconcile (Sarvam analytics poll)
                                                                  ▼
                              apply outcome: cancel WA nudges / needs_call / dnd
```

### 3.1 `voice-tick` (new, pg_cron every minute)

Why a new tick: `wa-journey-tick` runs every 15 min, so a +15m call could slip
to +30m. Each run does three bounded passes:

1. **Cart calls:** `wa_journey_runs` where `status='active'`,
   `context->>channel='voice'`, `next_action_at <= now()`. Logic moved out of
   `wa-journey-tick` into `_shared/voice-cart.ts` (same claim: active→completed
   conditional update, then `voice_calls` insert, then `voice-call-start`).
2. **COD calls:** `shopify_orders` where `confirmation_status='pending'`,
   `confirmation_sent_at <= now() - (cod_reminder_delay_hours + cod_voice_delay_hours)`,
   `voice_attempts < cod_voice_max_attempts`, and the last COD call for the
   order (if any) is older than `cod_voice_retry_hours` and not `dialing`.
3. **Reconcile:** `voice_calls` with `status='dialing'` older than 5 min →
   fetch the result from Sarvam analytics (logic ported from the Next route
   `api/whatsapp/voice-calls/sync` into `_shared/sarvam.ts`) and finalise via
   the same `finaliseVoiceCall()` the webhook uses. Rows still unresolved after
   2h → `unknown` (treated as not reached).

Batch limit 20 per pass, kill switch via the flags below.

### 3.2 `wa-journey-tick` (change)

Skips `context.channel='voice'` rows entirely (voice-tick owns them), and the
6h stuck-dial sweep moves to voice-tick. `_shared/window-asks.ts` (inbound
weave) also excludes voice rows, otherwise an inbound message could deliver the
voice row as a WhatsApp cart nudge and silently consume the call. Before
sending cart WhatsApp step 1, defers 15 min if a `voice_calls` row for that cart
is `dialing` and younger than 30 min (so a WA nudge never lands while the call
outcome is unknown).

### 3.3 `shopify-wa` (change)

When `voice_call_enabled`: enrol the voice run with
`next_action_at = checkout.updated_at + cart_voice_delay_minutes`. On
`checkouts/update` for an active voice run, push `next_action_at` forward
(abandoned = 15 min of no checkout activity). Existing per-customer unique index
on `template='voice_cart_call'` still prevents a second voice run per cart.

### 3.4 Eligibility (`_shared/voice-eligibility.ts`)

Cart (call-first mode): drop the `waPending` defer; outside call window →
**cancel** (not defer); `CART_ATTEMPT_CAP` = 1. Other checks unchanged
(dnd, opted-in, inbound since enrol, min value, 7-day connected fatigue).

New pure `codVoiceEligibility()`: enabled, still `pending`, not dnd, attempts
left, in window (outside → defer to next window open), not dialing already.

### 3.5 Starting calls (`voice-call-start`, change)

Accepts `purpose`. Picks agent by purpose:
`SARVAM_APP_ID`/`SARVAM_APP_VERSION` (cart) vs `SARVAM_COD_APP_ID`/
`SARVAM_COD_APP_VERSION`. COD agent vars: name, order ref, items, total,
delivery city.

### 3.6 Mid-call tool `voice-tool-cod` (new)

Same auth as `voice-tool-wa-link` (`VOICE_TOOL_SECRET` bearer, call must be
`dialing`, purpose `cod_confirm`). Body `{call_id, action: "confirm"|"cancel_request"}`.
- `confirm` → shared COD-gate confirm handler (idempotent on status; no-op if
  already confirmed/cancelled).
- `cancel_request` → existing explicit-cancel path (urgent ticket + ops WA ping),
  `confirmation_status='needs_call'`. One action per call (`voice_calls.tool_action`
  set once via conditional update).

### 3.7 Outcomes (`voice-webhook` + reconcile, change)

`finaliseVoiceCall(call, result)` in `_shared/voice-outcome.ts`, called from both:
- `reached = status='connected' && duration_s >= 20`.
- Cart + reached → cancel the cart's active WA journey runs
  (`last_error='voice: reached on call'`).
- COD + not confirmed by tool + (last attempt or reached without a decision) →
  `needs_call`.
- `do_not_call` → `voice_dnd` + Sarvam DND (existing).
- Idempotent: only acts when moving the row out of `dialing`.

### 3.8 One timeline (integration with WhatsApp + email)

- WhatsApp inbox thread shows each call as a system entry ("📞 Call, 2m 10s,
  link sent" / "📞 Call, no answer"), read from `voice_calls` by `wa_id`.
- Contact timeline shows the same.
- Voice tab (`VoiceView.tsx`) gains a purpose filter (Cart / COD) and COD
  outcome chips. COD "Needs call" queue shows the last call outcome + transcript link.
- Flows tab: new settings fields (section 4).

## 4. Data model (migration, applied by hand)

```sql
alter table voice_calls
  add column purpose text not null default 'cart' check (purpose in ('cart','cod_confirm')),
  add column attempt_no int not null default 1,
  add column tool_action text,            -- 'confirm' | 'cancel_request' (COD; cart uses link_sent_at)
  add column shopify_id bigint;           -- COD calls: the order being confirmed
create unique index voice_calls_cod_attempt_uq
  on voice_calls (order_ref, attempt_no) where purpose = 'cod_confirm';

alter table shopify_orders
  add column voice_attempts int not null default 0;  -- row-level claim counter
-- confirmed_via gains 'voice'
alter table shopify_orders drop constraint if exists shopify_orders_confirmed_via_check;
alter table shopify_orders add constraint shopify_orders_confirmed_via_check
  check (confirmed_via in ('button','manual','voice'));

alter table wa_flow_settings
  add column cart_voice_delay_minutes numeric not null default 15 check (cart_voice_delay_minutes >= 5),
  add column cod_voice_enabled boolean not null default false,
  add column cod_voice_delay_hours numeric not null default 2 check (cod_voice_delay_hours > 0),
  add column cod_voice_max_attempts int not null default 2 check (cod_voice_max_attempts between 1 and 3),
  add column cod_voice_retry_hours numeric not null default 3 check (cod_voice_retry_hours > 0);
```

`cart_voice_delay_hours` becomes unused (left in place, removed later).
`FLOW_DEFAULTS` in `_shared/flow-settings.ts` and `api/whatsapp/flows/route.ts`
mirror the new columns.

## 5. Never-call-twice guarantees

- Cart: one voice run per cart (existing partial unique index) + active→completed
  claim + attempt cap 1.
- COD: conditional `update shopify_orders set voice_attempts = n+1 ... where
  voice_attempts = n and confirmation_status = 'pending'` (row-level claim), then
  the unique `(order_ref, attempt_no)` index on `voice_calls` as a DB backstop.
- Tools: one link per call (existing `claimSend`), one COD action per call.
- No customer WhatsApp message is added by this feature except the existing
  mid-call link send (already claimed). Ops pings reuse the `cod_needs_call` claim.

## 6. Failure handling

- Sarvam start fails: cart → run marked failed, WA flow continues untouched
  (no call ≠ no recovery). COD → attempt not consumed if Sarvam never accepted
  (existing start_failed rule), 3 strikes then `needs_call`.
- Webhook never arrives (known live issue): reconcile pass in voice-tick.
- `SARVAM_*` / `SARVAM_COD_*` secrets missing: defer + throttled connector alert,
  nothing dials.
- Tool call after the call ended: rejected (row no longer `dialing`).

## 7. Rollout

1. Apply migration. 2. Deploy `voice-tick`, `voice-tool-cod`, `voice-call-start`,
`voice-webhook`, `wa-jobs-tick` (shared escalateNeedsCall), then
`wa-journey-tick` + `wa-ai-reply` (window-asks), then `shopify-wa` — voice-tick before
wa-journey-tick so voice rows are never orphaned. 3. Schedule `voice-tick` in
pg_cron (+ canonical cron file + CRON_TOPOLOGY.md). 4. Vercel deploy
(Flows fields, inbox entries, Voice tab). 5. Sarvam: update cart agent, build
COD agent + `cod_confirm` tool, commit versions, set secrets. 6. Live test with
`VOICE_TEST_WA_IDS` = owner's number: abandon a real cart, place a real COD
order, confirm both paths + no-answer path. 7. Flip `voice_call_enabled`, then
`cod_voice_enabled` separately.

Owner prerequisites: Sarvam KYC / outbound allowed on +917965480035 or
+917965853398, `SARVAM_*` secrets (org, workspace, connection, agent phone),
`VOICE_TOOL_SECRET`, and the Supabase CLI login (deploys 403'd since Jul 28).

## 8. Testing

- Unit (vitest/deno): `voiceEligibility` call-first rules, `codVoiceEligibility`,
  `decideOutcomeEffects` (reached threshold, cancel WA runs, needs_call
  transitions), COD due-time formula, IST window edges.
- `deno check` every touched function; `npm run build/test/lint`;
  `access.test.ts` for any new route.
- Live tests in section 7 step 6 before either flag goes on.
