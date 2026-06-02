// Order-confirmation de-duplication — the single guard that stops a customer
// being messaged twice for the same order.
//
// Source of truth = wa_messages. wa-send inserts a row there on EVERY send
// (status 'sent' | 'failed'), in the same call that hits Meta — so it is a
// reliable ledger, unlike connector_events which is best-effort logging
// (logConnector swallows its own failures).
//
// An order_confirmation send carries the order ref in template var "2"
// (vars: {"1": name, "2": orderRef, "3": total}), so wa_messages.template_vars
// ->> '2' tells us exactly which order a confirmation belonged to.

import { db } from "./supabase.ts";

const norm = (s: unknown) => String(s ?? "").trim().replace(/^#/, "");

// Set of order refs (normalised, no leading #) that have a DELIVERED
// order-confirmation since `sinceIso`. Cheap bulk lookup for the sweep.
export async function confirmedOrderRefs(sinceIso: string): Promise<Set<string>> {
  const out = new Set<string>();
  // wa_messages.status lifecycle: "sent" → "delivered" → "read" (Meta status
  // webhooks update it). Any of these means the customer actually got the
  // message; only "failed" / "pending" mean they didn't.
  // Match BOTH confirmation templates. Order confirmations now send via
  // order_confirmation_v2 (no total); the original order_confirmation is kept
  // for historical sends. Deduping on only one name would let a customer who
  // got a v2 confirmation be messaged again under the other name.
  const { data } = await db()
    .from("wa_messages")
    .select("template_vars")
    .in("template_name", ["order_confirmation", "order_confirmation_v2"])
    .in("status", ["sent", "delivered", "read"])
    .gte("created_at", sinceIso);
  for (const m of data ?? []) {
    const ref = norm((m.template_vars as Record<string, unknown> | null)?.["2"]);
    if (ref) out.add(ref);
  }
  return out;
}

// True when this one order already received its confirmation message.
// Used by the instant path before sending — 30-day lookback comfortably
// covers any order still inside a sane confirmation window.
export async function confirmationAlreadySent(orderRef: string): Promise<boolean> {
  const ref = norm(orderRef);
  if (!ref) return false;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  return (await confirmedOrderRefs(since)).has(ref);
}

// Order confirmation always uses order_confirmation_v2 — the welcoming
// "join the PROMUNCH family" copy with NO order total (name + order ref only).
// v2 is approved at Meta. We deliberately no longer fall back to the original
// three-var `order_confirmation` template: that one prints "Order total: {{3}}",
// which we never want to send. Two vars only.
export function buildConfirmationTemplate(
  customerName: string,
  orderRef: string,
): { name: string; language: string; vars: Record<string, string> } {
  return { name: "order_confirmation_v2", language: "en", vars: { "1": customerName, "2": orderRef } };
}
