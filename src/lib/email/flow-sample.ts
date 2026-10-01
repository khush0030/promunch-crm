// Sample enrolment context for automation previews and test sends, copied
// from real data so a test shows what a customer would actually see:
// - abandoned cart: the latest real cart whose link came from the checkout
//   NOTE (Super Money Breeze), so the real link format shows;
// - order placed: the latest real order, shaped like the context
//   order-confirmation stores (merged items + one-tap reorder permalink).

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const TEST_CONTACT = "00000000-0000-0000-0000-000000000000"; // unsubscribe link resolves to nobody

const FALLBACK = {
  checkout_url: "https://promunch.in/cart",
  items: [{ title: "PROMUNCH Diwali Snack Box", quantity: 1, price: 555 }],
  total: 555,
  reorder_url: "https://promunch.in/collections/all",
};

export async function sampleFlowContext(
  trigger: string,
  flowId?: string,
): Promise<{ context: Record<string, unknown>; source: string }> {
  if (trigger === "checkout_abandoned") {
    let q = supabase
      .from("flow_enrollments")
      .select("context, entered_at")
      .like("context->>checkout_url", "%atomsSt=%")
      .order("entered_at", { ascending: false })
      .limit(1);
    if (flowId) q = q.eq("flow_id", flowId);
    const { data } = await q;
    if (data?.[0]?.context) {
      return {
        context: data[0].context as Record<string, unknown>,
        source: `latest real cart with a note link (${String(data[0].entered_at).slice(0, 10)})`,
      };
    }
  } else if (trigger === "order_placed") {
    const { data } = await supabase
      .from("shopify_orders")
      .select("order_number, line_items, shopify_created_at")
      .gt("total_price", 1)
      .order("shopify_created_at", { ascending: false })
      .limit(1);
    const lines = (Array.isArray(data?.[0]?.line_items) ? data[0].line_items : []) as Array<Record<string, unknown>>;
    if (lines.length > 0) {
      const byTitle = new Map<string, { title: string; quantity: number; price: number }>();
      const qty = new Map<string, number>();
      for (const li of lines) {
        const title = String(li.title ?? li.name ?? "Item");
        const n = Number(li.quantity ?? 1);
        const prev = byTitle.get(title);
        if (prev) prev.quantity += n;
        else byTitle.set(title, { title, quantity: n, price: Number(li.price ?? 0) });
        if (li.variant_id && Number(li.price ?? 0) > 0) {
          const v = String(li.variant_id).replace(/\D/g, "");
          qty.set(v, (qty.get(v) ?? 0) + Math.max(1, n));
        }
      }
      const perma = [...qty].map(([v, q]) => `${v}:${q}`).join(",");
      return {
        context: {
          items: [...byTitle.values()].slice(0, 8),
          reorder_url: perma ? `https://promunch.in/cart/${perma}?storefront=true` : FALLBACK.reorder_url,
        },
        source: `latest real order ${data![0].order_number} (${String(data![0].shopify_created_at).slice(0, 10)})`,
      };
    }
  }
  return { context: FALLBACK, source: "sample cart" };
}
