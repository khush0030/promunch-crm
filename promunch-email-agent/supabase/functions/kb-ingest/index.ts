// Knowledge Base ingestion. Two modes:
//   1. POST { document_id } — parse a document already stored in Supabase Storage
//      (preferred for big PDFs).
//   2. POST { name, text } — direct text ingestion (manual entries).
//
// Process:
//   load doc → extract text (unpdf for PDFs; passthrough for txt/md) → chunk
//   ~800 tokens (≈3200 chars) → embed via OpenAI → insert kb_chunks rows.

import { db } from "../_shared/supabase.ts";
import { extractText } from "https://esm.sh/unpdf@0.12.1";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const EMBED_MODEL = Deno.env.get("WA_EMBED_MODEL") ?? "text-embedding-3-small";
const STORAGE_BUCKET = Deno.env.get("KB_BUCKET") ?? "kb-docs";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!OPENAI_API_KEY) return j({ error: "OPENAI_API_KEY not set" }, 500);

  const body = await req.json().catch(() => ({}));
  const sb = db();

  let docId: string | null = body.document_id ?? null;
  let rawText: string | null = body.text ?? null;
  let docName: string = body.name ?? "manual";
  let mime: string = body.mime ?? "text/plain";

  // load existing doc if document_id provided
  if (docId) {
    const { data: doc } = await sb.from("kb_documents").select("*").eq("id", docId).single();
    if (!doc) return j({ error: "document not found" }, 404);
    docName = doc.name;
    mime = doc.mime_type ?? "application/octet-stream";

    await sb.from("kb_documents").update({ status: "processing", error: null }).eq("id", docId);

    if (doc.raw_text) {
      rawText = doc.raw_text;
    } else if (doc.source_uri) {
      const { data: file, error } = await sb.storage.from(STORAGE_BUCKET).download(doc.source_uri);
      if (error || !file) {
        await sb.from("kb_documents").update({ status: "failed", error: error?.message ?? "download failed" }).eq("id", docId);
        return j({ error: "storage download failed" }, 500);
      }
      try {
        if (mime === "application/pdf" || doc.source_uri.endsWith(".pdf")) {
          const buf = new Uint8Array(await file.arrayBuffer());
          const out = await extractText(buf, { mergePages: true });
          rawText = Array.isArray(out.text) ? out.text.join("\n") : (out.text as string);
        } else {
          rawText = await file.text();
        }
      } catch (e) {
        await sb.from("kb_documents").update({ status: "failed", error: String(e) }).eq("id", docId);
        return j({ error: `parse failed: ${e}` }, 500);
      }
    }
  } else {
    // direct ingestion path — create the doc row now
    const { data: created } = await sb.from("kb_documents").insert({
      name: docName,
      source_type: "manual",
      mime_type: mime,
      status: "processing",
      raw_text: rawText,
    }).select("id").single();
    if (!created) return j({ error: "doc create failed" }, 500);
    docId = created.id;
  }

  if (!rawText || !rawText.trim()) {
    await sb.from("kb_documents").update({ status: "failed", error: "empty text" }).eq("id", docId);
    return j({ error: "empty text" }, 400);
  }

  const chunks = chunkText(rawText, 3200, 400);
  // delete prior chunks if re-ingesting
  await sb.from("kb_chunks").delete().eq("document_id", docId);

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let embedding: number[] | null = null;
    try { embedding = await embed(c); } catch (e) { console.warn("embed fail", i, e); }
    rows.push({ document_id: docId, chunk_index: i, content: c, token_count: Math.ceil(c.length / 4), embedding });
  }
  if (rows.length) {
    const { error } = await sb.from("kb_chunks").insert(rows);
    if (error) {
      await sb.from("kb_documents").update({ status: "failed", error: error.message }).eq("id", docId);
      return j({ error: error.message }, 500);
    }
  }

  await sb.from("kb_documents").update({
    status: "ready",
    raw_text: rawText.slice(0, 200_000),
    chunk_count: rows.length,
    processed_at: new Date().toISOString(),
  }).eq("id", docId);

  return j({ ok: true, document_id: docId, chunks: rows.length });
});

function chunkText(text: string, size: number, overlap: number): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= size) return [cleaned];
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + size);
    // try to break on paragraph or sentence
    let breakAt = end;
    if (end < cleaned.length) {
      const slice = cleaned.slice(i, end);
      const p = slice.lastIndexOf("\n\n");
      const s = slice.lastIndexOf(". ");
      const cand = p > size * 0.5 ? p : s > size * 0.5 ? s : -1;
      if (cand > 0) breakAt = i + cand;
    }
    out.push(cleaned.slice(i, breakAt).trim());
    if (breakAt >= cleaned.length) break;
    i = Math.max(breakAt - overlap, i + 1);
  }
  return out.filter((c) => c.length > 20);
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`embed http ${r.status}`);
  const out = await r.json();
  return out.data[0].embedding;
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
