// Knowledge-base retrieval.
//
// Rule: if every ready document fits in KB_CHAR_BUDGET, hand the model the
// whole KB straight from kb_documents.raw_text. That is the source the
// dashboard edits, so the bot can never answer from a stale embedding (the
// Sep 2026 audit found kb_chunks three months behind raw_text). Semantic
// retrieval over kb_chunks is used only when the KB has outgrown the budget.

import OpenAI from "npm:openai@4.78.0";
import { KB_CHAR_BUDGET, OPENAI_API_KEY } from "./config.ts";

export async function retrieveKb(sb: any, query: string): Promise<string> {
  const docs = await readyDocs(sb);
  const total = docs.reduce((n, d) => n + d.block.length + 2, 0);
  if (total <= KB_CHAR_BUDGET) return docs.map((d) => d.block).join("\n\n");

  try {
    const emb = await embedText(query);
    if (emb) {
      const { data, error } = await sb.rpc("match_kb_chunks", {
        query_embedding: emb,
        match_threshold: 0.25,
        match_count: 12,
      });
      if (!error && Array.isArray(data) && data.length) {
        // Always lead with the Master KB (policies, brand rules) so the
        // non-negotiables are never dropped by similarity ranking.
        let kb = docs.find((d) => /master/i.test(d.name))?.block ?? "";
        for (const r of data) {
          const block = String(r.content ?? "").trim();
          if (!block || kb.includes(block)) continue;
          if (kb.length + block.length + 2 > KB_CHAR_BUDGET) break;
          kb += (kb ? "\n\n" : "") + block;
        }
        if (kb) return kb;
      }
    }
  } catch (e) {
    console.error("[wa-ai-reply] KB retrieval failed, falling back to stuffed KB", e);
  }
  return stuffWithinBudget(docs);
}

async function readyDocs(sb: any): Promise<Array<{ name: string; block: string }>> {
  const { data } = await sb.from("kb_documents").select("name, raw_text").eq("status", "ready");
  // Master / policy / pricing / FAQ first, then the live catalogue, then the rest.
  const rank = (n: string) =>
    /master|policy|policies|pricing|faq/i.test(n) ? 0 : /catalog/i.test(n) ? 1 : 2;
  return (data ?? [])
    .filter((d: any) => d.raw_text && String(d.raw_text).trim())
    .sort((a: any, b: any) => rank(a.name) - rank(b.name))
    .map((d: any) => ({ name: String(d.name), block: `## ${d.name}\n${String(d.raw_text).trim()}` }));
}

function stuffWithinBudget(docs: Array<{ block: string }>): string {
  let kb = "";
  for (const d of docs) {
    if (kb.length + d.block.length + 2 > KB_CHAR_BUDGET) {
      const room = KB_CHAR_BUDGET - kb.length - 2;
      if (room > 200) kb += (kb ? "\n\n" : "") + d.block.slice(0, room);
      break;
    }
    kb += (kb ? "\n\n" : "") + d.block;
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
