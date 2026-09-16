import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAllowedEmail } from "@/lib/auth-domains";
import { parsePeriod, periodWindow, previousWindow } from "@/lib/metrics/period";
import {
  buildAmazonMetrics,
  VELOCITY_DAYS,
  type AmazonPeriodKey,
  type AmazonMetricsInput,
  type AmazonFinanceEventRow,
  type AmazonItemEventRow,
  type AmazonInventoryRow,
  type AmazonCostRow,
  type AmazonTitleRow,
  type AmazonSettlementRow,
  type AmazonOrderRow,
  type AmazonSyncRow,
  type AmazonMetrics,
} from "@/lib/amazon/economics";

// Amazon financials endpoint for /dashboard/sales/amazon (5 tabs: overview,
// stock, profit, payouts, orders). Reads the SP-API mirror tables (written by
// the amazon-poll edge function) with the service role, so the browser never
// touches raw/PII. All the arithmetic lives in src/lib/amazon/economics.ts
// (shared with the Needs Attention feed's stock-out aggregator) — this route
// only fetches rows and hands them to buildAmazonMetrics().
//
// GET /api/amazon?period=7d|30d|90d[&fresh=1]  (12m clamps to 90d)

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;

const cache = new Map<AmazonPeriodKey, { at: number; body: AmazonMetrics }>();

// Self-guard: middleware does NOT gate /api/*, and this route returns
// revenue figures — so verify an allowed, logged-in user before returning
// anything.
async function authed(): Promise<boolean> {
  const store = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && isAllowedEmail(user.email);
}

// PostgREST caps a single select at 1000 rows, so date-bounded tables are
// walked in 1000-row pages ordered by posted_date. Inventory, costs, titles,
// settlements, orders and sync state are small/capped tables and are fetched
// whole (or with their own .limit), not paged here.
async function fetchAll<T>(table: string, columns: string, sinceIso: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .gte("posted_date", sinceIso)
      .order("posted_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function GET(req: Request) {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawPeriod = parsePeriod(url.searchParams.get("period"));
  const period: AmazonPeriodKey = rawPeriod === "12m" ? "90d" : rawPeriod;
  const fresh = url.searchParams.get("fresh") === "1";

  const hit = cache.get(period);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body, { headers: { "x-cache": "hit" } });
  }

  const now = new Date();
  const window = periodWindow(period, now);
  const previous = previousWindow(window);
  const velocityFrom = new Date(now.getTime() - VELOCITY_DAYS * DAY_MS);
  // Item events feed both the period's per-SKU units AND the always-30-day
  // velocity basis, so fetch back to whichever is earlier.
  const itemSinceIso = new Date(Math.min(previous.from.getTime(), velocityFrom.getTime())).toISOString();
  const financeSinceIso = previous.from.toISOString();

  const db = supabaseAdmin;

  try {
    const [
      financeEvents,
      itemEvents,
      invRes,
      costsRes,
      titlesRes,
      settlementsRes,
      recentOrdersRes,
      periodCountRes,
      prevCountRes,
      syncRes,
    ] = await Promise.all([
      fetchAll<AmazonFinanceEventRow>(
        "amazon_finance_events",
        "posted_date, event_type, gross, promo, referral_fee, fba_fee, other_fees, net",
        financeSinceIso,
      ),
      fetchAll<AmazonItemEventRow>(
        "amazon_finance_item_events",
        "seller_sku, event_type, posted_date, quantity, gross, promo, referral_fee, fba_fee, closing_fee, other_fees, net",
        itemSinceIso,
      ),
      db
        .from("amazon_inventory")
        .select("seller_sku, asin, product_name, fulfillable_quantity, inbound_working, inbound_shipped, inbound_receiving"),
      db.from("amazon_sku_costs").select("seller_sku, cost_per_unit"),
      db.from("amazon_order_items").select("seller_sku, asin, title").order("created_at", { ascending: false }).limit(1500),
      db
        .from("amazon_settlements")
        .select(
          "settlement_id, total_deposit, period_start, period_end, deposit_date, gross_sales, fees_total, refunds_total, line_sum, variance, recon_note",
        )
        .order("deposit_date", { ascending: false })
        .limit(12),
      db
        .from("amazon_orders")
        .select("amazon_order_id, order_status, purchase_date, order_total, number_of_items_shipped, number_of_items_unshipped, fulfillment_channel")
        .order("purchase_date", { ascending: false })
        .limit(50),
      db
        .from("amazon_orders")
        .select("*", { count: "exact", head: true })
        .gte("purchase_date", window.from.toISOString())
        .lt("purchase_date", window.to.toISOString())
        .not("order_status", "ilike", "canceled"),
      db
        .from("amazon_orders")
        .select("*", { count: "exact", head: true })
        .gte("purchase_date", previous.from.toISOString())
        .lt("purchase_date", previous.to.toISOString())
        .not("order_status", "ilike", "canceled"),
      db.from("amazon_sync_state").select("key, updated_at"),
    ]);

    if (invRes.error) throw new Error(`amazon_inventory: ${invRes.error.message}`);
    if (costsRes.error) throw new Error(`amazon_sku_costs: ${costsRes.error.message}`);
    if (titlesRes.error) throw new Error(`amazon_order_items: ${titlesRes.error.message}`);
    if (settlementsRes.error) throw new Error(`amazon_settlements: ${settlementsRes.error.message}`);
    if (recentOrdersRes.error) throw new Error(`amazon_orders (recent): ${recentOrdersRes.error.message}`);
    if (periodCountRes.error) throw new Error(`amazon_orders (period count): ${periodCountRes.error.message}`);
    if (prevCountRes.error) throw new Error(`amazon_orders (prev count): ${prevCountRes.error.message}`);
    if (syncRes.error) throw new Error(`amazon_sync_state: ${syncRes.error.message}`);

    const input: AmazonMetricsInput = {
      now,
      period,
      financeEvents,
      itemEvents,
      inventory: (invRes.data ?? []) as AmazonInventoryRow[],
      costs: (costsRes.data ?? []) as AmazonCostRow[],
      titles: (titlesRes.data ?? []) as AmazonTitleRow[],
      settlements: (settlementsRes.data ?? []) as AmazonSettlementRow[],
      recentOrders: (recentOrdersRes.data ?? []) as AmazonOrderRow[],
      orderCount: { period: periodCountRes.count ?? 0, prev: prevCountRes.count ?? 0 },
      sync: (syncRes.data ?? []) as AmazonSyncRow[],
    };

    const body = buildAmazonMetrics(input);
    cache.set(period, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "x-cache": "miss" } });
  } catch (e) {
    console.error("[api/amazon]", period, e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "amazon metrics failed" },
      { status: 502 },
    );
  }
}

// Manual "Sync now" — triggers the Supabase amazon-poll edge function on demand
// so the user can force a refresh (and see failures) from the dashboard, incl.
// mobile. The edge function holds the SP-API secrets and does the real work.
// Pass ?only=settlements to run just the (heavier) settlement ingest.
export async function POST(req: Request) {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return NextResponse.json({ ok: false, error: "Supabase env not configured" }, { status: 500 });
  }
  const only = new URL(req.url).searchParams.get("only");
  const target = `${base}/functions/v1/amazon-poll${only ? `?only=${encodeURIComponent(only)}` : ""}`;
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    const detail = (await r.text()).slice(0, 800);
    return NextResponse.json({ ok: r.ok, status: r.status, detail }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "trigger failed" }, { status: 502 });
  }
}
