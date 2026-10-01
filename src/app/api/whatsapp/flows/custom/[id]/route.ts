import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCaller, requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { validateCustomFlow } from "../validate";

export const dynamic = "force-dynamic";

// Edit or switch a custom flow: any teammate with the WhatsApp marketing area
// (middleware-enforced). Deleting stays Admin-only (destructive, rbac.ts).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const gate = { user: caller };
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);

  // enabled-only toggle is the common fast path from the flow card
  if (body && typeof body === "object" && Object.keys(body).length === 1 && typeof body.enabled === "boolean") {
    const { data, error } = await supabaseAdmin
      .from("wa_custom_flows")
      .update({ enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: gate.user.email ?? null })
      .eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await recordAudit({
      action: "wa_flows.custom_toggle", entityType: "wa_custom_flow", entityId: id,
      summary: `${body.enabled ? "Enabled" : "Paused"} WhatsApp flow "${data.name}"`,
      request: req, actor: gate.user,
    });
    return NextResponse.json({ flow: data });
  }

  const v = validateCustomFlow(body);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  // A content edit never switches the flow on or off: that only happens via
  // the enabled-only toggle above, so saving an edit can't start sends.
  const { enabled: _ignored, ...content } = v.flow;
  void _ignored;
  const { data, error } = await supabaseAdmin
    .from("wa_custom_flows")
    .update({ ...content, updated_at: new Date().toISOString(), updated_by: gate.user.email ?? null })
    .eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    action: "wa_flows.custom_update", entityType: "wa_custom_flow", entityId: id,
    summary: `Updated WhatsApp flow "${v.flow.name}" (${v.flow.trigger_event}, ${v.flow.steps.length} step(s))`,
    request: req, actor: gate.user,
  });
  return NextResponse.json({ flow: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const { error } = await supabaseAdmin.from("wa_custom_flows").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Retire any messages still queued for this flow — never send for a deleted flow.
  await supabaseAdmin
    .from("wa_journey_runs")
    .update({ status: "cancelled", last_error: "custom flow deleted" })
    .eq("journey_key", `custom:${id}`)
    .eq("status", "active");

  await recordAudit({
    action: "wa_flows.custom_delete", entityType: "wa_custom_flow", entityId: id,
    summary: `Deleted WhatsApp flow ${id} (pending sends cancelled)`,
    request: req, actor: gate.user,
  });
  return NextResponse.json({ ok: true });
}
