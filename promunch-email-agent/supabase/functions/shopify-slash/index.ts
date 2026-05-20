// Slack slash command handler.
// Supports: /sales today, /sales mtd, /sales week, /sales month, /order #1234
// Verifies Slack signature with SHOPIFY_SLACK_SIGNING_SECRET.

import { db } from "../_shared/supabase.ts";
import { fmtMoney } from "../_shared/shopify.ts";

const IST_OFFSET_MIN = 330;

async function verifySlackSig(rawBody: string, sig: string | null, ts: string | null, secret: string): Promise<boolean> {
  if (!sig || !ts) return false;
  // Reject if timestamp older than 5 min
  const drift = Math.abs(Date.now() / 1000 - Number(ts));
  if (drift > 300) return false;
  const basestring = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `v0=${hex}`;
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function istBounds(now = new Date()) {
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

async function totalsFor(start: Date, end: Date) {
  const { data } = await db().from("shopify_orders")
    .select("total_price, refunded_amount, cancelled_at, currency")
    .gte("shopify_created_at", start.toISOString())
    .lt("shopify_created_at", end.toISOString());
  const active = (data ?? []).filter((r: any) => !r.cancelled_at);
  const total = active.reduce((a, r: any) => a + Number(r.total_price) - Number(r.refunded_amount ?? 0), 0);
  return { total, count: active.length, currency: data?.[0]?.currency || "INR" };
}

async function handleSales(arg: string) {
  const b = istBounds();
  const range = arg.toLowerCase();
  let start = b.dayStart, end = b.dayEnd, label = "Today";
  if (range === "week") { start = b.weekStart; label = "This week"; }
  else if (range === "month" || range === "mtd") { start = b.monthStart; label = "Month to date"; }
  const r = await totalsFor(start, end);
  return `*${label}:* ${fmtMoney(r.total, r.currency)} · ${r.count} orders · AOV ${fmtMoney(r.count ? r.total / r.count : 0, r.currency)}`;
}

async function handleOrder(arg: string) {
  const num = arg.replace(/^#/, "").trim();
  if (!num) return "Usage: `/order #1234`";
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text();
  const secret = Deno.env.get("SHOPIFY_SLACK_SIGNING_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });
  if (!(await verifySlackSig(raw, req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"), secret))) {
    return new Response("bad-sig", { status: 401 });
  }
  const form = new URLSearchParams(raw);
  const command = form.get("command") || "";
  const text = (form.get("text") || "").trim();

  let response: string;
  if (command === "/sales") response = await handleSales(text || "today");
  else if (command === "/order") response = await handleOrder(text);
  else response = `Unknown command ${command}`;

  return new Response(JSON.stringify({ response_type: "ephemeral", text: response }), {
    headers: { "content-type": "application/json" },
  });
});
