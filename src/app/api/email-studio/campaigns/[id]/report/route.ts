import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { bad } from "@/lib/email-studio/route-helpers";

// One campaign's results: delivery funnel, link clicks, unsubscribes and the
// Shopify orders credited to it (email_attributions, filled by the
// attribution tick). Opens are shown but clicks + revenue are the headline:
// Apple Mail Privacy Protection fakes opens.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const PAGE = 1000;

type Row = { id: string; contact_id: string; status: string; sent_at: string | null; opened_at: string | null; clicked_at: string | null };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { data: c } = await supabase
    .from("campaigns")
    .select("id, name, subject, status, sent_at, scheduled_at, total_recipients")
    .eq("id", id)
    .maybeSingle();
  if (!c) return bad("not found", 404);

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("campaign_emails")
      .select("id, contact_id, status, sent_at, opened_at, clicked_at")
      .eq("campaign_id", id)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return bad(error.message, 500);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE) break;
  }

  const accepted = rows.filter((r) => r.status !== "queued" && r.status !== "failed");
  const bounced = rows.filter((r) => r.status === "bounced").length;
  const complained = rows.filter((r) => r.status === "complained").length;
  const delivered = accepted.filter((r) => ["delivered", "opened", "clicked"].includes(r.status) || r.opened_at || r.clicked_at).length;
  const opened = rows.filter((r) => r.opened_at).length;
  const clicked = rows.filter((r) => r.clicked_at).length;
  const failed = rows.filter((r) => r.status === "failed").length;

  // Unsubscribes: recipients whose address was suppressed for "unsubscribe" after this send.
  let unsubscribed = 0;
  if (c.sent_at && rows.length) {
    const ids = rows.map((r) => r.contact_id);
    const emails: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("contacts").select("email").in("id", ids.slice(i, i + 200));
      for (const e of data ?? []) if (e.email) emails.push(String(e.email).toLowerCase());
    }
    for (let i = 0; i < emails.length; i += 200) {
      const { count } = await supabase
        .from("suppressions")
        .select("email", { count: "exact", head: true })
        .eq("reason", "unsubscribe")
        .gte("created_at", c.sent_at)
        .in("email", emails.slice(i, i + 200));
      unsubscribed += count ?? 0;
    }
  }

  // Link clicks (Resend puts the clicked URL in data.click.link).
  const { data: clicks } = await supabase
    .from("email_events")
    .select("metadata, campaign_emails!inner(campaign_id)")
    .eq("event_type", "clicked")
    .eq("campaign_emails.campaign_id", id)
    .limit(5000);
  const links = new Map<string, number>();
  for (const e of clicks ?? []) {
    const m = e.metadata as { click?: { link?: string } } | null;
    const raw = m?.click?.link;
    if (!raw) continue;
    let key = raw;
    try {
      const u = new URL(raw);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
      key = u.toString();
    } catch {}
    links.set(key, (links.get(key) ?? 0) + 1);
  }

  const { data: attrib } = await supabase
    .from("email_attributions")
    .select("order_number, order_at, revenue, model")
    .eq("campaign_id", id)
    .order("order_at", { ascending: false })
    .limit(500);
  const revenue = (attrib ?? []).reduce((s, a) => s + (Number(a.revenue) || 0), 0);

  return NextResponse.json({
    campaign: c,
    funnel: { recipients: rows.length, accepted: accepted.length, delivered, opened, clicked, bounced, complained, unsubscribed, failed },
    links: [...links.entries()].map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    orders: attrib ?? [],
    revenue,
  });
}
