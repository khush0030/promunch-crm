import { NextResponse } from "next/server";
import { parsePeriod, periodWindow, previousWindow, type PeriodKey } from "@/lib/metrics/period";
import { aggregateSales, type SalesMetrics } from "@/lib/metrics/sales-aggregate";
import { fetchAmazonFinance, fetchAmazonOrders, fetchShopify } from "@/lib/metrics/sales-fetch";

// The ONE source of sales numbers for the Home and Sales pages: Shopify
// (web/HYPD/other) + Amazon, current window vs the same-length previous
// window. Server-side because shopify_orders/amazon_* are admin-only for the
// browser. Middleware gates /api/*, so no auth code here.
//
// GET /api/metrics/sales?period=7d|30d|90d|12m[&fresh=1]
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;

// Home polls this; a 60s in-memory cache per period keeps the DB calm.
const cache = new Map<PeriodKey, { at: number; body: SalesMetrics }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams.get("period"));
  const fresh = url.searchParams.get("fresh") === "1";

  const hit = cache.get(period);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "hit" } });
  }

  const window = periodWindow(period);
  const previous = previousWindow(window);
  const sinceIso = previous.from.toISOString();

  try {
    const [shopify, amazonFinance, amazonOrders] = await Promise.all([
      fetchShopify(sinceIso),
      fetchAmazonFinance(sinceIso),
      fetchAmazonOrders(sinceIso),
    ]);

    const body = aggregateSales({ period, window, previous, shopify, amazonFinance, amazonOrders });
    cache.set(period, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch (e) {
    console.error("[metrics/sales]", period, e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sales metrics failed" },
      { status: 502 },
    );
  }
}
