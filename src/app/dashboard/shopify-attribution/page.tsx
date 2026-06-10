"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const dateRanges = ["Today", "Last 7 Days", "Last 30 Days", "Last 90 Days", "All time"];
const rangeDays: Record<string, number | null> = {
  Today: 0,
  "Last 7 Days": 7,
  "Last 30 Days": 30,
  "Last 90 Days": 90,
  "All time": null,
};

// Start of today in IST (UTC+5:30), as an ISO string. Matches the shopify-stats
// edge fn so the page's "Today" filter and the snapshot agree.
function istTodayStartIso(): string {
  const IST = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST);
  const midnightIstAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightIstAsUtc - IST).toISOString();
}

type Stats = {
  ok: boolean;
  currency: string;
  revenue: { today: number; d7: number; d30: number; all: number };
  orders: { today: number; d7: number; d30: number; all: number };
  customers: number | null;
  aov_all: number;
};

type OrderRow = {
  total_price: number | string | null;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_source: string | null;
  first_source_type: string | null;
  first_referrer_url: string | null;
  source_name: string | null;
  customer_order_index: number | null;
  attribution_synced_at: string | null;
  shopify_created_at: string | null;
  is_creator: boolean | null;
};

// Creator-order segment filter. ₹0.01 HYPD-creator seeds distort revenue/AOV, so
// let the user exclude them, isolate them, or see everything.
const creatorSegments = ["All orders", "Exclude creators", "Creators only"] as const;
type CreatorSegment = (typeof creatorSegments)[number];

type SourceRow = { source: string; medium: string; orders: number; newOrders: number; revenue: number; share: number };
type CampaignRow = { campaign: string; source: string; orders: number; revenue: number };
type ReferrerRow = { host: string; orders: number; revenue: number };
type TopMetric = { label: string; value: string; sub: string; iconBg: string; iconColor: string; iconPath: React.ReactNode };

const ICON_REVENUE = <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />;
const ICON_CART = (
  <>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </>
);
const ICON_TREND = (
  <>
    <path d="M3 17 9 11l4 4 8-8" />
    <path d="M17 7h4v4" />
  </>
);
const ICON_COMPASS = (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m16.2 7.8-2.9 6.3-6.3 2.9 2.9-6.3 6.3-2.9z" />
  </>
);

const num = (v: number | string | null) => Number(v) || 0;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// First-touch channel for an order. UTM source wins; else Shopify's classified
// source; else the sales-channel name (with HYPD's channel id mapped to a label);
// else "direct".
function channelOf(o: OrderRow): string {
  if (o.is_creator) return "HYPD Creator";
  if (o.first_utm_source) return o.first_utm_source;
  if (o.first_source) return o.first_source;
  const sn = o.source_name ?? "";
  if (sn === "341128478721" || /hypd/i.test(sn)) return "HYPD Marketplace";
  if (sn) return sn;
  return "direct";
}
const mediumOf = (o: OrderRow) => o.first_utm_medium || o.first_source_type || "none";
const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); }
};

export default function ShopifyAttributionPage() {
  const [activeRange, setActiveRange] = useState("Last 30 Days");
  const [creatorSeg, setCreatorSeg] = useState<CreatorSegment>("All orders");
  const [creatorCount, setCreatorCount] = useState(0);
  const [topMetrics, setTopMetrics] = useState<TopMetric[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [coverage, setCoverage] = useState<{ tracked: number; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Authoritative Shopify snapshot (revenue windows + live customer count) —
  // range-independent, fetched once via the server-side edge fn.
  useEffect(() => {
    fetch("/api/shopify/stats")
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setStats(d as Stats); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      setLoaded(false);
      const days = rangeDays[activeRange];
      const cols =
        "total_price, first_utm_source, first_utm_medium, first_utm_campaign, first_source, first_source_type, first_referrer_url, source_name, customer_order_index, attribution_synced_at, shopify_created_at, is_creator";
      const since =
        days === 0 ? istTodayStartIso()
        : days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      // Page past PostgREST's 1000-row cap so totals stay exact as orders grow.
      const allOrders: OrderRow[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("shopify_orders").select(cols).range(from, from + 999);
        if (since) q = q.gte("shopify_created_at", since);
        const { data } = await q;
        const batch = (data || []) as OrderRow[];
        allOrders.push(...batch);
        if (batch.length < 1000) break;
      }

      // Creator-segment filter. Count is always over the full range so the toggle
      // can show how many exist even while excluding them from the numbers.
      setCreatorCount(allOrders.filter((o) => o.is_creator).length);
      const orders =
        creatorSeg === "Exclude creators" ? allOrders.filter((o) => !o.is_creator)
        : creatorSeg === "Creators only" ? allOrders.filter((o) => o.is_creator)
        : allOrders;

      const totalRevenue = orders.reduce((s, o) => s + num(o.total_price), 0);
      const totalOrders = orders.length;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // by channel (first-touch)
      const chan = new Map<string, { medium: string; orders: number; newOrders: number; revenue: number }>();
      for (const o of orders) {
        const key = channelOf(o);
        const cur = chan.get(key) || { medium: mediumOf(o), orders: 0, newOrders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += num(o.total_price);
        if ((o.customer_order_index ?? 99) <= 1) cur.newOrders += 1;
        chan.set(key, cur);
      }
      const srcRows: SourceRow[] = [...chan.entries()]
        .map(([source, v]) => ({
          source,
          medium: v.medium,
          orders: v.orders,
          newOrders: v.newOrders,
          revenue: v.revenue,
          share: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // by campaign (only orders that carry a utm_campaign)
      const camp = new Map<string, { source: string; orders: number; revenue: number }>();
      for (const o of orders) {
        if (!o.first_utm_campaign) continue;
        const key = o.first_utm_campaign;
        const cur = camp.get(key) || { source: o.first_utm_source || channelOf(o), orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += num(o.total_price);
        camp.set(key, cur);
      }
      const campRows: CampaignRow[] = [...camp.entries()]
        .map(([campaign, v]) => ({ campaign, source: v.source, orders: v.orders, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      // by external referrer host
      const ref = new Map<string, { orders: number; revenue: number }>();
      for (const o of orders) {
        if (!o.first_referrer_url) continue;
        const key = hostOf(o.first_referrer_url);
        const cur = ref.get(key) || { orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += num(o.total_price);
        ref.set(key, cur);
      }
      const refRows: ReferrerRow[] = [...ref.entries()]
        .map(([host, v]) => ({ host, orders: v.orders, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      const tracked = orders.filter(
        (o) => o.first_utm_source || (o.first_source && o.first_source !== "an unknown source"),
      ).length;
      const topSource = srcRows[0];

      setTopMetrics([
        {
          label: "Order revenue",
          value: inr(totalRevenue),
          sub: `${activeRange.toLowerCase()}`,
          iconBg: "var(--green-soft)",
          iconColor: "var(--green)",
          iconPath: ICON_REVENUE,
        },
        {
          label: "Orders",
          value: totalOrders.toLocaleString("en-IN"),
          sub: tracked > 0 ? `${Math.round((tracked / Math.max(1, totalOrders)) * 100)}% with known source` : "—",
          iconBg: "var(--accent-soft)",
          iconColor: "var(--accent)",
          iconPath: ICON_CART,
        },
        {
          label: "Avg order value",
          value: inr(aov),
          sub: "across all channels",
          iconBg: "var(--amber-soft)",
          iconColor: "var(--amber)",
          iconPath: ICON_TREND,
        },
        {
          label: "Top channel",
          value: topSource ? topSource.source : "—",
          sub: topSource ? `${inr(topSource.revenue)} · ${topSource.share.toFixed(0)}% of rev` : "—",
          iconBg: "var(--blue-soft)",
          iconColor: "var(--blue)",
          iconPath: ICON_COMPASS,
        },
      ]);
      setSources(srcRows);
      setCampaigns(campRows);
      setReferrers(refRows);
      setCoverage({ tracked, total: totalOrders });
      setLoaded(true);
    }
    load();
  }, [activeRange, creatorSeg]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Shopify Attribution</h1>
          <div className="sub">Where your orders come from — UTM source, campaign &amp; referrer</div>
        </div>
        <div className="chips">
          {dateRanges.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip${activeRange === r ? " active" : ""}`}
              onClick={() => setActiveRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Authoritative Shopify snapshot — revenue by window + live customers */}
      <div className="kpi-grid">
        {[
          { label: "Today's revenue", rev: stats?.revenue.today, ord: stats?.orders.today, bg: "var(--green-soft)", color: "var(--green)", icon: ICON_REVENUE },
          { label: "Last 7 days", rev: stats?.revenue.d7, ord: stats?.orders.d7, bg: "var(--accent-soft)", color: "var(--accent)", icon: ICON_REVENUE },
          { label: "Last 30 days", rev: stats?.revenue.d30, ord: stats?.orders.d30, bg: "var(--amber-soft)", color: "var(--amber)", icon: ICON_REVENUE },
          { label: "All-time revenue", rev: stats?.revenue.all, ord: stats?.orders.all, bg: "var(--blue-soft)", color: "var(--blue)", icon: ICON_TREND },
        ].map((c) => (
          <div key={c.label} className="kpi">
            <div className="ico" style={{ background: c.bg }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={c.color} strokeWidth="2">{c.icon}</svg>
            </div>
            <div className="label">{c.label}</div>
            <div className="value">{stats ? inr(c.rev ?? 0) : "…"}</div>
            <div className="delta flat">{stats ? `${(c.ord ?? 0).toLocaleString("en-IN")} orders` : "loading"}</div>
          </div>
        ))}
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Customers</div>
          <div className="card-sub">Live count in your Shopify store</div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 12 }}>
            {stats?.customers != null ? stats.customers.toLocaleString("en-IN") : stats ? "—" : "…"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="card-title">Avg order value</div>
          <div className="card-sub">All-time, across channels</div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", marginTop: 12, color: "var(--green)" }}>
            {stats ? inr(stats.aov_all) : "…"}
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 4 }}>
        <div className="card-title" style={{ marginBottom: 2 }}>Attribution breakdown</div>
        <div className="card-sub">Filter the channel / campaign / referrer analysis below by date range.</div>
        <div className="chips" style={{ marginTop: 10 }}>
          {creatorSegments.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${creatorSeg === s ? " active" : ""}`}
              onClick={() => setCreatorSeg(s)}
            >
              {s === "All orders" ? s : `🎨 ${s}`}
              {s === "Creators only" && creatorCount > 0 ? ` · ${creatorCount}` : ""}
            </button>
          ))}
        </div>
        {creatorSeg !== "All orders" ? (
          <div className="card-sub" style={{ marginTop: 6 }}>
            {creatorSeg === "Exclude creators"
              ? `Hiding ${creatorCount} ₹0.01 HYPD-creator seed order${creatorCount === 1 ? "" : "s"} from the numbers below.`
              : `Showing only the ${creatorCount} HYPD-creator seed order${creatorCount === 1 ? "" : "s"} (₹0.01 influencer gifts).`}
          </div>
        ) : null}
      </div>

      <div className="kpi-grid">
        {topMetrics.map((m) => (
          <div key={m.label} className="kpi">
            <div className="ico" style={{ background: m.iconBg }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={m.iconColor} strokeWidth="2">
                {m.iconPath}
              </svg>
            </div>
            <div className="label">{m.label}</div>
            <div className="value" style={{ textTransform: m.label === "Top channel" ? "capitalize" : "none" }}>
              {m.value}
            </div>
            <div className="delta flat">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="card card-pad section">
        <div className="card-title">Traffic by channel</div>
        <div className="card-sub">First-touch attribution — how customers first discovered you</div>
        {sources.length > 0 ? (
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Medium</th>
                <th>Orders</th>
                <th>New</th>
                <th>Revenue</th>
                <th style={{ width: "26%" }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500, textTransform: "capitalize" }}>{s.source}</td>
                  <td className="muted" style={{ textTransform: "capitalize" }}>{s.medium}</td>
                  <td className="num">{s.orders}</td>
                  <td className="num muted">{s.newOrders}</td>
                  <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>{inr(s.revenue)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--bg-2, #eee)", borderRadius: 4, overflow: "hidden" }}>
                        <i style={{ display: "block", height: "100%", width: `${s.share}%`, background: "var(--accent)" }} />
                      </div>
                      <span className="num muted" style={{ minWidth: 38 }}>{s.share.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
            {loaded ? "No orders in this range" : "Loading…"}
          </div>
        )}
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Top campaigns</div>
          <div className="card-sub">Orders carrying a utm_campaign</div>
          {campaigns.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Source</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150, fontWeight: 500 }}>
                        {c.campaign}
                      </div>
                    </td>
                    <td className="muted" style={{ textTransform: "capitalize" }}>{c.source}</td>
                    <td className="num">{c.orders}</td>
                    <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>{inr(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
              {loaded ? "No tagged campaigns yet — add utm_campaign to your ad/email links" : "Loading…"}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">Top referrers</div>
          <div className="card-sub">External sites sending you buyers</div>
          {referrers.length > 0 ? (
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Referrer</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {referrers.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170, fontWeight: 500 }}>
                        {r.host}
                      </div>
                    </td>
                    <td className="num">{r.orders}</td>
                    <td className="num" style={{ color: "var(--green)", fontWeight: 500 }}>{inr(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: "42px 0" }}>
              {loaded ? "No external referrers in this range" : "Loading…"}
            </div>
          )}
        </div>
      </div>

      {loaded && coverage && coverage.total > 0 && coverage.tracked < coverage.total ? (
        <div className="note" style={{ marginTop: 16 }}>
          {coverage.total - coverage.tracked} of {coverage.total} orders have no web journey (direct, HYPD marketplace, or
          attribution still syncing). Run the orders backfill to fill historical gaps.
        </div>
      ) : null}
    </div>
  );
}
