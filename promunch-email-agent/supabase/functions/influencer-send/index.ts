// Influencer creator WhatsApp send (internal only).
//
// POST (service-role bearer, requireInternal):
//   { reminder_id }                         claim + send one existing creator reminder
//   { deal_id, kind, step?, note?, retry?, actor? }
//                                           manual send from the dashboard. kind is one of
//                                           brief_ready | brief_reminder | box_check |
//                                           draft_reminder | draft_overdue | draft_feedback |
//                                           post_reminder | post_fix
//
// Returns { ok, reminder_id?, status?, reason?, error?, wa_message_id?, already_sent?, engine_off? }.
// ok:false + reason:'engine_off' + engine_off:true (HTTP 200) when influencer_settings.engine_enabled is
// false: nothing is created or sent (dashboard shows "copy link instead").
//
// Dedup: a manual send lives in a deterministic influencer_reminders row
// (brief_ready step = brief version, draft_feedback step = draft version,
// post_fix step = fix round, other kinds = once per IST day), claimed with
// claim_influencer_reminder before wa-send is called, so a double click can
// never message the creator twice. All guards: _shared/influencer-send.ts.

import { requireInternal } from "../_shared/require-internal.ts";
import { errStr } from "../_shared/connector-log.ts";
import { loadInfluencerSettings } from "../_shared/influencers.ts";
import { type SendOutcome, sendByReminderId, sendManual } from "../_shared/influencer-send.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return j({ ok: false, error: "bad json" }, 400);
  }

  try {
    const settings = await loadInfluencerSettings();
    const actor = typeof b.actor === "string" ? b.actor.slice(0, 200) : undefined;

    if (typeof b.reminder_id === "string") {
      if (!UUID_RE.test(b.reminder_id)) return j({ ok: false, error: "bad reminder_id" }, 400);
      return reply(await sendByReminderId(b.reminder_id, settings, actor));
    }

    if (typeof b.deal_id === "string" && typeof b.kind === "string") {
      if (!UUID_RE.test(b.deal_id)) return j({ ok: false, error: "bad deal_id" }, 400);
      return reply(
        await sendManual({
          deal_id: b.deal_id,
          kind: b.kind,
          step: typeof b.step === "number" ? b.step : null,
          note: typeof b.note === "string" ? b.note : null,
          retry: b.retry === true,
          actor,
        }, settings),
      );
    }

    return j({ ok: false, error: "reminder_id or (deal_id, kind) required" }, 400);
  } catch (e) {
    console.error("[influencer-send]", errStr(e));
    return j({ ok: false, error: errStr(e) }, 500);
  }
});

// Response contract the app-side callers rely on:
//   engine off     → 200 {ok:false, reason:'engine_off', engine_off:true}
//   already sent   → 200 {ok:true, already_sent:true}
//   any failure    → {ok:false, error:'<message>', reason}
function reply(o: SendOutcome) {
  if (o.reason === "engine_off") return j({ ...o, ok: false, engine_off: true });
  if (!o.ok) return j({ ...o, error: o.error ?? REASON_TEXT[o.reason ?? ""] ?? o.reason ?? "send failed" });
  return j(o);
}

const REASON_TEXT: Record<string, string> = {
  bad_kind: "unknown influencer message kind",
  deal_not_found: "collab not found",
  deal_closed: "collab is closed",
  not_found: "reminder not found",
  not_a_creator_reminder: "reminder is not a creator message",
  not_claimable: "reminder is not scheduled (already handled)",
  claimed_elsewhere: "another send for this message is in progress",
  in_progress: "this message is already being sent",
  failed: "this message failed earlier; pass retry:true to try again",
  cancelled: "this message was cancelled; pass retry:true to try again",
  no_longer_needed: "the creator already completed this step",
  phone_missing: "creator phone missing",
};

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
