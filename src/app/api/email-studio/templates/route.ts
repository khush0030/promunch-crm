import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { parseDesign } from "@/lib/email-studio/design";
import { SYSTEM_TEMPLATES, systemTemplate } from "@/lib/email-studio/templates";
import { caller, isResponse, bad, migrationHint } from "@/lib/email-studio/route-helpers";

// Template library: built-in PROMUNCH templates (code) + saved ones (table).
export const dynamic = "force-dynamic";

export async function GET() {
  const system = SYSTEM_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    category: t.category,
    description: t.description,
    subject: t.subject,
    preview_text: t.previewText,
    design: t.build(),
  }));
  const { data, error } = await supabase
    .from("email_studio_templates")
    .select("id, name, category, subject, preview_text, design, created_by, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  return NextResponse.json({
    system,
    saved: data ?? [],
    savedError: error ? migrationHint(error.message) : undefined,
  });
}

/** Save a template: from a design (save-as) or copy a built-in one. */
export async function POST(req: NextRequest) {
  const me = await caller();
  if (isResponse(me)) return me;
  const body = await parseBody<{ name?: string; design?: unknown; subject?: string; preview_text?: string; fromSystem?: string; category?: string }>(req);
  if (!body) return bad("invalid JSON body");

  let design = body.design ? parseDesign(body.design) : null;
  let subject = body.subject ?? "";
  let preview = body.preview_text ?? "";
  if (!design && body.fromSystem) {
    const t = systemTemplate(body.fromSystem);
    if (!t) return bad("unknown template");
    design = t.build();
    subject = subject || t.subject;
    preview = preview || t.previewText;
  }
  if (!design) return bad("design is required");
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return bad("Give the template a name.");

  const { data, error } = await supabase
    .from("email_studio_templates")
    .insert({ name, category: body.category || "custom", subject, preview_text: preview, design, created_by: me.email })
    .select()
    .single();
  if (error) return bad(migrationHint(error.message), 500);
  return NextResponse.json({ template: data }, { status: 201 });
}
