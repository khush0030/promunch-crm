import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { campaignReadiness } from "@/lib/email-studio/readiness";
import { hasBlockers } from "@/lib/email-studio/checks";
import { sendCampaign } from "@/lib/email/campaign-send";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";

// Admin decision on a campaign waiting for approval. Approve = it goes out
// (now, or at the time the requester picked); reject = back to draft.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  if (!me.admin) return bad("Only an admin can approve campaigns.", 403);
  const { id } = await params;
  const body = await parseBody<{ decision?: "approve" | "reject" }>(req);
  if (body?.decision !== "approve" && body?.decision !== "reject") return bad("decision must be approve or reject");

  const r = await campaignReadiness(id);
  if (!r) return bad("not found", 404);
  const c = r.campaign;
  if (c.approval_status !== "pending") return bad("This campaign is not waiting for approval.", 409);

  if (body.decision === "reject") {
    await supabase.from("campaigns").update({ approval_status: "rejected", scheduled_at: null }).eq("id", id);
    await recordAudit({ action: "email_campaign.reject", entityType: "campaign", entityId: id, summary: `Rejected "${c.name}"`, actor: me.user, request: req });
    return NextResponse.json({ rejected: true });
  }

  if (hasBlockers(r.issues)) return NextResponse.json({ error: "The campaign has unresolved issues.", issues: r.issues }, { status: 422 });
  if (r.capBlocker) return bad(r.capBlocker, 403);

  await supabase
    .from("campaigns")
    .update({ approval_status: "approved", approved_by: me.email, approved_at: new Date().toISOString() })
    .eq("id", id);
  await recordAudit({
    action: "email_campaign.approve",
    entityType: "campaign",
    entityId: id,
    summary: `Approved "${c.name}" (${r.recipients} recipients)`,
    actor: me.user,
    request: req,
  });

  const at = c.scheduled_at ? Date.parse(c.scheduled_at as string) : NaN;
  if (Number.isFinite(at) && at > Date.now() + 60_000) {
    await supabase.from("campaigns").update({ status: "scheduled" }).eq("id", id).in("status", ["draft", "paused"]);
    return NextResponse.json({ approved: true, scheduled: true, scheduled_at: c.scheduled_at });
  }
  const result = await sendCampaign(id);
  const { ok, status, ...rest } = result;
  return NextResponse.json(ok ? { approved: true, sent: true, ...rest } : { error: result.error, ...rest }, { status });
}
