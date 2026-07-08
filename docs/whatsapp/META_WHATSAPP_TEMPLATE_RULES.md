# Meta WhatsApp Template Sending — Rules & Failure Playbook

Single source of truth for how we send WhatsApp template messages (campaigns,
journeys, order confirmations) through the Meta Cloud API, so a launch blast
never fails silently again. Keep this current when Meta changes behaviour.

> **The incident this prevents:** the Edamame Launch broadcast (Jun 24 2026) sent
> 1406 messages, **all failed** with Meta `#132012`, marked the campaign
> `completed`, fired **zero alerts**. Root cause: the campaign sender never built
> the **video header component** the approved template required. See "Component
> rules" below.

---

## 1. The golden rule: components must EXACTLY match the registered template

Meta validates the `components` array you send against the template as it was
**created/approved** in Meta Manager — not against what you feel like sending.
Mismatch → `(#132012) Parameter format does not match format in the created template`
and **every** recipient fails identically.

A template "matches" only when you send, in order:

| Template was created with…        | You MUST send a component…                                   |
|-----------------------------------|--------------------------------------------------------------|
| IMAGE header                      | `{type:"header", parameters:[{type:"image", image:{link}}]}` |
| VIDEO header                      | `{type:"header", parameters:[{type:"video", video:{link}}]}` |
| DOCUMENT header                   | `{type:"header", parameters:[{type:"document", document:{link, filename?}}]}` |
| TEXT header with `{{1}}`          | `{type:"header", parameters:[{type:"text", text}]}`          |
| TEXT header, no variables         | *(send nothing for the header)*                              |
| Body with `{{1}}…{{n}}`           | `{type:"body", parameters:[{type:"text", text}, …]}` — exactly n, in order |
| Body with NO variables            | *(send no body component)*                                   |
| URL button with `{{1}}` in URL    | `{type:"button", sub_type:"url", index:"0", parameters:[{type:"text", text}]}` |
| URL button, fully static URL      | *(send nothing for the button)*                              |
| Quick-reply button (dynamic)      | `{type:"button", sub_type:"quick_reply", index:"i", parameters:[{type:"payload", payload}]}` |

**Edamame_launch** = VIDEO header + static body (no vars) + static URL button →
the *only* required component is the video header. Sending `[]` (what the old
code did for a no-body-var template) = guaranteed `#132012`.

Media is passed by public `link` at **send** time (we host the mp4/jpg in the
`wa-media` Supabase storage bucket). The resumable-upload **handle** is only for
template **creation**; don't confuse the two.

## 2. Where this is implemented (keep both in sync)

- `wa-send/index.ts` — single sends; builds header from `header_image/header_video/header_document`.
- `wa-campaign-send/index.ts` → `buildComponents(tpl, vars, name)` — bulk sends;
  prepends the media header from `tpl.header_type` + `tpl.header_media_url`, then
  the body from numbered vars. **Any new sender must do the same.**

## 3. Pre-flight before any big blast

1. Template `status === 'approved'` in `wa_templates` (the sender already hard-blocks otherwise).
2. If `header_type` is IMAGE/VIDEO/DOCUMENT, `header_media_url` is set and publicly fetchable.
3. Body `{{n}}` count == number of numbered vars supplied.
4. **Send ONE test to your own number first** (via the wa-send path) and confirm
   it arrives — header, body, button all render — before scheduling the audience.

## 4. Meta error codes we actually hit

| Code   | Category       | Meaning / fix |
|--------|----------------|---------------|
| 132012 | template       | Components don't match the created template (header/body/button mismatch). **Fix the component build.** |
| 132000 | template       | Number of body params != template placeholders. |
| 132001 | template       | Template name/language pair doesn't exist or not approved. |
| 131049 | deliverability | Meta marketing-template per-user frequency cap. Expected; throttle/spread sends. Not a bug. |
| 131047 | deliverability | Outside 24h window — must use a template (we do). |
| 131048 / 130429 | rate     | Spam/rate limit — slow down. |
| 190 / 0 / 1    | auth     | Access token expired/invalid — rotate `WHATSAPP_ACCESS_TOKEN`, redeploy. Every send fails until fixed. |
| 1XX 5xx        | system   | Transient on Meta's side; auto-retries. |

Classifier + Slack routing live in `_shared/connector-log.ts` (`explainWaError`,
`alertWaSendFailure`).

## 5. Alerting guarantee (added Jun 27 2026)

`wa-campaign-send` now alerts on failure — previously it wrote `failed` rows to
`wa_messages` and stayed silent. Two layers:

1. **Per-recipient** `alertWaSendFailure()` — throttled to one Slack ping per
   error-code per 5 min, so a wholesale-failing blast pings **once**, not 1406×.
2. **Circuit breaker** — if a batch sends 0 and fails >0, the campaign is set to
   `status='failed'` with `last_error`, the self-chain **stops** (the rest of the
   audience is NOT blasted), and one loud un-throttled alert posts to the WA
   health Slack channel.

Requires secrets `SLACK_BOT_TOKEN` + `WA_HEALTH_CHANNEL_ID` (both set in prod).

## 6. Official references (re-check when behaviour changes)

- Cloud API – send template messages: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
- Template components / media headers: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#template-object
- Error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
- Per-user marketing limits (131049): https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates#per-user-marketing-template-message-limits
