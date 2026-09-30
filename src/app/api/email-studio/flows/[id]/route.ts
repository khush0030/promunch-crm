import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";

// Turn an automation on or off. Admin only: switching a flow on starts real
// customer email. Pausing keeps enrolments (the engine defers them) so
// switching back on resumes where people were.
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await caller();
  if (isResponse(me)) return me;
  if (!me.admin) return bad("Only admins can switch automations on or off.", 403);

  const { id } = await params;
  const body = (await parseBody<{ status?: string }>(req)) ?? {};
  const status = String(body.status ?? "");
  if (status !== "active" && status !== "paused") return bad("status must be active or paused");

  const { data: flow } = await supabase.from("flows").select("id, name, steps").eq("id", id).maybeSingle();
  if (!flow) return bad("flow not found", 404);
  if (status === "active" && (!Array.isArray(flow.steps) || flow.steps.length === 0)) {
    return bad("This automation has no emails yet.");
  }

  const { error } = await supabase
    .from("flows")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message, 500);
  await recordAudit({
    action: "email_studio.flow_status",
    entityType: "flow",
    entityId: id,
    summary: `Automation "${flow.name}" switched ${status === "active" ? "on" : "off"}`,
    metadata: { status },
    actor: me.user,
    request: req,
  });
  return NextResponse.json({ ok: true, status });
}
