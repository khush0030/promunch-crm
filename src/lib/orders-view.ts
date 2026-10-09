// Orders → All orders: channel chips, search, totals and CSV export over the
// rows GET /api/whatsapp/confirmations already returns. Pure, no fetching.

import type { ChannelKey } from "@/lib/metrics/channel";

/** "+91 98765 43210" for Indian numbers, "+<digits>" for others, "" for none. */
export function formatPhone(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("0")) return `+91 ${d.slice(1, 6)} ${d.slice(6)}`;
  return `+${d}`;
}

export type OrderChannel = "all" | "web" | "hypd" | "amazon" | "other";

export const CHANNEL_LABEL: Record<Exclude<OrderChannel, "all">, string> = {
  web: "Website",
  hypd: "HYPD",
  amazon: "Amazon",
  other: "Other",
};

export type ViewOrder = {
  order_number: string;
  customer_name: string | null;
  phone: string | null;
  total: number | null;
  created_at: string;
  channel?: ChannelKey | null;
  is_creator?: boolean | null;
};

/** HYPD ₹0.01 creator seeds: flagged by Shopify, or a 1 paisa total. */
export function isCreatorSeed(o: Pick<ViewOrder, "is_creator" | "total" | "channel">): boolean {
  if (o.is_creator || o.channel === "creator") return true;
  const t = Number(o.total);
  return Number.isFinite(t) && t > 0 && Math.round(t * 100) <= 1;
}

/** Which chip an order falls under. Creator seeds sit with HYPD. */
export function chipOf(o: ViewOrder): Exclude<OrderChannel, "all"> {
  if (isCreatorSeed(o)) return "hypd";
  const c = o.channel ?? "web";
  return c === "creator" ? "hypd" : c;
}

export function matchesSearch(o: ViewOrder, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const num = String(o.order_number ?? "").toLowerCase();
  if (num.includes(s.replace(/^#/, ""))) return true;
  if ((o.customer_name ?? "").toLowerCase().includes(s)) return true;
  const digits = s.replace(/\D/g, "");
  // Need a few digits so "2" does not match every phone number.
  return digits.length >= 3 && String(o.phone ?? "").replace(/\D/g, "").includes(digits);
}

export function filterOrders<T extends ViewOrder>(rows: T[], channel: OrderChannel, q: string): T[] {
  return rows.filter((o) => (channel === "all" || chipOf(o) === channel) && matchesSearch(o, q));
}

export function channelCounts(rows: ViewOrder[]): Record<OrderChannel, number> {
  const out: Record<OrderChannel, number> = { all: rows.length, web: 0, hypd: 0, amazon: 0, other: 0 };
  for (const o of rows) out[chipOf(o)]++;
  return out;
}

/** Orders + revenue for a view, leaving creator seeds out of both. */
export function viewTotals(rows: ViewOrder[]): { orders: number; revenue: number; seeds: number } {
  let orders = 0;
  let revenue = 0;
  let seeds = 0;
  for (const o of rows) {
    if (isCreatorSeed(o)) { seeds++; continue; }
    orders++;
    revenue += Number(o.total) || 0;
  }
  return { orders, revenue: Math.round(revenue * 100) / 100, seeds };
}

// CSV cell: quoted when needed, and a leading = + - @ is neutralised so a
// spreadsheet never runs a customer's name (or a "+91" phone) as a formula.
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
