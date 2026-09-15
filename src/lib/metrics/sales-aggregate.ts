// Pure sales aggregation for /api/metrics/sales. Takes already-fetched rows
// plus the current/previous windows and produces the SalesMetrics shape the
// Home and Sales pages render. No I/O here so it is unit-testable; the route
// only fetches rows and calls aggregateSales().

import type { PeriodKey } from "./period";
import { channelOf, isRevenueOrder, type ChannelKey } from "./channel";

export type SalesMetrics = {
  period: PeriodKey;
  window: { from: string; to: string };
  previous: { from: string; to: string };
  total: { revenue: number; orders: number; prevRevenue: number; prevOrders: number };
  channels: {
    key: ChannelKey;
    label: string;
    revenue: number;
    orders: number;
    prevRevenue: number;
    aov: number;
  }[]; // web, hypd, amazon, other
  amazon: { gross: number; net: number; prevGross: number; prevNet: number; orders: number } | null;
  daily: { date: string; revenue: number; prevRevenue: number }[]; // web+hypd gross + amazon gross, aligned by day index
  repeat: { orders: number; pct: number; prevPct: number }; // customer_order_index > 1
  newCustomers: { count: number; prevCount: number }; // customer_order_index === 1
  topProducts: { title: string; units: number; revenue: number; share: number }[]; // from line_items, top 5
};

export type ShopifySalesRow = {
  total_price: number | string | null;
  shopify_created_at: string | null;
  financial_status: string | null;
  source_name: string | null;
  first_utm_source: string | null;
  first_source: string | null;
  is_creator: boolean | null;
  customer_order_index: number | null;
  line_items: unknown;
};

export type AmazonFinanceRow = {
  posted_date: string | null;
  gross: number | string | null;
  net: number | string | null;
  event_type: string | null;
};

export type AmazonOrderRow = {
  purchase_date: string | null;
  order_status: string | null;
};

export type SalesAggregateInput = {
  period: PeriodKey;
  window: { from: Date; to: Date };
  previous: { from: Date; to: Date };
  shopify: ShopifySalesRow[];
  amazonFinance: AmazonFinanceRow[];
  amazonOrders: AmazonOrderRow[];
};

// Channels the dashboard reports on, in display order. "creator" is
// deliberately absent: seed orders are excluded from every number here.
const CHANNELS: { key: ChannelKey; label: string }[] = [
  { key: "web", label: "Web store" },
  { key: "hypd", label: "HYPD" },
  { key: "amazon", label: "Amazon" },
  { key: "other", label: "Other marketplaces" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct1(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

type Bucket = "current" | "previous" | null;

// Which window a timestamp falls in. Windows are contiguous half-open
// [from, to) so a row on the exact boundary lands in exactly one of them.
function bucketOf(
  ts: string | null,
  w: { from: Date; to: Date },
  p: { from: Date; to: Date },
): { bucket: Bucket; t: number } {
  if (!ts) return { bucket: null, t: NaN };
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return { bucket: null, t };
  if (t >= w.from.getTime() && t < w.to.getTime()) return { bucket: "current", t };
  if (t >= p.from.getTime() && t < p.to.getTime()) return { bucket: "previous", t };
  return { bucket: null, t };
}

function dayIndex(t: number, from: Date): number {
  return Math.floor((t - from.getTime()) / DAY_MS);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type LineItem = { title: string; quantity: number; price: number };

function lineItemsOf(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LineItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    out.push({ title, quantity: num(o.quantity), price: num(o.price) });
  }
  return out;
}

export function aggregateSales(input: SalesAggregateInput): SalesMetrics {
  const { window: w, previous: p } = input;
  const dayCount = Math.max(1, Math.round((w.to.getTime() - w.from.getTime()) / DAY_MS));
  const dailyCur = new Array<number>(dayCount).fill(0);
  const dailyPrev = new Array<number>(dayCount).fill(0);

  const chan = new Map<ChannelKey, { revenue: number; orders: number; prevRevenue: number }>();
  for (const c of CHANNELS) chan.set(c.key, { revenue: 0, orders: 0, prevRevenue: 0 });

  let curRevenueOrders = 0;
  let prevRevenueOrders = 0;
  let curRepeat = 0;
  let prevRepeat = 0;
  let curNew = 0;
  let prevNew = 0;
  let curShopifyRevenue = 0;
  const products = new Map<string, { units: number; revenue: number }>();

  for (const row of input.shopify) {
    if (!isRevenueOrder(row)) continue;
    const key = channelOf(row);
    if (key === "creator") continue; // isRevenueOrder already excludes, belt and braces
    const { bucket, t } = bucketOf(row.shopify_created_at, w, p);
    if (!bucket) continue;

    const amount = num(row.total_price);
    const c = chan.get(key)!;
    const idx = row.customer_order_index;

    if (bucket === "current") {
      c.revenue += amount;
      c.orders += 1;
      curRevenueOrders += 1;
      curShopifyRevenue += amount;
      const di = dayIndex(t, w.from);
      if (di >= 0 && di < dayCount) dailyCur[di] += amount;
      if (idx != null && idx > 1) curRepeat += 1;
      if (idx === 1) curNew += 1;
      for (const li of lineItemsOf(row.line_items)) {
        const agg = products.get(li.title) ?? { units: 0, revenue: 0 };
        agg.units += li.quantity;
        agg.revenue += li.quantity * li.price;
        products.set(li.title, agg);
      }
    } else {
      c.prevRevenue += amount;
      prevRevenueOrders += 1;
      const di = dayIndex(t, p.from);
      if (di >= 0 && di < dayCount) dailyPrev[di] += amount;
      if (idx != null && idx > 1) prevRepeat += 1;
      if (idx === 1) prevNew += 1;
    }
  }

  // Amazon: finance events carry the money (refund rows are negative and
  // stay in), amazon_orders carries the order count.
  let amzGross = 0;
  let amzNet = 0;
  let amzPrevGross = 0;
  let amzPrevNet = 0;
  for (const ev of input.amazonFinance) {
    const { bucket, t } = bucketOf(ev.posted_date, w, p);
    if (!bucket) continue;
    const gross = num(ev.gross);
    const net = num(ev.net);
    if (bucket === "current") {
      amzGross += gross;
      amzNet += net;
      const di = dayIndex(t, w.from);
      if (di >= 0 && di < dayCount) dailyCur[di] += gross;
    } else {
      amzPrevGross += gross;
      amzPrevNet += net;
      const di = dayIndex(t, p.from);
      if (di >= 0 && di < dayCount) dailyPrev[di] += gross;
    }
  }

  let amzOrders = 0;
  let amzPrevOrders = 0;
  for (const o of input.amazonOrders) {
    if ((o.order_status ?? "").toLowerCase() === "canceled") continue;
    const { bucket } = bucketOf(o.purchase_date, w, p);
    if (bucket === "current") amzOrders += 1;
    else if (bucket === "previous") amzPrevOrders += 1;
  }

  const amz = chan.get("amazon")!;
  amz.revenue = amzGross;
  amz.prevRevenue = amzPrevGross;
  amz.orders = amzOrders;

  const channels = CHANNELS.map(({ key, label }) => {
    const c = chan.get(key)!;
    return {
      key,
      label,
      revenue: round2(c.revenue),
      orders: c.orders,
      prevRevenue: round2(c.prevRevenue),
      aov: c.orders > 0 ? round2(c.revenue / c.orders) : 0,
    };
  });

  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  const totalPrevRevenue = channels.reduce((s, c) => s + c.prevRevenue, 0);

  const daily = dailyCur.map((rev, i) => ({
    date: isoDate(new Date(w.from.getTime() + i * DAY_MS)),
    revenue: round2(rev),
    prevRevenue: round2(dailyPrev[i]),
  }));

  const topProducts = [...products.entries()]
    .map(([title, v]) => ({
      title,
      units: v.units,
      revenue: round2(v.revenue),
      share: pct1(v.revenue, curShopifyRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.title.localeCompare(b.title))
    .slice(0, 5);

  return {
    period: input.period,
    window: { from: w.from.toISOString(), to: w.to.toISOString() },
    previous: { from: p.from.toISOString(), to: p.to.toISOString() },
    total: {
      revenue: round2(totalRevenue),
      orders: curRevenueOrders + amzOrders,
      prevRevenue: round2(totalPrevRevenue),
      prevOrders: prevRevenueOrders + amzPrevOrders,
    },
    channels,
    amazon: {
      gross: round2(amzGross),
      net: round2(amzNet),
      prevGross: round2(amzPrevGross),
      prevNet: round2(amzPrevNet),
      orders: amzOrders,
    },
    daily,
    repeat: {
      orders: curRepeat,
      pct: pct1(curRepeat, curRevenueOrders),
      prevPct: pct1(prevRepeat, prevRevenueOrders),
    },
    newCustomers: { count: curNew, prevCount: prevNew },
    topProducts,
  };
}
