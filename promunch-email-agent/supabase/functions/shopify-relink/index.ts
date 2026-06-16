// One-off admin tool: re-run the HYPD customer upsert + order link for a single
// order that failed the original webhook (e.g. #2092 "Phone has already been
// taken"). Loads the stored raw order, runs the now-fixed
// upsertShopifyCustomerFromOrder (flexible phone lookup) and linkOrderToCustomer.
// Token-gated by SHOPIFY_BACKFILL_TOKEN. verify_jwt=false in config.toml.
//
//   GET /shopify-relink?token=...&order=2092
//
import { db } from "../_shared/supabase.ts";
import { linkOrderToCustomer, upsertShopifyCustomerFromOrder } from "../_shared/shopify-customer.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = Deno.env.get("SHOPIFY_BACKFILL_TOKEN");
  if (!expected || token !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  const orderNo = (url.searchParams.get("order") ?? "").replace(/^#/, "").trim();
  if (!orderNo) return json({ ok: false, error: "missing order param" }, 400);

  // order_number is stored with a leading "#"; match either form.
  const { data: row, error } = await db()
    .from("shopify_orders")
    .select("shopify_id, order_number, raw")
    .or(`order_number.eq.${orderNo},order_number.eq.#${orderNo}`)
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!row?.raw) return json({ ok: false, error: "order not found or raw missing" }, 404);

  const order = row.raw as any;
  const up = await upsertShopifyCustomerFromOrder(order);
  if (!up.ok) return json({ ok: false, step: "upsert", reason: up.reason });
  if (!up.id) return json({ ok: false, step: "upsert", reason: "no customer id resolved" });

  const link = await linkOrderToCustomer(row.shopify_id, up.id);
  if (!link.ok) return json({ ok: false, step: "link", customerId: up.id, reason: link.reason });

  return json({ ok: true, order: row.order_number, customerId: up.id });
});
