import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Cart-recovery funnel for the WhatsApp dashboard tile.
//
// Each abandoned cart enrols TWO runs (reminder + recovery), so we aggregate by
// order_ref (the checkout token) to a single per-cart outcome — counting runs
// would double every number. Window: carts enrolled in the last 30 days.
//
// Outcome precedence per cart:
//   recovered : any run 'converted' (customer checked out after the nudge)
//   delivered : any run has delivered_at (a message landed, no purchase yet)
//   retrying  : any run still 'active' (in-flight, not yet delivered)
//   missed    : all runs terminal (expired/failed) with nothing delivered
export const dynamic = "force-dynamic";

export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("wa_journey_runs")
    .select("order_ref, status, delivered_at")
    .eq("journey_key", "abandoned_checkout")
    .gte("created_at", since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // reduce runs -> one outcome per cart
  const carts = new Map<string, { converted: boolean; delivered: boolean; active: boolean }>();
  for (const r of data ?? []) {
    const key = r.order_ref ?? `run:${Math.random()}`;
    const c = carts.get(key) ?? { converted: false, delivered: false, active: false };
    if (r.status === "converted") c.converted = true;
    if (r.delivered_at) c.delivered = true;
    if (r.status === "active") c.active = true;
    carts.set(key, c);
  }

  let recovered = 0, delivered = 0, retrying = 0, missed = 0;
  for (const c of carts.values()) {
    if (c.converted) recovered++;
    else if (c.delivered) delivered++;
    else if (c.active) retrying++;
    else missed++;
  }

  const enrolled = carts.size;
  const reached = recovered + delivered;            // got at least one message delivered
  const reachRate = enrolled ? Math.round((reached / enrolled) * 100) : 0;

  return NextResponse.json({
    stats: { enrolled, recovered, delivered, retrying, missed, reached, reachRate },
  });
}
