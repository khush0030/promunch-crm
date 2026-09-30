import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { caller, isResponse, bad } from "@/lib/email-studio/route-helpers";
import { recordAudit } from "@/lib/audit";
import { flowIssues, hasBlockingIssue, sanitizeFlow, type EditableFlow } from "@/lib/email-studio/automations";

// One automation: load, save, switch on/off, delete. Anything that changes
// what real customers receive is admin only: switching on, and editing or
// deleting an automation that is ON. Agents can build and edit drafts.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  const { data } = await supabase
    .from("flows")
    .select("id, name, description, trigger_type, trigger_config, status, steps, updated_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

function asEditable(f: NonNullable<Awaited<ReturnType<typeof load>>>): EditableFlow {
  return {
    name: f.name as string,
    description: (f.description as string | null) ?? "",
    trigger_type: f.trigger_type as string,
    trigger_config: (f.trigger_config ?? {}) as Record<string, unknown>,
    steps: (Array.isArray(f.steps) ? f.steps : []) as EditableFlow["steps"],
  };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const f = await load(id);
  if (!f) return bad("automation not found", 404);
  const { count: live } = await supabase
    .from("flow_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("flow_id", id)
    .eq("status", "active");
  return NextResponse.json({ flow: { id: f.id, status: f.status, updated_at: f.updated_at, ...asEditable(f) }, inProgress: live ?? 0, admin: me.admin });
}

// Save the editor's content. Status is never changed here.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const f = await load(id);
  if (!f) return bad("automation not found", 404);
  const on = f.status === "active";
  if (on && !me.admin) return bad("This automation is on. Only admins can change it. Ask an admin, or pause it first.", 403);

  const clean = sanitizeFlow(await parseBody(req));
  if (typeof clean === "string") return bad(clean);
  if (on && clean.trigger_type !== f.trigger_type) return bad("Pause the automation before changing its trigger.");
  const issues = flowIssues(clean);
  if (on && hasBlockingIssue(issues)) return NextResponse.json({ error: "Fix the issues before saving a live automation.", issues }, { status: 400 });

  const { error } = await supabase
    .from("flows")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message, 500);
  await recordAudit({
    action: "email_studio.flow_save",
    entityType: "flow",
    entityId: id,
    summary: `Automation "${clean.name}" edited${on ? " while on" : ""}`,
    metadata: { steps: clean.steps.length, trigger: clean.trigger_type },
    actor: me.user,
    request: req,
  });
  return NextResponse.json({ ok: true, issues });
}

// Switch on / pause. Admin only; switching on needs a clean check.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  if (!me.admin) return bad("Only admins can switch automations on or off.", 403);

  const { id } = await params;
  const body = (await parseBody<{ status?: string }>(req)) ?? {};
  const status = String(body.status ?? "");
  if (status !== "active" && status !== "paused") return bad("status must be active or paused");

  const f = await load(id);
  if (!f) return bad("automation not found", 404);
  if (status === "active") {
    const issues = flowIssues(asEditable(f));
    if (hasBlockingIssue(issues)) return NextResponse.json({ error: "Fix the issues before switching this on.", issues }, { status: 400 });
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
    summary: `Automation "${f.name}" switched ${status === "active" ? "on" : "off"}`,
    metadata: { status },
    actor: me.user,
    request: req,
  });
  return NextResponse.json({ ok: true, status });
}

// Delete. Never while on (pause first); deleting cancels anyone still in it.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  if (!me.admin) return bad("Only admins can delete automations.", 403);
  const { id } = await params;
  const f = await load(id);
  if (!f) return bad("automation not found", 404);
  if (f.status === "active") return bad("Pause the automation before deleting it.");
  const { error } = await supabase.from("flows").delete().eq("id", id);
  if (error) return bad(error.message, 500);
  await recordAudit({
    action: "email_studio.flow_delete",
    entityType: "flow",
    entityId: id,
    summary: `Automation "${f.name}" deleted`,
    actor: me.user,
    request: req,
  });
  return NextResponse.json({ ok: true });
}
