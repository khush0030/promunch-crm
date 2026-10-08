// Pure builder for the Live chats customer panel (third column of the
// Inbox). Takes the raw rows GET /api/inbox/context fetched for one
// customer (their WhatsApp contact + thread, CRM contact, Shopify orders
// by phone/email, support email threads) and turns them into one
// read-only "who is this and what has happened with them" shape.
// No React, no Supabase, no fetch: the route composes this with real data.

export type Tone = "good" | "info" | "warn" | "crit" | "neu";

export type CtxOrderRow = {
  shopify_id: string | number | null;
  order_number: string | number | null;
  total_price: string | number | null;
  currency: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  confirmation_status: string | null;
  line_items: unknown;
  shopify_created_at: string | null;
};

export type CtxWaContact = {
  wa_id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  tags: string[] | null;
  opted_in: boolean | null;
  created_at: string | null;
};

export type CtxWaThread = {
  id: string;
  status: string | null;
  ticket_status: string | null;
  ticket_number: number | null;
  ticket_category: string | null;
  ticket_subject: string | null;
  escalation_reason: string | null;
  ticket_opened_at: string | null;
  ticket_resolved_at: string | null;
  last_message_snippet: string | null;
  last_activity_at: string | null;
  created_at: string | null;
};

export type CtxWaMessage = { direction: "inbound" | "outbound"; body: string | null; type: string | null; created_at: string };

export type CtxCrmContact = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[] | null;
  city: string | null;
  state: string | null;
};

export type CtxEmailThread = {
  id: string;
  subject: string | null;
  status: string | null;
  lead_category: string | null;
  created_at: string;
};

export type CtxInput = {
  /** what the agent has open: never repeated in the history lists */
  open: { channel: "wa" | "em"; id: string };
  fallbackName: string;
  email: string | null;
  waContact: CtxWaContact | null;
  waThread: CtxWaThread | null;
  waMessages: CtxWaMessage[];
  crm: CtxCrmContact | null;
  orders: CtxOrderRow[];
  emails: CtxEmailThread[];
  storeHandle?: string;
};

export type CtxOrder = {
  number: string;
  placedAt: string | null;
  total: number;
  pay: "COD" | "Prepaid" | "Unpaid" | "Refunded";
  state: { text: string; tone: Tone };
  items: string;
  adminUrl: string | null;
};

export type CtxTicket = {
  number: number;
  open: boolean;
  status: { text: string; tone: Tone };
  topic: string;
  openedAt: string | null;
  resolvedAt: string | null;
  href: string;
};

export type InboxContext = {
  person: {
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    since: string | null;
    contactId: string | null;
  };
  stats: { orders: number; ordersCapped: boolean; spent: number; tickets: number };
  tags: { text: string; tone: Tone }[];
  cod: { orderNumber: string; text: string; tone: Tone; at: string | null } | null;
  orders: CtxOrder[];
  whatsapp: {
    threadId: string;
    isOpen: boolean;
    status: { text: string; tone: Tone };
    lastAt: string | null;
    snippet: string | null;
    messages: { mine: boolean; text: string; at: string }[];
  } | null;
  emails: { id: string; subject: string; status: { text: string; tone: Tone }; at: string; isOpen: boolean }[];
  tickets: CtxTicket[];
};

export const ORDER_FETCH_LIMIT = 50;
const ORDERS_SHOWN = 6;

const TOPIC_WORDS: Record<string, string> = {
  order_status: "Order status",
  order_tracking: "Order status",
  delivery: "Delivery",
  damaged: "Damaged item",
  wrong_item: "Wrong item",
  refund: "Refund",
  cancel: "Cancellation",
  cancellation: "Cancellation",
  product: "Product question",
  product_question: "Product question",
  complaint: "Complaint",
  wholesale: "Wholesale",
  partnership: "Partnership",
};

function words(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

export function topicWord(category: string | null | undefined): string {
  if (!category) return "General";
  return TOPIC_WORDS[category] || words(category);
}

export function orderNumberLabel(n: string | number | null | undefined): string {
  const s = String(n ?? "").trim().replace(/^#/, "");
  return s ? `#${s}` : "";
}

/** HYPD creator seeds are ₹0.01 and never count as revenue. */
function isSeed(total: number): boolean {
  return total > 0 && total <= 0.01;
}

export function payWord(o: Pick<CtxOrderRow, "financial_status" | "confirmation_status">): CtxOrder["pay"] {
  const fs = (o.financial_status || "").toLowerCase();
  if (fs === "refunded" || fs === "partially_refunded") return "Refunded";
  // Only COD orders go through the confirmation gate.
  if (o.confirmation_status) return "COD";
  if (fs === "paid" || fs === "partially_paid") return "Prepaid";
  if (fs === "pending") return "COD";
  return "Unpaid";
}

export function orderState(o: Pick<CtxOrderRow, "fulfillment_status" | "cancelled_at" | "confirmation_status" | "financial_status">): { text: string; tone: Tone } {
  if (o.cancelled_at || o.confirmation_status === "cancelled") return { text: "Cancelled", tone: "neu" };
  if ((o.financial_status || "").toLowerCase() === "refunded") return { text: "Refunded", tone: "neu" };
  const f = (o.fulfillment_status || "").toLowerCase();
  if (f === "fulfilled" || f === "success" || f === "delivered") return { text: "Shipped", tone: "good" };
  if (f === "partial") return { text: "Part shipped", tone: "info" };
  if (o.confirmation_status === "pending" || o.confirmation_status === "needs_call") return { text: "COD not confirmed", tone: "warn" };
  return { text: "To ship", tone: "info" };
}

export function codWord(status: string): { text: string; tone: Tone } {
  switch (status) {
    case "pending":
      return { text: "Waiting for the customer to confirm", tone: "warn" };
    case "needs_call":
      return { text: "Needs a call to confirm", tone: "crit" };
    case "confirmed":
      return { text: "Confirmed", tone: "good" };
    case "cancelled":
      return { text: "Cancelled by the customer", tone: "neu" };
    default:
      return { text: words(status), tone: "neu" };
  }
}

function itemsLine(lineItems: unknown): string {
  if (!Array.isArray(lineItems)) return "";
  const parts = (lineItems as { title?: string; name?: string; quantity?: number }[])
    .map((li) => {
      const name = (li.title || li.name || "").trim();
      if (!name) return "";
      const q = Number(li.quantity) || 1;
      return q > 1 ? `${name} × ${q}` : name;
    })
    .filter(Boolean);
  return parts.join(", ");
}

function waStatus(s: string | null): { text: string; tone: Tone } {
  switch (s) {
    case "human":
      return { text: "With a person", tone: "crit" };
    case "bot":
      return { text: "Bot replying", tone: "info" };
    case "snoozed":
      return { text: "Snoozed", tone: "neu" };
    case "closed":
      return { text: "Closed", tone: "neu" };
    default:
      return { text: "Chat", tone: "neu" };
  }
}

function emailStatus(s: string | null): { text: string; tone: Tone } {
  switch (s) {
    case "pending":
      return { text: "Draft ready", tone: "warn" };
    case "sent":
      return { text: "Replied", tone: "good" };
    case "skipped":
      return { text: "Skipped", tone: "neu" };
    case "failed":
      return { text: "Failed", tone: "crit" };
    default:
      return { text: words(s || "") || "Email", tone: "neu" };
  }
}

function ticketStatus(s: string | null): { text: string; tone: Tone } {
  if (s === "open") return { text: "Open", tone: "crit" };
  if (s === "pending") return { text: "Waiting on customer", tone: "warn" };
  if (s === "resolved" || s === "closed") return { text: "Solved", tone: "good" };
  return { text: words(s || ""), tone: "neu" };
}

function tagTone(tag: string): Tone {
  const t = tag.toLowerCase();
  if (t.includes("champion") || t.includes("loyal") || t.includes("vip")) return "good";
  if (t.includes("risk") || t.includes("lapsed") || t.includes("lost") || t.includes("hibernat")) return "warn";
  if (t.includes("new")) return "info";
  return "neu";
}

/** "rfm:at_risk" -> "At risk", "tier:engaged" -> "Engaged"; plain tags pass through. */
export function tagWord(tag: string): string {
  const t = tag.trim();
  const m = /^[a-z_]+:(.+)$/i.exec(t);
  return m ? words(m[1]) : t;
}

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).replace("Sept", "Sep");
}

function earliest(...isos: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const s of isos) {
    const t = s ? Date.parse(s) : NaN;
    if (!Number.isNaN(t) && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

function oneLine(s: string | null | undefined, max = 120): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildContext(input: CtxInput): InboxContext {
  const { waContact, waThread, crm } = input;

  // ---- orders (newest first, as fetched) --------------------------------
  const real = input.orders.filter((o) => !isSeed(Number(o.total_price) || 0));
  const counted = real.filter((o) => !o.cancelled_at && o.confirmation_status !== "cancelled");
  const spent = counted.reduce((s, o) => s + (Number(o.total_price) || 0), 0);
  const orders: CtxOrder[] = real.slice(0, ORDERS_SHOWN).map((o) => ({
    number: orderNumberLabel(o.order_number),
    placedAt: o.shopify_created_at,
    total: Number(o.total_price) || 0,
    pay: payWord(o),
    state: orderState(o),
    items: itemsLine(o.line_items),
    adminUrl:
      input.storeHandle && o.shopify_id ? `https://admin.shopify.com/store/${input.storeHandle}/orders/${o.shopify_id}` : null,
  }));

  // ---- COD: the newest order that went through the gate ------------------
  const codRow = input.orders.find((o) => o.confirmation_status);
  const cod = codRow
    ? { orderNumber: orderNumberLabel(codRow.order_number), ...codWord(codRow.confirmation_status as string), at: codRow.shopify_created_at }
    : null;

  // ---- tickets: live on the WhatsApp thread ------------------------------
  const tickets: CtxTicket[] = [];
  if (waThread && waThread.ticket_number && waThread.ticket_status && waThread.ticket_status !== "none") {
    tickets.push({
      number: waThread.ticket_number,
      open: waThread.ticket_status === "open" || waThread.ticket_status === "pending",
      status: ticketStatus(waThread.ticket_status),
      topic: oneLine(waThread.ticket_subject, 60) || topicWord(waThread.ticket_category),
      openedAt: waThread.ticket_opened_at,
      resolvedAt: waThread.ticket_resolved_at,
      href: `/dashboard/inbox/wa-${waThread.id}`,
    });
  }

  // ---- tags --------------------------------------------------------------
  const tags: { text: string; tone: Tone }[] = [];
  const seen = new Set<string>();
  const addTag = (text: string, tone: Tone) => {
    const k = text.toLowerCase();
    if (!text || seen.has(k)) return;
    seen.add(k);
    tags.push({ text, tone });
  };
  if (counted.length === 1) addTag("New customer", "info");
  else if (counted.length >= 4) addTag("Repeat buyer", "good");
  if (waContact) addTag(waContact.opted_in === false ? "WhatsApp opted out" : "WhatsApp opted in", waContact.opted_in === false ? "warn" : "good");
  const email = input.email || waContact?.email || crm?.email || null;
  if (!email) addTag("No email", "neu");
  for (const t of [...(waContact?.tags ?? []), ...(crm?.tags ?? [])]) {
    if (typeof t !== "string" || !t.trim()) continue;
    addTag(tagWord(t), tagTone(t));
  }

  // ---- WhatsApp thread summary -------------------------------------------
  const whatsapp = waThread
    ? {
        threadId: waThread.id,
        isOpen: input.open.channel === "wa" && input.open.id === waThread.id,
        status: waStatus(waThread.status),
        lastAt: waThread.last_activity_at,
        snippet: oneLine(waThread.last_message_snippet) || null,
        messages: input.waMessages
          .map((m) => ({ mine: m.direction === "outbound", text: oneLine(m.body || (m.type ? `(${m.type})` : ""), 140), at: m.created_at }))
          .filter((m) => m.text),
      }
    : null;

  const emails = input.emails.map((e) => ({
    id: e.id,
    subject: oneLine(e.subject, 80) || "(no subject)",
    status: emailStatus(e.status),
    at: e.created_at,
    isOpen: input.open.channel === "em" && input.open.id === e.id,
  }));

  const crmName = [crm?.first_name, crm?.last_name].filter(Boolean).join(" ").trim();
  const name = waContact?.name?.trim() || crmName || input.fallbackName;
  const city = [crm?.city].filter(Boolean).join("") || null;
  const oldestOrder = input.orders.length ? input.orders[input.orders.length - 1].shopify_created_at : null;

  return {
    person: {
      name,
      phone: waContact?.phone || (waContact?.wa_id ? `+${waContact.wa_id}` : null) || crm?.phone || null,
      email,
      city,
      since: monthYear(earliest(oldestOrder, waContact?.created_at, waThread?.created_at)),
      contactId: crm?.id ?? null,
    },
    stats: {
      orders: counted.length,
      ordersCapped: input.orders.length >= ORDER_FETCH_LIMIT,
      spent,
      tickets: tickets.length,
    },
    tags,
    cod,
    orders,
    whatsapp,
    emails,
    tickets,
  };
}
