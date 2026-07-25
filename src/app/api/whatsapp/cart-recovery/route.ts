import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Cart-recovery funnel for the WhatsApp dashboard tile.
//
// Each abandoned cart enrols multiple runs (reminder + coupon), so we aggregate
// by order_ref (the checkout token) to a single per-cart outcome — counting runs
// would double every number. Window: carts enrolled in the last 30 days.
//
// ATTRIBUTION (this is the part that used to lie). A run flips to 'converted'
// whenever orders/create fires for that customer, whether or not we ever got a
// message to them. The old tile counted every one of those as "recovered", so a
// customer who wandered back on their own read as a win. Over the first two
// months live that inflated 1 genuine recovery into 7.
//
// A cart only counts as RECOVERED if a message was delivered BEFORE the order.
// Everything else is reported honestly:
//
//   recovered      : we delivered a message, then they bought   <- the real number
//   self_returned  : they bought, we never reached them         <- not our win
//   delivered      : message landed, no purchase (yet)
//   retrying       : still in flight
//   missed         : all runs terminal, nothing ever delivered  <- the real loss
export const dynamic = "force-dynamic";

type Cart = { converted: boolean; delivered: boolean; active: boolean };

export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("wa_journey_runs")
    .select("order_ref, status, delivered_at")
    .eq("journey_key", "abandoned_checkout")
    .gte("created_at", since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // reduce runs -> one outcome per cart
  const carts = new Map<string, Cart>();
  for (const r of data ?? []) {
    const key = r.order_ref ?? `run:${r.status}:${r.delivered_at ?? ""}`;
    const c = carts.get(key) ?? { converted: false, delivered: false, active: false };
    if (r.status === "converted") c.converted = true;
    if (r.delivered_at) c.delivered = true;
    if (r.status === "active") c.active = true;
    carts.set(key, c);
  }

  let recovered = 0, selfReturned = 0, delivered = 0, retrying = 0, missed = 0;
  for (const c of carts.values()) {
    if (c.converted && c.delivered) recovered++;
    else if (c.converted) selfReturned++;
    else if (c.delivered) delivered++;
    else if (c.active) retrying++;
    else missed++;
  }

  const enrolled = carts.size;
  const reached = recovered + delivered;              // at least one message landed
  const reachRate = enrolled ? Math.round((reached / enrolled) * 100) : 0;
  // Recovery rate is measured against carts we actually REACHED. Measuring it
  // against everything enrolled blends two different failures (we could not
  // deliver vs they did not buy) into one number that can't be acted on.
  const recoveryRate = reached ? Math.round((recovered / reached) * 100) : 0;

  // Email arm of the same cart (phone-less checkouts). Enrolled by shopify-wa
  // into the active checkout_abandoned flow and sent by email-flow-tick.
  const email = { enrolled: 0, recovered: 0, sending: 0 };
  const { data: cartFlows } = await supabaseAdmin
    .from("flows")
    .select("id")
    .eq("trigger_type", "checkout_abandoned");
  const flowIds = (cartFlows ?? []).map((f) => f.id as string);
  if (flowIds.length) {
    const { data: enrolments } = await supabaseAdmin
      .from("flow_enrollments")
      .select("status")
      .in("flow_id", flowIds)
      .gte("entered_at", since);
    for (const e of enrolments ?? []) {
      email.enrolled++;
      if (e.status === "converted") email.recovered++;
      else if (e.status === "active") email.sending++;
    }
  }

  return NextResponse.json({
    stats: {
      enrolled,
      recovered,
      selfReturned,
      delivered,
      retrying,
      missed,
      reached,
      reachRate,
      recoveryRate,
      email,
    },
  });
}
