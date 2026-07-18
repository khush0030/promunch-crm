// Knowledge Base ingestion (embeddings-free).
//
// The AI agent (wa-ai-reply) prompt-stuffs every ready document, so ingestion
// only needs to extract and store raw_text — no chunking, no embeddings,
// no external embedding API.
//
// POST { document_id }  — parse a stored upload (PDF / txt / md)
// POST { name, text }   — direct text entry (manual paste)

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { extractText } from "https://esm.sh/unpdf@0.12.1";

const STORAGE_BUCKET = Deno.env.get("KB_BUCKET") ?? "kb-docs";

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const body = await req.json().catch(() => ({}));
  const sb = db();

  let docId: string | null = body.document_id ?? null;
  let rawText: string | null = body.text ?? null;
  let docName: string = body.name ?? "manual";
  let mime: string = body.mime ?? "text/plain";

  if (docId) {
    const { data: doc } = await sb.from("kb_documents").select("*").eq("id", docId).single();
    if (!doc) return j({ error: "document not found" }, 404);
    docName = doc.name;
    mime = doc.mime_type ?? mime;

    await sb.from("kb_documents").update({ status: "processing", error: null }).eq("id", docId);

    if (doc.raw_text) {
      rawText = doc.raw_text;
    } else if (doc.source_uri) {
      const { data: file, error } = await sb.storage.from(STORAGE_BUCKET).download(doc.source_uri);
      if (error || !file) {
        await fail(sb, docId, error?.message ?? "storage download failed");
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
        await fail(sb, docId, `parse failed: ${e}`);
        return j({ error: `parse failed: ${e}` }, 500);
      }
    }
  } else {
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
    await fail(sb, docId, "empty text");
    return j({ error: "empty text" }, 400);
  }

  const clean = rawText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  await sb.from("kb_documents").update({
    status: "ready",
    raw_text: clean.slice(0, 200_000),
    chunk_count: 1,
    processed_at: new Date().toISOString(),
  }).eq("id", docId);

  // Fire-and-forget: embed this document into kb_chunks for semantic retrieval.
  // Best-effort — wa-ai-reply falls back to prompt-stuffing when embeddings are
  // missing, so a failure here never breaks the bot.
  void triggerEmbed(docId);

  return j({ ok: true, document_id: docId, chars: clean.length });
});

async function fail(sb: ReturnType<typeof db>, id: string | null, msg: string) {
  if (!id) return;
  await sb.from("kb_documents").update({ status: "failed", error: msg }).eq("id", id);
}

// Best-effort call to kb-embed for one freshly-ingested document. Never throws
// into the request path — the bot degrades to prompt-stuffing without it.
async function triggerEmbed(documentId: string | null) {
  if (!documentId) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/kb-embed`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_id: documentId }),
    });
  } catch (e) {
    console.error("[kb-ingest] triggerEmbed failed", e);
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
