import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.KB_BUCKET ?? "kb-docs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // re-ingest endpoint
  const { id } = await ctx.params;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/kb-ingest`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: id }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: doc } = await supabaseAdmin.from("kb_documents").select("source_uri").eq("id", id).single();
  if (doc?.source_uri) await supabaseAdmin.storage.from(BUCKET).remove([doc.source_uri]).catch(() => {});
  const { error } = await supabaseAdmin.from("kb_documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
