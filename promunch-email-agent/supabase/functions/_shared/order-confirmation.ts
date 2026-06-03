// Single "an order was just created" handler — sends the WhatsApp
// confirmation (if not already sent) and enrols the post-purchase journeys.
//
// Every code path that learns about a new order calls this, so adding more
// trigger paths only makes the system more reliable. All paths gate on the
// same wa_messages-backed dedup, so no customer is ever messaged twice for
// the same order, no matter how many triggers fire.

import { db } from "./supabase.ts";
import { logConnector } from "./connector-log.ts";
import {
  buildConfirmationTemplate,
  claimConfirmation,
  confirmationAlreadySent,
  markConfirmationSent,
  releaseConfirmation,
} from "./confirmations.ts";
import { REVIEW_URL, SITE_URL, TIMED_JOURNEYS, firstName, toWaId } from "./journeys.ts";

export interface OrderConfirmationResult {
  orderRef: string;
  status: "sent" | "duplicate" | "no_phone" | "not_active" | "failed";
  detail?: string;
}

// Send the order confirmation + enrol post-purchase journeys for one order.
// Idempotent — safe to call from multiple trigger paths concurrently.
export async function handleOrderCreated(order: any): Promise<OrderConfirmationResult> {
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);

  // never send "your order is confirmed!" for an order already cancelled / reversed
  if (order?.cancelled_at) return { orderRef, status: "not_active", detail: "cancelled" };
  const fin = String(order?.financial_status ?? "").toLowerCase();
  if (fin === "voided" || fin === "refunded") return { orderRef, status: "not_active", detail: fin };

  const waId = toWaId(
    order.customer?.phone ?? order.phone ?? order.shipping_address?.phone ?? order.billing_address?.phone,
  );
  if (!waId) {
    await logConnector({
      connector: "shopify_wa", level: "info", event: "no_phone",
      message: `Order ${orderRef}: no usable phone — WhatsApp messages skipped.`,
      ref: orderRef, throttleMinutes: 24 * 60,
    }).catch(() => {});
    return { orderRef, status: "no_phone" };
  }

  const name = firstName(order.customer?.first_name, order.shipping_address?.first_name, order.billing_address?.first_name);

  // === DEDUP (two layers, see confirmations.ts) ===
  // 1. Durable guard: wa_messages already has a sent/delivered/read row for
  //    this order_ref → the customer already got it. Never message twice.
  // 2. Atomic claim: win the per-order DB lock or stand down. This closes the
  //    race where two trigger paths both pass guard (1) in the same instant
  //    and both send — the bug that messaged order #2050 twice.
  let sendStatus: OrderConfirmationResult["status"];
  let sendDetail: string | undefined;
  if (await confirmationAlreadySent(orderRef)) {
    sendStatus = "duplicate";
    await logConnector({
      connector: "shopify_wa", level: "info", event: "confirmation_skipped_dup",
      message: `Order ${orderRef}: confirmation already sent — not re-sending.`,
      ref: orderRef,
    }).catch(() => {});
  } else if (!(await claimConfirmation(orderRef))) {
    // Another path holds the claim (is sending right now) — stand down.
    sendStatus = "duplicate";
    await logConnector({
      connector: "shopify_wa", level: "info", event: "confirmation_skipped_dup",
      message: `Order ${orderRef}: confirmation already claimed by another path — not re-sending.`,
      ref: orderRef,
    }).catch(() => {});
  } else {
    const res = await callWaSend({
      to: waId,
      kind: "template",
      template: buildConfirmationTemplate(name, orderRef),
      sent_by: "journey:order_confirmation",
    });
    sendStatus = res?.ok ? "sent" : "failed";
    sendDetail = res?.ok ? undefined : res?.error ?? "send failed";
    // Lock the claim on success; release it on failure so the sweep can retry.
    if (res?.ok) await markConfirmationSent(orderRef);
    else await releaseConfirmation(orderRef);
    await logConnector({
      connector: "shopify_wa",
      level: res?.ok ? "info" : "error",
      event: res?.ok ? "confirmation_sent" : "confirmation_failed",
      message: res?.ok
        ? `Order ${orderRef}: WhatsApp confirmation sent to ${waId}.`
        : `Order ${orderRef}: confirmation failed — ${res?.error ?? "unknown"}.`,
      ref: orderRef,
    }).catch(() => {});
  }

  // enrol the timed post-purchase journeys (idempotent — checks for prior rows)
  await enrolPostPurchaseJourneys(orderRef, waId, name).catch((e) =>
    console.warn(`[order-confirmation] enrol failed for ${orderRef}:`, e)
  );

  // cancel any open abandoned-checkout reminder — they converted
  await db().from("wa_journey_runs")
    .update({ status: "converted" })
    .eq("wa_id", waId).eq("journey_key", "abandoned_checkout").eq("status", "active")
    .then(() => {}, () => {});

  return { orderRef, status: sendStatus, detail: sendDetail };
}

async function enrolPostPurchaseJourneys(orderRef: string, waId: string, name: string) {
  const sb = db();
  // dedup — skip if any post-purchase journey for this order already exists
  const { data: prior } = await sb.from("wa_journey_runs")
    .select("id").eq("order_ref", orderRef)
    .in("journey_key", ["review_request", "replenishment_reminder"])
    .limit(1);
  if (prior && prior.length) return;

  const enrolments: Array<readonly [string, Record<string, string>]> = [
    ["review_request", { "1": name, "2": REVIEW_URL }],
    ["replenishment_reminder", { "1": name, "2": SITE_URL }],
  ];
  for (const [key, vars] of enrolments) {
    const cfg = TIMED_JOURNEYS[key];
    if (!cfg) continue;
    const due = new Date(Date.now() + cfg.delayHours * 3600_000).toISOString();
    await sb.from("wa_journey_runs").insert({
      journey_key: key, wa_id: waId, next_action_at: due,
      context: { vars }, order_ref: orderRef,
    });
  }
}

// Inline 3× retry — multiple trigger paths reduce the need for this, but a
// per-call retry still cuts how often a transient Meta blip reaches the cron
// backstop. ok:false means Meta didn't accept, so retry sends nothing twice.
async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  let last: { ok?: boolean; error?: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await callWaSendOnce(body);
    if (last?.ok) return last;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
  }
  return last;
}

async function callWaSendOnce(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
