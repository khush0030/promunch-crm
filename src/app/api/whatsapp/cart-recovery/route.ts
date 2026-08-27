import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { reduceCartRuns } from "./reduce";

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

export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  // context is selected (not just for filtering server-side — PostgREST has
  // no clean operator for "->>'channel' is distinct from 'voice'" that also
  // tolerates a null context, so the voice row is excluded client-side in
  // reduceCartRuns instead; see that file's header comment) so the voice
  // rescue-call row (same journey_key + order_ref as the WA rows for the
  // same cart, see shopify-wa) never gets folded into this WA-only funnel.
  const { data, error } = await supabaseAdmin
    .from("wa_journey_runs")
    .select("order_ref, status, delivered_at, context")
    .eq("journey_key", "abandoned_checkout")
    .gte("created_at", since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const carts = reduceCartRuns(data ?? []);

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

  // Voice rescue arm.
  //
  // ATTRIBUTION, again (see the block comment above — same disease, new organ).
  // A redial can leave TWO+ voice_calls rows for the same cart, so counting rows
  // directly would double-count exactly like counting wa_journey_runs rows would.
  // We looked for a "when did this cart convert" timestamp to require the call
  // strictly precede the order (the honest way to claim causation) and came up
  // empty: wa_journey_runs.updated_at is a generic touch-trigger column bumped by
  // every write to the row (backoff reschedules, context patches, the delivery
  // stamp, the conversion flip, all of it) — not a dedicated conversion moment,
  // and nothing else in this codebase treats it as one. Faking a timestamp out of
  // a column that means something adjacent is how the WA number got inflated 7x
  // in the first place, so we don't do it here either.
  //
  // Instead we report the honest split:
  //   recovered         : cart converted, voice connected, and NO WA message was
  //                        ever delivered for it — the call is the only thing
  //                        that reached this customer. A clean, defensible win.
  //   assistedRecovered : cart converted, voice connected, AND a WA message also
  //                        delivered — we cannot tell which channel gets credit,
  //                        so it is labeled assisted, never folded into recovered.
  const voiceCarts = new Map<string, { placed: boolean; connected: boolean }>();
  let linkSent = 0;
  const { data: calls } = await supabaseAdmin
    .from("voice_calls").select("order_ref, status, link_sent_at").gte("created_at", since);
  (calls ?? []).forEach((c, i) => {
    // A link send is a real one-off WhatsApp send that happened during a specific
    // call, not a per-cart outcome — count every occurrence, not one per cart.
    if (c.link_sent_at) linkSent++;
    const key = c.order_ref ?? `call:${i}`;
    const v = voiceCarts.get(key) ?? { placed: false, connected: false };
    if (c.status !== "start_failed") v.placed = true;
    if (c.status === "connected") v.connected = true;
    voiceCarts.set(key, v);
  });

  let voicePlaced = 0, voiceConnected = 0, voiceRecovered = 0, voiceAssistedRecovered = 0;
  for (const [key, v] of voiceCarts) {
    if (v.placed) voicePlaced++;
    if (v.connected) voiceConnected++;
    if (!v.connected) continue;
    const cart = carts.get(key); // only matches when `key` is a real order_ref
    if (!cart?.converted) continue;
    if (cart.delivered) voiceAssistedRecovered++;
    else voiceRecovered++;
  }
  const voice = {
    placed: voicePlaced, connected: voiceConnected, linkSent,
    recovered: voiceRecovered, assistedRecovered: voiceAssistedRecovered,
  };

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
      voice,
    },
  });
}
