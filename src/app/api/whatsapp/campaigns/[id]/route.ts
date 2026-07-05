import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .select("*, template:wa_templates(id,name,language,category,status,body)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

// Only fields the dashboard legitimately edits — a raw passthrough would let
// any caller flip engine-owned columns (send_lock_at, counts, resume_at).
const PATCHABLE = new Set([
  "name", "status", "template_id", "template_vars", "audience_filter",
  "scheduled_at", "repeat_rule", "repeat_until",
]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const patch = Object.fromEntries(
    Object.entries(body ?? {}).filter(([k]) => PATCHABLE.has(k)),
  );
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("wa_campaigns")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
