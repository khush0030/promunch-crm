// COD confirmation gate (RTO reduction) — pure helpers.
// Spec: docs/superpowers/specs/2026-07-08-cod-confirmation-gate-design.md
// Stateful handlers (confirm/cancel/bounce) are added in a later task and
// live in this same module so the whole gate reads in one place.

import type { TemplateComponent } from "./whatsapp.ts";

export const GATE_TEMPLATE = "order_verify_v1";
export const GATE_REMINDER_TEMPLATE = "order_verify_reminder_v1";

// COD detection. payment_gateway_names is authoritative when present
// (webhook payload carries it; older rows may not). A known non-COD gateway
// with financial_status 'pending' (e.g. a Razorpay order awaiting capture)
// must NOT be gated, hence the early false.
export function isCodOrder(order: any): boolean {
  const names: string[] = Array.isArray(order?.payment_gateway_names)
    ? order.payment_gateway_names.map((n: unknown) => String(n))
    : [];
  if (names.length) return names.some((n) => /cash\s*on\s*delivery|\bcod\b/i.test(n));
  return String(order?.financial_status ?? "").toLowerCase() === "pending";
}

export type GateAction = "confirm" | "cancel_ask" | "cancel_confirm" | "keep";

const PAYLOAD_RE = /^(CONFIRM|CANCEL|CANCELCONF|KEEP)_(\d+)$/;
const ACTION_MAP: Record<string, GateAction> = {
  CONFIRM: "confirm",
  CANCEL: "cancel_ask",
  CANCELCONF: "cancel_confirm",
  KEEP: "keep",
};

export function parseGatePayload(
  payload: string | null | undefined,
): { action: GateAction; shopifyId: string } | null {
  const m = String(payload ?? "").match(PAYLOAD_RE);
  if (!m) return null;
  return { action: ACTION_MAP[m[1]], shopifyId: m[2] };
}

// Template vars: {"1": name, "2": orderRef, "3": total}. Var "2" MUST stay the
// order ref — the confirmation dedup ledger (confirmations.ts) keys on it.
export function buildVerifyVars(
  name: string,
  orderRef: string,
  totalLabel: string,
): Record<string, string> {
  return { "1": name, "2": orderRef, "3": totalLabel };
}

export function codTotalLabel(total: number, currency: string): string {
  const n = Math.round(Number(total) || 0);
  return currency === "INR" ? `₹${n}` : `${currency} ${n}`;
}

// Full component array for a gated template send: body params + the two
// quick-reply payload buttons. Payload carries the numeric Shopify order id.
export function buildVerifyComponents(
  vars: Record<string, string>,
  shopifyId: string | number,
): TemplateComponent[] {
  const sorted = Object.entries(vars).sort(([a], [b]) => Number(a) - Number(b));
  return [
    { type: "body", parameters: sorted.map(([, v]) => ({ type: "text", text: v })) },
    {
      type: "button", sub_type: "quick_reply", index: "0",
      parameters: [{ type: "payload", payload: `CONFIRM_${shopifyId}` }],
    } as TemplateComponent,
    {
      type: "button", sub_type: "quick_reply", index: "1",
      parameters: [{ type: "payload", payload: `CANCEL_${shopifyId}` }],
    } as TemplateComponent,
  ];
}

// ---- Stateful half: confirm/cancel transitions + wa-webhook button intercept ----

import { db } from "./supabase.ts";
import { logConnector } from "./connector-log.ts";
import { addOrderTags } from "./shopify-customer.ts";
import {
  cancelOrderByCustomer,
  releaseOrderHolds,
  setOrderNote,
} from "./shopify-fulfillment.ts";

// Auto-cancel is allowed ONLY while nothing has been paid or shipped.
// Anything else goes to the manual ticket path — never auto-touch money.
export function decideCancelGuards(
  row: { financial_status: string | null; raw: any },
): { allow: true } | { allow: false; why: string } {
  if (String(row.financial_status ?? "").toLowerCase() !== "pending") {
    return { allow: false, why: "paid" };
  }
  if (row.raw?.fulfillment_status) return { allow: false, why: "fulfilled" };
  return { allow: true };
}

type OrderRow = {
  shopify_id: number;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number;
  currency: string;
  financial_status: string | null;
  confirmation_status: string | null;
  raw: any;
};

const ORDER_COLS =
  "shopify_id, order_number, customer_name, customer_phone, total_price, currency, financial_status, confirmation_status, raw";

async function orderRow(shopifyId: string | number): Promise<OrderRow | null> {
  const { data } = await db().from("shopify_orders")
    .select(ORDER_COLS).eq("shopify_id", shopifyId).maybeSingle();
  return (data as OrderRow) ?? null;
}

// Atomic status transition — the row-level claim that makes taps idempotent.
// Returns the row when THIS caller won the transition, null when someone
// (double tap, ops click, another isolate) already moved it.
async function claimTransition(
  shopifyId: string | number,
  to: "confirmed" | "cancelled",
  via: "button" | "manual",
): Promise<OrderRow | null> {
  const patch: Record<string, unknown> = { confirmation_status: to, confirmed_via: via };
  if (to === "confirmed") patch.confirmed_at = new Date().toISOString();
  const { data } = await db().from("shopify_orders")
    .update(patch)
    .eq("shopify_id", shopifyId)
    .in("confirmation_status", ["pending", "needs_call"])
    .select(ORDER_COLS)
    .maybeSingle();
  return (data as OrderRow) ?? null;
}

export async function confirmGate(
  shopifyId: string | number,
  via: "button" | "manual",
): Promise<{ ok: boolean; outcome: "confirmed" | "already"; already?: string }> {
  const row = await claimTransition(shopifyId, "confirmed", via);
  if (!row) {
    const cur = await orderRow(shopifyId);
    return { ok: true, outcome: "already", already: cur?.confirmation_status ?? "unknown" };
  }
  const rel = await releaseOrderHolds(shopifyId);
  if (!rel.ok) {
    await logConnector({
      connector: "shopify_wa", level: "error", event: "cod_release_failed",
      message: `Order ${row.order_number}: confirmed but hold release failed — ${rel.reason}. Release it manually in Shopify.`,
      ref: row.order_number,
    }).catch(() => {});
  }
  await addOrderTags(shopifyId, ["WA-Confirmed"]).catch(() => {});
  await logConnector({
    connector: "shopify_wa", level: "info", event: "cod_confirmed",
    message: `Order ${row.order_number}: COD confirmed via ${via}.`, ref: row.order_number,
  }).catch(() => {});
  return { ok: true, outcome: "confirmed" };
}

export async function cancelGate(
  shopifyId: string | number,
  via: "button" | "manual",
): Promise<{ ok: boolean; outcome: "cancelled" | "already" | "guard_failed"; already?: string; reason?: string }> {
  const pre = await orderRow(shopifyId);
  if (!pre) return { ok: false, outcome: "guard_failed", reason: "order-not-found" };
  if (pre.confirmation_status !== "pending" && pre.confirmation_status !== "needs_call") {
    return { ok: true, outcome: "already", already: pre.confirmation_status ?? "unknown" };
  }
  const guards = decideCancelGuards(pre);
  if (!guards.allow) return { ok: true, outcome: "guard_failed", reason: guards.why };

  const row = await claimTransition(shopifyId, "cancelled", via);
  if (!row) {
    const cur = await orderRow(shopifyId);
    return { ok: true, outcome: "already", already: cur?.confirmation_status ?? "unknown" };
  }

  // Re-validate on the freshly-claimed row. claimTransition's RETURNING reflects
  // the latest committed financial_status/raw, and shopify-webhook upserts those
  // independently on every orders/* topic — so a paid/fulfilled update could have
  // landed after the pre-claim read. Never auto-cancel money that has arrived:
  // revert the claim to needs_call and hand off to the manual path.
  const fresh = decideCancelGuards(row);
  if (!fresh.allow) {
    await db().from("shopify_orders")
      .update({ confirmation_status: "needs_call", confirmed_via: null })
      .eq("shopify_id", shopifyId).then(() => {}, () => {});
    await logConnector({
      connector: "shopify_wa", level: "warn", event: "cod_cancel_guard_flip",
      message: `Order ${row.order_number}: cancel guard flipped to ${fresh.why} after claim — not auto-cancelled, moved to needs_call.`,
      ref: row.order_number,
    }).catch(() => {});
    return { ok: true, outcome: "guard_failed", reason: fresh.why };
  }

  const note = via === "button"
    ? "Cancelled by customer via WhatsApp confirmation flow (button tap)"
    : "Cancelled by ops via CRM after customer call";
  const cancel = await cancelOrderByCustomer(shopifyId, note);
  if (!cancel.ok) {
    // Shopify refused after we claimed — park it for a human, never retry
    // automatically (retrying a cancel is scarier than a stuck order).
    await db().from("shopify_orders")
      .update({ confirmation_status: "needs_call", confirmed_via: null })
      .eq("shopify_id", shopifyId).then(() => {}, () => {});
    await logConnector({
      connector: "shopify_wa", level: "error", event: "cod_cancel_failed",
      message: `Order ${row.order_number}: Shopify orderCancel failed — ${cancel.reason}. Moved to needs_call.`,
      ref: row.order_number,
    }).catch(() => {});
    return { ok: false, outcome: "guard_failed", reason: cancel.reason };
  }
  await setOrderNote(shopifyId, note).catch(() => {});
  await addOrderTags(shopifyId, ["WA-Cancelled"]).catch(() => {});
  await logConnector({
    connector: "shopify_wa", level: "info", event: "cod_cancelled",
    message: `Order ${row.order_number}: auto-cancelled in Shopify (${via}).`, ref: row.order_number,
  }).catch(() => {});
  return { ok: true, outcome: "cancelled" };
}

// ---- WhatsApp-side flow (button taps) --------------------------------------

async function waSend(body: Record<string, unknown>): Promise<void> {
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[cod-gate] wa-send failed", e));
}

// FYI/urgent ping to ops on WhatsApp via the approved ops_ticket_alert
// utility template (lands outside any 24h window). Same var layout as
// wa-ai-reply/ticket.ts notifyOps.
async function pingOps(label: string, row: OrderRow, reason: string): Promise<void> {
  const to = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
  if (!to) return;
  await waSend({
    to,
    kind: "template",
    sent_by: "cod_gate_ops",
    template: {
      name: Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert",
      language: "en",
      vars: {
        "1": label,
        "2": "—",
        "3": row.customer_name ?? "—",
        "4": row.customer_phone ? `+${row.customer_phone}` : "—",
        "5": reason.slice(0, 300),
      },
    },
  });
}

const statusLabel: Record<string, string> = {
  confirmed: "confirmed and on its way to packing",
  cancelled: "cancelled",
  needs_call: "with our team, we will call you shortly",
  pending: "awaiting your confirmation",
};

// Entry point for wa-webhook. All replies are free text: the customer just
// tapped, so the 24h service window is open.
export async function handleGateButton(
  action: GateAction,
  shopifyId: string,
  _waId: string,
  threadId: string,
): Promise<void> {
  const say = (text: string) =>
    waSend({ thread_id: threadId, kind: "text", sent_by: "cod_gate", text });

  const row = await orderRow(shopifyId);
  if (!row) {
    await say("Hmm, we could not find that order. Our team will take a look and get back to you 💚");
    return;
  }
  const ref = row.order_number;

  if (action === "confirm" || action === "keep") {
    const r = await confirmGate(shopifyId, "button");
    if (r.outcome === "confirmed") {
      await say(`Awesome! Order ${ref} is confirmed and heading to packing 📦 Your Munchy Pal 💚`);
    } else {
      await say(`All sorted! Order ${ref} is already ${statusLabel[r.already ?? ""] ?? r.already}. Need anything else? Just ask 😊`);
    }
    return;
  }

  if (action === "cancel_ask") {
    if (row.confirmation_status !== "pending" && row.confirmation_status !== "needs_call") {
      await say(`Order ${ref} is already ${statusLabel[row.confirmation_status ?? ""] ?? row.confirmation_status}. Need anything else? Just ask 😊`);
      return;
    }
    // fat-finger guard — no state change until they confirm the cancel
    await waSend({
      thread_id: threadId,
      kind: "interactive",
      sent_by: "cod_gate",
      interactive: {
        type: "button",
        body: { text: `You sure you want to cancel order ${ref}? 🥺` },
        footer: { text: "Your Munchy Pal 💚" },
        action: {
          buttons: [
            { type: "reply", reply: { id: `CANCELCONF_${shopifyId}`, title: "Yes, cancel it" } },
            { type: "reply", reply: { id: `KEEP_${shopifyId}`, title: "Keep my order" } },
          ],
        },
      },
    });
    return;
  }

  // action === "cancel_confirm"
  const r = await cancelGate(shopifyId, "button");
  if (r.outcome === "cancelled") {
    await say(`Done. Order ${ref} is cancelled ✅ Nothing to pay for COD orders. Hope to see you again soon 💚`);
    await pingOps("COD auto-cancel (FYI)", row, `Order ${ref} cancelled by customer via WhatsApp. No action needed.`);
  } else if (r.outcome === "already") {
    await say(`Order ${ref} is already ${statusLabel[r.already ?? ""] ?? r.already}. Need anything else? Just ask 😊`);
  } else {
    // guards failed (paid/fulfilled/API error) — manual path, urgent ticket
    await say(`Got it! We have flagged your cancellation request for order ${ref}. Our team will confirm with you shortly 💚`);
    await db().from("wa_threads").update({
      status: "human",
      ticket_status: "open",
      ticket_priority: "urgent",
      ticket_category: "order_issue",
      ticket_opened_at: new Date().toISOString(),
      escalation_reason: `COD gate: customer asked to cancel ${ref} but auto-cancel was blocked (${r.reason}). Cancel manually in Shopify.`.slice(0, 500),
    }).eq("id", threadId).then(() => {}, () => {});
    await pingOps("Cancel request (manual)", row,
      `Customer wants to cancel ${ref}; auto-cancel blocked (${r.reason}). Handle in Shopify.`);
  }
}
