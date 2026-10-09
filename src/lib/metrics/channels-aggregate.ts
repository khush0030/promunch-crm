// Pure aggregation for /api/metrics/channels (Insights → Channels). Channel
// totals come straight from aggregateSales() so they match the Sales tab to
// the rupee; this file adds what the Sales tab does not have: sales per day
// split by channel, and a cross-channel product (SKU) table.
//
// Product money per channel:
// - Web store / HYPD / other: Shopify line items, units × unit price (the
//   same basis as the Sales tab's "Top products"), on revenue orders only.
//   Order discounts and shipping are not split onto lines, so these do not
//   add up to the channel totals exactly.
// - Amazon: amazon_finance_item_events per seller SKU, what customers paid
//   (gross) with refunds taken off; units = shipped minus refunded.
//
// Grouping: Shopify lines group by SKU (title when a line has no SKU).
// Amazon SKUs that share an ASIN are one listing and group together. A
// Shopify and an Amazon product are joined ONLY when they carry the identical
// SKU code: there is no Amazon-to-Shopify product mapping table, and names
// are never fuzzy-matched.

import { aggregateSales, type SalesAggregateInput, type SalesMetrics } from "./sales-aggregate";
import { channelOf, isRevenueOrder } from "./channel";

export type SalesChannel = "web" | "hypd" | "amazon" | "other";
export const SALES_CHANNELS: SalesChannel[] = ["web", "hypd", "amazon", "other"];

export type AmazonItemRow = {
  seller_sku: string | null;
  event_type: string | null;
  posted_date: string | null;
  quantity: number | string | null;
  gross: number | string | null;
};

export type AmazonListingRow = { seller_sku: string | null; asin: string | null; title: string | null };

export type ChannelsAggregateInput = SalesAggregateInput & {
  amazonItems: AmazonItemRow[];
  // Inventory and order-item rows: seller SKU → ASIN + product name.
  amazonListings: AmazonListingRow[];
};

export type ChannelCell = { revenue: number; units: number };

export type SkuRow = {
  key: string;
  name: string;
  codes: string[]; // SKU codes in this group (Shopify + Amazon), for the sub line
  onAmazon: boolean;
  onShopify: boolean;
  byChannel: Record<SalesChannel, ChannelCell>;
  revenue: number;
  units: number;
  share: number; // % of all product sales in the table
  best: SalesChannel | null; // channel with the most product sales
};

export type ChannelsMetrics = {
  sales: SalesMetrics;
  dailyByChannel: { date: string; web: number; hypd: number; amazon: number; other: number }[];
  skus: SkuRow[];
  skuTotals: Record<SalesChannel, ChannelCell>;
  matchedSkus: number; // groups sold on both Amazon and Shopify, joined by identical SKU code
};

const DAY_MS = 24 * 60 * 60 * 1000;

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const inWin = (t: number, w: { from: Date; to: Date }) => t >= w.from.getTime() && t < w.to.getTime();
const norm = (s: string) => s.trim().toUpperCase();

// Amazon listing names run long ("PROMUNCH Roasted Soya Crunchies, Cheese &
// Onion Flavour 270g Jar, Gluten Free ..."): keep the part before the first
// comma or pipe.
function amazonShortName(title: string): string {
  const head = title.replace(/^﻿/, "").split(/[,|]/)[0].trim();
  return head || title.trim();
}

// Tiny union-find over string keys.
class Groups {
  private parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      return k;
    }
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let x = k;
    while (x !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const emptyCells = (): Record<SalesChannel, ChannelCell> => ({
  web: { revenue: 0, units: 0 },
  hypd: { revenue: 0, units: 0 },
  amazon: { revenue: 0, units: 0 },
  other: { revenue: 0, units: 0 },
});

export function aggregateChannels(input: ChannelsAggregateInput): ChannelsMetrics {
  const sales = aggregateSales(input);
  const w = input.window;
  const dayCount = sales.daily.length;
  const daily = sales.daily.map((d) => ({ date: d.date, web: 0, hypd: 0, amazon: 0, other: 0 }));

  // ---- per-day split, same rows and rules as aggregateSales -------------
  type Line = { key: string; channel: SalesChannel; title: string; code: string | null; qty: number; revenue: number };
  const lines: Line[] = [];
  for (const row of input.shopify) {
    if (!isRevenueOrder(row)) continue;
    const ch = channelOf(row);
    if (ch === "creator" || !row.shopify_created_at) continue;
    const t = new Date(row.shopify_created_at).getTime();
    if (!Number.isFinite(t) || !inWin(t, w)) continue;
    const di = Math.floor((t - w.from.getTime()) / DAY_MS);
    if (di >= 0 && di < dayCount) daily[di][ch] += num(row.total_price);
    if (!Array.isArray(row.line_items)) continue;
    for (const it of row.line_items) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      if (!title) continue;
      const sku = typeof o.sku === "string" && o.sku.trim() ? o.sku.trim() : null;
      const qty = num(o.quantity);
      lines.push({
        key: sku ? `sku:${norm(sku)}` : `t:${title.toLowerCase()}`,
        channel: ch,
        title,
        code: sku,
        qty,
        revenue: qty * num(o.price),
      });
    }
  }
  for (const ev of input.amazonFinance) {
    if (!ev.posted_date) continue;
    const t = new Date(ev.posted_date).getTime();
    if (!Number.isFinite(t) || !inWin(t, w)) continue;
    const di = Math.floor((t - w.from.getTime()) / DAY_MS);
    if (di >= 0 && di < dayCount) daily[di].amazon += num(ev.gross);
  }

  // ---- product groups ------------------------------------------------------
  const groups = new Groups();
  const asinOf = new Map<string, string>();
  const amzName = new Map<string, string>();
  for (const l of input.amazonListings) {
    if (!l.seller_sku) continue;
    const k = `sku:${norm(l.seller_sku)}`;
    if (l.asin && !asinOf.has(k)) asinOf.set(k, l.asin.trim());
    if (l.title && !amzName.has(k)) amzName.set(k, amazonShortName(l.title));
  }

  type Amz = { key: string; code: string; qty: number; revenue: number };
  const amz: Amz[] = [];
  for (const ev of input.amazonItems) {
    if (!ev.seller_sku || !ev.posted_date) continue;
    const t = new Date(ev.posted_date).getTime();
    if (!Number.isFinite(t) || !inWin(t, w)) continue;
    const refund = (ev.event_type ?? "").toLowerCase() === "refund";
    const qty = num(ev.quantity);
    amz.push({
      key: `sku:${norm(ev.seller_sku)}`,
      code: ev.seller_sku.trim(),
      qty: refund ? -Math.abs(qty) : qty,
      revenue: num(ev.gross), // refund rows already carry a negative gross
    });
  }

  for (const l of lines) groups.find(l.key);
  for (const a of amz) {
    groups.find(a.key);
    const asin = asinOf.get(a.key);
    if (asin) groups.union(`asin:${asin}`, a.key);
  }

  type Acc = {
    cells: Record<SalesChannel, ChannelCell>;
    codes: Set<string>;
    titles: Map<string, number>;
    amazonName: string | null;
    onAmazon: boolean;
    onShopify: boolean;
  };
  const acc = new Map<string, Acc>();
  const get = (k: string): Acc => {
    const root = groups.find(k);
    let a = acc.get(root);
    if (!a) {
      a = { cells: emptyCells(), codes: new Set(), titles: new Map(), amazonName: null, onAmazon: false, onShopify: false };
      acc.set(root, a);
    }
    return a;
  };
  for (const l of lines) {
    const a = get(l.key);
    a.onShopify = true;
    a.cells[l.channel].revenue += l.revenue;
    a.cells[l.channel].units += l.qty;
    if (l.code) a.codes.add(l.code);
    a.titles.set(l.title, (a.titles.get(l.title) ?? 0) + l.revenue);
  }
  for (const x of amz) {
    const a = get(x.key);
    a.onAmazon = true;
    a.cells.amazon.revenue += x.revenue;
    a.cells.amazon.units += x.qty;
    a.codes.add(x.code);
    if (!a.amazonName) a.amazonName = amzName.get(x.key) ?? null;
  }

  const skuTotals = emptyCells();
  const rows: Omit<SkuRow, "share">[] = [];
  for (const [root, a] of acc) {
    let revenue = 0;
    let units = 0;
    let best: SalesChannel | null = null;
    for (const ch of SALES_CHANNELS) {
      const c = a.cells[ch];
      c.revenue = round2(c.revenue);
      revenue += c.revenue;
      units += c.units;
      skuTotals[ch].revenue += c.revenue;
      skuTotals[ch].units += c.units;
      if (c.revenue > 0 && (best === null || c.revenue > a.cells[best].revenue)) best = ch;
    }
    // Nothing sold net of refunds: leave it out of the ranking.
    if (revenue <= 0 && units <= 0) continue;
    const topTitle = [...a.titles.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const codes = [...a.codes].sort();
    rows.push({
      key: root,
      name: topTitle ?? a.amazonName ?? codes[0] ?? root,
      codes,
      onAmazon: a.onAmazon,
      onShopify: a.onShopify,
      byChannel: a.cells,
      revenue: round2(revenue),
      units,
      best,
    });
  }
  for (const ch of SALES_CHANNELS) skuTotals[ch].revenue = round2(skuTotals[ch].revenue);
  const all = SALES_CHANNELS.reduce((s, ch) => s + Math.max(0, skuTotals[ch].revenue), 0);

  const skus: SkuRow[] = rows
    .map((r) => ({ ...r, share: all > 0 ? Math.round((Math.max(0, r.revenue) / all) * 1000) / 10 : 0 }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.name.localeCompare(b.name));

  return {
    sales,
    dailyByChannel: daily.map((d) => ({
      date: d.date,
      web: round2(d.web),
      hypd: round2(d.hypd),
      amazon: round2(d.amazon),
      other: round2(d.other),
    })),
    skus,
    skuTotals,
    matchedSkus: skus.filter((r) => r.onAmazon && r.onShopify).length,
  };
}
