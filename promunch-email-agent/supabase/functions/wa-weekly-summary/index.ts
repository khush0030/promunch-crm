// WhatsApp weekly recap posted to Slack — the channel's story without anyone
// opening the dashboard. Rolling last 7 days. Mirrors the dashboard Analytics
// headline: sent, delivered/read, replies, orders, revenue, spend, return,
// plus the week's top campaign.
//
// Deploy:  supabase functions deploy wa-weekly-summary  (set verify_jwt=false)
// Schedule: see scripts/wa-weekly-summary-cron.sql (Mondays 09:00 IST).

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { fmtMoney, postSlack } from "../_shared/shopify.ts";

const BILLED = ["sent", "delivered", "read"];
const PRICE: Record<string, number> = {
  marketing: 0.78, offer: 0.78, utility: 0.115, authentication: 0.115, service: 0,
};

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const channel = Deno.env.get("WA_SLACK_CHANNEL_ID") || Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
  if (!channel) return new Response("no-channel", { status: 500 });

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const supa = db();

  const outCount = async (statuses: string[] | null) => {
    let q = supa.from("wa_messages").select("*", { count: "exact", head: true })
      .eq("direction", "outbound").gte("created_at", since);
    if (statuses) q = q.in("status", statuses);
    const { count } = await q;
    return count ?? 0;
  };

  const [sent, delivered, read, failed] = await Promise.all([
    outCount(BILLED), outCount(["delivered", "read"]), outCount(["read"]), outCount(["failed"]),
  ]);
  const { count: replies } = await supa.from("wa_messages")
    .select("*", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", since);

  const spend = await estimateSpend(supa, since);
  const { orders, revenue } = await attributeRevenue(supa, since);

  // top campaign this week (by volume sent)
  const { data: camps } = await supa.from("wa_campaigns")
    .select("name,sent_count,failed_count").eq("status", "completed").gte("completed_at", since)
    .order("sent_count", { ascending: false }).limit(1);
  const top = camps?.[0];

  const deliveredPct = sent ? Math.round((delivered / sent) * 100) : 0;
  const readPct = sent ? Math.round((read / sent) * 100) : 0;
  const roi = spend > 0 ? revenue / spend : null;

  const fields = [
    { type: "mrkdwn", text: `*Messages sent*\n${sent.toLocaleString("en-IN")}` },
    { type: "mrkdwn", text: `*Delivered / Read*\n${deliveredPct}% / ${readPct}%` },
    { type: "mrkdwn", text: `*Replies*\n${(replies ?? 0).toLocaleString("en-IN")}` },
    { type: "mrkdwn", text: `*Orders from WhatsApp*\n${orders.toLocaleString("en-IN")}` },
    { type: "mrkdwn", text: `*Revenue*\n${fmtMoney(revenue, "INR")}` },
    { type: "mrkdwn", text: `*Message cost*\n${fmtMoney(spend, "INR")}` },
  ];
  if (roi != null) fields.push({ type: "mrkdwn", text: `*Return*\n${roi.toFixed(1)}x` });
  if (failed) fields.push({ type: "mrkdwn", text: `*Failed sends*\n${failed.toLocaleString("en-IN")}` });

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "📊 WhatsApp — last 7 days" } },
    { type: "section", fields },
  ];
  if (top) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Top campaign*\n${top.name} · ${(top.sent_count ?? 0).toLocaleString("en-IN")} sent${top.failed_count ? ` · ${top.failed_count} failed` : ""}` },
    });
  }

  await postSlack(channel, blocks, `WhatsApp weekly: ${sent} sent · ${fmtMoney(revenue, "INR")} revenue`);
  return new Response(JSON.stringify({ ok: true, sent, revenue, orders }), {
    headers: { "content-type": "application/json" },
  });
});

// deno-lint-ignore no-explicit-any
async function estimateSpend(supa: any, since: string): Promise<number> {
  const { data: tpls } = await supa.from("wa_templates").select("name,category");
  const namesByCat: Record<string, string[]> = {};
  (tpls ?? []).forEach((t: { name: string; category: string }) => {
    (namesByCat[t.category] ||= []).push(t.name);
  });
  let spend = 0;
  for (const [cat, names] of Object.entries(namesByCat)) {
    const price = PRICE[cat] ?? 0;
    if (!price || !names.length) continue;
    const { count } = await supa.from("wa_messages").select("*", { count: "exact", head: true })
      .eq("direction", "outbound").in("status", BILLED).gte("created_at", since).in("template_name", names);
    spend += (count ?? 0) * price;
  }
  return Math.round(spend * 100) / 100;
}

// Orders from customers we messaged this week, linked by customer_phone (= wa_id).
// deno-lint-ignore no-explicit-any
async function attributeRevenue(supa: any, since: string): Promise<{ orders: number; revenue: number }> {
  const { data: ordRows } = await supa.from("shopify_orders")
    .select("customer_phone,total_price,financial_status,is_creator")
    .gte("shopify_created_at", since).not("customer_phone", "is", null).limit(1000);
  const live = (ordRows ?? []).filter((o: { customer_phone: string | null; financial_status: string | null; is_creator: boolean | null }) =>
    o.customer_phone && !o.is_creator && o.financial_status !== "refunded" && o.financial_status !== "voided");
  if (!live.length) return { orders: 0, revenue: 0 };

  const phones = [...new Set(live.map((o: { customer_phone: string }) => o.customer_phone))];
  const { data: waC } = await supa.from("wa_contacts").select("id,wa_id").in("wa_id", phones);
  const idToPhone = new Map<string, string>();
  (waC ?? []).forEach((w: { id: string; wa_id: string }) => idToPhone.set(w.id, w.wa_id));
  if (!idToPhone.size) return { orders: 0, revenue: 0 };

  const { data: msgged } = await supa.from("wa_messages").select("contact_id")
    .eq("direction", "outbound").gte("created_at", since).in("contact_id", [...idToPhone.keys()]);
  const engaged = new Set<string>();
  (msgged ?? []).forEach((m: { contact_id: string }) => {
    const p = idToPhone.get(m.contact_id);
    if (p) engaged.add(p);
  });
  if (!engaged.size) return { orders: 0, revenue: 0 };

  const matched = live.filter((o: { customer_phone: string }) => engaged.has(o.customer_phone));
  const revenue = matched.reduce((s: number, o: { total_price: number | string }) => s + Number(o.total_price || 0), 0);
  return { orders: matched.length, revenue: Math.round(revenue) };
}
