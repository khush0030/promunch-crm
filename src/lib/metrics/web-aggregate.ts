// Pure web-store attribution aggregation for /api/metrics/web. Takes
// already-fetched shopify_orders rows plus the current/previous windows and
// produces the WebMetrics shape the Sales > Web store page renders. No I/O
// here so it is unit-testable; the route only fetches rows and calls
// aggregateWeb(). Replaces the ad hoc aggregation that used to live in
// src/app/dashboard/shopify-attribution/page.tsx.

import type { PeriodKey } from "./period";
import { channelOf, isRevenueOrder } from "./channel";

export type WebMetrics = {
  period: PeriodKey;
  window: { from: string; to: string };
  previous: { from: string; to: string };
  total: { revenue: number; orders: number; prevRevenue: number; prevOrders: number };
  aov: { value: number; prev: number };
  repeat: { pct: number; prevPct: number };
  untracked: { pct: number; prevPct: number; orders: number };
  sources: { key: string; label: string; revenue: number; orders: number; share: number }[];
  newVsReturning: { newRevenue: number; returningRevenue: number; newAov: number; returningAov: number };
  campaigns: { name: string; source: string; orders: number; revenue: number; newPct: number }[];
  tracking: { attributedOrders: number; totalOrders: number; lastAttributedAt: string | null };
};

export type WebOrderRow = {
  total_price: number | string | null;
  shopify_created_at: string | null;
  financial_status: string | null;
  source_name: string | null;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_source: string | null;
  first_source_type: string | null;
  first_referrer_url: string | null;
  is_creator: boolean | null;
  customer_order_index: number | null;
};

export type WebAggregateInput = {
  period: PeriodKey;
  window: { from: Date; to: Date };
  previous: { from: Date; to: Date };
  shopify: WebOrderRow[];
  // ?creators=include — when true, HYPD ₹0.01 creator seed orders are not
  // excluded from revenue and can land in the "web" channel bucket.
  includeCreators: boolean;
};

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

function bucketOf(
  ts: string | null,
  w: { from: Date; to: Date },
  p: { from: Date; to: Date },
): Bucket {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  if (t >= w.from.getTime() && t < w.to.getTime()) return "current";
  if (t >= p.from.getTime() && t < p.to.getTime()) return "previous";
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

type SourceKey = "instagram_ads" | "whatsapp" | "google" | "email" | "creators" | "direct" | "other" | "not_tracked";

const SOURCE_LABEL: Record<SourceKey, string> = {
  instagram_ads: "Instagram ads",
  whatsapp: "WhatsApp",
  google: "Google",
  email: "Email",
  creators: "Creators",
  direct: "Direct",
  other: "Other",
  not_tracked: "Not tracked",
};

// Business-name source mapping. Checked in this order against
// first_utm_source / first_utm_medium / first_source / first_referrer_url
// host — first match wins:
//   1. Instagram ads — utm source looks like instagram/ig/meta/facebook/fb,
//      or the referrer host is instagram/facebook.
//   2. WhatsApp      — utm source or medium looks like whatsapp/wa.
//   3. Google        — utm source looks like google, or referrer host is google.
//   4. Email         — utm medium looks like email, or utm source looks like
//      resend/klaviyo/mail.
//   5. Creators      — utm source looks like hypd/creator.
//   6. Direct        — first_source_type is "direct", or there is no
//      referrer and the source/first_source literally says "direct".
//   7. Other         — some source signal exists but matched nothing above.
//   8. Not tracked   — no source signal at all.
function sourceKeyOf(o: WebOrderRow): SourceKey {
  const s = (o.first_utm_source ?? "").trim().toLowerCase();
  const m = (o.first_utm_medium ?? "").trim().toLowerCase();
  const fs = (o.first_source ?? "").trim().toLowerCase();
  const fst = (o.first_source_type ?? "").trim().toLowerCase();
  const ref = (o.first_referrer_url ?? "").trim();
  const refHost = ref ? hostOf(ref) : "";

  if (/instagram|^ig$|meta|facebook|fb/.test(s) || /instagram|facebook/.test(refHost)) return "instagram_ads";
  if (/whatsapp|wa/.test(s) || /whatsapp|wa/.test(m)) return "whatsapp";
  if (/google/.test(s) || /google/.test(refHost)) return "google";
  if (/email/.test(m) || /resend|klaviyo|mail/.test(s)) return "email";
  if (/hypd|creator/.test(s)) return "creators";
  if (fst === "direct" || (!ref && (s === "direct" || fs === "direct"))) return "direct";

  const hasAny = !!(s || m || o.first_utm_campaign || fs || fst || ref);
  return hasAny ? "other" : "not_tracked";
}

// Web store orders per the brief: channelOf() === "web" (source_name "web"
// or "368925802497"), revenue orders only, creators excluded unless
// includeCreators is set — in which case a creator-flagged order that would
// otherwise land in "web" is judged on its source_name with is_creator
// treated as false (channelOf always buckets is_creator rows as "creator"
// otherwise, which would hide them from web entirely).
function isWebOrder(o: WebOrderRow, includeCreators: boolean): boolean {
  const status = (o.financial_status ?? "").toLowerCase();
  if (status === "voided" || status === "refunded") return false;
  if (o.is_creator && !includeCreators) return false;
  if (!includeCreators) return isRevenueOrder(o) && channelOf(o) === "web";
  return channelOf({ ...o, is_creator: false }) === "web";
}

export function aggregateWeb(input: WebAggregateInput): WebMetrics {
  const { window: w, previous: p } = input;
  const orders = input.shopify.filter((o) => isWebOrder(o, input.includeCreators));

  let curRevenue = 0;
  let curOrders = 0;
  let prevRevenue = 0;
  let prevOrders = 0;
  let curRepeat = 0;
  let prevRepeat = 0;
  let curUntracked = 0;
  let curNewRevenue = 0;
  let curNewOrders = 0;
  let curReturningRevenue = 0;
  let curReturningOrders = 0;
  let curAttributed = 0;
  let lastAttributedAt: string | null = null;

  const sourceAgg = new Map<SourceKey, { revenue: number; orders: number }>();
  const campaignAgg = new Map<string, { source: SourceKey; orders: number; revenue: number; newOrders: number }>();

  for (const o of orders) {
    const bucket = bucketOf(o.shopify_created_at, w, p);
    if (!bucket) continue;
    const amount = num(o.total_price);
    const idx = o.customer_order_index;
    const key = sourceKeyOf(o);

    // Last attributed order is tracked across the whole fetched range (not
    // just the current window) so the honesty callout can say when Shopify's
    // traffic-source data actually stopped.
    if (key !== "not_tracked" && o.shopify_created_at) {
      if (!lastAttributedAt || o.shopify_created_at > lastAttributedAt) lastAttributedAt = o.shopify_created_at;
    }

    if (bucket === "current") {
      curRevenue += amount;
      curOrders += 1;
      if (idx != null && idx > 1) curRepeat += 1;
      if (key === "not_tracked") curUntracked += 1;
      else curAttributed += 1;

      if (idx === 1) {
        curNewRevenue += amount;
        curNewOrders += 1;
      } else if (idx != null && idx > 1) {
        curReturningRevenue += amount;
        curReturningOrders += 1;
      }

      const sAgg = sourceAgg.get(key) ?? { revenue: 0, orders: 0 };
      sAgg.revenue += amount;
      sAgg.orders += 1;
      sourceAgg.set(key, sAgg);

      if (o.first_utm_campaign) {
        const cAgg = campaignAgg.get(o.first_utm_campaign) ?? { source: key, orders: 0, revenue: 0, newOrders: 0 };
        cAgg.orders += 1;
        cAgg.revenue += amount;
        if (idx === 1) cAgg.newOrders += 1;
        campaignAgg.set(o.first_utm_campaign, cAgg);
      }
    } else {
      prevRevenue += amount;
      prevOrders += 1;
      if (idx != null && idx > 1) prevRepeat += 1;
    }
  }

  const sources = [...sourceAgg.entries()]
    .map(([key, v]) => ({
      key,
      label: SOURCE_LABEL[key],
      revenue: round2(v.revenue),
      orders: v.orders,
      share: pct1(v.revenue, curRevenue),
    }))
    .sort((a, b) => {
      if (a.key === "not_tracked") return 1;
      if (b.key === "not_tracked") return -1;
      return b.revenue - a.revenue;
    });

  const campaigns = [...campaignAgg.entries()]
    .map(([name, v]) => ({
      name,
      source: SOURCE_LABEL[v.source],
      orders: v.orders,
      revenue: round2(v.revenue),
      newPct: pct1(v.newOrders, v.orders),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return {
    period: input.period,
    window: { from: w.from.toISOString(), to: w.to.toISOString() },
    previous: { from: p.from.toISOString(), to: p.to.toISOString() },
    total: {
      revenue: round2(curRevenue),
      orders: curOrders,
      prevRevenue: round2(prevRevenue),
      prevOrders,
    },
    aov: {
      value: curOrders > 0 ? round2(curRevenue / curOrders) : 0,
      prev: prevOrders > 0 ? round2(prevRevenue / prevOrders) : 0,
    },
    repeat: {
      pct: pct1(curRepeat, curOrders),
      prevPct: pct1(prevRepeat, prevOrders),
    },
    untracked: {
      pct: pct1(curUntracked, curOrders),
      prevPct: pct1(prevUntrackedCount(orders, w, p), prevOrders),
      orders: curUntracked,
    },
    sources,
    newVsReturning: {
      newRevenue: round2(curNewRevenue),
      returningRevenue: round2(curReturningRevenue),
      newAov: curNewOrders > 0 ? round2(curNewRevenue / curNewOrders) : 0,
      returningAov: curReturningOrders > 0 ? round2(curReturningRevenue / curReturningOrders) : 0,
    },
    campaigns,
    tracking: {
      attributedOrders: curAttributed,
      totalOrders: curOrders,
      lastAttributedAt,
    },
  };
}

// Previous-window untracked count needs the same not_tracked classification
// applied to previous-bucket rows; kept as a small second pass (rather than
// threading more accumulators through the main loop) since it is only used
// for one delta chip.
function prevUntrackedCount(
  orders: WebOrderRow[],
  w: { from: Date; to: Date },
  p: { from: Date; to: Date },
): number {
  let untracked = 0;
  for (const o of orders) {
    if (bucketOf(o.shopify_created_at, w, p) !== "previous") continue;
    if (sourceKeyOf(o) === "not_tracked") untracked += 1;
  }
  return untracked;
}
