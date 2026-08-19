// Ticket creation + ops escalation ping.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import { db } from "../_shared/supabase.ts";
import { lookupOrders, type OrderSummary } from "../_shared/orders.ts";
import { callSend } from "./send.ts";
import { LEAD_TICKET_CATEGORIES, pingLeadDesk } from "../_shared/lead-alert.ts";

export interface TicketInput {
  category?: string;
  priority?: string;
  reason?: string;
  order_number?: string;
}

// Map a structured order-change request (request_order_change tool) into a
// ticket the ops team acts on. Cancels + address fixes must beat dispatch →
// urgent; returns / replacements → high.
export function changeToTicket(c: { changeType: string; orderNumber: string | null; details: string }): TicketInput {
  const label: Record<string, string> = {
    cancel: "Order cancellation",
    return: "Return / refund",
    replacement: "Replacement",
    address_change: "Delivery address change",
  };
  const category: Record<string, string> = {
    cancel: "order_issue",
    return: "refund",
    replacement: "order_issue",
    address_change: "order_issue",
  };
  const urgent = c.changeType === "cancel" || c.changeType === "address_change";
  return {
    category: category[c.changeType] ?? "order_issue",
    priority: urgent ? "urgent" : "high",
    reason: `${label[c.changeType] ?? "Order change"} requested — ${c.details}`,
    order_number: c.orderNumber ?? undefined,
  };
}

// Raise / refresh a support ticket on the thread, then post a Slack escalation.
//
// ANY open ticket flips the thread to 'human': the reply we just sent this turn
// is the customer's one acknowledgement ("I've raised this with the team…"),
// and from here the bot goes quiet so a person owns the conversation — no more
// AI improvising on a live complaint, and (with the campaign/journey ticket
// guards) no marketing blasts while the issue is open. The bot resumes
// automatically when the ticket is resolved/closed in the dashboard.
//   handoff=true is still tracked separately (drives the Slack card heading +
//   priority default) but no longer the only thing that silences the bot.
export async function openTicket(
  threadId: string,
  waId: string | null,
  ticket: TicketInput | null,
  handoff: boolean,
) {
  const sb = db();
  const { data: thread } = await sb
    .from("wa_threads")
    .select("ticket_status, ticket_number")
    .eq("id", threadId)
    .maybeSingle();

  const reason = ticket?.reason ??
    (handoff ? "Customer asked to speak to a human" : "Ticket raised by AI agent");
  const category = ticket?.category ?? "general";
  const priority = ticket?.priority ?? (handoff ? "high" : "normal");
  const upd: Record<string, unknown> = {
    ticket_status: "open",
    ticket_category: category,
    ticket_priority: priority,
    escalation_reason: reason,
  };
  // don't reset the opened-at clock (or the watchdog's alert counters) on a
  // ticket that is already open — only on a fresh one.
  const fresh = thread?.ticket_status !== "open";
  const openedAt = new Date().toISOString();
  if (fresh) {
    upd.ticket_opened_at = openedAt;
    upd.ticket_last_alert_at = null;
    upd.ticket_alert_count = 0;
  }
  // NOTE: the bot deliberately KEEPS replying while a ticket is open (status
  // stays 'bot'). Escalation is now a quiet WhatsApp ping to a human, not a
  // takeover — so threads never rot in silence waiting for someone to grab one.

  await sb.from("wa_threads").update(upd).eq("id", threadId);

  // Only ping a human on a FRESH ticket — never re-ping on every follow-up turn
  // while the same ticket is still open (the SLA watchdog owns the fallback).
  if (!fresh) return;

  // when the ticket names an order, pull it from the DB so the alert carries
  // verified details — never the model's recollection.
  let order: OrderSummary | null = null;
  if (ticket?.order_number) {
    const found = await lookupOrders(waId, ticket.order_number).catch(() => [] as OrderSummary[]);
    order = found[0] ?? null;
  }

  await notifyOps({
    waId,
    handoff,
    category,
    leadKey: `lead_alert:ticket:${threadId}:${openedAt}`,
    ticketNumber: thread?.ticket_number ?? null,
    reason,
    order,
  }).catch((e) => console.error("[wa-ai-reply] ops ticket ping failed", e));
}

// Ticket categories that ride the ORDER lane: pinged to the ops guard
// (OPS_WA_ID) first, then Narendra (OPS_WA_ID_2) on SLA fallback via the
// watchdog. Everything else routes to the owner (ESCALATION_WA_ID).
const ORDER_LANE = new Set(["order_issue", "refund"]);
const TYPE_LABEL: Record<string, string> = {
  order_issue: "Order issue",
  refund: "Refund / return",
  product_query: "Product question",
  partnership: "Partnership lead",
  complaint: "Complaint",
  wholesale: "Wholesale lead",
  general: "New ticket",
};

// Ping the right human on WhatsApp the instant a ticket is raised. Order issues
// → OPS_WA_ID (number 1); every other ticket → ESCALATION_WA_ID (owner). Uses
// the approved `ops_ticket_alert` UTILITY template so it lands outside any 24h
// window. Best-effort, gated on the env vars — a no-op until the number/template
// are live, and it never blocks the customer reply. Slack is intentionally gone:
// the two-number WhatsApp ladder is the only escalation channel now.
async function notifyOps(o: {
  waId: string | null;
  handoff: boolean;
  category: string;
  ticketNumber: number | string | null;
  reason: string;
  order: OrderSummary | null;
  leadKey: string;
}) {
  const clean = (v: string | undefined) => (v ?? "").replace(/^\+/, "").replace(/\D/g, "");
  const orderLane = !o.handoff && ORDER_LANE.has(o.category);
  const to = orderLane ? clean(Deno.env.get("OPS_WA_ID")) : clean(Deno.env.get("ESCALATION_WA_ID"));
  if (!to) return; // number not configured yet

  const tpl = Deno.env.get("OPS_ALERT_TEMPLATE") ?? "ops_ticket_alert";
  const label = o.handoff ? "Human requested" : (TYPE_LABEL[o.category] ?? "New ticket");
  const vars = {
    "1": label,
    "2": String(o.ticketNumber ?? "—"),
    "3": o.order?.customer_name ?? "—",
    "4": o.waId ? `+${o.waId}` : "—",
    "5": (o.reason || "See chat").slice(0, 300),
  };

  await callSend({
    to,
    kind: "template",
    sent_by: "ops_ticket_alert",
    template: { name: tpl, language: "en", vars },
  });

  // Commercial leads (wholesale / partnership) additionally copy the lead desk
  // (LEADS_WA_ID) so a distributor enquiry never sits unseen. Best-effort and
  // claim-guarded — it never blocks or duplicates the ping above.
  if (!o.handoff && LEAD_TICKET_CATEGORIES.has(o.category)) {
    await pingLeadDesk({
      claimKey: o.leadKey,
      label,
      ref: o.ticketNumber,
      name: o.order?.customer_name ?? null,
      contact: o.waId ? `+${o.waId}` : null,
      details: o.reason || "See chat",
      skipIfSameAs: to,
    }).catch((e) => console.error("[wa-ai-reply] lead desk ping failed", e));
  }
}

// ---- retired ---------------------------------------------------------------
// postEscalation() (Slack ticket card) and notifyOpsCancel() (cancel-only ops
// ping) were removed. Ticket escalation is now a single WhatsApp ping via
// notifyOps() above — routed to the ops guard/Narendra for order issues, or to
// the owner for everything else. The Slack firehose + human-takeover model is
// gone. Send/delivery FAILURE alerts (connector-log) are unrelated and stay on.
