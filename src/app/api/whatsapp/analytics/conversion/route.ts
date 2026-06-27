import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Click -> order conversion. For every tracked link a customer clicked, did
// they then buy? Attributes each order to the destination of the customer's
// LAST click before that order (last-click attribution), grouped by
// destination URL so staff see which links/messages actually drive revenue.
//
// Reads wa_short_links + wa_link_clicks (click tracking) joined through
// wa_contacts.wa_id -> shopify_orders.customer_phone. Degrades to empty if the
// tracking tables aren't migrated yet.

const ATTRIB_DAYS = 7; // an order counts if placed within 7 days of the click

async function pageAll<T>(mk: () => any, cap = 60000): Promise<T[]> {
  const size = 1000;
  let from = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await mk().range(from, from + size - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < size || from >= cap) break;
    from += size;
  }
  return out;
}

// Group key + display: drop protocol + query string, trim trailing slash.
function destOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split(/[?#]/)[0].replace(/\/+$/, "") || url;
}

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // 1. tracked links + clicks in window
  type Link = { code: string; target_url: string };
  const links = await pageAll<Link>(() =>
    supabaseAdmin.from("wa_short_links").select("code,target_url").gte("created_at", since)
  ).catch(() => []);
  if (!links.length) return NextResponse.json(empty(days));
  const destByCode = new Map<string, string>();
  const sentByDest = new Map<string, number>();
  links.forEach((l) => {
    const d = destOf(l.target_url);
    destByCode.set(l.code, d);
    sentByDest.set(d, (sentByDest.get(d) ?? 0) + 1);
  });

  type Click = { code: string; contact_id: string | null; clicked_at: string };
  const clicks = await pageAll<Click>(() =>
    supabaseAdmin.from("wa_link_clicks").select("code,contact_id,clicked_at").gte("clicked_at", since)
  ).catch(() => []);

  // per-destination click + distinct-clicker tally; per-contact click timeline
  const clicksByDest = new Map<string, number>();
  const clickersByDest = new Map<string, Set<string>>();
  const clicksByContact = new Map<string, { dest: string; at: string }[]>();
  for (const c of clicks) {
    const dest = destByCode.get(c.code);
    if (!dest) continue;
    clicksByDest.set(dest, (clicksByDest.get(dest) ?? 0) + 1);
    if (c.contact_id) {
      (clickersByDest.get(dest) ?? clickersByDest.set(dest, new Set()).get(dest)!).add(c.contact_id);
      (clicksByContact.get(c.contact_id) ?? clicksByContact.set(c.contact_id, []).get(c.contact_id)!)
        .push({ dest, at: c.clicked_at });
    }
  }

  // 2. clicker contact -> wa_id (phone)
  const contactIds = [...clicksByContact.keys()];
  const idToPhone = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const slice = contactIds.slice(i, i + 500);
    const { data } = await supabaseAdmin.from("wa_contacts").select("id,wa_id").in("id", slice);
    (data ?? []).forEach((w: { id: string; wa_id: string }) => idToPhone.set(w.id, w.wa_id));
  }

  // 3. orders for those phones in window (live, non-creator)
  const phones = [...new Set([...idToPhone.values()])];
  type Ord = { customer_phone: string; total_price: number | string; shopify_created_at: string; financial_status: string | null; is_creator: boolean | null };
  const ordersByPhone = new Map<string, Ord[]>();
  for (let i = 0; i < phones.length; i += 300) {
    const slice = phones.slice(i, i + 300);
    const { data } = await supabaseAdmin
      .from("shopify_orders")
      .select("customer_phone,total_price,shopify_created_at,financial_status,is_creator")
      .in("customer_phone", slice)
      .gte("shopify_created_at", since);
    (data ?? []).forEach((o: Ord) => {
      if (o.is_creator || o.financial_status === "refunded" || o.financial_status === "voided") return;
      (ordersByPhone.get(o.customer_phone) ?? ordersByPhone.set(o.customer_phone, []).get(o.customer_phone)!).push(o);
    });
  }

  // 4. last-click attribution: each order credited to the destination of the
  // contact's latest click within ATTRIB_DAYS before the order.
  const ordersByDest = new Map<string, number>();
  const revenueByDest = new Map<string, number>();
  let totalOrders = 0, totalRevenue = 0;
  const attribMs = ATTRIB_DAYS * 86400000;
  for (const [contactId, taps] of clicksByContact) {
    const phone = idToPhone.get(contactId);
    if (!phone) continue;
    const orders = ordersByPhone.get(phone) ?? [];
    const sorted = taps.slice().sort((a, b) => (a.at < b.at ? 1 : -1)); // newest first
    for (const o of orders) {
      const ot = new Date(o.shopify_created_at).getTime();
      const tap = sorted.find((t) => {
        const tt = new Date(t.at).getTime();
        return tt <= ot && ot - tt <= attribMs;
      });
      if (!tap) continue;
      const rev = Number(o.total_price || 0);
      ordersByDest.set(tap.dest, (ordersByDest.get(tap.dest) ?? 0) + 1);
      revenueByDest.set(tap.dest, (revenueByDest.get(tap.dest) ?? 0) + rev);
      totalOrders++; totalRevenue += rev;
    }
  }

  // 5. assemble rows, sorted by revenue then clicks
  const rows = [...sentByDest.keys()].map((dest) => {
    const clickCount = clicksByDest.get(dest) ?? 0;
    const clickers = clickersByDest.get(dest)?.size ?? 0;
    const orders = ordersByDest.get(dest) ?? 0;
    const revenue = Math.round(revenueByDest.get(dest) ?? 0);
    return {
      dest,
      sent: sentByDest.get(dest) ?? 0,
      clicks: clickCount,
      clickers,
      orders,
      revenue,
      convPct: clickers ? Math.round((orders / clickers) * 100) : 0,
    };
  }).filter((r) => r.clicks > 0 || r.orders > 0)
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks)
    .slice(0, 30);

  const totalClicks = [...clicksByDest.values()].reduce((s, n) => s + n, 0);
  const totalClickers = new Set(clicksByContact.keys()).size;

  return NextResponse.json({
    window: { days },
    totals: {
      links: links.length,
      clicks: totalClicks,
      clickers: totalClickers,
      orders: totalOrders,
      revenue: Math.round(totalRevenue),
      convPct: totalClickers ? Math.round((totalOrders / totalClickers) * 100) : 0,
    },
    rows,
  });
}

function empty(days: number) {
  return { window: { days }, totals: { links: 0, clicks: 0, clickers: 0, orders: 0, revenue: 0, convPct: 0 }, rows: [] };
}
