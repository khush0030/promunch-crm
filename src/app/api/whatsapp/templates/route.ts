import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || "";
  const status = searchParams.get("status") || "";

  let q = supabaseAdmin.from("wa_templates").select("*").order("updated_at", { ascending: false });
  if (category) q = q.eq("category", category);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

// Save a LOCAL DRAFT (never touches Meta). Rules that keep submitted
// templates safe:
//  - A draft can never overwrite a row that has been submitted to Meta
//    (pending / approved / rejected / paused): that used to flip approved
//    templates to 'draft' and drop them out of the campaign picker. Edits to
//    submitted templates go through "Edit & resubmit" (submit route, mode edit).
//  - Body samples live in `variables` ([{name, sample}]); header samples in
//    `header_samples` (migration 20260929110000; retried without it if the
//    column is not there yet).
export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  for (const k of ["name", "category"]) {
    if (!body[k]) return NextResponse.json({ error: `${k === "name" ? "A name" : "A category"} is needed to save a draft.` }, { status: 400 });
  }
  const name = String(body.name);
  const language = String(body.language ?? "en");
  const id = typeof body.id === "string" ? body.id : null;

  const { data: clash, error: clashErr } = await supabaseAdmin
    .from("wa_templates").select("id, status, meta_template_id").eq("name", name).eq("language", language).maybeSingle();
  if (clashErr) return NextResponse.json({ error: clashErr.message }, { status: 500 });
  if (clash && (clash.status !== "draft" || clash.meta_template_id)) {
    return NextResponse.json({
      error: "A template with this name has already been sent to Meta, so it can't be saved as a draft. Use Edit & resubmit on it, or Duplicate as new version.",
    }, { status: 409 });
  }
  if (clash && id && clash.id !== id) {
    return NextResponse.json({ error: "Another draft already uses this name. Pick a different name." }, { status: 409 });
  }
  if (id) {
    const { data: self } = await supabaseAdmin.from("wa_templates").select("status, meta_template_id").eq("id", id).maybeSingle();
    if (self && (self.status !== "draft" || self.meta_template_id)) {
      return NextResponse.json({
        error: "This template has been sent to Meta, so changes must go through Edit & resubmit.",
      }, { status: 409 });
    }
  }

  const row: Record<string, unknown> = {
    name,
    language,
    category: body.category,
    status: "draft",
    header_type: body.header_type ?? null,
    header_text: body.header_text ?? null,
    header_media_url: body.header_media_url ?? null,
    body: body.body ?? "",
    footer: body.footer ?? null,
    buttons: body.buttons ?? null,
    variables: body.variables ?? null,
    header_samples: body.header_samples ?? null,
  };

  const write = (r: Record<string, unknown>) => {
    const target = id ?? clash?.id ?? null;
    return target
      ? supabaseAdmin.from("wa_templates").update(r).eq("id", target).select("*").single()
      : supabaseAdmin.from("wa_templates").insert(r).select("*").single();
  };
  let { data, error } = await write(row);
  if (error && /header_samples|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
    // Migration 20260929110000 not applied yet: save without header samples.
    const { header_samples: _drop, ...rest } = row;
    void _drop;
    ({ data, error } = await write(rest));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
