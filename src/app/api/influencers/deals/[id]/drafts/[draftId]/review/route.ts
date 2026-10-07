import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getDeal,
  getSettings,
  invokeInfluencerSend,
  jsonError,
  logEvent,
  readJson,
  requireUser,
} from "@/lib/influencers/db";
import { stagePatch, type TransitionDeal } from "@/lib/influencers/health";
import { UUID_RE, cleanText } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

// Review one draft version: { decision: 'approved' | 'changes_requested', note }.
// The pending -> reviewed flip is a compare-and-set, so a double click or two
// reviewers can only review (and notify) once. The creator is told through
// influencer-send kind draft_feedback, which owns the claim + engine switch.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; draftId: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id, draftId } = await ctx.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(draftId)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const decision = body.decision;
  if (decision !== "approved" && decision !== "changes_requested") {
    return jsonError("decision must be approved or changes_requested");
  }
  const note = cleanText(body.note, 4000);
  if (decision === "changes_requested" && !note) return jsonError("Tell the creator what to change");

  const { data: deal } = await supabaseAdmin.from("influencer_deals").select("*").eq("id", id).maybeSingle();
  if (!deal) return jsonError("not found", 404);
  const { data: draft } = await supabaseAdmin
    .from("influencer_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("deal_id", id)
    .maybeSingle();
  if (!draft) return jsonError("draft not found", 404);
  if (draft.review_status !== "pending") return jsonError(`This draft was already reviewed (${draft.review_status})`, 409);
  if (["completed", "cancelled", "ghosted", "posted"].includes(deal.stage)) {
    return jsonError(`This collab is ${deal.stage}; drafts can't be reviewed now`, 409);
  }

  const nowIso = new Date().toISOString();
  const { data: flipped, error: flipErr } = await supabaseAdmin
    .from("influencer_drafts")
    .update({ review_status: decision, review_note: note, reviewed_by: gate.actor, reviewed_at: nowIso })
    .eq("id", draftId)
    .eq("review_status", "pending")
    .select("*")
    .maybeSingle();
  if (flipErr) return jsonError(flipErr.message, 500);
  if (!flipped) return jsonError("This draft was just reviewed by someone else", 409);

  const settings = await getSettings();
  const toStage = decision === "approved" ? "draft_approved" : "changes_requested";
  const patch: Record<string, unknown> = {
    stage: toStage,
    updated_at: nowIso,
    ...stagePatch(deal as TransitionDeal, toStage, Date.now(), {
      postAfterApprovalDays: settings.default_post_after_approval_days,
    }),
  };
  if (decision === "changes_requested") patch.revision_count = (deal.revision_count ?? 0) + 1;

  const { error: dErr } = await supabaseAdmin.from("influencer_deals").update(patch).eq("id", id);
  if (dErr) return jsonError(dErr.message, 500);

  await logEvent(
    deal.influencer_id,
    id,
    "draft_reviewed",
    "dashboard",
    gate.actor,
    decision === "approved" ? `Draft v${draft.version} approved` : `Changes requested on draft v${draft.version}`,
    { draft_id: draftId, version: draft.version, decision, note, from: deal.stage, to: toStage },
  );

  // Tell the creator. Engine off / not deployed yet is fine: the review stands
  // and the dashboard offers the portal link to share by hand.
  const notify = await invokeInfluencerSend({ deal_id: id, kind: "draft_feedback" });
  if (!notify.ok) {
    console.warn("influencer_draft_feedback_not_sent", { deal_id: id, status: notify.status, data: notify.data });
  }

  return NextResponse.json({ ok: true, draft: flipped, deal: await getDeal(id, settings), notify });
}
