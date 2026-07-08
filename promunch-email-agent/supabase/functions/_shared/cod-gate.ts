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
