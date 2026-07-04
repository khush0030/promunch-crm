// Sales recap posted to Slack.
// Default daily (today + MTD). Pass ?period=week or ?period=month for weekly/monthly recap.
// All timestamps interpreted in Asia/Kolkata.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { fmtMoney, postSlackBlocks } from "../_shared/shopify.ts";

const IST_OFFSET_MIN = 330;

type Period = "day" | "week" | "month";

function istBounds(now = new Date()) {
  const istNow = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const dow = istNow.getUTCDay(); // 0 = Sun

  const dayStart = new Date(Date.UTC(y, m, d) - IST_OFFSET_MIN * 60_000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const monthStart = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MIN * 60_000);
  const weekStart = new Date(dayStart.getTime() - dow * 24 * 60 * 60_000); // assume Sun-start week
  const istLabel = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { dayStart, dayEnd, monthStart, weekStart, istLabel, y, m, d };
}

type Row = { total_price: number; currency: string; line_items: { title?: string; name?: string; quantity?: number }[]; refunded_amount?: number; cancelled_at?: string | null };

function summarize(rows: Row[]) {
  const active = rows.filter((r) => !r.cancelled_at);
  const total = active.reduce((a, r) => a + Number(r.total_price) - Number(r.refunded_amount ?? 0), 0);
  const count = active.length;
  const aov = count ? total / count : 0;
  const items = new Map<string, number>();
  for (const r of active) {
    for (const li of r.line_items ?? []) {
      const name = li.title || li.name || "Item";
      items.set(name, (items.get(name) ?? 0) + (li.quantity ?? 1));
    }
  }
  const top = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { total, count, aov, top };
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  const url = new URL(req.url);
  const period = (url.searchParams.get("period") as Period) || "day";
  const channel = Deno.env.get("SHOPIFY_SLACK_CHANNEL_ID");
  if (!channel) return new Response("no-channel", { status: 500 });

  const b = istBounds();

  const queries: Record<Period, { label: string; start: Date; end: Date; compareLabel?: string; compare?: { start: Date; end: Date } }> = {
    day: { label: `Daily — ${b.istLabel} (IST)`, start: b.dayStart, end: b.dayEnd, compareLabel: "Month to date", compare: { start: b.monthStart, end: b.dayEnd } },
    week: { label: `Weekly recap — week of ${b.istLabel}`, start: b.weekStart, end: b.dayEnd },
    month: { label: `Monthly recap — ${b.y}-${String(b.m + 1).padStart(2, "0")}`, start: b.monthStart, end: b.dayEnd },
  };

  const cfg = queries[period];
  const primary = await db().from("shopify_orders")
    .select("total_price, currency, line_items, refunded_amount, cancelled_at")
    .gte("shopify_created_at", cfg.start.toISOString())
    .lt("shopify_created_at", cfg.end.toISOString());
  if (primary.error) return new Response("db-error", { status: 500 });

  const p = summarize((primary.data ?? []) as Row[]);
  const currency = primary.data?.[0]?.currency || "INR";

  const topLines = p.top.map(([n, q]) => `• ${q} × ${n}`).join("\n") || "_no items_";

  const fields = [
    { type: "mrkdwn", text: `*Revenue*\n${fmtMoney(p.total, currency)}` },
    { type: "mrkdwn", text: `*Orders*\n${p.count}` },
    { type: "mrkdwn", text: `*AOV*\n${fmtMoney(p.aov, currency)}` },
  ];

  if (cfg.compare) {
    const c = await db().from("shopify_orders")
      .select("total_price, currency, line_items, refunded_amount, cancelled_at")
      .gte("shopify_created_at", cfg.compare.start.toISOString())
      .lt("shopify_created_at", cfg.compare.end.toISOString());
    if (!c.error) {
      const cs = summarize((c.data ?? []) as Row[]);
      fields.push({ type: "mrkdwn", text: `*${cfg.compareLabel}*\n${fmtMoney(cs.total, currency)} · ${cs.count} orders` });
    }
  }

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `📊 ${cfg.label}` } },
    { type: "section", fields },
    { type: "section", text: { type: "mrkdwn", text: `*Top items*\n${topLines}` } },
  ];

  await postSlackBlocks(channel, blocks, `${cfg.label}: ${fmtMoney(p.total, currency)} · ${p.count} orders`);
  return new Response(JSON.stringify({ ok: true, period, total: p.total, count: p.count }), { headers: { "content-type": "application/json" } });
});
