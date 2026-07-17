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
  // Match all THREE confirmation templates. Order confirmations now send via
  // order_confirmation_v2 (no total); the original order_confirmation is kept
  // for historical sends; order_verify_v1 is the COD gate's buttoned verify
  // template, which IS the confirmation for gated orders. Deduping on fewer
  // than all three would let a customer be messaged again under a name we
  // didn't check.
  const { data } = await db()
    .from("wa_messages")
    .select("template_vars")
    // order_verify_v1 (COD gate) IS the order confirmation for gated orders —
    // without it here the sweep would see "missing" and double-message.
    .in("template_name", ["order_confirmation", "order_confirmation_v2", "order_verify_v1"])
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

// === ATOMIC CLAIM — the hard no-spam guard ================================
// confirmationAlreadySent() above is a read-then-send check: two trigger paths
// can both read "not sent yet" in the same instant and both send. That is the
// race that messaged order #2050 twice. These helpers close it at the database
// via wa_confirmation_claims (order_ref is the PRIMARY KEY) so exactly ONE
// caller can ever hold a given order — see migration 20260602160000.
//
// Contract for every send path:
//   1. if (await confirmationAlreadySent(ref)) skip;        // durable guard
//   2. if (!(await claimConfirmation(ref))) skip;           // win the lock
//   3. send;
//   4. ok  -> await markConfirmationSent(ref)               // lock it sent
//      fail -> await releaseConfirmation(ref)               // let sweep retry
// A miss is recoverable (the sweep re-runs); a duplicate is not. So on ANY
// uncertainty (e.g. the claim RPC errors) we DO NOT send.

// True only for the single caller now allowed to send this order.
export async function claimConfirmation(orderRef: string): Promise<boolean> {
  const ref = norm(orderRef);
  if (!ref) return false;
  const { data, error } = await db().rpc("claim_order_confirmation", { p_ref: ref });
  if (error) {
    // Unknown DB state — bias to NO-SPAM: stand down. The sweep retries later.
    console.warn(`[confirmations] claim_order_confirmation failed for ${ref}:`, error.message);
    return false;
  }
  return data === true;
}

// Lock the claim as 'sent' once Meta accepted — it can never be re-sent.
export async function markConfirmationSent(orderRef: string): Promise<void> {
  const ref = norm(orderRef);
  if (!ref) return;
  await db().rpc("mark_order_confirmation_sent", { p_ref: ref }).then(() => {}, () => {});
}

// Release the claim after a failed send so the sweep can retry immediately.
export async function releaseConfirmation(orderRef: string): Promise<void> {
  const ref = norm(orderRef);
  if (!ref) return;
  await db().rpc("release_order_confirmation", { p_ref: ref }).then(() => {}, () => {});
}

// === GENERIC one-per-event claim ==========================================
// Built on the same wa_confirmation_claims primitive (claim_order_confirmation)
// so any "send this WhatsApp exactly once per event X" flow gets the identical
// atomic no-duplicate guarantee — no new table/migration. Pass a NAMESPACED key
// (e.g. `shipping_update:<orderRef>:<fulfillmentId>`) so keys never collide with
// bare confirmation refs. Same contract as the confirmation helpers: win the
// claim → send → markSendSent on ok / releaseSend on failure.
export async function claimSend(key: string): Promise<boolean> {
  if (!key) return false;
  const { data, error } = await db().rpc("claim_order_confirmation", { p_ref: key });
  if (error) { console.warn(`[confirmations] claimSend failed for ${key}:`, error.message); return false; }
  return data === true;
}
export async function markSendSent(key: string): Promise<void> {
  if (!key) return;
  await db().rpc("mark_order_confirmation_sent", { p_ref: key }).then(() => {}, () => {});
}
export async function releaseSend(key: string): Promise<void> {
  if (!key) return;
  await db().rpc("release_order_confirmation", { p_ref: key }).then(() => {}, () => {});
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
