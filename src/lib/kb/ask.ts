// Pure helpers for Bot knowledge → "Test a question" (retrieval preview).
//
// Mirrors how the WhatsApp bot picks its knowledge
// (promunch-email-agent/supabase/functions/wa-ai-reply/kb.ts retrieveKb):
//   - every ready kb_documents row with text, ordered master/policy/pricing/
//     FAQ first, then the catalogue, then the rest;
//   - if all of it fits in KB_CHAR_BUDGET the bot reads the WHOLE KB;
//   - only past the budget does it switch to semantic search over kb_chunks.
// Keep KB_CHAR_BUDGET and the ordering in step with that file.
//
// On top of that, rankPassages() scores each paragraph against the question
// so the preview can show "where the answer most likely comes from". That
// ranking is a reading aid only; the bot itself reads the whole KB.
// No I/O here: the route (GET /api/whatsapp/kb/ask) fetches and calls these.

export const KB_CHAR_BUDGET = 28_000; // wa-ai-reply/config.ts

export type KbDocInput = { id: string; name: string; raw_text: string | null };

export type KbPlan = {
  mode: "whole" | "search";
  totalChars: number;
  budget: number;
  docs: { id: string; name: string; chars: number }[];
};

export function docRank(name: string): number {
  return /master|policy|policies|pricing|faq/i.test(name) ? 0 : /catalog/i.test(name) ? 1 : 2;
}

export function planKb(docs: KbDocInput[]): KbPlan {
  const ready = docs
    .filter((d) => d.raw_text && d.raw_text.trim())
    .sort((a, b) => docRank(a.name) - docRank(b.name))
    .map((d) => ({ id: d.id, name: d.name, chars: `## ${d.name}\n${d.raw_text!.trim()}`.length }));
  const totalChars = ready.reduce((n, d) => n + d.chars + 2, 0);
  return { mode: totalChars <= KB_CHAR_BUDGET ? "whole" : "search", totalChars, budget: KB_CHAR_BUDGET, docs: ready };
}

const STOP = new Set(
  (
    "a an and are as at be but by can do does for from get got have how i if in is it its me my of on or our so " +
    "that the their them there this to us was we what when where which who why will with you your yes no not " +
    "hi hello hey please pls thanks thank ok okay want need know tell any some much many one also just about " +
    "kya hai ka ki ke ko se me mai"
  ).split(" "),
);

export function questionTerms(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[₹]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    // crude singular: "pouches" -> "pouch", "chips" -> "chip"
    if (w.length > 3 && w.endsWith("es")) out.add(w.slice(0, -2));
    else if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
  }
  return [...out];
}

// Paragraphs (blank-line separated), long ones cut at line breaks so a match
// shows a readable snippet rather than a whole page.
export function splitPassages(text: string, max = 600): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= max) {
      out.push(p);
      continue;
    }
    let cur = "";
    for (const line of p.split("\n")) {
      if (cur && cur.length + line.length + 1 > max) {
        out.push(cur.trim());
        cur = "";
      }
      cur += (cur ? "\n" : "") + line;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export type Passage = { docId: string; docName: string; text: string; score: number; matched: string[] };

export function rankPassages(question: string, docs: KbDocInput[], limit = 5): Passage[] {
  const terms = questionTerms(question);
  if (!terms.length) return [];
  const scored: Passage[] = [];
  for (const d of docs) {
    if (!d.raw_text) continue;
    for (const text of splitPassages(d.raw_text)) {
      const lower = text.toLowerCase();
      const matched = terms.filter((t) => new RegExp(`\\b${t}`, "i").test(lower));
      if (!matched.length) continue;
      // distinct terms matter most; a short focused passage beats a long one
      const score = matched.length * 10 + Math.min(5, matched.reduce((n, t) => n + (lower.split(t).length - 1), 0)) - text.length / 2000;
      scored.push({ docId: d.id, docName: d.name, text, score: Math.round(score * 100) / 100, matched });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function cleanQuestion(raw: string | null): string | null {
  const q = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!q) return null;
  return q.slice(0, 300);
}
