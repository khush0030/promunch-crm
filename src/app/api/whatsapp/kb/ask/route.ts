import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret } from "@/lib/secrets";
import { cleanQuestion, planKb, rankPassages, type KbDocInput } from "@/lib/kb/ask";

// GET /api/whatsapp/kb/ask?q=… — Bot knowledge → "Test a question".
//
// DRY RUN, READ ONLY. It shows what the WhatsApp bot would READ for this
// question and the passages most likely to answer it. It never calls
// wa-ai-reply or wa-send, never takes a reply claim, never writes
// wa_messages or any other table. It does not write a reply: the bot's
// wording lives in the wa-ai-reply edge function prompt, and generating it
// here would mean a second copy of that prompt (see the note in KbAsk.tsx).
//
// Session-gated by the middleware; mapped to the Bot knowledge area under
// /api/whatsapp/kb in src/lib/access.ts.
export const dynamic = "force-dynamic";

type ChunkMatch = { document_id: string; content: string; similarity: number };

export async function GET(req: Request) {
  const q = cleanQuestion(new URL(req.url).searchParams.get("q"));
  if (!q) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("kb_documents")
    .select("id, name, raw_text")
    .eq("status", "ready");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const docs = (data ?? []) as KbDocInput[];

  const plan = planKb(docs);
  const passages = rankPassages(q, docs, 5);

  // Past the budget the bot searches kb_chunks by meaning (match_kb_chunks,
  // a read-only SQL function). Mirror that so the preview shows the same
  // sections. Under the budget the bot reads everything, so skip it.
  let search: { docName: string; text: string; similarity: number }[] | null = null;
  let searchError: string | null = null;
  if (plan.mode === "search") {
    try {
      const key = await getSecret("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.WA_EMBED_MODEL ?? "text-embedding-3-small", input: q }),
      });
      if (!r.ok) throw new Error(`embedding HTTP ${r.status}`);
      const emb = (await r.json())?.data?.[0]?.embedding as number[] | undefined;
      if (!emb) throw new Error("no embedding returned");
      const { data: rows, error: rpcErr } = await supabaseAdmin.rpc("match_kb_chunks", {
        query_embedding: emb,
        match_threshold: 0.25,
        match_count: 12,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const nameOf = new Map(docs.map((d) => [d.id, d.name]));
      search = ((rows ?? []) as ChunkMatch[]).map((c) => ({
        docName: nameOf.get(c.document_id) ?? "Unknown document",
        text: String(c.content ?? "").trim(),
        similarity: Math.round(Number(c.similarity) * 100) / 100,
      }));
    } catch (e) {
      searchError = e instanceof Error ? e.message : "search failed";
    }
  }

  return NextResponse.json({ question: q, plan, passages, search, searchError });
}
