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
import { getAppSecret } from "./app-secrets.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

export interface WaStanding {
  tier: string | null;     // e.g. TIER_250, TIER_2K, TIER_UNLIMITED
  limit: number | null;    // unique users / 24h; null = unknown or unlimited
  quality: string | null;  // GREEN | YELLOW | RED | NA
}

const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

export function tierDailyLimit(tier: string | null | undefined): number | null {
  if (!tier || tier === "TIER_UNLIMITED") return null;
  return TIER_LIMIT[tier.toUpperCase()] ?? null;
}

// Operator-set daily budget. Meta omits the messaging-limit tier for numbers
// without an established tier (ours, as of Jul 2026: business verified, GREEN
// quality, no tier reported), and the observed ceiling (~250 marketing
// sends/day) bites before any tier anyway. When both exist the LOWER wins —
// this is "my daily budget", never permission to exceed the tier.
//
// Source order: app_secrets.WA_DAILY_SEND_LIMIT (editable in the dashboard,
// takes effect within a minute) → Deno.env fallback. So staff can change the
// budget from the Campaigns tab with no CLI and no redeploy.
export async function manualDailyLimit(): Promise<number | null> {
  const raw = (await getAppSecret("WA_DAILY_SEND_LIMIT")) ?? Deno.env.get("WA_DAILY_SEND_LIMIT") ?? "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Meta deprecated `messaging_limit_tier`; the current phone-number field is
// `whatsapp_business_manager_messaging_limit` (values TIER_250, TIER_2K,
// TIER_10K, TIER_100K, TIER_UNLIMITED). Asking Graph for a field it does not
// know fails the WHOLE request, so each field is requested on its own and the
// deprecated one is only a fallback.
export const LIMIT_FIELD = "whatsapp_business_manager_messaging_limit";
export const LEGACY_LIMIT_FIELD = "messaging_limit_tier";

async function graphGet(url: string, token: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (!r.ok || !body || body.error) return null;
    return body;
  } catch {
    return null;
  }
}

// Pull the tier out of a phone-number object: new field first, legacy second.
export function tierFromPhone(p: Record<string, unknown> | null | undefined): string | null {
  const v = p?.[LIMIT_FIELD] ?? p?.[LEGACY_LIMIT_FIELD];
  return typeof v === "string" && v ? v : null;
}

export async function fetchWaTier(token: string, phoneId: string): Promise<string | null> {
  for (const field of [LIMIT_FIELD, LEGACY_LIMIT_FIELD]) {
    const b = await graphGet(`${GRAPH}/${phoneId}?fields=${field}`, token);
    const t = tierFromPhone(b);
    if (t) return t;
  }
  const waba = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (waba) {
    for (const field of [LIMIT_FIELD, LEGACY_LIMIT_FIELD]) {
      const b = await graphGet(`${GRAPH}/${waba}/phone_numbers?fields=id,${field}`, token);
      const rows = Array.isArray(b?.data) ? b!.data as Record<string, unknown>[] : [];
      const row = rows.find((p) => p.id === phoneId) ?? rows[0];
      const t = tierFromPhone(row);
      if (t) return t;
    }
  }
  return null;
}

export async function fetchWaStanding(): Promise<WaStanding | null> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  let tier: string | null = null;
  let quality: string | null = null;
  if (token && phoneId) {
    tier = await fetchWaTier(token, phoneId);
    const q = await graphGet(`${GRAPH}/${phoneId}?fields=quality_rating`, token);
    quality = typeof q?.quality_rating === "string" ? q.quality_rating : null;
    const waba = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
    if (!quality && waba) {
      const b2 = await graphGet(`${GRAPH}/${waba}/phone_numbers?fields=id,quality_rating`, token);
      const rows = Array.isArray(b2?.data) ? b2!.data as Record<string, unknown>[] : [];
      const row = rows.find((p) => p.id === phoneId) ?? rows[0];
      quality = typeof row?.quality_rating === "string" ? row.quality_rating : null;
    }
  }
  const metaLimit = tierDailyLimit(tier);
  const manual = await manualDailyLimit();
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
  const u = await businessInitiatedUsage24h(sb);
  return u ? u.count : null;
}

// Same count, plus WHEN the budget frees up. A contact stops counting against
// the rolling window only once their LATEST send in it ages out, so we keep each
// contact's latest stamp and report the minimum across contacts: the first
// moment one slot frees. `nonCampaign` = unique contacts whose window sends were
// all non-campaign (utility / journeys), used for ETA estimates.
export interface Usage24h {
  count: number;
  oldestAt: number | null;
  nonCampaign: number;
}
export async function businessInitiatedUsage24h(sb: ReturnType<typeof db>): Promise<Usage24h | null> {
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  const latest = new Map<string, number>();
  const campaignTouched = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("wa_messages")
      .select("contact_id, created_at, campaign_id")
      .eq("direction", "outbound")
      .not("template_name", "is", null)
      .in("status", ["queued", "sent", "delivered", "read"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) return null; // unknown usage → caller must not fabricate a budget
    if (!data || data.length === 0) break;
    for (const r of data as { contact_id: string | null; created_at: string; campaign_id: string | null }[]) {
      if (!r.contact_id) continue;
      const t = Date.parse(r.created_at);
      if (Number.isFinite(t) && t > (latest.get(r.contact_id) ?? 0)) latest.set(r.contact_id, t);
      if (r.campaign_id) campaignTouched.add(r.contact_id);
    }
    if (data.length < 1000) break;
  }
  let oldestAt: number | null = null;
  for (const t of latest.values()) if (oldestAt == null || t < oldestAt) oldestAt = t;
  let nonCampaign = 0;
  for (const id of latest.keys()) if (!campaignTouched.has(id)) nonCampaign++;
  return { count: latest.size, oldestAt, nonCampaign };
}
