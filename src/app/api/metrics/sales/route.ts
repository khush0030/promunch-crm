import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parsePeriod, periodWindow, previousWindow, type PeriodKey } from "@/lib/metrics/period";
import {
  aggregateSales,
  type AmazonFinanceRow,
  type AmazonOrderRow,
  type SalesMetrics,
  type ShopifySalesRow,
} from "@/lib/metrics/sales-aggregate";

// The ONE source of sales numbers for the Home and Sales pages: Shopify
// (web/HYPD/other) + Amazon, current window vs the same-length previous
// window. Server-side because shopify_orders/amazon_* are admin-only for the
// browser. Middleware gates /api/*, so no auth code here.
//
// GET /api/metrics/sales?period=7d|30d|90d|12m[&fresh=1]
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;

// Home polls this; a 60s in-memory cache per period keeps the DB calm.
const cache = new Map<PeriodKey, { at: number; body: SalesMetrics }>();

// PostgREST caps a single select at 1000 rows, so every table is walked in
// 1000-row pages ordered by its timestamp column; stop on a short page.
async function fetchAll<T>(table: string, columns: string, tsColumn: string, sinceIso: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .gte(tsColumn, sinceIso)
      .order(tsColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const fetchShopify = (sinceIso: string) =>
  fetchAll<ShopifySalesRow>(
    "shopify_orders",
    "total_price, shopify_created_at, financial_status, source_name, first_utm_source, first_source, is_creator, customer_order_index, line_items",
    "shopify_created_at",
    sinceIso,
  );

const fetchAmazonFinance = (sinceIso: string) =>
  fetchAll<AmazonFinanceRow>("amazon_finance_events", "posted_date, gross, net, event_type", "posted_date", sinceIso);

const fetchAmazonOrders = (sinceIso: string) =>
  fetchAll<AmazonOrderRow>("amazon_orders", "purchase_date, order_status", "purchase_date", sinceIso);

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
