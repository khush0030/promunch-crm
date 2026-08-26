import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TIERS, TIER_TAGS, type Tier } from "@/lib/wa-engagement";

// Estimate the number of opted-in WhatsApp recipients for a campaign audience,
// and break that audience down by engagement tier so the campaign builder can
// tell staff how much of it is a cold list.
//
// GET /api/whatsapp/audience?tags=rfm:vip,tier:engaged  (tags optional)
//   -> { count, byTier: { engaged, reachable, subscribed, imported, suppressed } }
//
// Counting mirrors the send engine exactly: opted_in = true, plus a tag OVERLAP
// (union) when tags are given — see wa-campaign-send. byTier comes off the
// wa_contact_engagement view (live truth, never a stale tag), and is omitted
// when migration 014 has not been applied yet.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tags = (searchParams.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let q = supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true })
    .eq("opted_in", true);
  if (tags.length) q = q.overlaps("tags", tags);

  const { count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tiered = await Promise.all(
    TIERS.map(async (tier: Tier) => {
      let tq = supabaseAdmin
        .from("wa_contact_engagement")
        .select("id", { count: "exact", head: true })
        .eq("opted_in", true)
        .eq("engagement_tier", TIER_TAGS[tier]);
      if (tags.length) tq = tq.overlaps("tags", tags);
      const r = await tq;
      return [tier, r.error ? null : r.count ?? 0] as const;
    }),
  );

  const byTier = tiered.every(([, v]) => v == null)
    ? null // view missing (migration 014 not applied) — say nothing rather than guess
    : (Object.fromEntries(tiered.map(([k, v]) => [k, v ?? 0])) as Record<Tier, number>);

  return NextResponse.json({ count: count ?? 0, byTier });
}
