import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSettings, jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import { sendBriefReady, type InfluencerSendResult } from "@/lib/influencers/brief-server";
import { stagePatch } from "@/lib/influencers/health";
import { isBefore } from "@/lib/influencers/portal-rules";
import type { DealStage } from "@/lib/influencers/types";

export const dynamic = "force-dynamic";

// POST /api/influencers/deals/[id]/brief/[briefId]/send
// Only an APPROVED brief can be sent. Publishing it is a DB transition (the
// portal shows the latest sent version); the WhatsApp ping is delegated to
// edge fn influencer-send {deal_id, kind:'brief_ready'}, which owns the claim
// and the engine_enabled switch. Engine off → still published, response says
// whatsapp:'engine_off' so the UI offers "copy the link instead".
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; briefId: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id, briefId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(briefId)) return jsonError("brief not found", 404);

  const [{ data: brief }, { data: deal }] = await Promise.all([
    supabaseAdmin.from("influencer_briefs").select("*").eq("id", briefId).eq("deal_id", id).maybeSingle(),
    supabaseAdmin
      .from("influencer_deals")
      .select(
        "id, influencer_id, code, stage, draft_due_days, brief_sent_at, brief_acknowledged_at, dispatched_at, delivered_at, draft_submitted_at, draft_approved_at, go_live_at, posted_at, completed_at",
      )
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!brief || !deal) return jsonError("brief not found", 404);
  const stage = deal.stage as DealStage;
  if (stage === "cancelled" || stage === "ghosted" || stage === "completed") {
    return jsonError(`deal is ${stage}`, 409);
  }
  if (brief.status === "sent") {
    // Already published: do not re-trigger WhatsApp from a double click.
    return NextResponse.json({ ok: true, brief, whatsapp: "already_sent", code: deal.code });
  }
  if (brief.status !== "approved") {
    return jsonError(`brief v${brief.version} is ${brief.status}; approve it before sending`, 409);
  }

  const now = new Date().toISOString();
  // Claim: approved → sent (compare-and-set), so two clicks publish + ping once.
  const { data: sent, error: sendErr } = await supabaseAdmin
    .from("influencer_briefs")
    .update({ status: "sent", sent_at: now, acknowledged_at: null })
    .eq("id", briefId)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();
  if (sendErr) return jsonError(sendErr.message, 500);
  if (!sent) return NextResponse.json({ ok: true, brief, whatsapp: "already_sent", code: deal.code });

  // Older sent versions become superseded (the portal shows only the latest).
  await supabaseAdmin
    .from("influencer_briefs")
    .update({ status: "superseded" })
    .eq("deal_id", id)
    .eq("status", "sent")
    .neq("id", briefId);

  const resend = !isBefore(stage, "brief_sent"); // a brief already went out earlier
  // First send: stagePatch moves the stage + stamps brief_sent_at. Every send
  // (incl. a re-send) re-anchors brief_sent_at to now and clears the ack, so
  // the brief_ack nudges and the portal track the version just published.
  const settings = await getSettings();
  const dealPatch: Record<string, unknown> = isBefore(stage, "brief_sent")
    ? {
        ...stagePatch({ ...deal, brief_sent_at: null }, "brief_sent", Date.parse(now), {
          postAfterApprovalDays: settings.default_post_after_approval_days,
        }),
        stage: "brief_sent",
      }
    : {};
  Object.assign(dealPatch, { brief_sent_at: now, brief_acknowledged_at: null, updated_at: now });
  const { error: dealErr } = await supabaseAdmin.from("influencer_deals").update(dealPatch).eq("id", id);
  if (dealErr) return jsonError(dealErr.message, 500);

  await logEvent(
    deal.influencer_id,
    id,
    "brief_sent",
    "dashboard",
    gate.actor,
    `Brief v${brief.version} sent${resend ? " (updated version)" : ""}`,
    { version: brief.version, ...(dealPatch.stage ? { from: stage, to: "brief_sent" } : {}) },
  );

  // Engine off: influencer-send would refuse anyway, so skip the call and let
  // the UI offer "copy the link instead". The brief stays published.
  const wa: InfluencerSendResult = settings.engine_enabled ? await sendBriefReady(id) : { whatsapp: "engine_off", data: {} };
  if (wa.whatsapp === "failed") console.warn("influencer-send brief_ready failed:", wa.error);
  return NextResponse.json({
    ok: true,
    brief: sent,
    code: deal.code,
    whatsapp: wa.whatsapp,
    ...(wa.whatsapp === "failed" ? { whatsapp_error: wa.error } : {}),
  });
}
