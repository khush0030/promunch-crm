// Authoritative Shopify "state of affairs" for the dashboard:
//   - revenue + order counts for Today / last 7d / last 30d / all-time
//   - live customer count (from Shopify, not our mirror)
//
// Runs server-side (service role) so it can read the WHOLE shopify_orders table
// — including columns the browser anon role can't (none needed here, but it also
// means no PII is ever shipped to the client; only aggregates leave this fn).
//
// Called by the Next API route /api/shopify/stats (server→edge, like the other
// dashboard edge calls), so no CORS handling is needed and verify_jwt stays on.
//
// "Today" is computed in IST (Asia/Kolkata, UTC+5:30) — PROMUNCH is an Indian
// brand, so the owner's "today" is the IST calendar day, not UTC.

import { db } from "../_shared/supabase.ts";
import { adminGraphQL } from "../_shared/shopify-customer.ts";

const IST = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Start-of-today in IST, expressed as a UTC epoch ms.
function istTodayStartUtcMs(now: number): number {
  const ist = new Date(now + IST);
  const midnightIstAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return midnightIstAsUtc - IST;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Orders in these payment states don't count toward realized revenue.
const DEAD = new Set(["voided", "refunded"]);

Deno.serve(async () => {
  const now = Date.now();
  const todayStart = istTodayStartUtcMs(now);
  const d7 = now - 7 * DAY;
  const d30 = now - 30 * DAY;

  const { data, error } = await db()
    .from("shopify_orders")
    .select("total_price, shopify_created_at, financial_status");
  if (error) return json({ ok: false, error: error.message }, 500);

  const revenue = { today: 0, d7: 0, d30: 0, all: 0 };
  const orders = { today: 0, d7: 0, d30: 0, all: 0 };
  for (const o of data ?? []) {
    if (DEAD.has(String(o.financial_status ?? "").toLowerCase())) continue;
    const amt = Number(o.total_price) || 0;
    const t = Date.parse(o.shopify_created_at);
    revenue.all += amt; orders.all += 1;
    if (t >= d30) { revenue.d30 += amt; orders.d30 += 1; }
    if (t >= d7) { revenue.d7 += amt; orders.d7 += 1; }
    if (t >= todayStart) { revenue.today += amt; orders.today += 1; }
  }

  // Live customer count from Shopify (needs read_customers; write_customers covers it).
  let customers: number | null = null;
  try {
    const cj = await adminGraphQL(`{ customersCount { count } }`);
    customers = cj?.data?.customersCount?.count ?? null;
  } catch (_e) {
    customers = null; // fall back silently; revenue still returns
  }

  return json({
    ok: true,
    currency: "INR",
    revenue,
    orders,
    customers,
    aov_all: orders.all ? Math.round(revenue.all / orders.all) : 0,
    generated_at: new Date(now).toISOString(),
  });
});
