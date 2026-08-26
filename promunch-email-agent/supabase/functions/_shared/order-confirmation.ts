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
  chooseConfirmationTemplate,
  claimConfirmation,
  confirmationAlreadySent,
  markConfirmationSent,
  releaseConfirmation,
  claimSend,
  markSendSent,
} from "./confirmations.ts";
import { REVIEW_URL, SITE_URL, firstName, toWaId } from "./journeys.ts";
import { getFlowSettings, type FlowSettings } from "./flow-settings.ts";
import { enrolCustomFlows } from "./custom-flows.ts";
import { enrolEmailFlow, convertAbandonedEmailFlows, convertAbandonedEmailFlowsByCheckout } from "./email-flows.ts";
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  GATE_TEMPLATE,
  isCodOrder,
} from "./cod-gate.ts";
import { isCreatorOrder } from "./shopify-customer.ts";
import { buildSupportComponents } from "./quick-replies.ts";
import { holdOrderFulfillments } from "./shopify-fulfillment.ts";

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

  // Email flows (independent of WhatsApp; enrol on the order's EMAIL even when
  // there is no phone). DB-only: post-purchase enrols, and this buyer's active
  // abandoned-cart email flows stop (they converted). No-op unless a matching
  // Active flow exists; idempotent per order.
  try {
    const email = order.email ?? order.customer?.email ?? null;
    const nm = firstName(order.customer?.first_name, order.shipping_address?.first_name, order.billing_address?.first_name);
    // Stop by checkout token FIRST: it works even when the order has no email
    // (most PROMUNCH orders are phone-only), where the email-keyed stop below
    // silently no-ops and would leave the cart sequence running post-purchase.
    await convertAbandonedEmailFlowsByCheckout(order.checkout_token ?? order.cart_token ?? null);
    await convertAbandonedEmailFlows(email);
    await enrolEmailFlow("order_placed", { email, entityRef: orderRef, dedupPrefix: "postpurchase", firstName: nm });
  } catch (e) {
    console.warn(`[order-confirmation] email flow enrol failed for ${orderRef}:`, e);
  }

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
  const flows = await getFlowSettings();

  // COD confirmation gate — spec docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
  // Gated orders get the buttoned verify template INSTEAD of the plain
  // confirmation, plus a Shopify fulfillment hold. Inert while the flag is off.
  const gated = flows.cod_gate_enabled && isCodOrder(order) && !isCreatorOrder(order);

  let sendStatus: OrderConfirmationResult["status"];
  let sendDetail: string | undefined;
  if (!flows.order_confirmation_enabled) {
    // Dashboard kill-switch (Flows tab). Post-purchase enrolment and cart
    // conversion below still run — they're separate flows.
    sendStatus = "not_active";
    sendDetail = "order confirmation disabled in flow settings";
  } else if (await confirmationAlreadySent(orderRef)) {
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
    let template: Record<string, unknown>;
    if (gated) {
      // Hold BEFORE messaging: fail-closed for shipping. A hold failure is
      // logged loudly but does not block the send — ops sees the pending
      // status in the dashboard either way.
      const hold = await holdOrderFulfillments(order.id, "Awaiting WhatsApp COD confirmation");
      // "no-holdable-fulfillment-orders" on a released-claim retry means the
      // order is already held (nothing left to hold) — not a real failure.
      // Only log cod_hold_failed for genuine failures, or ops gets a false
      // alarm ("hold failed") for an order that IS still hold-protected.
      if (!hold.ok && hold.reason !== "no-holdable-fulfillment-orders") {
        await logConnector({
          connector: "shopify_wa", level: "error", event: "cod_hold_failed",
          message: `Order ${orderRef}: fulfillment hold failed — ${hold.reason}. Order is NOT hold-protected; rely on dashboard status.`,
          ref: orderRef,
        }).catch(() => {});
      }
      const vars = buildVerifyVars(
        name, orderRef,
        codTotalLabel(Number(order.total_price ?? order.current_total_price ?? 0), order.currency ?? "INR"),
      );
      template = {
        name: GATE_TEMPLATE, language: "en",
        vars, components: buildVerifyComponents(vars, order.id),
      };
    } else {
      // First-order vs returning-customer template is Flows-tab config.
      const chosen = await chooseConfirmationTemplate({
        waId, customerName: name, orderRef, excludeShopifyId: order.id ?? null, flows,
      });
      // The Flows tab lets anyone point the first-order template at ANY name,
      // and chooseConfirmationTemplate only verifies the REPEAT one. Pointing
      // "first" at a template Meta has not approved yet (exactly what happens
      // while rolling the buttoned order_confirmation_v3 out) would make every
      // send fail with Meta 132001 and cost customers their confirmation
      // entirely. Verify before sending, and fall back to the known-good
      // default rather than sending nothing.
      const safe = await approvedConfirmationTemplate(chosen, orderRef);
      // Buttoned utility templates (order_confirmation_v3 and friends) need an
      // explicit quick_reply component per button so the payload carries the
      // order ref back to us on the tap. Templates with no service buttons get
      // null here and keep wa-send's default body-only build: sending a button
      // component for a buttonless template is a #132012 on every recipient.
      const comps = buildSupportComponents(safe.name, safe.vars, orderRef);
      template = comps ? { ...safe, components: comps } : safe;
    }
    const res = await callWaSend({
      to: waId,
      kind: "template",
      template,
      sent_by: gated ? "journey:cod_gate" : "journey:order_confirmation",
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
    if (gated) {
      // stamp the gate state on the order row (keyed by shopify_id)
      const stamp = res?.ok
        ? { confirmation_status: "pending", confirmation_sent_at: new Date().toISOString() }
        : { confirmation_status: "needs_call" }; // send failed → human calls
      await db().from("shopify_orders").update(stamp)
        .eq("shopify_id", order.id).is("confirmation_status", null)
        .then(
          ({ error: stampError }) => {
            if (stampError) {
              logConnector({
                connector: "shopify_wa", level: "error", event: "cod_stamp_failed",
                message: `Order ${orderRef}: gated WhatsApp message was already sent, but the confirmation_status stamp failed — ${stampError.message}. Dashboard status may be stale; check shopify_orders directly.`,
                ref: orderRef,
              }).catch(() => {});
            }
          },
          (e) => {
            logConnector({
              connector: "shopify_wa", level: "error", event: "cod_stamp_failed",
              message: `Order ${orderRef}: gated WhatsApp message was already sent, but the confirmation_status stamp threw — ${String(e)}. Dashboard status may be stale; check shopify_orders directly.`,
              ref: orderRef,
            }).catch(() => {});
          },
        );
      if (!res?.ok) {
        await logConnector({
          connector: "shopify_wa", level: "error", event: "cod_gate_needs_call",
          message: `Order ${orderRef}: COD verify send failed (${res?.error ?? "unknown"}) — marked needs_call.`,
          ref: orderRef,
        }).catch(() => {});
      }
    }
  }

  // enrol the timed post-purchase journeys (idempotent — checks for prior rows)
  await enrolPostPurchaseJourneys(orderRef, waId, name, flows).catch((e) =>
    console.warn(`[order-confirmation] enrol failed for ${orderRef}:`, e)
  );

  // user-created flows on this trigger (own atomic claim per flow+order)
  await enrolCustomFlows("order_placed", { waId, name, entityRef: orderRef }).catch((e) =>
    console.warn(`[order-confirmation] custom enrol failed for ${orderRef}:`, e)
  );

  // cancel any open abandoned-checkout reminder — they converted
  await db().from("wa_journey_runs")
    .update({ status: "converted" })
    .eq("wa_id", waId).eq("journey_key", "abandoned_checkout").eq("status", "active")
    .then(() => {}, () => {});
  // ...and any user-created checkout-abandoned flow runs for this customer —
  // a "come back to your cart" message after they just ordered reads as spam.
  await db().from("wa_journey_runs")
    .update({ status: "converted" })
    .eq("wa_id", waId).like("journey_key", "custom:%")
    .eq("context->>trigger", "checkout_abandoned").eq("status", "active")
    .then(() => {}, () => {});

  return { orderRef, status: sendStatus, detail: sendDetail };
}

async function enrolPostPurchaseJourneys(orderRef: string, waId: string, name: string, flows: FlowSettings) {
  const sb = db();
  // ATOMIC gate — the select-based dedup below is check-then-act: two
  // confirmation paths firing together both saw "no prior runs" and both
  // enrolled, so order #2024 got 2 review_request + 2 replenishment runs (and
  // was review-pinged twice). claimSend makes enrollment happen exactly once.
  const enrolKey = `postpurchase_enrol:${orderRef}`;
  if (!(await claimSend(enrolKey))) return;

  // secondary guard — if rows already exist from before, lock and stop.
  const { data: prior } = await sb.from("wa_journey_runs")
    .select("id").eq("order_ref", orderRef)
    .in("journey_key", ["review_request", "replenishment_reminder"])
    .limit(1);
  if (prior && prior.length) { await markSendSent(enrolKey); return; }

  // Delays come from the dashboard (Flows tab); a disabled flow simply isn't
  // enrolled — this order stays out of it even if re-enabled later.
  const enrolments: Array<readonly [string, Record<string, string>, number]> = [];
  if (flows.review_request_enabled)
    enrolments.push(["review_request", { "1": name, "2": REVIEW_URL }, flows.review_delay_days * 24]);
  if (flows.replenishment_enabled)
    enrolments.push(["replenishment_reminder", { "1": name, "2": SITE_URL }, flows.replenishment_delay_days * 24]);
  for (const [key, vars, delayHours] of enrolments) {
    const due = new Date(Date.now() + delayHours * 3600_000).toISOString();
    await sb.from("wa_journey_runs").insert({
      journey_key: key, wa_id: waId, next_action_at: due,
      context: { vars }, order_ref: orderRef,
    });
  }
  await markSendSent(enrolKey); // lock — never enrol this order's journeys again
}

// The confirmation template that is actually safe to send right now.
//
// FAIL OPEN, not closed: only an explicit non-approved status downgrades to the
// default. A missing row or a DB error keeps the caller's choice, because a
// lookup blip must never rewrite which template a customer receives.
const DEFAULT_CONFIRMATION_TEMPLATE = "order_confirmation_v2";

async function approvedConfirmationTemplate(
  chosen: { name: string; language: string; vars: Record<string, string> },
  orderRef: string,
): Promise<{ name: string; language: string; vars: Record<string, string> }> {
  if (chosen.name === DEFAULT_CONFIRMATION_TEMPLATE) return chosen;
  try {
    const { data: row, error } = await db()
      .from("wa_templates").select("status")
      .eq("name", chosen.name).eq("language", chosen.language ?? "en")
      .maybeSingle();
    if (error || !row) return chosen;              // unknown to us — trust the caller
    if (row.status === "approved") return chosen;
    await logConnector({
      connector: "shopify_wa", level: "error", event: "confirmation_template_not_approved",
      message: `Order ${orderRef}: configured confirmation template '${chosen.name}' is '${row.status}', ` +
        `not approved at Meta. Sent '${DEFAULT_CONFIRMATION_TEMPLATE}' instead. Fix the Flows tab template picker.`,
      ref: orderRef, throttleMinutes: 60,
    }).catch(() => {});
    return { ...chosen, name: DEFAULT_CONFIRMATION_TEMPLATE };
  } catch {
    return chosen;
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
