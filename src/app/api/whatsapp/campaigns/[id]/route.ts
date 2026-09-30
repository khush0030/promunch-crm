import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/api-helpers";
import {
  basicInputErrors,
  CONTENT_FIELDS,
  contentEditable,
  followupAudienceFilter,
  followupEditable,
  JOURNEY_DUPLICATE_ERROR,
  journeyDuplicateError,
  needsFollowupSql,
  normalizeAudienceFilter,
  parseFollowupInput,
  templateInputErrors,
} from "@/lib/wa-campaigns";
import { warmAudienceError } from "@/lib/wa-warm-guard";
import { campaignTemplateError } from "@/lib/wa-campaign-template-guard";
import {
  armFollowups,
  descendants,
  disarmFollowups,
  followupSqlError,
  journeyMessages,
  TEMPLATE_JOIN,
  templateDefaultMedia,
} from "@/lib/wa-campaign-journeys";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select(TEMPLATE_JOIN)
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

// Only fields the dashboard legitimately edits — a raw passthrough would let
// any caller flip engine-owned columns (send_lock_at, counts, resume_at).
// Lifecycle moves (pause/resume/cancel) have their own routes; PATCH only
// allows the draft <-> scheduled toggle.
const PATCHABLE = new Set([
  "name", "status", "template_id", "template_vars", "audience_filter", "header_media_url",
  "scheduled_at", "repeat_rule", "repeat_until",
]);
const SCHEDULE_FIELDS = new Set(["scheduled_at", "repeat_rule", "repeat_until"]);

// Recipients this campaign has messaged (or is messaging right now).
async function reachedCount(id: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .eq("direction", "outbound")
    .in("status", ["queued", "sent", "delivered", "read"]);
  return error ? null : count ?? 0;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await parseBody<Record<string, unknown>>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([k]) => PATCHABLE.has(k)),
  );
  if (Object.keys(patch).length === 0 && !FOLLOWUP_FIELDS.some((k) => k in body)) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }

  const { data: current, error: curErr } = await supabaseAdmin
    .from("wa_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (current.followup_of) return await patchFollowup(id, current, body);
  if (FOLLOWUP_FIELDS.some((k) => k in body)) {
    return NextResponse.json({ error: "An existing campaign can't be turned into a follow-up. Create a new follow-up instead." }, { status: 400 });
  }

  if ("status" in patch) {
    const to = String(patch.status);
    if (!["draft", "scheduled"].includes(to) || !["draft", "scheduled"].includes(current.status)) {
      return NextResponse.json({
        error: "Use Pause, Resume or Cancel to change a campaign that has started.",
      }, { status: 409 });
    }
  }
  if ([...SCHEDULE_FIELDS].some((k) => k in patch) && !["draft", "scheduled", "paused"].includes(current.status)) {
    return NextResponse.json({ error: `The schedule can't change once the campaign is ${current.status}.` }, { status: 409 });
  }

  if ("repeat_rule" in patch) {
    const rr = patch.repeat_rule;
    if (rr !== null && rr !== "" && !["daily", "weekly", "monthly"].includes(String(rr))) {
      return NextResponse.json({ error: "repeat_rule must be daily, weekly or monthly" }, { status: 400 });
    }
    if (rr === "") patch.repeat_rule = null;
  }
  if ("scheduled_at" in patch && patch.scheduled_at != null && !Number.isFinite(Date.parse(String(patch.scheduled_at)))) {
    return NextResponse.json({ error: "scheduled_at must be a date" }, { status: 400 });
  }

  const touchesContent = CONTENT_FIELDS.some((k) => k in patch);
  if (touchesContent) {
    const reached = await reachedCount(id);
    if (reached == null) return NextResponse.json({ error: "could not check campaign progress" }, { status: 500 });
    if (!contentEditable(current.status, reached)) {
      return NextResponse.json({
        error: reached > 0
          ? `This campaign already went to ${reached} people. Changing the message or audience now would send the rest something different. Cancel it and create a new campaign instead.`
          : `The message and audience can't change while the campaign is ${current.status}. Pause it first.`,
      }, { status: 409 });
    }
    if ("audience_filter" in patch) {
      const aud = normalizeAudienceFilter(patch.audience_filter);
      if (!aud.ok) return NextResponse.json({ error: aud.error }, { status: 400 });
      patch.audience_filter = aud.filter;
      if (needsFollowupSql(aud.filter)) {
        const sqlErr = await followupSqlError();
        if (sqlErr) return NextResponse.json({ error: sqlErr }, { status: 409 });
      }
      const warmErr = await warmAudienceError(aud.filter);
      if (warmErr) return NextResponse.json({ error: warmErr }, { status: 409 });
    }
    if ("header_media_url" in patch) {
      patch.header_media_url = String(patch.header_media_url ?? "").trim() || null;
    }
    const nextVars = ("template_vars" in patch ? patch.template_vars : current.template_vars) as Record<string, unknown> | null;
    const nextMedia = ("header_media_url" in patch ? patch.header_media_url : current.header_media_url) as string | null;
    const basic = basicInputErrors({ template_vars: nextVars ?? {}, header_media_url: nextMedia });
    if (basic.length) return NextResponse.json({ error: basic.join("; "), errors: basic }, { status: 400 });
    // A campaign with follow-ups must not become identical to one of them.
    if ("template_id" in patch || "template_vars" in patch || "header_media_url" in patch) {
      const nextTpl = ("template_id" in patch ? patch.template_id : current.template_id) as string | null;
      try {
        const others = (await journeyMessages(id)).filter((m) => m.id !== id);
        if (others.length) {
          const dupErr = journeyDuplicateError(
            { template_id: nextTpl, template_vars: nextVars ?? {}, header_media_url: nextMedia },
            others,
            await templateDefaultMedia(nextTpl),
          );
          if (dupErr) {
            return NextResponse.json({
              error: "This would make the campaign exactly the same as one of its follow-ups. Change the picture or the text.",
            }, { status: 409 });
          }
        }
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }
    if ("header_media_url" in patch && nextMedia) {
      const tplId = ("template_id" in patch ? patch.template_id : current.template_id) as string | null;
      const { data: tpl } = tplId
        ? await supabaseAdmin.from("wa_templates")
          .select("name,header_type,header_text,header_media_url,body,buttons").eq("id", tplId).maybeSingle()
        : { data: null };
      // only the header rules matter here; body/button values may still be in progress
      const mediaErrs = templateInputErrors(tpl, nextVars ?? {}, nextMedia).filter((e) => /header|media/i.test(e));
      if (mediaErrs.length) return NextResponse.json({ error: mediaErrs.join("; "), errors: mediaErrs }, { status: 400 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .update(patch)
    .eq("id", id)
    .eq("status", current.status) // guarded: a concurrent start/pause wins, this retries
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "The campaign changed state meanwhile. Refresh and try again." }, { status: 409 });
  // Scheduling a campaign arms its draft follow-ups; un-scheduling disarms
  // the ones that never started.
  let followups_armed = 0, followups_disarmed = 0;
  try {
    if (data.status === "scheduled" && current.status === "draft") followups_armed = await armFollowups(id);
    if (data.status === "draft" && current.status === "scheduled") followups_disarmed = await disarmFollowups(id);
  } catch (e) {
    console.error("wa_campaign_followup_arming_failed", { id, error: e instanceof Error ? e.message : String(e) });
  }
  return NextResponse.json({ campaign: data, followups_armed, followups_disarmed });
}

const FOLLOWUP_FIELDS = ["followup_of", "followup_after_hours", "followup_stage"] as const;
const FOLLOWUP_PATCHABLE = new Set([
  "name", "template_id", "template_vars", "header_media_url", "followup_after_hours", "followup_stage",
]);
const LOCK_FRESH_MS = 3 * 60_000;

// PATCH on a follow-up: name any time; message (template / vars / media) and
// timing (followup_after_hours / followup_stage) while it has reached nobody
// and is not finished. audience_filter is always re-derived from the parent +
// timing (a client audience is ignored). Status / schedule are not editable:
// a follow-up's lifecycle comes from its parent (arm) and Pause / Resume /
// Cancel.
async function patchFollowup(id: string, current: Record<string, unknown>, body: Record<string, unknown>) {
  if (["status", "scheduled_at", "repeat_rule", "repeat_until"].some((k) => k in body)) {
    return NextResponse.json({
      error: "A follow-up starts from the campaign it follows. Use Pause, Resume or Cancel to control it.",
    }, { status: 409 });
  }
  if ("followup_of" in body && String(body.followup_of ?? "").toLowerCase() !== String(current.followup_of).toLowerCase()) {
    return NextResponse.json({ error: "A follow-up can't be moved to another campaign. Create a new one instead." }, { status: 400 });
  }
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([k]) => FOLLOWUP_PATCHABLE.has(k)),
  );
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }
  const status = String(current.status);
  const touchesContent = Object.keys(patch).some((k) => k !== "name");
  if (touchesContent) {
    const reached = await reachedCount(id);
    if (reached == null) return NextResponse.json({ error: "could not check campaign progress" }, { status: 500 });
    if (!followupEditable(status, reached)) {
      return NextResponse.json({
        error: reached > 0
          ? `This follow-up already went to ${reached} people, so its message and timing are fixed. Cancel it and add a new follow-up instead.`
          : `This follow-up is ${status}, so it can't be changed.`,
      }, { status: 409 });
    }
    const lockAt = current.send_lock_at ? Date.parse(String(current.send_lock_at)) : NaN;
    if (Number.isFinite(lockAt) && Date.now() - lockAt < LOCK_FRESH_MS) {
      return NextResponse.json({ error: "This follow-up is checking who is due right now. Try again in a minute." }, { status: 409 });
    }
  }

  if ("followup_after_hours" in patch || "followup_stage" in patch) {
    const fu = parseFollowupInput({
      followup_of: current.followup_of,
      followup_after_hours: "followup_after_hours" in patch ? patch.followup_after_hours : current.followup_after_hours,
      followup_stage: "followup_stage" in patch ? patch.followup_stage : current.followup_stage,
    });
    if (!fu.ok) return NextResponse.json({ error: fu.error }, { status: 400 });
    if (!fu.followup) return NextResponse.json({ error: "followup_after_hours and followup_stage can't be cleared" }, { status: 400 });
    patch.followup_after_hours = fu.followup.followup_after_hours;
    patch.followup_stage = fu.followup.followup_stage;
    patch.audience_filter = followupAudienceFilter(fu.followup);
    // re-evaluate soon with the new timing (the old resume_at may be too late)
    if (status === "scheduled" || status === "sending") patch.resume_at = null;
  }

  if ("template_id" in patch) {
    const tplId = String(patch.template_id ?? "");
    if (!tplId) return NextResponse.json({ error: "template_id required" }, { status: 400 });
    const kindErr = await campaignTemplateError(tplId);
    if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });
  }
  if ("header_media_url" in patch) patch.header_media_url = String(patch.header_media_url ?? "").trim() || null;
  const nextVars = ("template_vars" in patch ? patch.template_vars : current.template_vars) as Record<string, unknown> | null;
  const nextMedia = ("header_media_url" in patch ? patch.header_media_url : current.header_media_url) as string | null;
  const basic = basicInputErrors({ template_vars: nextVars ?? {}, header_media_url: nextMedia });
  if (basic.length) return NextResponse.json({ error: basic.join("; "), errors: basic }, { status: 400 });
  // Never the exact same message twice in one journey (same template, blanks
  // and picture). A different picture or text is fine.
  if ("template_id" in patch || "template_vars" in patch || "header_media_url" in patch) {
    const nextTpl = ("template_id" in patch ? patch.template_id : current.template_id) as string | null;
    try {
      const others = (await journeyMessages(id)).filter((m) => m.id !== id);
      const dupErr = journeyDuplicateError(
        { template_id: nextTpl, template_vars: nextVars ?? {}, header_media_url: nextMedia },
        others,
        await templateDefaultMedia(nextTpl),
      );
      if (dupErr) return NextResponse.json({ error: dupErr }, { status: 409 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  // An armed / running follow-up fires unattended: it must stay sendable.
  if (touchesContent && status !== "draft") {
    const tplId = ("template_id" in patch ? patch.template_id : current.template_id) as string | null;
    const { data: tpl } = tplId
      ? await supabaseAdmin.from("wa_templates")
        .select("name,header_type,header_text,header_media_url,body,buttons").eq("id", tplId).maybeSingle()
      : { data: null };
    const errs = templateInputErrors(tpl, nextVars ?? {}, nextMedia);
    if (errs.length) return NextResponse.json({ error: errs.join("; "), errors: errs }, { status: 400 });
  }

  let q = supabaseAdmin
    .from("wa_campaigns")
    .update(patch)
    .eq("id", id)
    .eq("status", status);
  // Message / timing only change while no batch holds the send lock (the
  // engine also re-reads these columns with its lock and skips a batch that
  // started on the old version).
  if (touchesContent) {
    q = q.or(`send_lock_at.is.null,send_lock_at.lt.${new Date(Date.now() - LOCK_FRESH_MS).toISOString()}`);
  }
  const { data, error } = await q.select(TEMPLATE_JOIN).maybeSingle();
  if (error?.code === "23505") return NextResponse.json({ error: JOURNEY_DUPLICATE_ERROR }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "The follow-up changed state meanwhile. Refresh and try again." }, { status: 409 });
  return NextResponse.json({ campaign: data });
}

// Deleting a campaign that has messaged anyone would erase its dedup history
// (wa_messages.campaign_id is ON DELETE SET NULL) and its analytics. Refuse and
// point at Cancel instead.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: current } = await supabaseAdmin.from("wa_campaigns").select("status").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (current.status === "sending") {
    return NextResponse.json({ error: "This campaign is sending. Pause or cancel it first." }, { status: 409 });
  }
  const reached = await reachedCount(id);
  if (reached == null) return NextResponse.json({ error: "could not check campaign progress" }, { status: 500 });
  if (reached > 0) {
    return NextResponse.json({
      error: `This campaign already went to ${reached} people, so it's kept for its history and to make sure nobody gets it twice. Cancel it instead.`,
    }, { status: 409 });
  }
  // Its follow-ups go with it (they can't have sent: they only start after
  // their parent). Refuse if any of them somehow did.
  let followupIds: string[] = [];
  try {
    const ds = await descendants(id, "id,status,followup_of");
    for (const d of ds) {
      if (d.status === "sending") {
        return NextResponse.json({ error: "One of its follow-ups is sending. Cancel the campaign instead." }, { status: 409 });
      }
      const r = await reachedCount(d.id);
      if (r == null) return NextResponse.json({ error: "could not check follow-up progress" }, { status: 500 });
      if (r > 0) {
        return NextResponse.json({
          error: `One of its follow-ups already went to ${r} people, so the journey is kept for its history. Cancel it instead.`,
        }, { status: 409 });
      }
    }
    followupIds = ds.map((d) => d.id).reverse(); // deepest first
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  if (followupIds.length) {
    const { error: fErr } = await supabaseAdmin.from("wa_campaigns").delete().in("id", followupIds);
    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  }
  const { error } = await supabaseAdmin.from("wa_campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAudit({
    action: "wa_campaign.delete",
    entityType: "wa_campaign",
    entityId: id,
    summary: `Deleted WhatsApp campaign ${id}${followupIds.length ? ` and ${followupIds.length} follow-up(s)` : ""}`,
    request: req,
  });
  return NextResponse.json({ ok: true });
}
