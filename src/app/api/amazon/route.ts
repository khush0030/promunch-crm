import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAllowedEmail } from "@/lib/auth-domains";

// Amazon financials endpoint for /dashboard/amazon.
// Reads the SP-API mirror tables (written by the amazon-poll edge function) with
// the service role, so the browser never touches raw/PII. Returns:
//   - sales/net rollups (today / 7d / 30d / all) with the Amazon-fee breakdown
//   - recent orders
//   - low-stock SKUs
//   - settlements + reconciliation status (computed net vs bank deposit)

export const dynamic = "force-dynamic";

const IST = 5.5 * 60 * 60 * 1000;
function istDayStart(daysAgo = 0): string {
  const ist = new Date(Date.now() + IST);
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - daysAgo * 86_400_000;
  return new Date(midnight - IST).toISOString();
}
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type FeeRow = { posted_date: string | null; gross: number; promo: number; referral_fee: number; fba_fee: number; other_fees: number; net: number; event_type: string };

function rollup(rows: FeeRow[], since: string | null) {
  const sel = since ? rows.filter((r) => r.posted_date && r.posted_date >= since) : rows;
  const sum = (k: keyof FeeRow) => sel.reduce((a, r) => a + n(r[k]), 0);
  const fees = sum("referral_fee") + sum("fba_fee") + sum("other_fees"); // negative
  const gross = sum("gross");
  return {
    gross: Math.round(gross * 100) / 100,
    promo: Math.round(sum("promo") * 100) / 100,
    referralFee: Math.round(sum("referral_fee") * 100) / 100,
    fbaFee: Math.round(sum("fba_fee") * 100) / 100,
    otherFees: Math.round(sum("other_fees") * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    net: Math.round(sum("net") * 100) / 100,
    feePct: gross ? Math.round((-fees / gross) * 1000) / 10 : 0,
    events: sel.length,
  };
}

// Self-guard: middleware does NOT gate /api/*, and this route returns revenue
// figures — so verify an allowed, logged-in user before returning anything.
async function authed(): Promise<boolean> {
  const store = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return !!user && isAllowedEmail(user.email);
}

export async function GET() {
  if (!(await authed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin;

  // Finance events (cap to last 90 days for the page; older lives in DB).
  const since90 = istDayStart(90);
  const { data: fe } = await db
    .from("amazon_finance_events")
    .select("posted_date, gross, promo, referral_fee, fba_fee, other_fees, net, event_type")
    .gte("posted_date", since90)
    .order("posted_date", { ascending: false });
  const feeRows = (fe ?? []) as FeeRow[];

  const financials = {
    today: rollup(feeRows, istDayStart(0)),
    d7: rollup(feeRows, istDayStart(7)),
    d30: rollup(feeRows, istDayStart(30)),
    d90: rollup(feeRows, null),
  };

  // Orders rollup (count + gross order value) from amazon_orders.
  const { data: orders } = await db
    .from("amazon_orders")
    .select("amazon_order_id, order_status, purchase_date, order_total, currency, fulfillment_channel, number_of_items_shipped")
    .order("purchase_date", { ascending: false })
    .limit(50);
  const recentOrders = (orders ?? []).map((o) => ({
    id: o.amazon_order_id,
    status: o.order_status,
    date: o.purchase_date,
    total: n(o.order_total),
    currency: o.currency,
    channel: o.fulfillment_channel === "AFN" ? "FBA" : "Merchant",
  }));

  const { count: orderCount } = await db.from("amazon_orders").select("*", { count: "exact", head: true });

  // Low stock.
  const { data: low } = await db
    .from("amazon_inventory")
    .select("seller_sku, product_name, fulfillable_quantity, inbound_shipped")
    .lte("fulfillable_quantity", 10)
    .order("fulfillable_quantity", { ascending: true })
    .limit(30);
  const { count: skuCount } = await db.from("amazon_inventory").select("*", { count: "exact", head: true });

  // ---- Per-SKU unit economics (trailing 90d, velocity from trailing 30d) ----
  // Source: amazon_finance_item_events — the per-item explode of Amazon's own
  // finance events, so every fee here is what Amazon ACTUALLY charged, not a
  // rate-card estimate. COGS joins from amazon_sku_costs (manual input).
  const since30 = istDayStart(30);
  const { data: itemEv } = await db
    .from("amazon_finance_item_events")
    .select("seller_sku, event_type, posted_date, quantity, gross, promo, referral_fee, fba_fee, closing_fee, other_fees, net")
    .gte("posted_date", since90);
  const { data: costs } = await db.from("amazon_sku_costs").select("seller_sku, cost_per_unit, note");
  const { data: invAll } = await db
    .from("amazon_inventory")
    .select("seller_sku, asin, product_name, fulfillable_quantity, inbound_working, inbound_shipped, inbound_receiving");
  const { data: itemTitles } = await db
    .from("amazon_order_items")
    .select("seller_sku, asin, title")
    .order("created_at", { ascending: false })
    .limit(1500);

  const costBySku = new Map((costs ?? []).map((c) => [c.seller_sku, n(c.cost_per_unit)]));
  const invBySku = new Map((invAll ?? []).map((i) => [i.seller_sku, i]));
  const titleBySku = new Map<string, { title: string | null; asin: string | null }>();
  for (const t of itemTitles ?? []) {
    if (t.seller_sku && !titleBySku.has(t.seller_sku)) titleBySku.set(t.seller_sku, { title: t.title, asin: t.asin });
  }

  type SkuAgg = {
    units30: number; units90: number; gross90: number; promo90: number;
    referral90: number; fba90: number; closing90: number; otherFees90: number;
    net90: number; refundUnits90: number; refundNet90: number;
  };
  const agg = new Map<string, SkuAgg>();
  for (const ev of itemEv ?? []) {
    if (!ev.seller_sku) continue;
    let s = agg.get(ev.seller_sku);
    if (!s) {
      s = { units30: 0, units90: 0, gross90: 0, promo90: 0, referral90: 0, fba90: 0, closing90: 0, otherFees90: 0, net90: 0, refundUnits90: 0, refundNet90: 0 };
      agg.set(ev.seller_sku, s);
    }
    if (ev.event_type === "Refund") {
      s.refundUnits90 += n(ev.quantity);
      s.refundNet90 += n(ev.net);
      continue;
    }
    s.units90 += n(ev.quantity);
    s.gross90 += n(ev.gross);
    s.promo90 += n(ev.promo);
    s.referral90 += n(ev.referral_fee);
    s.fba90 += n(ev.fba_fee);
    s.closing90 += n(ev.closing_fee);
    s.otherFees90 += n(ev.other_fees);
    s.net90 += n(ev.net);
    if (ev.posted_date && ev.posted_date >= since30) s.units30 += n(ev.quantity);
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const skuEconomics = [...agg.entries()].map(([sku, s]) => {
    const inv = invBySku.get(sku);
    const meta = titleBySku.get(sku);
    const isFba = !!inv;
    const fees90 = s.referral90 + s.fba90 + s.closing90 + s.otherFees90; // negative
    const units = s.units90 || 0;
    const avgPrice = units ? s.gross90 / units : 0;
    const netPerUnit = units ? s.net90 / units : 0;
    const cogs = costBySku.get(sku) ?? null;
    const profitPerUnit = cogs != null && units ? netPerUnit - cogs : null;
    // Sales velocity: trailing 30d preferred; a stocked-out SKU sells 0 in the
    // last 30d, so fall back to the 90d rate to estimate what it WOULD sell.
    const velocity = s.units30 > 0 ? s.units30 / 30 : units / 90;
    const fulfillable = inv ? n(inv.fulfillable_quantity) : null;
    const inbound = inv ? n(inv.inbound_working) + n(inv.inbound_shipped) + n(inv.inbound_receiving) : null;
    const daysCover = isFba && velocity > 0 && fulfillable != null ? fulfillable / velocity : null;
    const outOfStock = isFba && fulfillable === 0;
    const lostRevenuePerDay = outOfStock && velocity > 0 ? velocity * avgPrice : 0;
    const lostNetPerDay = outOfStock && velocity > 0 ? velocity * netPerUnit : 0;
    const lostProfitPerDay = outOfStock && velocity > 0 && profitPerUnit != null ? velocity * profitPerUnit : null;
    return {
      sku,
      title: inv?.product_name ?? meta?.title ?? sku,
      asin: inv?.asin ?? meta?.asin ?? null,
      isFba,
      units30: s.units30,
      units90: units,
      gross90: r2(s.gross90),
      promo90: r2(s.promo90),
      referral90: r2(s.referral90),
      fba90: r2(s.fba90),
      closing90: r2(s.closing90),
      otherFees90: r2(s.otherFees90),
      net90: r2(s.net90),
      refundUnits90: s.refundUnits90,
      refundNet90: r2(s.refundNet90),
      avgPrice: r2(avgPrice),
      feesPerUnit: units ? r2(-fees90 / units) : 0,
      feePct: s.gross90 ? Math.round((-fees90 / s.gross90) * 1000) / 10 : 0,
      netPerUnit: r2(netPerUnit),
      cogs,
      profitPerUnit: profitPerUnit != null ? r2(profitPerUnit) : null,
      marginPct: profitPerUnit != null && avgPrice ? Math.round((profitPerUnit / avgPrice) * 1000) / 10 : null,
      velocity: Math.round(velocity * 100) / 100,
      fulfillable,
      inbound,
      daysCover: daysCover != null ? Math.round(daysCover) : null,
      outOfStock,
      lostRevenuePerDay: r2(lostRevenuePerDay),
      lostNetPerDay: r2(lostNetPerDay),
      lostProfitPerDay: lostProfitPerDay != null ? r2(lostProfitPerDay) : null,
    };
  }).sort((a, b) => b.gross90 - a.gross90);

  // Settlements + reconciliation.
  const { data: settlements } = await db
    .from("amazon_settlements")
    .select("settlement_id, currency, total_deposit, period_start, period_end, deposit_date, gross_sales, fees_total, refunds_total, line_sum, variance, reconciled, recon_note, breakdown")
    .order("deposit_date", { ascending: false })
    .limit(12);

  // Sync freshness.
  const { data: sync } = await db.from("amazon_sync_state").select("key, watermark, updated_at");

  return NextResponse.json({
    ok: true,
    financials,
    orders: { recent: recentOrders, total: orderCount ?? 0 },
    inventory: { lowStock: low ?? [], skuCount: skuCount ?? 0 },
    skuEconomics,
    settlements: settlements ?? [],
    sync: sync ?? [],
  });
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
