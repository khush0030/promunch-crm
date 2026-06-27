import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Layer 3: a plain-English live activity feed — replies coming in, campaigns
// finishing, orders landing — so an employee can watch the channel work in
// real time and trust it. Merged + time-sorted, newest first.

type Item = { at: string; type: "reply" | "campaign" | "order"; tone: "b" | "g" | "o"; title: string; sub?: string };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export async function GET() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString(); // last 3 days

  const [replies, camps, orders] = await Promise.all([
    supabaseAdmin
      .from("wa_messages")
      .select("created_at,body,contact:wa_contacts(name,wa_id)")
      .eq("direction", "inbound")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("wa_campaigns")
      .select("name,sent_count,failed_count,started_at,completed_at")
      .eq("status", "completed")
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(8),
    supabaseAdmin
      .from("shopify_orders")
      .select("order_number,customer_name,total_price,currency,shopify_created_at,customer_phone,is_creator")
      .gte("shopify_created_at", since)
      .not("customer_phone", "is", null)
      .order("shopify_created_at", { ascending: false })
      .limit(12),
  ]);

  const items: Item[] = [];

  (replies.data ?? []).forEach((r: any) => {
    const who = r.contact?.name || r.contact?.wa_id || "A customer";
    const snip = (r.body || "").replace(/\s+/g, " ").slice(0, 60);
    items.push({ at: r.created_at, type: "reply", tone: "b", title: `New reply from ${who}`, sub: snip || undefined });
  });

  (camps.data ?? []).forEach((c: any) => {
    const at = c.completed_at || c.started_at;
    if (!at) return;
    items.push({
      at, type: "campaign", tone: "g",
      title: `Campaign "${c.name}" finished`,
      sub: `${(c.sent_count ?? 0).toLocaleString("en-IN")} sent${c.failed_count ? ` · ${c.failed_count} failed` : ""}`,
    });
  });

  (orders.data ?? []).forEach((o: any) => {
    if (o.is_creator) return;
    items.push({
      at: o.shopify_created_at, type: "order", tone: "g",
      title: `New order ${o.order_number ? "#" + o.order_number : ""}`.trim(),
      sub: `${inr(Number(o.total_price || 0))}${o.customer_name ? " · " + o.customer_name : ""}`,
    });
  });

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return NextResponse.json({ items: items.slice(0, 25) });
}
