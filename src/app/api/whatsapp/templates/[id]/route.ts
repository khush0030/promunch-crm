import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/api-helpers";

// Only fields the dashboard template editor edits — a raw passthrough would
// let any caller flip Meta-owned columns. Meta owns the real template status
// (the sync/submit flow mirrors it back), so `status` is deliberately absent.
const PATCHABLE = new Set([
  "name", "language", "category", "header_type", "header_text",
  "header_media_url", "body", "footer", "buttons", "variables",
]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await parseBody(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => PATCHABLE.has(k)),
  );
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("wa_templates")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("wa_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAudit({
    action: "wa_template.delete",
    entityType: "wa_template",
    entityId: id,
    summary: `Deleted WhatsApp template ${id}`,
    request: req,
  });
  return NextResponse.json({ ok: true });
}
