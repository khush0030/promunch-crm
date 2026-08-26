import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TIERS, TIER_TAGS, type Tier } from "@/lib/wa-engagement";

export const dynamic = "force-dynamic";

// Audience-quality scoreboard for the WhatsApp module.
// GET /api/whatsapp/engagement
//
// Everything here is computed from production rows by wa_audience_health()
// (migration 014) — one round trip, no estimates. If the migration has not been
// pasted into the SQL editor yet the route says so plainly instead of guessing.

type Health = {
  total: number;
  opted_in: number;
  tiers: Record<string, number>;
  marketing30d: { sent: number; failed: number; delivered: number };
  warm30d: { sent: number; failed: number };
  cold30d: { sent: number; failed: number };
  inbound30d: number;
  consent30d: number;
  consentTotal: number;
  generated_at: string;
};

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc("wa_audience_health");
  if (error) {
    // 42883 = function does not exist / PGRST202 = not in the schema cache.
    const missing = error.code === "42883" || error.code === "PGRST202";
    return NextResponse.json(
      {
        error: error.message,
        needsMigration: missing,
        hint: missing
          ? "Apply supabase/migrations/014_wa_engagement_tiers_and_consent.sql in the Supabase SQL editor."
          : undefined,
      },
      { status: missing ? 503 : 500 },
    );
  }

  const h = data as Health;
  const byTier = Object.fromEntries(
    TIERS.map((t) => [t, h.tiers?.[TIER_TAGS[t]] ?? 0]),
  ) as Record<Tier, number>;

  const mkt = h.marketing30d ?? { sent: 0, failed: 0, delivered: 0 };
  const cold = h.cold30d ?? { sent: 0, failed: 0 };
  const warm = h.warm30d ?? { sent: 0, failed: 0 };

  return NextResponse.json({
    total: h.total,
    optedIn: h.opted_in,
    byTier,
    engaged: byTier.engaged,
    suppressed: byTier.suppressed,
    marketing30d: {
      ...mkt,
      deliveryRate: rate(mkt.delivered, mkt.sent),
    },
    // The two numbers that justify the whole tiering exercise: what Meta does
    // with a message to someone who has replied to us, versus someone who never has.
    warm30d: { ...warm, deliveryRate: rate(warm.sent - warm.failed, warm.sent) },
    cold30d: {
      ...cold,
      deliveryRate: rate(cold.sent - cold.failed, cold.sent),
      blockRate: rate(cold.failed, cold.sent),
    },
    inbound30d: h.inbound30d,
    consent30d: h.consent30d,
    consentTotal: h.consentTotal,
    generatedAt: h.generated_at,
  });
}
