# Marketing Messages (MM Lite) API migration

**Status:** built, flag OFF, not enabled at Meta. Nothing about production send behaviour changes until `WA_MM_LITE_ENABLED` is set.
**Owner files:** `promunch-email-agent/supabase/functions/_shared/whatsapp.ts`, `promunch-email-agent/supabase/functions/wa-send/index.ts`
**Written:** 2026-08-26

---

## 1. Why we want this

84% of our MARKETING-category template sends are refused by Meta with error
**#131049** (per-user marketing frequency cap / "healthy ecosystem" throttle).
That is the single biggest ceiling on the WhatsApp channel, bigger than the
~250/day tier limit.

Meta now runs a second send path specifically for marketing templates: the
**Marketing Messages API**, still widely called **MM Lite**. It takes the same
approved templates and the same request body, on a different endpoint, and Meta
applies its own send-time delivery optimization (timing, per-user eligibility)
before delivering. Meta's own A/B test, cited in its docs, covered
"approximately 12 million delivered marketing messages" in India during
January 2025 and reports more reads and clicks; Meta has signalled Cloud API
marketing sends are being phased out in favour of this endpoint during 2026.

Same billing model, same templates, same webhooks. The migration is a routing
change, not a rebuild.

---

## 2. What was verified against Meta's docs (August 2026)

Sources:

- [Marketing Messages Lite API reference (phone number node)](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/marketing-messages-lite-api)
- [Marketing Messages API overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview)
- [Get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started)
- [WhatsApp error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)

### Verified

| Question | Answer |
|---|---|
| Endpoint + method | `POST /{Version}/{Phone-Number-ID}/marketing_messages` — on the phone-number node, same as `/messages` |
| Body shape | Same as the Cloud API template send: `messaging_product: "whatsapp"`, `recipient_type: "individual"`, `to`, `type: "template"`, `template: { name, language: { code }, components }` |
| MM-Lite-only body fields | Two, both optional: `product_policy` (`"CLOUD_API_FALLBACK"` or `"STRICT"`) and `message_activity_sharing` (boolean) |
| Response shape | `{ messaging_product, contacts: [{ input, wa_id }], messages: [{ id, message_status }] }` |
| Where the wamid is | `messages[0].id` — **the same position as Cloud API**, so `wa_messages.wa_message_id` is populated identically whichever path ran |
| Template category restriction | Marketing templates only. Utility / authentication templates are rejected (#131055, #134100) |
| Delivery status webhooks | **Same `messages` webhook, same format.** MM Lite sends trigger the normal status webhook events; they are only *distinguishable* by extra markers: `conversation.origin.type` and `pricing.category` carry `"marketing_lite"`, and `pricing.pricing_model` is `"PMP"` |
| Error-code family | Meta states explicitly that "MM API for WhatsApp uses the same error codes as Cloud API, with a few additions" |
| MM-Lite-specific error codes | `131055` only marketing templates supported · `134100` non-marketing template type unsupported · `134101` template still syncing, retry within ~10 min · `134102` template unavailable or user ineligible for MM Lite · `1752041` duplicate/pending onboarding request · `131009` invalid parameter values / incomplete ad syncing · `132018` template parameter configuration error |
| Onboarding entry point | Accept the Terms of Service in **App Dashboard → WhatsApp → Quickstart**; prerequisites are an active WABA in an eligible country, an approved marketing template, and a `messages` webhook subscription |

### NOT confirmed — do not treat as fact

1. **Minimum Graph API version.** Meta's pages use a `<API_VERSION>` placeholder
   and never name a floor. Third-party integrator docs (Gupshup, Wati) all use
   **v24.0**. Our Cloud API calls are pinned to **v21.0**. Because of this our
   code takes an independent override, `WA_MM_LITE_GRAPH_VERSION`, so MM Lite
   can be moved to v24.0 without touching every other WhatsApp call.
2. **The exact error returned by a non-onboarded WABA.** Not documented. The
   expected shape is Graph's generic `code: 100` — *"Unsupported post request.
   Object with ID '…' does not exist, cannot be loaded due to missing
   permissions, or does not support this operation."* Our fallback matches on
   that message text plus the documented MM Lite refusal codes; it is a
   best-effort match, not a documented contract.
3. **The WABA eligibility field names.** `marketing_messages_lite_api_status`
   (values `INELIGIBLE` → `ELIGIBLE` → `ONBOARDED`) and
   `marketing_messages_onboarding_status` come from third-party write-ups, not
   from a Meta page we could open. Treat them as a hint for checking status, not
   as verified API surface. Note the reported gotcha: `ELIGIBLE` means the WABA
   is *allowed to onboard*, not that MM Lite is live — only `ONBOARDED` sends.
4. **Precise semantics of `message_activity_sharing`.** Listed as an optional
   boolean; the docs we could reach do not define what it shares. **We omit it
   by default.**
5. **The "~9% higher delivery in India" figure.** Meta's overview page describes
   the India A/B test and says it "drove more reads and clicks" but does not
   publish a percentage on the pages we could open. Do not quote 9% as Meta's
   number.
6. **Whether `product_policy: "CLOUD_API_FALLBACK"` is silent.** Third-party
   reporting says posting to `/marketing_messages` does not guarantee Meta
   routed it through MM Lite rather than quietly falling back to Cloud API. If
   that is true, a status webhook whose `pricing.category` is **not**
   `marketing_lite` is the only way to tell. **We omit `product_policy` by
   default** so our own fallback stays the observable one.

---

## 3. How the code behaves

All of it lives in `sendTemplate()` in `_shared/whatsapp.ts`. The signature and
return type (`SendResult`) are unchanged, so no caller needed editing.

```
sendTemplate(to, name, language, components)
  │
  ├─ WA_MM_LITE_ENABLED not "true"/"1"  ──────────────► POST /messages   (today's behaviour, unchanged)
  │
  ├─ wa_templates.category !== 'marketing' ───────────► POST /messages
  │
  └─ marketing template, flag on ─────────► POST /marketing_messages
                                              ├─ ok                    → SendResult{ send_path: "mm_lite" }
                                              ├─ refusal, enablement   → POST /messages
                                              │  class (see below)        → SendResult{ send_path: "cloud_api",
                                              │                                        mm_lite_fallback: true,
                                              │                                        mm_lite_error: "#… …" }
                                              └─ any other failure     → returned as-is, NO retry
```

**Default-off is a true no-op.** With the secret unset, `sendTemplate()` runs a
single `postMessage()` to `/messages` with exactly the body it always built. No
DB lookup, no extra fetch, no new log line, no new `connector_events` row, and
every MM Lite field on `SendResult` stays `undefined`.

### Marketing detection

`_shared/template-category.ts` owns the one cached `wa_templates` lookup (whole
table, 5-minute in-process TTL, name+language preferred with a name-only
fallback, stale index kept on error). Both consumers ask it and each passes its
own safety direction, because the safe guess is **opposite** for each:

| Caller | `fallback` | Meaning when the category cannot be resolved |
|---|---|---|
| `_shared/marketing-governor.ts` | `true` | assume MARKETING → throttle. Fails CLOSED; also passes a hardcoded `utilityAllowlist` so a `wa_templates` outage can never throttle an order confirmation. |
| `_shared/whatsapp.ts` (MM Lite) | `false` | assume NOT marketing → stay on the proven Cloud API path. MM Lite deliberately passes **no** `marketingAllowlist`: only an authoritative live row may move a send off Cloud API. |

`fallback` is a required argument with no default, so neither direction can be
inherited by accident.

### Fallback rules (never message a customer twice)

We fall back to Cloud API **only** when MM Lite provably created no message:

- HTTP 401 / 403 / 404
- Meta codes `10`, `200` (permission), `131055`, `134100`, `134101`, `134102`,
  `1752041` (MM Lite refusals)
- code `100` whose message names an endpoint/permission problem
  ("does not support this operation", "missing permissions", "unsupported post
  request", "does not exist")

We **never** fall back on:

- any 5xx or a thrown fetch — the outcome is ambiguous and Meta may already have
  queued the message; a retry there is a duplicate risk (AGENTS.md §4.1)
- `#131049` / `#131050` (marketing cap), `#132xxx` (template param mismatch),
  rate limits — these fail identically on Cloud API, so a retry buys nothing

### Observability

`wa-send/index.ts` emits one structured console line per MM-Lite-routed send:

```json
{"evt":"wa_send_path","path":"mm_lite","template":"edamame_launch","ok":true,
 "wa_message_id":"wamid.…","mm_lite_fallback":false,"mm_lite_error":null,"sent_by":"campaign:…"}
```

and, when a fallback happens, one `connector_events` row
(`connector: whatsapp`, `event: mm_lite_fallback`) **throttled to once an
hour** — per-send rows are exactly what caused the August 2026 Disk IO
incident. Failed sends also get `via mm_lite` appended to the Slack alert's
detail line, so a bad rollout does not read as a generic Cloud API failure.

`wa-campaign-send/index.ts` does **not** go through `wa-send` (it calls
`sendTemplate()` directly), so it mirrors the same observability one level up,
**aggregated per batch** rather than per recipient:

```json
{"evt":"wa_send_path","scope":"campaign_batch","campaign_id":"…","campaign":"…",
 "template":"edamame_launch","batch_size":50,"mm_lite_sent":47,"mm_lite_failed":3,
 "cloud_api_sent":0,"cloud_api_failed":0,"fallbacks":0,"sent_by":"campaign"}
```

plus at most one `mm_lite_fallback` `connector_events` row per batch (same
one-per-hour throttle) when MM Lite refused sends and Cloud API carried them.
The same counters ride back in the function's JSON response as `send_paths`,
which is **omitted entirely** while the flag is off so the response shape is
unchanged for callers today.

No new DB column. The wamid is in the per-send console line, so
"MM Lite vs Cloud API delivery rate" is a join of the function logs against
`wa_messages.wa_message_id` / `.status`; the campaign line answers the same
question per wave without a join.

---

## 4. What the user must do in Meta Business Manager

MM Lite is **not** on by default. Do these before setting the secret.

1. Open <https://developers.facebook.com/apps> and select the PROMUNCH WhatsApp app.
2. Go to **WhatsApp → Quickstart** in the left nav and **accept the Marketing
   Messages API Terms of Service**. This is the onboarding gate; there is no
   API call that substitutes for it.
3. Confirm in **Business Manager → WhatsApp Manager** that the WABA is in an
   eligible country (India is) and that the number's quality rating is not
   flagged.
4. Confirm the marketing templates we intend to route (campaign templates, not
   `order_confirmation` / `shipping_update`) are **APPROVED** and their category
   in Meta Manager is **MARKETING**, matching `wa_templates.category` in our DB.
   A category mismatch is what produces #131055 / #134100.
5. Confirm the app is subscribed to the **`messages`** webhook field. It already
   is (that is how delivery statuses reach `wa-webhook`); MM Lite reuses it.
6. Optional status check via Graph Explorer — field names unverified, see §2:
   `GET /{WABA_ID}?fields=marketing_messages_lite_api_status`. Only `ONBOARDED`
   means MM Lite will actually send.

**Wait for onboarding to complete before enabling the flag.** If it has not,
every marketing send will take the MM Lite hop, get refused, and fall back to
Cloud API. Customers still receive their messages, but each send costs an extra
round trip and Slack gets an hourly `mm_lite_fallback` warning.

---

## 5. Setting the secret

From `promunch-email-agent/`:

```bash
supabase secrets set WA_MM_LITE_ENABLED=true

# optional, only if MM Lite rejects our v21.0 pin (see §2, unconfirmed):
supabase secrets set WA_MM_LITE_GRAPH_VERSION=v24.0

# optional, both omitted from the request body unless set:
supabase secrets set WA_MM_LITE_PRODUCT_POLICY=CLOUD_API_FALLBACK
supabase secrets set WA_MM_LITE_ACTIVITY_SHARING=true
```

Then redeploy the send chokepoint so the new code is live:

```bash
supabase functions deploy wa-send
```

Secrets propagate on the next cold start, so no redeploy is needed for later
flag flips, only for the initial code rollout.

---

## 6. Rollout plan

1. **Deploy code with the flag unset.** Verify nothing changed: marketing
   campaign sends still show `#131049` at the usual rate, no `wa_send_path` lines
   in `supabase functions logs wa-send`, no `mm_lite_fallback` events.
2. **Complete Meta onboarding** (§4).
3. **Enable on one small campaign first.** Set the secret, send a campaign to a
   small segment, and confirm in the logs that `path: "mm_lite"` appears and
   `mm_lite_fallback` is `false`. If every send falls back, onboarding is not
   finished — unset the secret and go back to §4.
4. **Live-test to a real number** (AGENTS.md §9: every rollout gets a real send).
   Confirm the message arrives, and that its `wa_messages` row moved
   `sent → delivered` — that proves the status webhook still matches on
   `wa_message_id` through the MM Lite path.
5. **Watch for 3 to 5 days.** Baseline to beat: **~16% delivery on
   marketing-category templates** (84% refused with #131049).

```sql
-- marketing-template delivery rate, by day
select date_trunc('day', m.created_at)::date as day,
       count(*)                                          as attempted,
       count(*) filter (where m.status in ('delivered','read')) as delivered,
       round(100.0 * count(*) filter (where m.status in ('delivered','read')) / nullif(count(*),0), 1) as pct
from wa_messages m
join wa_templates t
  on t.name = m.template_name and t.language = m.template_lang
where m.type = 'template'
  and t.category = 'marketing'
  and m.created_at > now() - interval '30 days'
group by 1
order by 1;
```

Compare the days before the flag flip to the days after. Also check the failure
mix did not simply move sideways:

```sql
select event, count(*)
from connector_events
where connector = 'whatsapp'
  and created_at > now() - interval '7 days'
  and event like 'send_failed:%'
group by 1 order by 2 desc;
```

---

## 7. Rollback

```bash
supabase secrets unset WA_MM_LITE_ENABLED
```

That is the whole rollback. The next cold start routes every marketing template
back through `/messages` exactly as before; no redeploy, no migration, no data
to undo, because nothing MM-Lite-specific was ever persisted. Setting it to
`false` works identically.

If sends look wrong and you cannot wait for a cold start, redeploying `wa-send`
forces one.
