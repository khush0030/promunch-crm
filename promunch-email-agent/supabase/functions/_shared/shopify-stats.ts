// Shared Shopify sales/order queries.
// Used by both the `/shopify` slash command and Maya's DM chatbot, so the
// numbers and formatting stay identical no matter how they're asked for.

import { db } from "./supabase.ts";
import { fmtMoney } from "./shopify.ts";

const IST_OFFSET_MIN = 330;

export function istBounds(now = new Date()) {
  const istNow = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const dow = istNow.getUTCDay();
  const dayStart = new Date(Date.UTC(y, m, d) - IST_OFFSET_MIN * 60_000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const monthStart = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MIN * 60_000);
  const weekStart = new Date(dayStart.getTime() - dow * 24 * 60 * 60_000);
  return { dayStart, dayEnd, monthStart, weekStart };
}

export async function totalsFor(start: Date, end: Date) {
  const { data } = await db().from("shopify_orders")
    .select("total_price, refunded_amount, cancelled_at, currency")
    .gte("shopify_created_at", start.toISOString())
    .lt("shopify_created_at", end.toISOString());
  const active = (data ?? []).filter((r: any) => !r.cancelled_at);
  const total = active.reduce((a, r: any) => a + Number(r.total_price) - Number(r.refunded_amount ?? 0), 0);
  return { total, count: active.length, currency: data?.[0]?.currency || "INR" };
}

// Returns a one-line Slack-formatted sales summary. arg: today | week | month | mtd
export async function salesSummary(arg: string): Promise<string> {
  const b = istBounds();
  const range = (arg || "today").toLowerCase();
  let start = b.dayStart, end = b.dayEnd, label = "Today";
  if (range === "week") { start = b.weekStart; label = "This week"; }
  else if (range === "month" || range === "mtd") { start = b.monthStart; label = "Month to date"; }
  const r = await totalsFor(start, end);
  return `*${label}:* ${fmtMoney(r.total, r.currency)} · ${r.count} orders · AOV ${fmtMoney(r.count ? r.total / r.count : 0, r.currency)}`;
}

// Returns a Slack-formatted order card, or a not-found / usage message.
export async function orderLookup(arg: string): Promise<string> {
  const num = (arg ?? "").replace(/^#/, "").trim();
  if (!num) return "Usage: `/shopify order #1234`";
  const { data } = await db().from("shopify_orders")
    .select("order_number, total_price, currency, customer_name, customer_email, line_items, financial_status, fulfillment_status, cancelled_at, refunded_amount")
    .or(`order_number.eq.#${num},order_number.eq.${num}`)
    .maybeSingle();
  if (!data) return `Order #${num} not found.`;
  const who = [data.customer_name, data.customer_email].filter(Boolean).join(" · ") || "guest";
  const items = (data.line_items ?? []).map((li: any) => `• ${li.quantity ?? 1} × ${li.title || li.name}`).join("\n");
  const flags: string[] = [];
  if (data.cancelled_at) flags.push("❌ cancelled");
  if (data.fulfillment_status === "fulfilled") flags.push("📦 fulfilled");
  if (Number(data.refunded_amount) > 0) flags.push(`💸 refunded ${fmtMoney(Number(data.refunded_amount), data.currency)}`);
  return [
    `*${data.order_number}* · ${fmtMoney(Number(data.total_price), data.currency)} · ${data.financial_status ?? ""} ${flags.join(" ")}`,
    `Customer: ${who}`,
    items,
  ].join("\n");
}
