// Knowledge-base retrieval (semantic + prompt-stuff fallback).
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import OpenAI from "npm:openai@4.78.0";
import { KB_CHAR_BUDGET, OPENAI_API_KEY } from "./config.ts";

// ---- Knowledge base retrieval ---------------------------------------------
// Embed the customer's message, pull the most relevant kb_chunks via the
// match_kb_chunks RPC, and assemble them within the char budget. Falls back to
// prompt-stuffing every ready document if embeddings aren't populated yet or
// anything goes wrong — the bot is never left without a KB.
export async function retrieveKb(sb: any, query: string): Promise<string> {
  try {
    const emb = await embedText(query);
    if (emb) {
      const { data, error } = await sb.rpc("match_kb_chunks", {
        query_embedding: emb,
        match_threshold: 0.25,
        match_count: 10,
      });
      if (!error && Array.isArray(data) && data.length) {
        let kb = "";
        for (const r of data) {
          const block = String(r.content ?? "").trim();
          if (!block) continue;
          if (kb.length + block.length + 2 > KB_CHAR_BUDGET) break;
          kb += (kb ? "\n\n" : "") + block;
        }
        if (kb) return kb;
      }
    }
  } catch (e) {
    console.error("[wa-ai-reply] KB retrieval failed — falling back to full KB", e);
  }
  return await stuffAllDocs(sb);
}

// Legacy path: prompt-stuff all ready docs, Master/policy/pricing/FAQ first so
// they always land inside the budget; budget doc-by-doc (no silent mid-word cut
// of a whole later doc).
async function stuffAllDocs(sb: any): Promise<string> {
  const { data: docs } = await sb
    .from("kb_documents").select("name, raw_text").eq("status", "ready");
  const masterRank = (n: string) => (/master|policy|policies|pricing|faq/i.test(n) ? 0 : 1);
  const ready = (docs ?? [])
    .filter((d: any) => d.raw_text && String(d.raw_text).trim())
    .sort((a: any, b: any) => masterRank(a.name) - masterRank(b.name));
  let kb = "";
  for (const d of ready) {
    const block = `## ${d.name}\n${d.raw_text}`;
    if (kb.length + block.length + 2 > KB_CHAR_BUDGET) {
      const room = KB_CHAR_BUDGET - kb.length - 2;
      if (room > 200) kb += (kb ? "\n\n" : "") + block.slice(0, room);
      break;
    }
    kb += (kb ? "\n\n" : "") + block;
  }
  return kb;
}

async function embedText(text: string): Promise<number[] | null> {
  const t = text.trim().slice(0, 8000);
  if (!t) return null;
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const model = Deno.env.get("WA_EMBED_MODEL") ?? "text-embedding-3-small";
  const resp = await client.embeddings.create({ model, input: t });
  return (resp.data?.[0]?.embedding as number[]) ?? null;
}
