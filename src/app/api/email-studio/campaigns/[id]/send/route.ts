import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { hasBlockers } from "@/lib/email-studio/checks";
import { campaignReadiness } from "@/lib/email-studio/readiness";
import { sendCampaign } from "@/lib/email/campaign-send";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";

// GET  = the Review step: checks, recipient count, approval + test status.
// POST = send now or schedule. Refuses unless every check passes, a test of
//        this exact version was sent, and (if needed) an admin approved.
//        A non-admin's request becomes "waiting for approval" instead.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const r = await campaignReadiness(id);
  if (!r) return bad("not found", 404);
  const { campaign, ...rest } = r;
  return NextResponse.json({
    ...rest,
    status: campaign.status,
    approval_status: campaign.approval_status,
    approved_by: campaign.approved_by,
    scheduled_at: campaign.scheduled_at,
    test_sent_at: campaign.test_sent_at,
    isAdmin: me.admin,
  });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const body = await parseBody<{ when?: "now" | "schedule"; scheduled_at?: string }>(req);
  if (!body) return bad("invalid JSON body");

  let scheduledAt: string | null = null;
  if (body.when === "schedule") {
    const t = Date.parse(String(body.scheduled_at ?? ""));
    if (!Number.isFinite(t)) return bad("Pick a date and time to schedule.");
    if (t < Date.now() + 5 * 60_000) return bad("Schedule at least 5 minutes from now, or send now.");
    if (t > Date.now() + 60 * 86_400_000) return bad("Schedule within the next 60 days.");
    scheduledAt = new Date(t).toISOString();
  }

  const r = await campaignReadiness(id);
  if (!r) return bad("not found", 404);
  const c = r.campaign;
  if (!["draft", "paused"].includes(c.status as string)) return bad("This campaign is already scheduled or sent.", 409);
  if (hasBlockers(r.issues)) return NextResponse.json({ error: "Fix the issues on the Review step first.", issues: r.issues }, { status: 422 });
  if (!r.testIsCurrent) return bad("Send yourself a test of this latest version first.", 409);
  if (r.capBlocker) return bad(r.capBlocker, 403);

  if (r.needsApproval) {
    if (!me.admin) {
      await supabase
        .from("campaigns")
        .update({ approval_status: "pending", scheduled_at: scheduledAt })
        .eq("id", id)
        .in("status", ["draft", "paused"]);
      await recordAudit({
        action: "email_campaign.approval_requested",
        entityType: "campaign",
        entityId: id,
        summary: `Approval requested for "${c.name}" (${r.recipients} recipients)`,
        actor: me.user,
        request: req,
      });
      return NextResponse.json({ pending: true, recipients: r.recipients });
    }
    // An admin sending it is the approval.
    await supabase
      .from("campaigns")
      .update({ approval_status: "approved", approved_by: me.email, approved_at: new Date().toISOString() })
      .eq("id", id);
  }

  if (scheduledAt) {
    const { data, error } = await supabase
      .from("campaigns")
      .update({ status: "scheduled", scheduled_at: scheduledAt })
      .eq("id", id)
      .in("status", ["draft", "paused"])
      .select("id");
    if (error) return bad(error.message, 500);
    if (!data?.length) return bad("This campaign changed status. Refresh and try again.", 409);
    await recordAudit({
      action: "email_campaign.schedule",
      entityType: "campaign",
      entityId: id,
      summary: `Scheduled "${c.name}" for ${scheduledAt} (${r.recipients} recipients)`,
      actor: me.user,
      request: req,
    });
    return NextResponse.json({ scheduled: true, scheduled_at: scheduledAt, recipients: r.recipients });
  }

  await recordAudit({
    action: "email_campaign.send",
    entityType: "campaign",
    entityId: id,
    summary: `Sent "${c.name}" to ${r.recipients} recipients`,
    actor: me.user,
    request: req,
  });
  const result = await sendCampaign(id);
  const { ok, status, ...rest } = result;
  return NextResponse.json(ok ? { sent: true, ...rest } : { error: result.error, ...rest }, { status });
}
