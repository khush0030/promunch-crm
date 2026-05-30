import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findCrmContactForWa } from "@/lib/customer-link";

// Customer 360 for a WhatsApp thread: stitches the chat to the rest of the
// CRM. Given a thread it returns the customer's Shopify orders (matched by
// their WhatsApp number) and their CRM contact record (matched by email or
// phone) — so an agent sees order numbers and a contact link without leaving
// the chat.

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "";
// "promunch.myshopify.com" -> "promunch" (the admin URL store handle)
const STORE_HANDLE = SHOPIFY_STORE_URL.replace(/\.myshopify\.com$/i, "");

function fmtMoney(amount: number, currency: string): string {
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  return `${sym}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: thread, error } = await supabaseAdmin
    .from("wa_threads")
    .select("id, wa_id, contact:wa_contacts!inner(id, wa_id, phone, name, email, tags, shopify_customer_id)")
    .eq("id", id)
    .single();
  if (error || !thread) {
    return NextResponse.json({ error: error?.message ?? "thread not found" }, { status: 404 });
  }

  const waId: string = thread.wa_id;

  // --- Shopify orders, matched by the customer's WhatsApp number ------------
  const { data: orderRows } = await supabaseAdmin
    .from("shopify_orders")
    .select(
      "shopify_id, order_number, total_price, currency, financial_status, " +
        "customer_name, customer_email, line_items, shopify_created_at, raw",
    )
    .eq("customer_phone", waId)
    .order("shopify_created_at", { ascending: false })
    .limit(10);

  const orders = ((orderRows ?? []) as any[]).map((r) => {
    const raw = (r.raw ?? {}) as Record<string, any>;
    const f = Array.isArray(raw.fulfillments) ? raw.fulfillments[0] : null;
    const items = (Array.isArray(r.line_items) ? r.line_items : []).map((li: any) => ({
      name: li.title || li.name || "Item",
      qty: li.quantity ?? 1,
    }));
    return {
      order_number: r.order_number,
      placed_at: String(r.shopify_created_at ?? "").slice(0, 10),
      total: fmtMoney(Number(r.total_price ?? 0), r.currency || "INR"),
      financial_status: r.financial_status ?? null,
      fulfillment_status: raw.fulfillment_status ?? f?.status ?? "unfulfilled",
      items,
      tracking_url: f?.tracking_url || f?.tracking_urls?.[0] || null,
      order_status_url: raw.order_status_url || null,
      admin_url: STORE_HANDLE && r.shopify_id
        ? `https://admin.shopify.com/store/${STORE_HANDLE}/orders/${r.shopify_id}`
        : null,
    };
  });

  // --- CRM contact: resolved through the unified matching layer ------------
  // (shopify_customer_id → email → last-10-digit phone). The shopify customer
  // id is the highest-confidence match and is lifted from the raw order
  // payload as a fallback when wa_contacts doesn't carry it.
  const email =
    (thread.contact as any)?.email ||
    ((orderRows ?? []) as any[]).find((o) => o.customer_email)?.customer_email ||
    null;
  const firstRaw = ((orderRows?.[0] ?? null) as { raw?: Record<string, unknown> } | null)?.raw as
    | Record<string, unknown>
    | undefined;
  const rawCustomer = (firstRaw?.customer ?? null) as { id?: string | number | null } | null;
  const shopifyCustomerId =
    (thread.contact as { shopify_customer_id?: string | null })?.shopify_customer_id ??
    (rawCustomer?.id != null ? String(rawCustomer.id) : null);

  const contact = await findCrmContactForWa({
    email,
    wa_id: waId,
    phone: (thread.contact as { phone?: string | null })?.phone ?? null,
    shopify_customer_id: shopifyCustomerId,
  });

  return NextResponse.json({
    wa_id: waId,
    contact,
    orders,
    order_count: orders.length,
  });
}
