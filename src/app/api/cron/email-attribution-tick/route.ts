import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { attributeOrder, phoneKey, type Click } from "@/lib/email-studio/attribution";

// Credits recent Shopify orders to the email campaign / flow that drove them
// (rules in src/lib/email-studio/attribution.ts) and keeps campaigns.revenue_attributed
// + total_orders current. Read-only on orders; idempotent (shopify_order_id is
// unique in email_attributions). Runs on pg_cron every 3h with the
// CRON_SECRET bearer; fails closed without it.
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const PAGE = 1000;
const LOOKBACK_DAYS = 30;

async function pageAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const clickSince = new Date(Date.now() - (LOOKBACK_DAYS + 5) * 86_400_000).toISOString();

    type OrderRow = {
      shopify_id: string | number;
      order_number: string | number | null;
      total_price: number | string | null;
      shopify_created_at: string | null;
      customer_email: string | null;
      customer_phone: string | null;
      last_utm_source: string | null;
      last_utm_campaign: string | null;
      first_utm_source: string | null;
      first_utm_campaign: string | null;
      is_creator: boolean | null;
      cancelled_at: string | null;
    };
    const [orders, done, campaigns, campClicks, flowClicks] = await Promise.all([
      pageAll<OrderRow>((a, b) =>
        supabase
          .from("shopify_orders")
          .select("shopify_id, order_number, total_price, shopify_created_at, customer_email, customer_phone, last_utm_source, last_utm_campaign, first_utm_source, first_utm_campaign, is_creator, cancelled_at")
          .gte("shopify_created_at", since)
          .order("shopify_created_at")
          .range(a, b),
      ),
      pageAll<{ shopify_order_id: string }>((a, b) => supabase.from("email_attributions").select("shopify_order_id").gte("order_at", since).order("id").range(a, b)),
      pageAll<{ id: string; utm_campaign: string }>((a, b) => supabase.from("campaigns").select("id, utm_campaign").not("utm_campaign", "is", null).order("id").range(a, b)),
      pageAll<{ campaign_id: string; contact_id: string; clicked_at: string }>((a, b) =>
        supabase.from("campaign_emails").select("campaign_id, contact_id, clicked_at").gte("clicked_at", clickSince).order("id").range(a, b),
      ),
      pageAll<{ flow_id: string; contact_id: string; clicked_at: string }>((a, b) =>
        supabase.from("email_sends").select("flow_id, contact_id, clicked_at").gte("clicked_at", clickSince).order("id").range(a, b),
      ),
    ]);

    const already = new Set(done.map((d) => String(d.shopify_order_id)));
    const campaignByUtm = new Map(campaigns.map((c) => [c.utm_campaign.toLowerCase(), c.id]));
    const clicksByContact = new Map<string, Click[]>();
    const add = (k: Click) => {
      if (!k.contact_id || !k.id) return;
      const list = clicksByContact.get(k.contact_id) ?? [];
      list.push(k);
      clicksByContact.set(k.contact_id, list);
    };
    campClicks.forEach((c) => add({ kind: "campaign", id: c.campaign_id, contact_id: c.contact_id, clicked_at: c.clicked_at }));
    flowClicks.forEach((c) => add({ kind: "flow", id: c.flow_id, contact_id: c.contact_id, clicked_at: c.clicked_at }));

    // Contacts only for clickers (the click rule) + UTM orders still need a contact id.
    const contactIds = [...clicksByContact.keys()];
    const contactByEmail = new Map<string, string>();
    const contactByPhone = new Map<string, string>();
    for (let i = 0; i < contactIds.length; i += 200) {
      const { data } = await supabase.from("contacts").select("id, email, phone").in("id", contactIds.slice(i, i + 200));
      for (const c of data ?? []) {
        if (c.email) contactByEmail.set(String(c.email).toLowerCase(), c.id);
        const k = phoneKey(c.phone);
        if (k) contactByPhone.set(k, c.id);
      }
    }

    const inserts = [];
    for (const o of orders) {
      const sid = String(o.shopify_id);
      if (already.has(sid) || !o.shopify_created_at) continue;
      const credit = attributeOrder(
        {
          shopify_id: sid,
          order_number: o.order_number != null ? String(o.order_number) : null,
          total_price: Number(o.total_price) || 0,
          created_at: o.shopify_created_at,
          email: o.customer_email,
          phone: o.customer_phone,
          utm_sources: [o.last_utm_source, o.first_utm_source],
          utm_campaigns: [o.last_utm_campaign, o.first_utm_campaign],
          is_creator: !!o.is_creator,
          cancelled: !!o.cancelled_at,
        },
        { campaignByUtm, contactByEmail, contactByPhone, clicksByContact },
      );
      if (!credit) continue;
      inserts.push({
        shopify_order_id: sid,
        order_number: o.order_number != null ? String(o.order_number) : null,
        order_at: o.shopify_created_at,
        revenue: Number(o.total_price) || 0,
        ...credit,
      });
    }

    if (inserts.length) {
      const { error } = await supabase.from("email_attributions").upsert(inserts, { onConflict: "shopify_order_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    // Roll up per campaign for the list view.
    const touched = [...new Set(inserts.map((i) => i.campaign_id).filter((x): x is string => !!x))];
    for (const id of touched) {
      const { data } = await supabase.from("email_attributions").select("revenue").eq("campaign_id", id);
      const rev = (data ?? []).reduce((s, r) => s + (Number(r.revenue) || 0), 0);
      await supabase.from("campaigns").update({ revenue_attributed: rev, total_orders: (data ?? []).length }).eq("id", id);
    }

    return NextResponse.json({ ok: true, scanned: orders.length, credited: inserts.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "attribution failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
