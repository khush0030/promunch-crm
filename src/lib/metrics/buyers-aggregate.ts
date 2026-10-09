// Pure aggregation for Insights → "Repeat & cohorts" and "What people buy"
// (prototype an-retention / an-products). Website orders only (channelOf ===
// "web"), revenue orders only (isRevenueOrder: no HYPD seeds, refunds, ₹0
// kits). A buyer is their phone, else their email. No I/O: GET
// /api/metrics/buyers fetches rows and calls these.

import { channelOf, isRevenueOrder } from "./channel";

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;
export const FREE_SHIPPING_FROM = 599;

export type BuyerOrderRow = {
  shopify_id: number | string;
  total_price: number | string | null;
  shopify_created_at: string | null;
  financial_status: string | null;
  source_name: string | null;
  first_utm_source: string | null;
  first_source: string | null;
  is_creator: boolean | null;
  customer_order_index: number | null;
  customer_phone: string | null;
  customer_email: string | null;
  line_items?: unknown;
};

type Order = { id: string; t: number; total: number; index: number | null; items: Item[] | null };
type Item = { title: string; qty: number; revenue: number };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function itemsOf(raw: unknown): Item[] | null {
  if (!Array.isArray(raw)) return null;
  const by = new Map<string, Item>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = (typeof o.title === "string" ? o.title : typeof o.name === "string" ? o.name : "").trim().replace(/\s+/g, " ");
    if (!title) continue;
    const qty = num(o.quantity) || 1;
    const cur = by.get(title) ?? { title, qty: 0, revenue: 0 };
    cur.qty += qty;
    cur.revenue += qty * num(o.price);
    by.set(title, cur);
  }
  return [...by.values()];
}

export function buyerKey(r: Pick<BuyerOrderRow, "customer_phone" | "customer_email">): string | null {
  const p = (r.customer_phone ?? "").replace(/\D/g, "");
  if (p.length >= 10) return `p:${p}`;
  const e = (r.customer_email ?? "").trim().toLowerCase();
  return e.includes("@") ? `e:${e}` : null;
}

// Website revenue orders grouped by buyer, each buyer's orders oldest first.
export function groupBuyers(rows: BuyerOrderRow[]): Map<string, Order[]> {
  const by = new Map<string, Order[]>();
  for (const r of rows) {
    if (channelOf(r) !== "web" || !isRevenueOrder(r)) continue;
    const t = r.shopify_created_at ? new Date(r.shopify_created_at).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const key = buyerKey(r);
    if (!key) continue;
    const list = by.get(key) ?? [];
    list.push({
      id: String(r.shopify_id),
      t,
      total: num(r.total_price),
      index: r.customer_order_index ?? null,
      items: r.line_items === undefined ? null : itemsOf(r.line_items),
    });
    by.set(key, list);
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  return by;
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

function istMonth(t: number): string {
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 7);
}

// Buyers whose first order we actually see. A first-seen order Shopify
// numbers 2+ means they bought before our data starts: not a new buyer.
function cohortOf(by: Map<string, Order[]>): Order[][] {
  const out: Order[][] = [];
  for (const list of by.values()) {
    const first = list[0];
    if (first.index != null && first.index > 1) continue;
    out.push(list);
  }
  return out;
}

export type RepeatMetrics = {
  since: string;
  buyers: number;
  // Of new buyers whose first order is 30+ days old, the share with 2+ orders.
  repeatPct: number | null;
  repeatBase: number;
  medianDaysToSecond: number | null;
  spendPerBuyer: number | null;
  cohorts: { month: string; buyers: number; cells: (number | null)[] }[];
  secondOrderWeeks: { label: string; buyers: number }[];
};

const WEEK_LABELS = ["1w", "2w", "3w", "4w", "5w", "6w", "7w", "8w", "8w+"];

export function aggregateRepeat(rows: BuyerOrderRow[], now: Date, since: Date, months = 6, cellCount = 5): RepeatMetrics {
  const nowMs = now.getTime();
  const cohort = cohortOf(groupBuyers(rows));

  let base = 0;
  let repeaters = 0;
  const gaps: number[] = [];
  const weeks = new Array<number>(WEEK_LABELS.length).fill(0);
  let spend = 0;
  for (const list of cohort) {
    spend += list.reduce((n, o) => n + o.total, 0);
    if (list.length > 1) {
      const days = (list[1].t - list[0].t) / DAY_MS;
      gaps.push(days);
      const w = Math.min(WEEK_LABELS.length - 1, Math.max(0, Math.ceil(days / 7) - 1));
      weeks[w]++;
    }
    if (nowMs - list[0].t >= 30 * DAY_MS) {
      base++;
      if (list.length > 1) repeaters++;
    }
  }

  // Cohort grid: the last `months` first-order months (IST), oldest first.
  // Cell k = share of that month's new buyers who ordered again 30k-30 to
  // 30k days after their first order; null until every buyer in the month
  // has had the full 30 days.
  const byMonth = new Map<string, Order[][]>();
  for (const list of cohort) {
    const m = istMonth(list[0].t);
    byMonth.set(m, [...(byMonth.get(m) ?? []), list]);
  }
  const nowIst = new Date(nowMs + IST_OFFSET_MS);
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const cohorts = monthKeys.map((month) => {
    const lists = byMonth.get(month) ?? [];
    const [y, m] = month.split("-").map(Number);
    const monthEnd = Date.UTC(y, m, 1) - IST_OFFSET_MS; // IST midnight that ends the month
    const cells: (number | null)[] = [];
    for (let k = 1; k <= cellCount; k++) {
      if (!lists.length || monthEnd + k * 30 * DAY_MS > nowMs) {
        cells.push(null);
        continue;
      }
      const back = lists.filter((l) =>
        l.slice(1).some((o) => o.t - l[0].t > (k - 1) * 30 * DAY_MS && o.t - l[0].t <= k * 30 * DAY_MS),
      ).length;
      cells.push(pct(back, lists.length));
    }
    return { month, buyers: lists.length, cells };
  });

  return {
    since: since.toISOString(),
    buyers: cohort.length,
    repeatPct: pct(repeaters, base),
    repeatBase: base,
    medianDaysToSecond: median(gaps),
    spendPerBuyer: cohort.length ? Math.round(spend / cohort.length) : null,
    cohorts,
    secondOrderWeeks: WEEK_LABELS.map((label, i) => ({ label, buyers: weeks[i] })),
  };
}

export type ProductMetrics = {
  window: { from: string; to: string };
  orders: number;
  products: { title: string; units: number; revenue: number }[];
  pairs: { a: string; b: string; orders: number; pct: number }[];
  multiItemOrders: number;
  sizes: { label: string; orders: number }[];
  justAboveFreeShipping: number;
  firstProduct: { label: string; buyers: number; cameBack: number; pct: number }[];
};

const SIZE_EDGES: { label: string; max: number }[] = [
  { label: "Under ₹400", max: 400 },
  { label: "₹400 to 599", max: 600 },
  { label: "₹600 to 799", max: 800 },
  { label: "₹800 to 999", max: 1000 },
  { label: "₹1,000 to 1,499", max: 1500 },
  { label: "₹1,500+", max: Infinity },
];

export const MIXED_LABEL = "Mixed (3+ products)";

export function aggregateProducts(
  rows: BuyerOrderRow[],
  window: { from: Date; to: Date },
  now: Date,
  minGroup = 5,
): ProductMetrics {
  const by = groupBuyers(rows);
  const from = window.from.getTime();
  const to = window.to.getTime();

  const prod = new Map<string, { units: number; revenue: number }>();
  const pairCount = new Map<string, number>();
  const sizes = new Array<number>(SIZE_EDGES.length).fill(0);
  let orders = 0;
  let multi = 0;
  let nearFree = 0;

  for (const list of by.values()) {
    for (const o of list) {
      if (o.t < from || o.t >= to) continue;
      orders++;
      sizes[SIZE_EDGES.findIndex((e) => o.total < e.max)]++;
      if (o.total >= FREE_SHIPPING_FROM && o.total < FREE_SHIPPING_FROM + 200) nearFree++;
      const items = o.items ?? [];
      for (const it of items) {
        const p = prod.get(it.title) ?? { units: 0, revenue: 0 };
        p.units += it.qty;
        p.revenue += it.revenue;
        prod.set(it.title, p);
      }
      const titles = [...new Set(items.map((i) => i.title))].sort();
      if (titles.length >= 2) {
        multi++;
        for (let i = 0; i < titles.length; i++)
          for (let j = i + 1; j < titles.length; j++) {
            const k = `${titles[i]}\u0000${titles[j]}`;
            pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
          }
      }
    }
  }

  // First product → came back: new buyers whose first order is 30 to 180
  // days old (time to come back, and line items fetched), grouped by what
  // that first order held.
  const nowMs = now.getTime();
  const groups = new Map<string, { buyers: number; back: number }>();
  for (const list of cohortOf(by)) {
    const first = list[0];
    const age = nowMs - first.t;
    if (age < 30 * DAY_MS || age > 180 * DAY_MS || !first.items?.length) continue;
    const label =
      first.items.length >= 3 ? MIXED_LABEL : [...first.items].sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title))[0].title;
    const g = groups.get(label) ?? { buyers: 0, back: 0 };
    g.buyers++;
    if (list.length > 1) g.back++;
    groups.set(label, g);
  }

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    orders,
    products: [...prod.entries()]
      .map(([title, p]) => ({ title, units: p.units, revenue: Math.round(p.revenue) }))
      .sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title))
      .slice(0, 8),
    pairs: [...pairCount.entries()]
      .map(([k, n]) => {
        const [a, b] = k.split("\u0000");
        return { a, b, orders: n, pct: pct(n, multi) ?? 0 };
      })
      .sort((x, y) => y.orders - x.orders || x.a.localeCompare(y.a))
      .slice(0, 5),
    multiItemOrders: multi,
    sizes: SIZE_EDGES.map((e, i) => ({ label: e.label, orders: sizes[i] })),
    justAboveFreeShipping: nearFree,
    firstProduct: [...groups.entries()]
      .filter(([, g]) => g.buyers >= minGroup)
      .map(([label, g]) => ({ label, buyers: g.buyers, cameBack: g.back, pct: pct(g.back, g.buyers) ?? 0 }))
      .sort((a, b) => b.buyers - a.buyers)
      .slice(0, 6),
  };
}
