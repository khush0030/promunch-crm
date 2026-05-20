import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const required = ["name", "category", "body"];
  for (const k of required) {
    if (!body[k]) return NextResponse.json({ error: `${k} required` }, { status: 400 });
  }
  const row = {
    name: body.name,
    language: body.language ?? "en",
    category: body.category,
    status: body.status ?? "draft",
    header_type: body.header_type ?? null,
    header_text: body.header_text ?? null,
    header_media_url: body.header_media_url ?? null,
    body: body.body,
    footer: body.footer ?? null,
    buttons: body.buttons ?? null,
    variables: body.variables ?? null,
  };
  const { data, error } = await supabaseAdmin
    .from("wa_templates")
    .upsert(row, { onConflict: "name,language" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
