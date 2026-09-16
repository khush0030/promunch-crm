// Pure aggregation for the Amazon section (/dashboard/sales/amazon). The API
// route fetches the SP-API mirror rows (amazon_finance_events,
// amazon_finance_item_events, amazon_inventory, amazon_sku_costs,
// amazon_order_items, amazon_settlements, amazon_orders, amazon_sync_state)
// and hands them here; everything below is arithmetic on those rows so it
// can be unit-tested with a fixture.
//
// Period rules:
//   - Money flow, refunds, per-SKU units/profit, the daily series and the
//     payouts list all follow the requested period (rolling window ending now).
//   - Sales velocity (and therefore days of stock left and lost profit per
//     day) is ALWAYS on a 30-day basis, whatever the period. The UI says so.
import { periodWindow, previousWindow } from "../metrics/period";
import { shortProductName } from "../metrics/attention";

export type AmazonPeriodKey = "7d" | "30d" | "90d";

export const VELOCITY_DAYS = 30;
export const MATCH_TOLERANCE = 50; // rupees; |deposit - line items| within this is "Matched"

// ---- input rows (already fetched) ------------------------------------------

type Num = number | string | null | undefined;

export type AmazonFinanceEventRow = {
  posted_date: string | null;
  event_type: string | null;
  gross: Num;
  promo: Num;
  referral_fee: Num;
  fba_fee: Num;
  other_fees: Num;
  net: Num;
};

export type AmazonItemEventRow = {
  seller_sku: string | null;
  event_type: string | null;
  posted_date: string | null;
  quantity: Num;
  gross: Num;
  promo: Num;
  referral_fee: Num;
  fba_fee: Num;
  closing_fee: Num;
  other_fees: Num;
  net: Num;
};

export type AmazonInventoryRow = {
  seller_sku: string;
  asin: string | null;
  product_name: string | null;
  fulfillable_quantity: Num;
  inbound_working: Num;
  inbound_shipped: Num;
  inbound_receiving: Num;
};

export type AmazonCostRow = { seller_sku: string; cost_per_unit: Num };
export type AmazonTitleRow = { seller_sku: string | null; asin: string | null; title: string | null };

export type AmazonSettlementRow = {
  settlement_id: string;
  total_deposit: Num;
  period_start: string | null;
  period_end: string | null;
  deposit_date: string | null;
  gross_sales: Num;
  fees_total: Num;
  refunds_total: Num;
  line_sum: Num;
  variance: Num;
  recon_note: string | null;
};

export type AmazonOrderRow = {
  amazon_order_id: string;
  order_status: string | null;
  purchase_date: string | null;
  order_total: Num;
  number_of_items_shipped: Num;
  number_of_items_unshipped: Num;
  fulfillment_channel: string | null;
};

export type AmazonSyncRow = { key: string; updated_at: string | null };

export type AmazonMetricsInput = {
  now: Date;
  period: AmazonPeriodKey;
  // amazon_finance_events since the previous window's start.
  financeEvents: AmazonFinanceEventRow[];
  // amazon_finance_item_events since min(previous window start, now - 30d).
  itemEvents: AmazonItemEventRow[];
  inventory: AmazonInventoryRow[];
  costs: AmazonCostRow[];
  // amazon_order_items, newest first (title/asin fallback for SKUs not in inventory).
  titles: AmazonTitleRow[];
  // amazon_settlements with deposit_date on or after the window start.
  settlements: AmazonSettlementRow[];
  // latest 50 amazon_orders, newest first.
  recentOrders: AmazonOrderRow[];
  // non-cancelled amazon_orders counted in the current / previous window.
  orderCount: { period: number; prev: number };
  sync: AmazonSyncRow[];
};

// ---- output ------------------------------------------------------------------

export type AmazonSku = {
  sku: string;
  asin: string | null;
  title: string;
  shortTitle: string;
  fulfillmentChannel: "FBA" | "MFN";
  // Stock (FBA only; null when Amazon does not hold the stock).
  fulfillable: number | null;
  inbound: number | null;
  // Period figures.
  units: number;
  unitsPrev: number;
  refundUnits: number;
  avgPrice: number; // what a customer pays per unit, before Amazon's cut
  amazonKeepsPerUnit: number; // referral + FBA + closing/other + promo, per unit
  costPerUnit: number | null; // from amazon_sku_costs; null when not entered
  keepPerUnit: number | null; // avgPrice - amazonKeeps - cost; null without a cost price
  profit: number | null; // keepPerUnit x units; null without a cost price
  // Always on a 30-day basis.
  velocityPerDay: number;
  daysLeft: number | null | "untracked"; // null = no 30-day sales; "untracked" = ships from you
  outOfStock: boolean; // FBA, nothing fulfillable, and it sells
  lostProfitPerDay: number | null; // only when out of stock and the cost is known
  lostNetPerDay: number; // out of stock: velocity x (avgPrice - amazonKeeps)
};

export type AmazonSettlement = {
  id: string;
  depositDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: number;
  fees: number;
  refunds: number;
  deposit: number;
  lineSum: number;
  variance: number; // deposit - lineSum (negative = short)
  matched: boolean;
  note: string | null;
  scheduled: boolean; // deposit date is still in the future
};

export type AmazonMetrics = {
  ok: true;
  period: AmazonPeriodKey;
  window: { from: string; to: string };
  previousWindow: { from: string; to: string };
  velocityDays: number;
  money: {
    customersPaid: number;
    customersPaidPrev: number;
    amazonKept: number;
    amazonKeptBreakdown: { referral: number; fba: number; closingOther: number; promo: number };
    paidToYou: number;
    paidToYouPrev: number;
    productCost: number;
    productCostPrev: number;
    profit: number;
    profitPrev: number;
    marginPct: number;
    marginPctPrev: number;
    costCoverage: number; // % of units sold in the period that carry a cost price
  };
  refunds: { count: number; amount: number; pct: number; prevPct: number; orders: number };
  orders: {
    count: number;
    prevCount: number;
    recent: { id: string; status: string; date: string | null; items: number; total: number; channel: "FBA" | "MFN" }[];
  };
  stock: { total: number; outOfStock: number; under14Days: number; atRisk: number; lostProfitPerDay: number };
  skus: AmazonSku[];
  settlements: AmazonSettlement[];
  payouts: {
    paidOut: number; // deposits already made in the period
    count: number;
    matched: number; // of settlements listed
    needsLook: number; // sum of |variance| on unmatched settlements
    last: AmazonSettlement | null;
    next: AmazonSettlement | null;
  };
  daily: { date: string; gross: number; net: number }[];
  sync: { lastSyncedAt: string | null };
};

// ---- helpers ----------------------------------------------------------------

const DAY_MS = 86_400_000;

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct1 = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function inWindow(iso: string | null, w: { from: Date; to: Date }): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= w.from.getTime() && t < w.to.getTime();
}

function isRefund(type: string | null): boolean {
  return (type ?? "").toLowerCase() === "refund";
}

// ---- sorting (exported so the page and tests share one rule) ----------------

// Worst first: out of stock, then fewest days left, then no estimate, then
// ships-from-you (Amazon does not track that stock).
export function sortForStock(skus: AmazonSku[]): AmazonSku[] {
  const rank = (s: AmazonSku) => {
    if (s.outOfStock) return 0;
    if (typeof s.daysLeft === "number") return 1;
    if (s.daysLeft === null) return 2;
    return 3;
  };
  return [...skus].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (a.daysLeft as number) - (b.daysLeft as number);
    return b.units - a.units;
  });
}

// Most profit first; rows without a cost price (profit unknown) last, those
// ordered by what customers paid.
export function sortForProfit(skus: AmazonSku[]): AmazonSku[] {
  return [...skus].sort((a, b) => {
    if (a.profit != null && b.profit != null) return b.profit - a.profit;
    if (a.profit != null) return -1;
    if (b.profit != null) return 1;
    return b.avgPrice * b.units - a.avgPrice * a.units;
  });
}

// ---- main ---------------------------------------------------------------------

export function buildAmazonMetrics(input: AmazonMetricsInput): AmazonMetrics {
  const { now, period } = input;
  const w = periodWindow(period, now);
  const p = previousWindow(w);
  const velocityFrom = new Date(now.getTime() - VELOCITY_DAYS * DAY_MS);
  const velocityWindow = { from: velocityFrom, to: now };

  // ---- money flow from header-level finance events --------------------------
  const cur = { gross: 0, promo: 0, referral: 0, fba: 0, other: 0, net: 0, refunds: 0, refundAmount: 0 };
  const prev = { gross: 0, net: 0, refunds: 0 };
  const dayCount = Math.round((w.to.getTime() - w.from.getTime()) / DAY_MS);
  const dailyGross = new Array<number>(dayCount).fill(0);
  const dailyNet = new Array<number>(dayCount).fill(0);
  for (const ev of input.financeEvents) {
    if (inWindow(ev.posted_date, w)) {
      cur.gross += num(ev.gross);
      cur.promo += num(ev.promo);
      cur.referral += num(ev.referral_fee);
      cur.fba += num(ev.fba_fee);
      cur.other += num(ev.other_fees);
      cur.net += num(ev.net);
      if (isRefund(ev.event_type)) {
        cur.refunds += 1;
        cur.refundAmount += -num(ev.net);
      }
      const di = Math.floor((Date.parse(ev.posted_date!) - w.from.getTime()) / DAY_MS);
      if (di >= 0 && di < dayCount) {
        dailyGross[di] += num(ev.gross);
        dailyNet[di] += num(ev.net);
      }
    } else if (inWindow(ev.posted_date, p)) {
      prev.gross += num(ev.gross);
      prev.net += num(ev.net);
      if (isRefund(ev.event_type)) prev.refunds += 1;
    }
  }

  // ---- per-SKU from item-level events --------------------------------------
  type Agg = {
    units: number; unitsPrev: number; units30: number; refundUnits: number;
    gross: number; promo: number; referral: number; fba: number; closing: number; other: number;
  };
  const agg = new Map<string, Agg>();
  const get = (sku: string) => {
    let a = agg.get(sku);
    if (!a) {
      a = { units: 0, unitsPrev: 0, units30: 0, refundUnits: 0, gross: 0, promo: 0, referral: 0, fba: 0, closing: 0, other: 0 };
      agg.set(sku, a);
    }
    return a;
  };
  for (const ev of input.itemEvents) {
    if (!ev.seller_sku) continue;
    const a = get(ev.seller_sku);
    const qty = num(ev.quantity);
    if (isRefund(ev.event_type)) {
      if (inWindow(ev.posted_date, w)) a.refundUnits += qty;
      continue;
    }
    if (inWindow(ev.posted_date, velocityWindow)) a.units30 += qty;
    if (inWindow(ev.posted_date, w)) {
      a.units += qty;
      a.gross += num(ev.gross);
      a.promo += num(ev.promo);
      a.referral += num(ev.referral_fee);
      a.fba += num(ev.fba_fee);
      a.closing += num(ev.closing_fee);
      a.other += num(ev.other_fees);
    } else if (inWindow(ev.posted_date, p)) {
      a.unitsPrev += qty;
    }
  }

  const costBySku = new Map<string, number>();
  for (const c of input.costs) {
    if (c.seller_sku && c.cost_per_unit != null && c.cost_per_unit !== "") costBySku.set(c.seller_sku, num(c.cost_per_unit));
  }
  const invBySku = new Map(input.inventory.map((i) => [i.seller_sku, i]));
  const titleBySku = new Map<string, AmazonTitleRow>();
  for (const t of input.titles) {
    if (t.seller_sku && !titleBySku.has(t.seller_sku)) titleBySku.set(t.seller_sku, t);
  }

  const skuIds = new Set<string>([...invBySku.keys(), ...agg.keys()]);
  const skus: AmazonSku[] = [];
  let productCost = 0;
  let productCostPrev = 0;
  let unitsWithCost = 0;
  let unitsTotal = 0;
  for (const sku of skuIds) {
    const a = agg.get(sku);
    const inv = invBySku.get(sku);
    const meta = titleBySku.get(sku);
    const isFba = !!inv;
    const fulfillable = inv ? num(inv.fulfillable_quantity) : null;
    const inbound = inv ? num(inv.inbound_working) + num(inv.inbound_shipped) + num(inv.inbound_receiving) : null;
    const units = a?.units ?? 0;
    const units30 = a?.units30 ?? 0;
    const unitsPrev = a?.unitsPrev ?? 0;
    // Dead listings: nothing in stock, nothing coming, nothing sold recently.
    if (!units && !units30 && !unitsPrev && !(fulfillable ?? 0) && !(inbound ?? 0)) continue;

    const gross = a?.gross ?? 0;
    const keeps = a ? -(a.promo + a.referral + a.fba + a.closing + a.other) : 0;
    const avgPrice = units ? gross / units : 0;
    const amazonKeepsPerUnit = units ? keeps / units : 0;
    const cost = costBySku.get(sku) ?? null;
    const keepPerUnit = cost != null && units ? avgPrice - amazonKeepsPerUnit - cost : null;
    const profit = keepPerUnit != null ? keepPerUnit * units : null;
    const velocity = units30 / VELOCITY_DAYS;
    const outOfStock = isFba && fulfillable === 0 && velocity > 0;
    let daysLeft: AmazonSku["daysLeft"];
    if (!isFba) daysLeft = "untracked";
    else if (velocity <= 0) daysLeft = null;
    else daysLeft = Math.round((fulfillable ?? 0) / velocity);
    // Lost per day uses the period's per-unit economics (falls back to the
    // 30-day net when the SKU has not sold in the period but did in 30 days).
    const netPerUnit = units ? avgPrice - amazonKeepsPerUnit : 0;
    const lostNetPerDay = outOfStock ? velocity * netPerUnit : 0;
    const lostProfitPerDay = outOfStock && cost != null && units ? velocity * (netPerUnit - cost) : null;

    if (cost != null) {
      productCost += cost * units;
      productCostPrev += cost * unitsPrev;
      unitsWithCost += units;
    }
    unitsTotal += units;

    const title = inv?.product_name || meta?.title || sku;
    skus.push({
      sku,
      asin: inv?.asin ?? meta?.asin ?? null,
      title,
      shortTitle: shortProductName(title) || sku,
      fulfillmentChannel: isFba ? "FBA" : "MFN",
      fulfillable,
      inbound,
      units,
      unitsPrev,
      refundUnits: a?.refundUnits ?? 0,
      avgPrice: r2(avgPrice),
      amazonKeepsPerUnit: r2(amazonKeepsPerUnit),
      costPerUnit: cost,
      keepPerUnit: keepPerUnit != null ? r2(keepPerUnit) : null,
      profit: profit != null ? r2(profit) : null,
      velocityPerDay: Math.round(velocity * 100) / 100,
      daysLeft,
      outOfStock,
      lostProfitPerDay: lostProfitPerDay != null ? r2(lostProfitPerDay) : null,
      lostNetPerDay: r2(lostNetPerDay),
    });
  }

  const amazonKept = -(cur.promo + cur.referral + cur.fba + cur.other);
  const profit = cur.net - productCost;
  const profitPrev = prev.net - productCostPrev;

  const outOfStock = skus.filter((s) => s.outOfStock).length;
  const under14Days = skus.filter((s) => !s.outOfStock && typeof s.daysLeft === "number" && s.daysLeft < 14).length;
  const lostProfitPerDay = skus.reduce((a, s) => a + (s.lostProfitPerDay ?? s.lostNetPerDay), 0);

  // ---- settlements -----------------------------------------------------------
  const settlements: AmazonSettlement[] = input.settlements
    .filter((s) => s.deposit_date && Date.parse(s.deposit_date) >= w.from.getTime())
    .map((s) => {
      const deposit = num(s.total_deposit);
      const lineSum = num(s.line_sum);
      const variance = s.variance != null && s.variance !== "" ? num(s.variance) : deposit - lineSum;
      return {
        id: s.settlement_id,
        depositDate: s.deposit_date,
        periodStart: s.period_start,
        periodEnd: s.period_end,
        gross: r2(num(s.gross_sales)),
        fees: r2(num(s.fees_total)),
        refunds: r2(num(s.refunds_total)),
        deposit: r2(deposit),
        lineSum: r2(lineSum),
        variance: r2(variance),
        matched: Math.abs(variance) <= MATCH_TOLERANCE,
        note: s.recon_note,
        scheduled: Date.parse(s.deposit_date!) > now.getTime(),
      };
    })
    .sort((a, b) => Date.parse(b.depositDate!) - Date.parse(a.depositDate!));
  const deposited = settlements.filter((s) => !s.scheduled);
  const scheduled = settlements.filter((s) => s.scheduled);

  return {
    ok: true,
    period,
    window: { from: w.from.toISOString(), to: w.to.toISOString() },
    previousWindow: { from: p.from.toISOString(), to: p.to.toISOString() },
    velocityDays: VELOCITY_DAYS,
    money: {
      customersPaid: r2(cur.gross),
      customersPaidPrev: r2(prev.gross),
      amazonKept: r2(amazonKept),
      amazonKeptBreakdown: {
        referral: r2(-cur.referral),
        fba: r2(-cur.fba),
        closingOther: r2(-cur.other),
        promo: r2(-cur.promo),
      },
      paidToYou: r2(cur.net),
      paidToYouPrev: r2(prev.net),
      productCost: r2(productCost),
      productCostPrev: r2(productCostPrev),
      profit: r2(profit),
      profitPrev: r2(profitPrev),
      marginPct: pct1(profit, cur.gross),
      marginPctPrev: pct1(profitPrev, prev.gross),
      costCoverage: pct1(unitsWithCost, unitsTotal),
    },
    refunds: {
      count: cur.refunds,
      amount: r2(cur.refundAmount),
      pct: pct1(cur.refunds, input.orderCount.period),
      prevPct: pct1(prev.refunds, input.orderCount.prev),
      orders: input.orderCount.period,
    },
    orders: {
      count: input.orderCount.period,
      prevCount: input.orderCount.prev,
      recent: input.recentOrders.map((o) => ({
        id: o.amazon_order_id,
        status: o.order_status ?? "",
        date: o.purchase_date,
        items: num(o.number_of_items_shipped) + num(o.number_of_items_unshipped),
        total: num(o.order_total),
        channel: o.fulfillment_channel === "AFN" ? "FBA" : "MFN",
      })),
    },
    stock: { total: skus.length, outOfStock, under14Days, atRisk: outOfStock + under14Days, lostProfitPerDay: r2(lostProfitPerDay) },
    skus,
    settlements,
    payouts: {
      paidOut: r2(deposited.reduce((a, s) => a + s.deposit, 0)),
      count: deposited.length,
      matched: settlements.filter((s) => s.matched).length,
      needsLook: r2(settlements.filter((s) => !s.matched).reduce((a, s) => a + Math.abs(s.variance), 0)),
      last: deposited[0] ?? null,
      next: scheduled[scheduled.length - 1] ?? null,
    },
    daily: dailyGross.map((g, i) => ({
      date: new Date(w.from.getTime() + i * DAY_MS).toISOString().slice(0, 10),
      gross: r2(g),
      net: r2(dailyNet[i]),
    })),
    sync: {
      lastSyncedAt: input.sync.reduce<string | null>((latest, s) => (s.updated_at && (!latest || s.updated_at > latest) ? s.updated_at : latest), null),
    },
  };
}
