import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { aggregateProducts, aggregateRepeat, type BuyerOrderRow } from "@/lib/metrics/buyers-aggregate";

// GET /api/metrics/buyers?view=repeat
// GET /api/metrics/buyers?view=products&period=30d|90d
// Insights → Repeat & cohorts / What people buy. Read only: shopify_orders
// (website orders) and the wa_rfm_summary() customer groups. Session-gated by
// the middleware; mapped to the Sales area in src/lib/access.ts.
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const PAGE = 1000;
const TTL_MS = 5 * 60_000;
const LIGHT =
  "shopify_id, total_price, shopify_created_at, financial_status, source_name, first_utm_source, first_source, is_creator, customer_order_index, customer_phone, customer_email";

const cache = new Map<string, { at: number; body: unknown }>();

async function fetchOrders(sinceIso: string, withItems: boolean): Promise<BuyerOrderRow[]> {
  const rows: BuyerOrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("shopify_orders")
      .select(withItems ? `${LIGHT}, line_items` : LIGHT)
      .gte("shopify_created_at", sinceIso)
      .order("shopify_created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`shopify_orders: ${error.message}`);
    const page = (data ?? []) as unknown as BuyerOrderRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "products" ? "products" : "repeat";
  const period = url.searchParams.get("period") === "90d" ? "90d" : "30d";
  const key = `${view}:${period}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && url.searchParams.get("fresh") !== "1") return NextResponse.json(hit.body);

  const now = new Date();
  // 400 days of history tells a new buyer from a returning one.
  const since = new Date(now.getTime() - 400 * DAY_MS);
  try {
    let body: unknown;
    if (view === "repeat") {
      const [rows, rfm] = await Promise.all([
        fetchOrders(since.toISOString(), false),
        supabaseAdmin.rpc("wa_rfm_summary").then(
          (r) => (r.error ? null : ((r.data ?? []) as { rfm_tier: string; customers: number; spend: number }[])),
          () => null,
        ),
      ]);
      body = { ...aggregateRepeat(rows, now, since), groups: rfm };
    } else {
      // Line items only for the last 180 days (window + first orders 30 to
      // 180 days old); older orders only need dates to spot returning buyers.
      const itemsSince = new Date(now.getTime() - 180 * DAY_MS);
      const [old, recent] = await Promise.all([
        fetchOrders(since.toISOString(), false),
        fetchOrders(itemsSince.toISOString(), true),
      ]);
      const recentIds = new Set(recent.map((r) => String(r.shopify_id)));
      const rows = [...old.filter((r) => !recentIds.has(String(r.shopify_id))), ...recent];
      const days = period === "90d" ? 90 : 30;
      body = { period, ...aggregateProducts(rows, { from: new Date(now.getTime() - days * DAY_MS), to: now }, now) };
    }
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    console.error("[metrics/buyers]", view, e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "buyers metrics failed" }, { status: 502 });
  }
}
