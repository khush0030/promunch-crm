// Pure planning for order events -> Brevo. No IO; brevo-events.ts runs it.

import { marketingEligibility, waIdOf, type SyncContact } from "./brevo-audience";

export type EventName = "order_placed" | "order_fulfilled" | "order_cancelled";

export type EventOrder = {
  id: string;
  shopify_id: string | number | null;
  order_number: string | number | null;
  total_price: number | string | null;
  currency: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  line_items: unknown;
  shopify_created_at: string | null;
  fulfillment_status: string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  source_name: string | null;
  is_creator: boolean | null;
  customer_order_index: number | null;
};

export type BrevoEvent = {
  event_name: EventName;
  event_date: string;
  identifiers: { email_id: string };
  contact_properties?: Record<string, string | number>;
  event_properties: Record<string, unknown>;
};

export type PlannedEvent = { orderId: string; event: EventName; email: string; payload: BrevoEvent };

type LineItem = { title?: string; name?: string; quantity?: number; price?: string | number; sku?: string; variant_title?: string };

function items(raw: unknown) {
  const arr = Array.isArray(raw) ? (raw as LineItem[]) : [];
  return arr.slice(0, 20).map((li) => ({
    title: li.title ?? li.name ?? "Item",
    variant: li.variant_title ?? undefined,
    quantity: Number(li.quantity ?? 1),
    price: Number(li.price ?? 0),
    sku: li.sku ?? undefined,
  }));
}

/** Which events each order is due, before claims/consent are applied. */
export function dueEvents(o: EventOrder): EventName[] {
  if (o.is_creator) return [];
  const price = Number(o.total_price ?? 0);
  if (!Number.isFinite(price) || price <= 0.01) return [];
  const out: EventName[] = ["order_placed"];
  if ((o.fulfillment_status ?? "").toLowerCase() === "fulfilled") out.push("order_fulfilled");
  if (o.cancelled_at) out.push("order_cancelled");
  return out;
}

export function buildEvent(o: EventOrder, event: EventName, email: string, now: Date): BrevoEvent {
  const date =
    event === "order_placed"
      ? o.shopify_created_at ?? now.toISOString()
      : event === "order_cancelled"
        ? o.cancelled_at ?? now.toISOString()
        : now.toISOString();
  const first = (o.customer_name ?? "").trim().split(/\s+/)[0] || undefined;
  return {
    event_name: event,
    event_date: date,
    identifiers: { email_id: email },
    ...(first ? { contact_properties: { FIRSTNAME: first } } : {}),
    event_properties: {
      order_id: String(o.shopify_id ?? o.id),
      order_number: o.order_number != null ? String(o.order_number) : null,
      total: Number(o.total_price ?? 0),
      currency: o.currency ?? "INR",
      first_order: o.customer_order_index === 1,
      payment: (o.financial_status ?? "").toLowerCase() === "pending" ? "COD" : "Prepaid",
      channel: o.source_name === "341128478721" ? "HYPD" : "D2C site",
      items: items(o.line_items),
    },
  };
}

/**
 * Plans events for a batch of orders: resolves the email (order email, else
 * the CRM contact with the same phone), applies test/live audience rules and
 * drops anything already claimed.
 */
export function planEvents(input: {
  orders: EventOrder[];
  claimed: Set<string>;
  contactsByEmail: Map<string, SyncContact>;
  emailByWaId: Map<string, string>;
  suppressed: Set<string>;
  target: "test" | "live";
  testEmails: Set<string>;
  now: Date;
}): { planned: PlannedEvent[]; skipped: Record<string, number> } {
  const planned: PlannedEvent[] = [];
  const skipped: Record<string, number> = {};
  const skip = (r: string) => (skipped[r] = (skipped[r] ?? 0) + 1);
  for (const o of input.orders) {
    const events = dueEvents(o).filter((e) => !input.claimed.has(`${o.id}:${e}`));
    if (events.length === 0) continue;
    const waId = waIdOf(o.customer_phone);
    const email = o.customer_email?.trim().toLowerCase() || (waId ? input.emailByWaId.get(waId) : undefined);
    if (!email) {
      skip("no_email");
      continue;
    }
    if (input.target === "test") {
      if (!input.testEmails.has(email)) {
        skip("not_test_address");
        continue;
      }
      if (input.suppressed.has(email)) {
        skip("suppressed");
        continue;
      }
    } else {
      const contact = input.contactsByEmail.get(email);
      if (!contact) {
        skip("no_crm_contact");
        continue;
      }
      const v = marketingEligibility(contact, input.suppressed);
      if (!v.ok) {
        skip(v.reason);
        continue;
      }
    }
    for (const e of events) planned.push({ orderId: o.id, event: e, email, payload: buildEvent(o, e, email, input.now) });
  }
  return { planned, skipped };
}

