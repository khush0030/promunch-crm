import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parsePeriod, periodWindow, previousWindow, type PeriodKey } from "@/lib/metrics/period";
import { aggregateWeb, type WebMetrics, type WebOrderRow } from "@/lib/metrics/web-aggregate";

// Web-store attribution numbers for the Sales > Web store page: where orders
// came from, new vs returning, best campaigns. Server-side because
// shopify_orders is admin-only for the browser. Middleware gates /api/*, so
// no auth code here. Replaces the client-side aggregation that used to live
// in src/app/dashboard/shopify-attribution/page.tsx.
//
// GET /api/metrics/web?period=7d|30d|90d[&creators=include]
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;

type CacheKey = `${PeriodKey}:${"0" | "1"}`;
const cache = new Map<CacheKey, { at: number; body: WebMetrics }>();

const COLUMNS =
  "total_price, shopify_created_at, financial_status, source_name, first_utm_source, first_utm_medium, first_utm_campaign, first_source, first_source_type, first_referrer_url, is_creator, customer_order_index";

// PostgREST caps a single select at 1000 rows, so shopify_orders is walked in
// 1000-row pages ordered by shopify_created_at; stop on a short page.
async function fetchShopify(sinceIso: string): Promise<WebOrderRow[]> {
  const rows: WebOrderRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("shopify_orders")
      .select(COLUMNS)
      .gte("shopify_created_at", sinceIso)
      .order("shopify_created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`shopify_orders: ${error.message}`);
    const page = (data ?? []) as WebOrderRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams.get("period"));
  const includeCreators = url.searchParams.get("creators") === "include";
  const fresh = url.searchParams.get("fresh") === "1";
  const cacheKey: CacheKey = `${period}:${includeCreators ? "1" : "0"}`;

  const hit = cache.get(cacheKey);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "hit" } });
  }

  const window = periodWindow(period);
  const previous = previousWindow(window);
  const sinceIso = previous.from.toISOString();

  try {
    const shopify = await fetchShopify(sinceIso);
    const body = aggregateWeb({ period, window, previous, shopify, includeCreators });
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch (e) {
    console.error("[metrics/web]", period, e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "web metrics failed" },
      { status: 502 },
    );
  }
}
