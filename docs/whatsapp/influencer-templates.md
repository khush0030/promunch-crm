# Influencer WhatsApp templates (UTILITY)

Creator-facing WhatsApp templates for the influencer delivery tracker
(build spec: [../plans/2026-10-07-influencer-build-spec.md](../plans/2026-10-07-influencer-build-spec.md)).
They are sent only by the `influencer-send` logic through `wa-send` (never Meta
directly). **All 8 must be APPROVED at Meta before `influencer_settings.engine_enabled`
is switched on.** Until a template is approved, `influencer-send` refuses to call
Meta for it: it reads `wa_templates.status`, records "template not approved" on
the reminder, and retries with backoff.

Machine-readable seed (shape accepted by `wa-template-create`'s `{ template }` mode):
`promunch-email-agent/supabase/functions/_shared/influencer-templates.json`.
Every entry passes `_shared/template-rules.ts` `validateCore`.

## Why these should classify as UTILITY

- Each one is about a collab the creator **already agreed to** (brief, box, draft, post).
  Meta treats a message tied to an existing agreement or transaction as utility.
- No offers, prices, discounts, "shop now", product promotion or calls to buy.
- PROMUNCH in caps, no em dashes, warm and short. Footer `Your Munchy Pal`.
  UTILITY footers get no STOP notice (`finalFooter`).
- One URL button per template. The **link** is the creator's private collab page,
  `https://collab.promunch.in/{{1}}`, and `{{1}}` is the deal code.

If Meta re-categorises any of these as MARKETING, do not resubmit with promo-free
copy tweaks in a loop. Read [TEMPLATE_CATEGORY_AUDIT.md](TEMPLATE_CATEGORY_AUDIT.md) first.

## Variable contracts (must match `_shared/influencers.ts` `TEMPLATES`)

| Template | Body {{1}} | Body {{2}} | Button {{1}} | Sent when |
|---|---|---|---|---|
| `influencer_brief_ready` | first name | none | deal code | Team sends an approved brief (manual, step = brief version) |
| `influencer_brief_reminder` | first name | none | deal code | Brief not acknowledged: +24h, +48h after brief sent |
| `influencer_box_check` | first name | dispatch date ("12 Oct") | deal code | Box not confirmed: dispatch +4d, +6d (10:00 IST) |
| `influencer_draft_reminder` | first name | draft due date | deal code | Due date -2d and due day (10:00 IST) |
| `influencer_draft_overdue` | first name | draft due date | deal code | Due date +1d, +3d (10:00 IST) |
| `influencer_draft_feedback` | first name | review outcome sentence | deal code | Team reviews a draft (manual, step = draft version) |
| `influencer_post_reminder` | first name | go-live date | deal code | Go-live -1d (10:00 IST) |
| `influencer_post_fix` | first name | what to fix (team note) | deal code | Team flags a fix on a live post (manual, step = fix round) |

`influencer_draft_feedback` {{2}} values: `your draft is approved, please post it on 25 Oct`,
`your draft is approved and ready to post` (no go-live date), or
`we have a few small changes for you`. The template adds the full stop.

Offsets come from `influencer_settings.nudges` and are editable in the dashboard.

## Copy

### influencer_brief_ready
```
Hi {{1}}, your PROMUNCH collab brief is ready. It has the concept, the key points to cover and your dates.

Please read it and tap "I'm in" on your collab page so we can ship your box.
```
Footer: `Your Munchy Pal` · Button: **Open my brief** → `https://collab.promunch.in/{{1}}`
Samples: `Priya` · button `https://collab.promunch.in/k7Qm2xPa9LtZ`

### influencer_brief_reminder
```
Hi {{1}}, a quick reminder that your PROMUNCH collab brief is waiting for you.

Once you confirm it on your collab page, we will pack and ship your box.
```
Button: **Open my brief** · Samples: `Priya`

### influencer_box_check
```
Hi {{1}}, your PROMUNCH collab box was shipped on {{2}}. Has it reached you?

Please tap "My box arrived" on your collab page so we can confirm your draft date.
```
Button: **Open collab page** · Samples: `Priya`, `12 Oct`

### influencer_draft_reminder
```
Hi {{1}}, a reminder that your PROMUNCH collab draft is due on {{2}}.

You can share a link or upload the video on your collab page.
```
Button: **Submit my draft** · Samples: `Priya`, `22 Oct`

### influencer_draft_overdue
```
Hi {{1}}, your PROMUNCH collab draft was due on {{2}} and we have not received it yet.

If you need a little more time, just reply here and let us know. You can submit it on your collab page.
```
Button: **Submit my draft** · Samples: `Priya`, `22 Oct`

### influencer_draft_feedback
```
Hi {{1}}, we have reviewed your PROMUNCH collab draft. Update: {{2}}.

The full notes and next steps are on your collab page.
```
Button: **See feedback** · Samples: `Priya`, `your draft is approved, please post it on 25 Oct`

### influencer_post_reminder
```
Hi {{1}}, your approved PROMUNCH collab video is scheduled to go live on {{2}}.

Once it is posted, please add the post link on your collab page.
```
Button: **Add post link** · Samples: `Priya`, `25 Oct`

### influencer_post_fix
```
Hi {{1}}, thanks for posting your PROMUNCH collab. One detail needs a small fix: {{2}}.

The details are on your collab page.
```
Button: **Open collab page** · Samples: `Priya`, `please tag @promunch.snacks in the caption`

## Submitting

For each entry in the JSON seed, POST to `wa-template-create` with the service-role bearer:

```bash
# from promunch-email-agent/, one template at a time
jq -c '.[]' supabase/functions/_shared/influencer-templates.json | while read -r t; do
  curl -s -X POST "https://wlungshkwfuggtbantkb.supabase.co/functions/v1/wa-template-create" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"template\": $t}"; echo
done
```

Or paste each into the dashboard template builder (category Utility). The 15-minute
template sync mirrors Meta's verdict into `wa_templates`. Then send ONE test of each to
the owner's number before you enable the engine (META_WHATSAPP_TEMPLATE_RULES.md §3).

**Portal domain:** the button base URL is fixed when Meta approves the template. Since
Oct 8 2026 it is `https://collab.promunch.in/{{1}}` (creator-only host; the Next
middleware rewrites `/<code>` to `/c/<code>` and serves nothing else there, see
`src/lib/collab-host.ts`). Edge `portalUrl()` reads `COLLAB_PORTAL_URL` (default
`https://collab.promunch.in`). Changing the host again means editing and re-approving
all 8 templates. Old `https://promunch-crm.vercel.app/c/<code>` links keep working.
The code sends only the deal code as the button parameter.

## Owner messages (not in this set)

Escalations and the daily digest go to the owner. The owner number comes from
`influencer_settings.owner_wa_id`, then `OWNER_WA_ID`, then `ESCALATION_WA_ID`.
They use the existing approved internal `ops_ticket_alert` template, the same one
support ticket pings use, so they arrive even when the owner's 24h window is closed.
