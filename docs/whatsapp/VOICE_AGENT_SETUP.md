# Sarvam voice agent setup — abandoned-cart rescue calls

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

**Placeholders used below** (never invented — fill in from your own dashboard): `<SARVAM_ORG_ID>`, `<SARVAM_WORKSPACE_ID>`, `<SARVAM_APP_ID>`, `<SARVAM_CONNECTION_ID>`, `<SARVAM_AGENT_PHONE>` (e.g. `+9198XXXXXXXX`), `<PROJECT_REF>` (this project's Supabase ref, `hlykspakpewuilttnydm`), `<INTERNAL_FN_SECRET>` (a shared secret you generate — see §5).

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

`INTERNAL_FN_SECRET` gates `voice-call-start` and `voice-tool-wa-link` (`requireInternal`, `_shared/require-internal.ts`). If it is unset, `requireInternal` falls back to accepting `SUPABASE_SERVICE_ROLE_KEY` as the bearer — but that key is also the master key to the database, so do not paste it into a third-party dashboard (Sarvam's tool config, §5). Generate and set a dedicated value instead:

```bash
supabase secrets set INTERNAL_FN_SECRET=$(openssl rand -hex 32)
```

Use that same value as the bearer token in the HTTPS tool config in §5.

## 3. Agent variables (Variables tab)

Create the voice agent ("app") in indus.sarvam.ai, then define its variables.

**Inputs** (type string, default empty): `customer_name`, `cart_items`, `cart_value`, `discount_code`, `checkout_url`, `call_id`, `phone`, `gender`.

These names must match the agent EXACTLY. Sending a variable the agent has not declared is a HARD FAILURE: Sarvam returns `422 Invalid Parameter -- Agent variables {...} not found in agent variables of app <id>` and does not dial (verified live, Aug 27 2026). The `voice_calls` row is recorded `start_failed` with that message in `failure_reason`, and the tick retries up to 3 times before retiring the run. The reverse is harmless: the agent may declare variables we never send. `call_id` is load-bearing: the `send_whatsapp_link` tool passes it back to `voice-tool-wa-link`, which is how that endpoint identifies the live call. `gender` is declared by the agent but always sent empty (we hold no gender data and never guess).

These are populated per call by `voice-call-start` from the journey run's context (`_shared/... `: `customer_name` from the enrolment name, `cart_items` as `"2x Peri Peri Crunchies, 1x Masala Sticks"`, `cart_value` as `"Rs 748"`, `checkout_url` from the Shopify checkout NOTE URL, `call_id`/`phone` for the WhatsApp-link tool).

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
| Auth value | `<INTERNAL_FN_SECRET>` (the value you set in §2 — never the service-role key) |
| Body | `{"call_id":"@call_id","phone":"@phone"}` |
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
2. Set the `SARVAM_*` and `INTERNAL_FN_SECRET` function secrets (§2).
3. `supabase functions deploy voice-call-start voice-webhook voice-tool-wa-link wa-journey-tick shopify-wa wa-template-create` — **in that order**, or at minimum `wa-journey-tick` before `shopify-wa`.
4. Submit `cart_link_requested` to Meta (§6); wait for approval.
5. `vercel --prod`.
6. Configure the Sarvam tool + variables + prompt per §3–§5.
7. Live test, then toggle on.

**Live test:** set `voice_call_enabled=true` (Flows tab), `voice_min_cart_value=0`, and enrol a real cart from the owner's own phone with the WA path disabled (or wait for the WA leg to stand down naturally). Expect a call inside the configured window (`voice_call_start_hour`–`voice_call_end_hour` IST, default 10–20). During the call, ask for the link and confirm it lands on WhatsApp. Afterward check the `voice_calls` row (status, transcript, outcome) and the Contact 360 call log in the WhatsApp thread side panel.

Before the first real rollout to the full audience, `VOICE_TEST_WA_IDS` (an edge function env var, comma-separated wa_ids) restricts dialing to an allowlist — everyone else's voice row just defers 6h. Keep it set to the owner's number through the live test, then unset it.

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
