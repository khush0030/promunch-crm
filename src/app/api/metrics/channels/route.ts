import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parsePeriod, periodWindow, previousWindow, type PeriodKey } from "@/lib/metrics/period";
import { aggregateChannels, type AmazonItemRow, type AmazonListingRow, type ChannelsMetrics } from "@/lib/metrics/channels-aggregate";
import { fetchAll, fetchAmazonFinance, fetchAmazonOrders, fetchShopify } from "@/lib/metrics/sales-fetch";

// Insights → Channels: every sales channel side by side plus a cross-channel
// product table. Reads the same rows as /api/metrics/sales (shared fetchers)
// so the channel totals match the Sales tab exactly, plus Amazon per-SKU
// finance item events and listing names. Read-only, service role on the
// server; middleware gates /api/* (session + the "sales" area in access.ts).
//
// GET /api/metrics/channels?period=7d|30d|90d|12m[&fresh=1]
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const cache = new Map<PeriodKey, { at: number; body: ChannelsMetrics }>();

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
    const [shopify, amazonFinance, amazonOrders, amazonItems, invRes, titlesRes] = await Promise.all([
      fetchShopify(sinceIso),
      fetchAmazonFinance(sinceIso),
      fetchAmazonOrders(sinceIso),
      // Only the current window feeds the product table.
      fetchAll<AmazonItemRow>(
        "amazon_finance_item_events",
        "seller_sku, event_type, posted_date, quantity, gross",
        "posted_date",
        window.from.toISOString(),
      ),
      supabaseAdmin.from("amazon_inventory").select("seller_sku, asin, product_name"),
      supabaseAdmin.from("amazon_order_items").select("seller_sku, asin, title").order("created_at", { ascending: false }).limit(3000),
    ]);
    if (invRes.error) throw new Error(`amazon_inventory: ${invRes.error.message}`);
    if (titlesRes.error) throw new Error(`amazon_order_items: ${titlesRes.error.message}`);

    // Inventory names first (the listing's current title), then order items.
    const amazonListings: AmazonListingRow[] = [
      ...((invRes.data ?? []) as { seller_sku: string | null; asin: string | null; product_name: string | null }[]).map((r) => ({
        seller_sku: r.seller_sku,
        asin: r.asin,
        title: r.product_name,
      })),
      ...((titlesRes.data ?? []) as AmazonListingRow[]),
    ];

    const body = aggregateChannels({ period, window, previous, shopify, amazonFinance, amazonOrders, amazonItems, amazonListings });
    cache.set(period, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch (e) {
    console.error("[metrics/channels]", period, e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "channel metrics failed" },
      { status: 502 },
    );
  }
}
