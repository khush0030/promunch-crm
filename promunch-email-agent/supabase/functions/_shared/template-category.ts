// The single answer to "is this WhatsApp template MARKETING-category?"
//
// WHY THIS IS ITS OWN MODULE
// --------------------------
// Two very different callers need this classification:
//
//   1. _shared/marketing-governor.ts — decides whether a send is subject to
//      Meta's per-recipient marketing fatigue cap (#131049) and must therefore
//      be throttled.
//   2. _shared/whatsapp.ts (sendTemplate) — decides whether a send may be
//      routed down the MM Lite /marketing_messages endpoint.
//
// They used to each carry their own cached wa_templates lookup, which meant two
// caches, two queries per warm instance, and two places to get the category
// wrong. This module owns the cache; both callers ask it.
//
// It lives in its own file rather than inside either caller because whatsapp.ts
// and marketing-governor.ts are on opposite sides of the send path: the governor
// is free to grow a dependency on whatsapp.ts later (e.g. to read Meta's
// messaging tier), and putting the helper in whatsapp.ts would make that an
// import cycle. A leaf module that only depends on ./supabase.ts cannot cycle.
//
// THE TWO FALLBACKS ARE OPPOSITE ON PURPOSE
// -----------------------------------------
// When wa_templates cannot answer, the safe guess is different for each caller,
// so `fallback` is a REQUIRED argument — there is deliberately no default:
//
//   • Governor  → fallback: true  ("assume marketing"). Fails CLOSED. Guessing
//     "marketing" only ever THROTTLES a send, which cannot hurt a customer. It
//     pairs with `utilityAllowlist`, the hardcoded transactional lifelines, so a
//     wa_templates outage can never mute an order confirmation.
//   • MM Lite   → fallback: false ("assume not marketing"). Fails to the CLOUD
//     API. Guessing "not marketing" keeps the send on the existing, proven
//     endpoint rather than an untested one. Routing a send to a new endpoint on
//     a guess is the risky direction here, so unknown must mean "stay put".
//
// Collapsing these into one behaviour would break one caller or the other.

import { db } from "./supabase.ts";

// wa_templates changes maybe once a week and this is read on every send, so the
// WHOLE table is cached in module scope. A 250-recipient broadcast costs one
// query, not 250. Kept at the tighter of the two old TTLs (5 min) so a category
// correction in the dashboard takes effect quickly.
const TTL_MS = 5 * 60_000;

interface CategoryIndex {
  // "name|language" -> category. Exact match, preferred.
  byNameLang: Map<string, string>;
  // "name" -> category. Meta scopes a template's category to its NAME (all
  // language versions of a name share one category), so this resolves a send
  // whose language string does not exactly match the stored row.
  byName: Map<string, string>;
}

let cache: CategoryIndex | null = null;
let cacheAt = 0;

// Returns null only when we have never successfully loaded the table. On a
// later failure the STALE index is returned instead — a five-minute-old category
// is far better information than no information.
async function index(): Promise<CategoryIndex | null> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const { data, error } = await db().from("wa_templates").select("name, language, category");
    if (error || !data) return cache;
    const byNameLang = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const t of data as { name: string; language: string | null; category: string | null }[]) {
      if (!t?.name) continue;
      const cat = String(t.category ?? "").toLowerCase();
      if (!cat) continue;
      byName.set(t.name, cat);
      if (t.language) byNameLang.set(`${t.name}|${t.language}`, cat);
    }
    cache = { byNameLang, byName };
    cacheAt = Date.now();
    return cache;
  } catch {
    return cache;
  }
}

// Resolve the authoritative category from wa_templates, or null if unknown.
export async function templateCategory(name: string, language?: string): Promise<string | null> {
  const n = (name ?? "").trim();
  if (!n) return null;
  const idx = await index();
  if (!idx) return null;
  if (language) {
    const exact = idx.byNameLang.get(`${n}|${language}`);
    if (exact) return exact;
  }
  return idx.byName.get(n) ?? null;
}

export interface CategoryQuery {
  name: string;
  /** Optional. Only refines the lookup; a name-only match is still used. */
  language?: string;
  /**
   * The answer when nothing else resolves. REQUIRED — see the header comment:
   * the governor passes true (fail closed / throttle), MM Lite passes false
   * (fail to the Cloud API path).
   */
  fallback: boolean;
  /**
   * Names that are ALWAYS utility, whatever the table says or fails to say.
   * Checked before `fallback`. The governor passes its transactional lifelines
   * here so a wa_templates outage can never throttle an order confirmation.
   */
  utilityAllowlist?: ReadonlySet<string>;
  /**
   * Names known to be marketing at Meta, used when the table cannot answer.
   * Checked before `fallback`, after `utilityAllowlist`. Callers whose unknown
   * case must stay on the conservative path (MM Lite) deliberately omit this.
   */
  marketingAllowlist?: ReadonlySet<string>;
}

// Order of resolution:
//   1. live wa_templates category (authoritative),
//   2. caller's utility allowlist,
//   3. caller's marketing allowlist,
//   4. caller's fallback.
export async function isMarketingTemplate(q: CategoryQuery): Promise<boolean> {
  const n = (q.name ?? "").trim();
  if (!n) return q.fallback;
  const cat = await templateCategory(n, q.language);
  if (cat) return cat === "marketing";
  if (q.utilityAllowlist?.has(n)) return false;
  if (q.marketingAllowlist?.has(n)) return true;
  return q.fallback;
}

// Every marketing-category template name, for bulk callers that classify many
// ledger rows at once (the campaign sender's hold-set query). `seed` is the
// caller's known-marketing list; it is always included so the answer is never
// emptier than the hardcoded knowledge, even during a wa_templates outage.
export async function marketingTemplateNames(seed: ReadonlySet<string>): Promise<Set<string>> {
  const idx = await index();
  const out = new Set<string>(seed);
  if (!idx) return out;
  for (const [name, cat] of idx.byName) if (cat === "marketing") out.add(name);
  return out;
}
