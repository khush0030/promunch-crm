import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { parseDesign } from "@/lib/email-studio/design";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { data, error } = await supabase.from("email_studio_templates").select("*").eq("id", id).maybeSingle();
  if (error) return bad(migrationHint(error.message), 500);
  if (!data) return bad("not found", 404);
  return NextResponse.json({ template: data });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const body = await parseBody<{ name?: string; design?: unknown; subject?: string; preview_text?: string; category?: string }>(req);
  if (!body) return bad("invalid JSON body");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return bad("name cannot be empty");
    patch.name = name;
  }
  if (body.design !== undefined) {
    const d = parseDesign(body.design);
    if (!d) return bad("invalid design");
    patch.design = d;
  }
  if (body.subject !== undefined) patch.subject = String(body.subject).slice(0, 200);
  if (body.preview_text !== undefined) patch.preview_text = String(body.preview_text).slice(0, 300);
  if (body.category !== undefined) patch.category = String(body.category).slice(0, 40);
  const { data, error } = await supabase.from("email_studio_templates").update(patch).eq("id", id).select().maybeSingle();
  if (error) return bad(migrationHint(error.message), 500);
  if (!data) return bad("not found", 404);
  return NextResponse.json({ template: data });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await caller();
  if (isResponse(me)) return me;
  const { id } = await params;
  const { error } = await supabase.from("email_studio_templates").delete().eq("id", id);
  if (error) return bad(migrationHint(error.message), 500);
  return NextResponse.json({ ok: true });
}
