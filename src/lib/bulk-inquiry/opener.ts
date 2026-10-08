// One-line personalised opener for the bulk auto-reply ("Diwali gifting for
// the Navan team, love it."). Deliberately states NO product facts, so there
// is nothing to get wrong; facts belong in the human-approved quote reply.
// Any failure, timeout or rule break falls back to a fixed opener, so the
// email always goes out.

import { getSecret } from "@/lib/secrets";
import { USE_CASES, cleanCopy, fallbackOpener, type BulkInquiryInput } from "./schema";

const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 6000;
const TAIL = "Here is what we need to send you pricing.";

const SYSTEM = `You write the first sentence of a reply email from PROMUNCH, an Indian high-protein snack brand, to someone who just asked for a bulk order quote.

Write ONE short, warm sentence (max 18 words) that reflects what they asked for, using their company name or occasion if given.
Rules:
- Do not state any product facts, prices, protein numbers, ingredients, delivery times or promises.
- Do not ask questions. Do not greet by name (the email already does).
- No em dashes or en dashes. No emoji. No exclamation marks.
- Write the brand as PROMUNCH in capitals if you mention it.
- Plain Indian business English, friendly, not salesy.
Return JSON: {"sentence": "..."}`;

/** Validate a model sentence; null when it breaks a rule. Exported for tests. */
export function acceptOpenerSentence(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = cleanCopy(raw).replace(/^["']|["']$/g, "");
  if (!s || /[?!]/.test(s)) return null;
  if (!/[.]$/.test(s)) s = s.replace(/[,;:]+$/, "") + ".";
  const words = s.split(/\s+/).length;
  if (words < 4 || words > 24) return null;
  // Facts/promises we never want in an unreviewed line.
  if (/\d|protein|₹|rs\.?\s|price|discount|free|deliver|guarantee|fried|roast|olive|calorie|organic|vegan|gluten/i.test(s)) return null;
  if (/[\u{1F300}-\u{1FAFF}]/u.test(s)) return null;
  return s;
}

export async function buildOpener(q: Pick<BulkInquiryInput, "useCase" | "company" | "city" | "notes" | "quantityBand">): Promise<{ opener: string; source: "ai" | "fallback" }> {
  const fallback = fallbackOpener(q.useCase, q.company);
  try {
    const apiKey = await getSecret("OPENAI_API_KEY");
    if (!apiKey) return { opener: fallback, source: "fallback" };
    const user = [
      `Order type: ${USE_CASES[q.useCase].label}`,
      `Company: ${q.company}`,
      `City: ${q.city}`,
      q.notes ? `Their note: ${q.notes.slice(0, 500)}` : null,
    ].filter(Boolean).join("\n");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { opener: fallback, source: "fallback" };
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    const sentence = acceptOpenerSentence(content ? JSON.parse(content)?.sentence : null);
    return sentence ? { opener: `${sentence} ${TAIL}`, source: "ai" } : { opener: fallback, source: "fallback" };
  } catch {
    return { opener: fallback, source: "fallback" };
  }
}
