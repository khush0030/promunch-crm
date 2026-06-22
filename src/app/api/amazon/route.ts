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
