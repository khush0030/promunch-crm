// deno-lint-ignore-file no-explicit-any -- model + DB JSON is untyped
// ORM (Reputation) enrichment. Contract: docs/plans/2026-10-08-orm-build-spec.md §3.
//
// One OpenAI call per batch of ≤20 mentions (gpt-4o-mini, env ORM_AI_MODEL
// override), JSON-schema output, temperature 0. The prompt builder, schema,
// parser and the food-safety override are pure and unit-tested
// (orm-enrich_test.ts). The model never decides that a food-safety report is
// harmless: the regex override forces urgency='critical' in code.
//
// Never messages anyone; writes only orm_mentions enrichment columns.

import { db } from "./supabase.ts";

export const ENRICH_BATCH = 20;
export const ENRICH_BODY_MAX = 1500;
export const MAX_ENRICH_ATTEMPTS = 3;

export const TOPICS = [
  "taste", "crunch", "flavour", "price", "value", "protein", "ingredients", "packaging",
  "delivery", "freshness", "quality", "foreign_object", "allergy", "availability",
  "customer_service", "competitor", "other",
] as const;
export const INTENTS = ["complaint", "question", "praise", "suggestion", "collab", "spam", "other"] as const;
export const URGENCIES = ["critical", "high", "normal", "low"] as const;

export type Urgency = typeof URGENCIES[number];

export interface EnrichItemInput {
  id: string;                    // orm_mentions.id
  source: string;
  rating: number | null;
  title: string | null;
  body: string;
  author_followers: number | null;
}

export interface Enrichment {
  relevant: boolean;
  sentiment: number;             // -2..2
  summary: string;               // ≤140 chars
  topics: string[];
  intent: typeof INTENTS[number];
  urgency: Urgency;
  product: string | null;
  language: string | null;
  order_ref: string | null;
}

// ---- food-safety hard rule ---------------------------------------------------

export const FOOD_SAFETY_RE =
  /(insect|worm|fungus|fungal|mould|mold|stale|rotten|smell|vomit|sick|food poisoning|allerg|hospital|plastic piece|hair in|keeda|kida|ganda)/i;

export function isFoodSafety(text: string | null | undefined): boolean {
  return FOOD_SAFETY_RE.test(String(text ?? ""));
}

/** Code-level overrides applied after the model. */
export function applyHardRules(
  e: Enrichment,
  m: { title?: string | null; body: string; is_owned?: boolean },
): Enrichment {
  const out = { ...e };
  if (isFoodSafety(`${m.title ?? ""}\n${m.body}`)) out.urgency = "critical";
  // owned surfaces (our listings, our channel) are about us by definition
  if (m.is_owned) out.relevant = true;
  if (!out.order_ref) out.order_ref = extractOrderRef(`${m.title ?? ""}\n${m.body}`);
  return out;
}

/** "#2083" / "order 2083" / "order no. 2083" → "#2083". */
export function extractOrderRef(text: string): string | null {
  const m = text.match(/#\s?(\d{4,6})\b/) ?? text.match(/\border\s*(?:no\.?|number|id|#)?\s*[:#]?\s*(\d{4,6})\b/i);
  return m ? `#${m[1]}` : null;
}

export function normalizeOrderRef(v: unknown): string | null {
  const d = String(v ?? "").match(/\d{3,7}/)?.[0];
  return d ? `#${d}` : null;
}

// ---- prompt ------------------------------------------------------------------

export const ENRICH_SYSTEM = `You classify public online mentions (reviews, comments, posts, articles) for PROMUNCH, an Indian D2C high-protein snack brand ("Your Munchy Pal").
PROMUNCH product lines: Roasted Edamame (flavours such as Himalayan Rock Salt, Indori Chatka, Masala Mania), Soya Crunchies, Chips, Sticks.

For EVERY item return one result with the same id:
- relevant: true only if the text is actually about PROMUNCH the snack brand or its products (not another company or a different meaning of the word).
- sentiment: integer -2 (very negative) to 2 (very positive), 0 neutral, judged from the author's view of PROMUNCH.
- summary: one plain English sentence, max 140 characters, no em dashes, write PROMUNCH in capitals.
- topics: zero or more from the allowed list only.
- intent: complaint, question, praise, suggestion, collab, spam or other.
- urgency: critical (health or safety risk, legal threat, viral outrage), high (an unhappy customer who needs a reply soon), normal, low.
- product: the PROMUNCH product line mentioned, e.g. "Roasted Edamame (Masala Mania)", "Soya Crunchies", "Chips", "Sticks", or null. Never name a non PROMUNCH product.
- language: ISO 639-1 code of the text (e.g. en, hi), "hi-Latn" style for Hinglish is fine.
- order_ref: an order number written in the text, formatted like "#2083", else null.
Text may be in Hindi or Hinglish. Use only the text given; do not invent facts.`;

export function buildEnrichUser(items: EnrichItemInput[]): string {
  const payload = items.map((i) => ({
    id: i.id,
    source: i.source,
    rating: i.rating,
    title: i.title ? i.title.slice(0, 300) : null,
    body: (i.body ?? "").slice(0, ENRICH_BODY_MAX),
    author_followers: i.author_followers,
  }));
  return `Classify these ${items.length} items. Return {"items":[...]} with exactly one entry per id.\n\n${JSON.stringify(payload)}`;
}

export const ENRICH_SCHEMA = {
  name: "orm_enrichment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "relevant", "sentiment", "summary", "topics", "intent", "urgency", "product", "language", "order_ref"],
          properties: {
            id: { type: "string" },
            relevant: { type: "boolean" },
            sentiment: { type: "integer", enum: [-2, -1, 0, 1, 2] },
            summary: { type: "string" },
            topics: { type: "array", items: { type: "string", enum: [...TOPICS] } },
            intent: { type: "string", enum: [...INTENTS] },
            urgency: { type: "string", enum: [...URGENCIES] },
            product: { type: ["string", "null"] },
            language: { type: ["string", "null"] },
            order_ref: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

// ---- parser ------------------------------------------------------------------

const clampSentiment = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(-2, Math.min(2, n)) : 0;
};

export function cleanSummary(s: unknown): string {
  return String(s ?? "")
    .replace(/[—–]/g, ", ")
    .replace(/\bpromunch\b/gi, "PROMUNCH")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function parseEnrichItem(o: any): Enrichment | null {
  if (!o || typeof o !== "object") return null;
  const topics = Array.isArray(o.topics)
    ? [...new Set(o.topics.map((t: unknown) => String(t)).filter((t: string) => (TOPICS as readonly string[]).includes(t)))]
    : [];
  const intent = (INTENTS as readonly string[]).includes(o.intent) ? o.intent : "other";
  const urgency = (URGENCIES as readonly string[]).includes(o.urgency) ? o.urgency : "normal";
  const product = typeof o.product === "string" && o.product.trim() ? o.product.trim().slice(0, 80) : null;
  const language = typeof o.language === "string" && o.language.trim() ? o.language.trim().slice(0, 12) : null;
  return {
    relevant: o.relevant !== false,
    sentiment: clampSentiment(o.sentiment),
    summary: cleanSummary(o.summary),
    topics: topics as string[],
    intent,
    urgency,
    product,
    language,
    order_ref: normalizeOrderRef(o.order_ref),
  };
}

/** Raw model text → Map<id, Enrichment>. Unknown ids are dropped; a missing id = failure for that item. */
export function parseEnrichResponse(raw: string, ids: string[]): Map<string, Enrichment> {
  const out = new Map<string, Enrichment>();
  const want = new Set(ids);
  const txt = String(raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(txt);
  } catch {
    return out;
  }
  const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  for (const o of arr) {
    const id = String(o?.id ?? "");
    if (!want.has(id) || out.has(id)) continue;
    const e = parseEnrichItem(o);
    if (e) out.set(id, e);
  }
  return out;
}

// ---- OpenAI call ---------------------------------------------------------------

export function enrichModel(): string {
  return Deno.env.get("ORM_AI_MODEL") || "gpt-4o-mini";
}

export async function callEnrichModel(items: EnrichItemInput[]): Promise<Map<string, Enrichment>> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: enrichModel(),
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_schema", json_schema: ENRICH_SCHEMA },
      messages: [
        { role: "system", content: ENRICH_SYSTEM },
        { role: "user", content: buildEnrichUser(items) },
      ],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${json?.error?.message ?? "unknown"}`.slice(0, 300));
  const content = json?.choices?.[0]?.message?.content ?? "";
  return parseEnrichResponse(content, items.map((i) => i.id));
}

// ---- customer match (best effort) -------------------------------------------

function phoneVariants(raw: string): string[] {
  const d = raw.replace(/\D/g, "");
  if (!d) return [];
  const v = new Set([d, `+${d}`]);
  if (d.length === 12 && d.startsWith("91")) { v.add(d.slice(2)); v.add(`+${d}`); }
  if (d.length === 10) { v.add(`91${d}`); v.add(`+91${d}`); }
  return [...v];
}

/** order_ref → shopify_orders (order_number '#2083') → contacts by email, then phone. */
export async function matchCustomer(orderRef: string | null): Promise<string | null> {
  const num = orderRef?.replace(/\D/g, "");
  if (!num) return null;
  const sb = db();
  const { data: order } = await sb.from("shopify_orders")
    .select("customer_email, customer_phone")
    .or(`order_number.eq.#${num},order_number.eq.${num}`)
    .limit(1).maybeSingle();
  if (!order) return null;
  const email = String(order.customer_email ?? "").trim().toLowerCase();
  if (email) {
    const { data } = await sb.from("contacts").select("id").eq("email", email).limit(1).maybeSingle();
    if (data?.id) return data.id;
  }
  const phones = phoneVariants(String(order.customer_phone ?? ""));
  if (phones.length) {
    const { data } = await sb.from("contacts").select("id").in("phone", phones).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  return null;
}
