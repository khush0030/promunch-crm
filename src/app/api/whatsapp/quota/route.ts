import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Account standing + daily send budget for the WhatsApp number.
//
// Meta's messaging tier caps how many UNIQUE customers can receive a
// business-initiated (template) message per rolling 24h. This route returns
// the live tier + quality rating (via the wa-meta-info edge function, which
// owns the token) plus how much of today's budget is already used, so the
// Campaigns tab can show "you can reach N more people today" and the create
// modal can estimate how many days a blast will take.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

export async function GET() {
  // Live standing from Meta. Failure here must not 500 the tab — the UI shows
  // "standing unavailable" and the engine still paces reactively via #131049.
  let tier: string | null = null;
  let quality: string | null = null;
  let override: number | null = null;
  let standingError: string | null = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/wa-meta-info`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    });
    const j = await r.json();
    const phone = j?.phone ?? {};
    const edge = Array.isArray(j?.phoneNumbers?.data) ? j.phoneNumbers.data[0] : null;
    tier = phone.messaging_limit_tier ?? edge?.messaging_limit_tier ?? null;
    quality = phone.quality_rating ?? edge?.quality_rating ?? null;
    override = typeof j?.daily_limit_override === "number" ? j.daily_limit_override : null;
    if (!r.ok) standingError = phone?.error?.message ?? `wa-meta-info HTTP ${r.status}`;
  } catch (e) {
    standingError = String(e);
  }
  // Same rule as the engine (_shared/wa-quota.ts): Meta tier and the operator
  // budget (WA_DAILY_SEND_LIMIT secret) — the LOWER of the two wins. Meta
  // omits the tier for numbers without an established one (ours), so the
  // secret is usually what drives pacing.
  const metaLimit = !tier || tier === "TIER_UNLIMITED"
    ? null
    : TIER_LIMIT[tier.toUpperCase()] ?? null;
  const limit = metaLimit != null && override != null
    ? Math.min(metaLimit, override)
    : metaLimit ?? override;
  const limitSource = limit == null
    ? null
    : metaLimit != null && (override == null || metaLimit <= override) ? "meta" : "manual";

  // Unique contacts who got a business-initiated (template) send in the
  // rolling 24h — Meta counts unique users, not messages. queued rows are
  // in-flight claims about to become sends, so they count too.
  const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("wa_messages")
      .select("contact_id")
      .eq("direction", "outbound")
      .not("template_name", "is", null)
      .in("status", ["queued", "sent", "delivered", "read"])
      .gte("created_at", sinceIso)
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    for (const r of data as { contact_id: string | null }[]) if (r.contact_id) seen.add(r.contact_id);
    if (data.length < 1000) break;
  }
  const used = seen.size;

  return NextResponse.json({
    tier,
    quality,
    limit,
    limit_source: limitSource,
    used24h: used,
    remaining: limit != null ? Math.max(0, limit - used) : null,
    standing_error: standingError,
    checked_at: new Date().toISOString(),
  });
}
