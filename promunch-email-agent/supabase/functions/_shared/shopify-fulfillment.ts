// Shopify fulfillment holds + customer-initiated order cancellation for the
// COD confirmation gate. All calls ride the same client-credentials Admin
// token as customer upserts (shopify-customer.ts). Requires app scopes:
//   read/write_merchant_managed_fulfillment_orders  (hold + release)
//   write_orders                                     (cancel + note; already
//                                                     granted for tagsAdd)
// Every function returns { ok, reason } and never throws — callers decide
// whether a failure blocks (it never blocks a customer-facing send).

import { adminGraphQL } from "./shopify-customer.ts";

const orderGid = (id: number | string) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`;

const errsOf = (j: any, path: string): unknown[] | null => {
  const node = path.split(".").reduce((o, k) => o?.[k], j?.data);
  const errs = node?.userErrors ?? j?.errors;
  return Array.isArray(errs) && errs.length ? errs : null;
};

const fail = (reason: unknown) => ({ ok: false as const, reason: JSON.stringify(reason).slice(0, 300) });

async function fulfillmentOrderIds(
  orderId: number | string,
  statuses: string[],
): Promise<string[] | { error: string }> {
  const j = await adminGraphQL(
    `query($id: ID!){ order(id:$id){ fulfillmentOrders(first: 10){ nodes { id status } } } }`,
    { id: orderGid(orderId) },
  );
  if (j?.errors) return { error: JSON.stringify(j.errors).slice(0, 300) };
  const nodes: any[] = j?.data?.order?.fulfillmentOrders?.nodes ?? [];
  return nodes.filter((n) => statuses.includes(String(n?.status))).map((n) => String(n.id));
}

// Place a hold on every open fulfillment order (split shipments each get one).
export async function holdOrderFulfillments(
  orderId: number | string,
  note: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const ids = await fulfillmentOrderIds(orderId, ["OPEN", "IN_PROGRESS", "SCHEDULED"]);
    if (!Array.isArray(ids)) return fail(ids.error);
    if (!ids.length) return { ok: false, reason: "no-holdable-fulfillment-orders" };
    for (const id of ids) {
      const j = await adminGraphQL(
        `mutation($id: ID!, $hold: FulfillmentOrderHoldInput!){
           fulfillmentOrderHold(id: $id, fulfillmentHold: $hold){
             userErrors { field message } } }`,
        { id, hold: { reason: "OTHER", reasonNotes: note } },
      );
      const errs = errsOf(j, "fulfillmentOrderHold");
      if (errs) return fail(errs);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

export async function releaseOrderHolds(
  orderId: number | string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const ids = await fulfillmentOrderIds(orderId, ["ON_HOLD"]);
    if (!Array.isArray(ids)) return fail(ids.error);
    if (!ids.length) return { ok: true }; // nothing held — releasing is a no-op
    for (const id of ids) {
      const j = await adminGraphQL(
        `mutation($id: ID!){
           fulfillmentOrderReleaseHold(id: $id){ userErrors { field message } } }`,
        { id },
      );
      const errs = errsOf(j, "fulfillmentOrderReleaseHold");
      if (errs) return fail(errs);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

// Cancel an unpaid COD order at the customer's request. No refund (nothing
// was paid), restock inventory, no Shopify email (customer is phone-only,
// we message them on WhatsApp ourselves).
export async function cancelOrderByCustomer(
  orderId: number | string,
  staffNote: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const j = await adminGraphQL(
      `mutation($orderId: ID!, $reason: OrderCancelReason!, $staffNote: String){
         orderCancel(orderId: $orderId, reason: $reason, refund: false,
                     restock: true, staffNote: $staffNote, notifyCustomer: false){
           orderCancelUserErrors { field message }
           userErrors { field message } } }`,
      { orderId: orderGid(orderId), reason: "CUSTOMER", staffNote },
    );
    const errs = errsOf(j, "orderCancel") ??
      (Array.isArray(j?.data?.orderCancel?.orderCancelUserErrors) &&
          j.data.orderCancel.orderCancelUserErrors.length
        ? j.data.orderCancel.orderCancelUserErrors
        : null);
    if (errs) return fail(errs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}

// Order note shows in the Shopify admin order page sidebar.
export async function setOrderNote(
  orderId: number | string,
  note: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const j = await adminGraphQL(
      `mutation($input: OrderInput!){
         orderUpdate(input: $input){ userErrors { field message } } }`,
      { input: { id: orderGid(orderId), note } },
    );
    const errs = errsOf(j, "orderUpdate");
    if (errs) return fail(errs);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 300) };
  }
}
