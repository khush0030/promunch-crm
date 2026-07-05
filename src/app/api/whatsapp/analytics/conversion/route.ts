import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// WhatsApp -> order conversion via UTM attribution (Option A). Outbound links
// are tagged utm_source=whatsapp (see wa-send appendUtm + utm-tagged template
// buttons); Shopify's customer-journey records that on the order. We read those
// orders straight from shopify_orders — no redirect, no click tables — and
// group by campaign so staff see which WhatsApp pushes drove revenue.
//
// Matches on first OR last touch = whatsapp; excludes HYPD creator seeds and
// refunded/voided orders.

async function pageAll<T>(mk: () => any, cap = 60000): Promise<T[]> {
  const size = 1000;
  let from = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await mk().range(from, from + size - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < size || from >= cap) break;
    from += size;
  }
  return out;
}

type Ord = {
  total_price: number | string;
  financial_status: string | null;
  is_creator: boolean | null;
  first_utm_source: string | null;
  last_utm_source: string | null;
  first_utm_medium: string | null;
  last_utm_medium: string | null;
  first_utm_campaign: string | null;
  last_utm_campaign: string | null;
  first_landing_page: string | null;
  last_landing_page: string | null;
};

const hasWa = (s: string | null) => !!s && s.toLowerCase().includes("whatsapp");
// Landing-page fallback: Shopify sometimes records the raw landing URL without
// parsing its query into utmParameters — catch our tags there too.
const waLanding = (s: string | null) =>
  !!s && /utm_(source|medium)=whatsapp/i.test(s);
// A touch counts as WhatsApp if either its source or medium mentions whatsapp.
// (appendUtm sets source=whatsapp; some templates carry medium=whatsapp instead.)
const waLastTouch = (o: Ord) => hasWa(o.last_utm_source) || hasWa(o.last_utm_medium) || waLanding(o.last_landing_page);
const waFirstTouch = (o: Ord) => hasWa(o.first_utm_source) || hasWa(o.first_utm_medium) || waLanding(o.first_landing_page);

// utm_campaign recovered from the landing page URL when Shopify didn't parse it.
function landingCampaign(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/utm_campaign=([^&\s]+)/i);
  try { return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null; } catch { return m ? m[1] : null; }
}

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let orders: Ord[] = [];
  try {
    orders = await pageAll<Ord>(() =>
      supabaseAdmin
        .from("shopify_orders")
        .select("total_price,financial_status,is_creator,first_utm_source,last_utm_source,first_utm_medium,last_utm_medium,first_utm_campaign,last_utm_campaign,first_landing_page,last_landing_page")
        .gte("shopify_created_at", since)
    );
  } catch {
    return NextResponse.json(empty(days));
  }

  const live = orders.filter(
    (o) => !o.is_creator && o.financial_status !== "refunded" && o.financial_status !== "voided",
  );
  // last-touch wins for attribution; fall back to first-touch.
  const wa = live.filter((o) => waLastTouch(o) || waFirstTouch(o));

  const byCampaign = new Map<string, { orders: number; revenue: number; medium: string }>();
  let totalOrders = 0, totalRevenue = 0;
  for (const o of wa) {
    const lastWins = waLastTouch(o);
    const campaign =
      (lastWins ? o.last_utm_campaign : o.first_utm_campaign) ||
      landingCampaign(lastWins ? o.last_landing_page : o.first_landing_page) ||
      "(no campaign tag)";
    const medium = (lastWins ? o.last_utm_medium : o.first_utm_medium) || "—";
    const rev = Number(o.total_price || 0);
    const b = byCampaign.get(campaign) || { orders: 0, revenue: 0, medium };
    b.orders += 1; b.revenue += rev;
    byCampaign.set(campaign, b);
    totalOrders += 1; totalRevenue += rev;
  }

  const rows = [...byCampaign.entries()]
    .map(([campaign, b]) => ({ campaign, medium: b.medium, orders: b.orders, revenue: Math.round(b.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
    .slice(0, 30);

  return NextResponse.json({
    window: { days },
    totals: { orders: totalOrders, revenue: Math.round(totalRevenue) },
    rows,
  });
}

function empty(days: number) {
  return { window: { days }, totals: { orders: 0, revenue: 0 }, rows: [] };
}
