import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/api-helpers";
import {
  basicInputErrors,
  CONTENT_FIELDS,
  contentEditable,
  normalizeAudienceFilter,
  templateInputErrors,
} from "@/lib/wa-campaigns";
import { warmAudienceError } from "@/lib/wa-warm-guard";

const TEMPLATE_JOIN =
  "*, template:wa_templates(id,name,language,category,status,body,header_type,header_text,header_media_url,buttons)";

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
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }

  const { data: current, error: curErr } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id,status,template_id,template_vars,header_media_url")
    .eq("id", id)
    .maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

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
  const { error } = await supabaseAdmin.from("wa_campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAudit({
    action: "wa_campaign.delete",
    entityType: "wa_campaign",
    entityId: id,
    summary: `Deleted WhatsApp campaign ${id}`,
    request: req,
  });
  return NextResponse.json({ ok: true });
}
