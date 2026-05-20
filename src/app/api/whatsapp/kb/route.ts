import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.KB_BUCKET ?? "kb-docs";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("kb_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

// Two POST modes:
//   multipart/form-data with field "file" — upload PDF / txt to storage then ingest
//   application/json { name, text } — manual entry
export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    const body = await req.json();
    if (!body.text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const r = await fetch(`${SUPABASE_URL}/functions/v1/kb-ingest`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: body.name ?? "manual entry", text: body.text, mime: "text/plain" }),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  }

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) return NextResponse.json({ error: "file required" }, { status: 400 });
    const name = (form.get("name") as string) || (file as File).name || "upload";
    const mime = (file as File).type || "application/octet-stream";
    const ab = await file.arrayBuffer();

    // upload to storage
    const path = `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, ab, { contentType: mime, upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: doc, error: dErr } = await supabaseAdmin
      .from("kb_documents")
      .insert({
        name,
        source_type: "upload",
        source_uri: path,
        mime_type: mime,
        size_bytes: ab.byteLength,
        status: "pending",
      })
      .select("*")
      .single();
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

    // kick ingest (fire-and-forget — large PDFs may exceed Vercel timeout otherwise)
    fetch(`${SUPABASE_URL}/functions/v1/kb-ingest`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: doc.id }),
    }).catch(() => {});

    return NextResponse.json({ document: doc });
  }

  return NextResponse.json({ error: "unsupported content-type" }, { status: 415 });
}
