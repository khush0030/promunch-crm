import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Per-segment rollup for the campaigns segment overview.
// GET /api/whatsapp/segments  ->  { segments: [{ rfm_tier, customers, spend, avg_recency }] }
//
// Two kinds of rows are returned, keyed by `rfm_tier` (matches the audience tag):
//   1. RFM tiers (rfm:vip, rfm:loyal, …) — buyers, from wa_rfm_summary() over shopify_orders.
//   2. Prospect buckets — opted-in phones with NO purchase history (no rfm:* tag), so spend is
//      ₹0. These carry a source tag instead of an RFM tier. They are mutually exclusive from
//      buyers (an rfm-tagged contact never also carries these), so a plain `contains(tag)` count
//      is exact. This is what surfaces the ~470 phone contacts that have never ordered.
const PROSPECT_TAGS = ["crm_import", "order_phone", "lead"];

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc("wa_rfm_summary");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prospects = await Promise.all(
    PROSPECT_TAGS.map(async (tag) => {
      const { count } = await supabaseAdmin
        .from("wa_contacts")
        .select("id", { count: "exact", head: true })
        .eq("opted_in", true)
        .contains("tags", [tag]);
      return { rfm_tier: tag, customers: count ?? 0, spend: 0, avg_recency: 0 };
    })
  );

  return NextResponse.json({
    segments: [...(data ?? []), ...prospects.filter((p) => p.customers > 0)],
  });
}
