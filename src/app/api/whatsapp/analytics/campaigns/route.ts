import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { attributeOrders, loadAttributableOrders, pageAll, touchesFrom } from "@/lib/whatsapp/campaign-attribution";

export const dynamic = "force-dynamic";

// Layer 2: per-campaign report cards (grade + plain verdict), cost/ROI, and
// "smart hints" (best send time, best-responding segment) — all derived from
// wa_messages so an employee can compare campaigns without reading numbers.

const PRICE: Record<string, number> = {
  marketing: 0.78, offer: 0.78, utility: 0.115, authentication: 0.115, service: 0,
};
const BILLED = ["sent", "delivered", "read"];

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Campaigns in window (most recent first), with template category. Delivery
  // counts are authoritative on the row (maintained by wa_campaign_recount).
  const { data: camps } = await supabaseAdmin
    .from("wa_campaigns")
    .select("id,name,status,sent_count,delivered_count,read_count,failed_count,started_at,created_at,template:wa_templates(category)")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);
  const campaigns = camps ?? [];

  // One scan of campaign messages → per-campaign status counts + audience sets.
  type Msg = { campaign_id: string; contact_id: string | null; status: string; created_at: string };
  const msgs = await pageAll<Msg>(() =>
    supabaseAdmin
      .from("wa_messages")
      .select("campaign_id,contact_id,status,created_at")
      .eq("direction", "outbound")
      .not("campaign_id", "is", null)
      .gte("created_at", since)
  );
  const stat = new Map<string, { delivered: number; read: number; sent: number; failed: number; contacts: Set<string> }>();
  for (const m of msgs) {
    const s = stat.get(m.campaign_id) || { delivered: 0, read: 0, sent: 0, failed: 0, contacts: new Set<string>() };
    if (m.status === "read") { s.read++; s.delivered++; s.sent++; }
    else if (m.status === "delivered") { s.delivered++; s.sent++; }
    else if (m.status === "sent") { s.sent++; }
    else if (m.status === "failed") { s.failed++; }
    if (m.contact_id) s.contacts.add(m.contact_id);
    stat.set(m.campaign_id, s);
  }

  // wa_contact → wa_id (phone) + rfm tag, for revenue + segment hints.
  const allWa = [...new Set(msgs.map((m) => m.contact_id).filter(Boolean))] as string[];
  const waMeta = new Map<string, { phone: string | null; rfm: string | null }>();
  for (let i = 0; i < allWa.length; i += 500) {
    const slice = allWa.slice(i, i + 500);
    const { data } = await supabaseAdmin.from("wa_contacts").select("id,wa_id,tags").in("id", slice);
    (data ?? []).forEach((w: { id: string; wa_id: string | null; tags: string[] | null }) =>
      waMeta.set(w.id, { phone: w.wa_id, rfm: (w.tags || []).find((t) => t.startsWith("rfm:")) || null })
    );
  }

  // Orders each campaign earned: shared 7-day last-touch rule (same number
  // the journey card shows), see src/lib/whatsapp/campaign-attribution.ts.
  const revByCamp = attributeOrders(
    touchesFrom(msgs, (id) => waMeta.get(id)?.phone),
    await loadAttributableOrders(since),
  );

  // Build a report card per campaign.
  const cards = campaigns.map((c: any) => {
    const sent = c.sent_count || 0;
    const deliveredPct = sent ? Math.round((c.delivered_count / sent) * 100) : 0;
    const readPct = sent ? Math.round((c.read_count / sent) * 100) : 0;
    const cat = c.template?.category || "marketing";
    const cost = Math.round(sent * (PRICE[cat] ?? 0) * 100) / 100;

    const attributed = revByCamp.get(c.id) ?? { revenue: 0, orders: 0 };
    const revenue = Math.round(attributed.revenue);
    const orderCount = attributed.orders;
    const roi = cost > 0 ? revenue / cost : null;
    const { grade, verdict } = gradeCampaign(deliveredPct, readPct, roi, orderCount);

    return {
      id: c.id, name: c.name, status: c.status,
      sent, deliveredPct, readPct, failed: c.failed_count || 0,
      orders: orderCount, revenue, cost, roi, grade, verdict,
    };
  });

  // ---- Smart hints ----
  const hints = await buildHints(since, msgs, waMeta);

  return NextResponse.json({ window: { days }, campaigns: cards, hints });
}

function gradeCampaign(deliveredPct: number, readPct: number, roi: number | null, orders: number) {
  let score = 0;
  score += deliveredPct >= 85 ? 25 : deliveredPct >= 60 ? 12 : 0;
  score += readPct >= 50 ? 35 : readPct >= 30 ? 22 : readPct >= 15 ? 10 : 0;
  score += roi != null ? (roi >= 3 ? 40 : roi >= 1 ? 25 : roi > 0 ? 10 : 0) : orders > 0 ? 15 : 0;
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";

  let verdict: string;
  if (readPct < 20) verdict = "Few people opened it. Try a stronger first line or better timing.";
  else if (deliveredPct < 70) verdict = "Many didn't get delivered. Clean up the phone list.";
  else if (roi != null && roi < 1) verdict = "Cost more than it earned. Tighten the audience or offer.";
  else if (orders === 0) verdict = "Good reach but no orders yet. Add a clearer call to action.";
  else if (grade === "A") verdict = "Strong all round. Do more like this.";
  else verdict = "Solid. Small tweaks to copy or audience could lift orders.";
  return { grade, verdict };
}

async function buildHints(
  since: string,
  campMsgs: { contact_id: string | null }[],
  waMeta: Map<string, { phone: string | null; rfm: string | null }>
) {
  // Best time to send: when do customer replies land (IST hour histogram)?
  const inbound = await pageAll<{ created_at: string }>(() =>
    supabaseAdmin.from("wa_messages").select("created_at").eq("direction", "inbound").gte("created_at", since)
  );
  const IST = 5.5 * 60 * 60 * 1000;
  const byHour = new Array(24).fill(0);
  inbound.forEach((m) => { byHour[new Date(new Date(m.created_at).getTime() + IST).getUTCHours()]++; });
  const peak = byHour.indexOf(Math.max(...byHour));
  const fmtH = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const bestTime = inbound.length
    ? { hour: peak, label: `${fmtH(peak)}–${fmtH((peak + 2) % 24)}`, note: "Most customer replies arrive then. Schedule campaigns just before." }
    : null;

  // Best segment: which RFM tier replied most among messaged contacts.
  const RFM_NAME: Record<string, string> = {
    "rfm:vip": "VIP", "rfm:loyal": "Loyal", "rfm:repeat": "Repeat",
    "rfm:at_risk": "At-risk", "rfm:dormant": "Dormant", "rfm:new": "New",
  };
  const segReplies = new Map<string, number>();
  // contacts we messaged in campaigns, with their rfm
  const messagedRfm = new Map<string, string>();
  campMsgs.forEach((m) => { if (m.contact_id) { const r = waMeta.get(m.contact_id)?.rfm; if (r) messagedRfm.set(m.contact_id, r); } });
  // who among them replied (paged — .limit(5000) still gets capped at
  // PostgREST's 1000-row response ceiling)
  const repliers = await pageAll<{ contact_id: string | null }>(() =>
    supabaseAdmin.from("wa_messages").select("contact_id").eq("direction", "inbound").gte("created_at", since)
  );
  repliers.forEach((r: { contact_id: string | null }) => {
    if (!r.contact_id) return;
    const rfm = messagedRfm.get(r.contact_id);
    if (rfm) segReplies.set(rfm, (segReplies.get(rfm) || 0) + 1);
  });
  let topSegment: { name: string; note: string } | null = null;
  if (segReplies.size) {
    const [tag] = [...segReplies.entries()].sort((a, b) => b[1] - a[1])[0];
    const name = RFM_NAME[tag] || tag;
    topSegment = { name, note: `${name} customers reply the most. Message them first.` };
  }

  return { bestTime, topSegment };
}
