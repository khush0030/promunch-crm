// Meta account standing + daily business-initiated budget for our WhatsApp
// number. The messaging tier caps how many UNIQUE customers can receive a
// business-initiated (template) message per rolling 24h; sending past it just
// burns sends into #131049 rejections and hurts quality rating. The campaign
// engine asks here BEFORE each wave so it stops at the budget instead of
// slamming into the cap.
//
// Everything is defensive: any Meta/API failure returns null and callers fall
// back to reactive pacing (the engine's existing 131049 defer). A quota check
// must never be the reason a campaign can't send at all.

import { db } from "./supabase.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

export interface WaStanding {
  tier: string | null;     // e.g. TIER_250, TIER_1K, TIER_UNLIMITED
  limit: number | null;    // unique users / 24h; null = unknown or unlimited
  quality: string | null;  // GREEN | YELLOW | RED | NA
}

const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

export function tierDailyLimit(tier: string | null | undefined): number | null {
  if (!tier || tier === "TIER_UNLIMITED") return null;
  return TIER_LIMIT[tier.toUpperCase()] ?? null;
}

// Operator-set daily budget (Supabase secret WA_DAILY_SEND_LIMIT). Meta omits
// messaging_limit_tier for numbers without an established tier (ours, as of
// Jul 2026: business verified, GREEN quality, no tier reported), and the
// observed ceiling (~250 marketing sends/day) bites before any tier anyway.
// When both exist the LOWER wins — the secret is "my daily budget", never
// permission to exceed the tier.
export function manualDailyLimit(): number | null {
  const n = Number(Deno.env.get("WA_DAILY_SEND_LIMIT") ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function fetchWaStanding(): Promise<WaStanding | null> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  let tier: string | null = null;
  let quality: string | null = null;
  if (token && phoneId) {
    try {
      const r = await fetch(
        `${GRAPH}/${phoneId}?fields=quality_rating,messaging_limit_tier`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = await r.json().catch(() => null) as
        | { quality_rating?: string; messaging_limit_tier?: string }
        | null;
      tier = body?.messaging_limit_tier ?? null;
      quality = body?.quality_rating ?? null;

      // Phone-node fields are sometimes absent; try the WABA phone_numbers edge.
      const waba = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
      if ((!tier || !quality) && waba) {
        const r2 = await fetch(
          `${GRAPH}/${waba}/phone_numbers?fields=id,quality_rating,messaging_limit_tier`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const b2 = await r2.json().catch(() => null) as
          | { data?: { id?: string; quality_rating?: string; messaging_limit_tier?: string }[] }
          | null;
        const row = b2?.data?.find((p) => p.id === phoneId) ?? b2?.data?.[0];
        tier = tier ?? row?.messaging_limit_tier ?? null;
        quality = quality ?? row?.quality_rating ?? null;
      }
    } catch {
      // Meta unreachable — the manual budget below still applies.
    }
  }
  const metaLimit = tierDailyLimit(tier);
  const manual = manualDailyLimit();
  const limit = metaLimit != null && manual != null
    ? Math.min(metaLimit, manual)
    : metaLimit ?? manual;
  if (!tier && !quality && limit == null) return null;
  return { tier, quality, limit };
}

// Unique contacts who got a business-initiated (template) message in the
// rolling 24h — Meta's tier counts unique users, not messages. 'queued' rows
// are in-flight claims about to become sends, so they count too. Paged past
// PostgREST's 1000-row cap.
export async function countBusinessInitiated24h(sb: ReturnType<typeof db>): Promise<number | null> {
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("wa_messages")
      .select("contact_id")
      .eq("direction", "outbound")
      .not("template_name", "is", null)
      .in("status", ["queued", "sent", "delivered", "read"])
      .gte("created_at", sinceIso)
      .range(from, from + 999);
    if (error) return null; // unknown usage → caller must not fabricate a budget
    if (!data || data.length === 0) break;
    for (const r of data as { contact_id: string | null }[]) {
      if (r.contact_id) seen.add(r.contact_id);
    }
    if (data.length < 1000) break;
  }
  return seen.size;
}
