import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/api-helpers";
import { callTemplateFn } from "@/lib/whatsapp/template-edge";

// Only fields the dashboard template editor edits — a raw passthrough would
// let any caller flip Meta-owned columns. Meta owns the real template status
// (the sync/submit flow mirrors it back), so `status` is deliberately absent.
const PATCHABLE = new Set([
  "name", "language", "category", "header_type", "header_text",
  "header_media_url", "body", "footer", "buttons", "variables", "header_samples", "needs_media",
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

// Delete a template. If it was ever submitted to Meta, it is deleted AT META
// first (otherwise the next sync would bring it back). If Meta refuses, the
// local row is kept and Meta's reason is returned. Meta blocks reusing a
// deleted name for about 30 days.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: row, error: readErr } = await supabaseAdmin
    .from("wa_templates").select("id, name, language, meta_template_id").eq("id", id).maybeSingle();
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ ok: false, error: "Template not found." }, { status: 404 });

  if (row.meta_template_id) {
    const { status, data } = await callTemplateFn({ action: "delete", name: row.name, language: row.language });
    if (data.ok !== true) {
      return NextResponse.json({ ok: false, ...data }, { status: status >= 400 ? status : 502 });
    }
  } else {
    const { error } = await supabaseAdmin.from("wa_templates").delete().eq("id", id);
    if (error?.code === "23503") {
      return NextResponse.json({
        ok: false,
        error: "A campaign still uses this template. Delete or switch that campaign first.",
      }, { status: 409 });
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  await recordAudit({
    action: "wa_template.delete",
    entityType: "wa_template",
    entityId: id,
    summary: `Deleted WhatsApp template ${row.name} (${row.language})${row.meta_template_id ? " at Meta and locally" : ""}`,
    request: req,
  });
  return NextResponse.json({ ok: true, meta_deleted: !!row.meta_template_id });
}
