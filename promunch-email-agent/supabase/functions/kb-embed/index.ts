// Knowledge Base embedding pipeline.
//
// Chunks every ready kb_documents.raw_text and writes 1536-dim embeddings into
// kb_chunks so wa-ai-reply can do semantic retrieval (match_kb_chunks RPC)
// instead of prompt-stuffing the whole KB. Idempotent: re-embeds a document
// from scratch (delete + re-insert) each run, so it's safe to re-run anytime.
//
// POST {}                  — (re)embed every ready document
// POST { document_id: ".."} — just that one (used by kb-ingest after upload)
//
// Auth: service-role bearer via requireInternal (verify_jwt alone is NOT
// authorization — the public anon key passes it). Invoked by the Next.js API
// with the service role bearer, or function-to-function by kb-ingest /
// shopify-catalog-sync.

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
// text-embedding-3-small outputs 1536 dims — matches kb_chunks.embedding vector(1536).
const EMBED_MODEL = Deno.env.get("WA_EMBED_MODEL") ?? "text-embedding-3-small";
const CHUNK_CHARS = 1100;    // ~280 tokens
const CHUNK_OVERLAP = 150;   // carry context across the cut
const EMBED_BATCH = 96;      // inputs per embeddings API call

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sb = db();

  let q = sb.from("kb_documents").select("id, name, raw_text").eq("status", "ready");
  if (typeof body?.document_id === "string" && body.document_id) {
    q = q.eq("id", body.document_id);
  }
  const { data: docs, error } = await q;
  if (error) return j({ error: error.message }, 500);

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const results: Array<Record<string, unknown>> = [];

  for (const d of docs ?? []) {
    const text = String(d.raw_text ?? "").trim();
    if (!text) { results.push({ name: d.name, chunks: 0, skipped: "empty" }); continue; }
    try {
      const chunks = chunkText(text);
      const embeddings = await embedBatch(client, chunks);

      // Replace the document's chunks atomically-ish: delete then insert.
      await sb.from("kb_chunks").delete().eq("document_id", d.id);
      const rows = chunks.map((content, i) => ({
        document_id: d.id,
        chunk_index: i,
        content,
        token_count: Math.round(content.length / 4),
        embedding: embeddings[i],
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error: insErr } = await sb.from("kb_chunks").insert(rows.slice(i, i + 100));
        if (insErr) throw new Error(insErr.message);
      }
      await sb.from("kb_documents").update({ chunk_count: rows.length }).eq("id", d.id);
      results.push({ name: d.name, chunks: rows.length });
    } catch (e) {
      results.push({ name: d.name, error: String(e instanceof Error ? e.message : e) });
    }
  }

  return j({ ok: results.every((r) => !r.error), model: EMBED_MODEL, count: results.length, results });
});

// Split text into overlapping chunks, preferring to cut on a paragraph /
// sentence boundary near the target size so a chunk stays coherent.
function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const br = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (br > CHUNK_CHARS * 0.5) end = i + br + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return chunks;
}

async function embedBatch(client: OpenAI, inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH);
    const resp = await client.embeddings.create({ model: EMBED_MODEL, input: batch });
    // resp.data carries an `index` per item — honour it rather than assume order.
    for (const item of resp.data) out[i + item.index] = item.embedding as number[];
  }
  return out;
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
