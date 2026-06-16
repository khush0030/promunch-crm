"use client";
import { useEffect, useState } from "react";
import { IndianRupee, ShoppingCart, TrendingUp, Compass, Users, Tag, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHead, SectionLabel, KpiCard, Panel, DataTable } from "@/components/pm";
import type { Column, KpiTone } from "@/components/pm";

const dateRanges = ["Today", "Last 7 Days", "Last 30 Days", "Last 90 Days", "All time"];
const rangeShort: Record<string, string> = {
  Today: "Today",
  "Last 7 Days": "7d",
  "Last 30 Days": "30d",
  "Last 90 Days": "90d",
  "All time": "All",
};
const rangeDays: Record<string, number | null> = {
  Today: 0,
  "Last 7 Days": 7,
  "Last 30 Days": 30,
  "Last 90 Days": 90,
  "All time": null,
};

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

const creatorSegments = ["All orders", "Exclude creators", "Creators only"] as const;
type CreatorSegment = (typeof creatorSegments)[number];

type SourceRow = { source: string; medium: string; orders: number; newOrders: number; revenue: number; share: number };
type CampaignRow = { campaign: string; source: string; orders: number; revenue: number };
type ReferrerRow = { host: string; orders: number; revenue: number };

const num = (v: number | string | null) => Number(v) || 0;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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
  const [totals, setTotals] = useState<{ revenue: number; orders: number; aov: number; tracked: number; top: SourceRow | null }>({
    revenue: 0, orders: 0, aov: 0, tracked: 0, top: null,
  });
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [referrers, setReferrers] = useState<ReferrerRow[]>([]);
  const [coverage, setCoverage] = useState<{ tracked: number; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);

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
      const allOrders: OrderRow[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("shopify_orders").select(cols).range(from, from + 999);
        if (since) q = q.gte("shopify_created_at", since);
        const { data } = await q;
        const batch = (data || []) as OrderRow[];
        allOrders.push(...batch);
        if (batch.length < 1000) break;
      }

      setCreatorCount(allOrders.filter((o) => o.is_creator).length);
      const orders =
        creatorSeg === "Exclude creators" ? allOrders.filter((o) => !o.is_creator)
        : creatorSeg === "Creators only" ? allOrders.filter((o) => o.is_creator)
        : allOrders;

      const totalRevenue = orders.reduce((s, o) => s + num(o.total_price), 0);
      const totalOrders = orders.length;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
          source, medium: v.medium, orders: v.orders, newOrders: v.newOrders, revenue: v.revenue,
          share: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

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

      setTotals({ revenue: totalRevenue, orders: totalOrders, aov, tracked, top: srcRows[0] ?? null });
      setSources(srcRows);
      setCampaigns(campRows);
      setReferrers(refRows);
      setCoverage({ tracked, total: totalOrders });
      setLoaded(true);
    }
    load();
  }, [activeRange, creatorSeg]);

  const snapshot: { label: string; rev?: number; ord?: number; tone: KpiTone }[] = [
    { label: "Today's revenue", rev: stats?.revenue.today, ord: stats?.orders.today, tone: "g" },
    { label: "Last 7 days", rev: stats?.revenue.d7, ord: stats?.orders.d7, tone: "o" },
    { label: "Last 30 days", rev: stats?.revenue.d30, ord: stats?.orders.d30, tone: "t" },
    { label: "All-time revenue", rev: stats?.revenue.all, ord: stats?.orders.all, tone: "b" },
  ];

  const sourceCols: Column<SourceRow>[] = [
    { header: "Channel", cell: (s) => <span className="pm-b7" style={{ textTransform: "capitalize" }}>{s.source}</span> },
    { header: "Medium", cell: (s) => <span className="pm-dim" style={{ textTransform: "capitalize" }}>{s.medium}</span> },
    { header: "Orders", cell: (s) => s.orders },
    { header: "New", cell: (s) => <span className="pm-dim">{s.newOrders}</span> },
    { header: "Revenue", cell: (s) => <span className="pm-b7" style={{ color: "var(--pm-green)" }}>{inr(s.revenue)}</span> },
    {
      header: "Share",
      width: "26%",
      cell: (s) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 9, background: "var(--pm-line)", borderRadius: 6, overflow: "hidden" }}>
            <i style={{ display: "block", height: "100%", width: `${s.share}%`, background: "var(--pm-green)", borderRadius: 6 }} />
          </div>
          <span className="pm-dim" style={{ minWidth: 38 }}>{s.share.toFixed(0)}%</span>
        </div>
      ),
    },
  ];

  const campaignCols: Column<CampaignRow>[] = [
    { header: "Campaign", cell: (c) => <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160, fontWeight: 600 }}>{c.campaign}</div> },
    { header: "Source", cell: (c) => <span className="pm-dim" style={{ textTransform: "capitalize" }}>{c.source}</span> },
    { header: "Orders", cell: (c) => c.orders },
    { header: "Revenue", cell: (c) => <span className="pm-b7" style={{ color: "var(--pm-green)" }}>{inr(c.revenue)}</span> },
  ];

  const referrerCols: Column<ReferrerRow>[] = [
    { header: "Referrer", cell: (r) => <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180, fontWeight: 600 }}>{r.host}</div> },
    { header: "Orders", cell: (r) => r.orders },
    { header: "Revenue", cell: (r) => <span className="pm-b7" style={{ color: "var(--pm-green)" }}>{inr(r.revenue)}</span> },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Shopify Attribution"
        subtitle="Where your orders come from — UTM source, campaign & referrer"
        actions={
          <div className="pm-ranges">
            {dateRanges.map((r) => (
              <button key={r} className={activeRange === r ? "on" : ""} onClick={() => setActiveRange(r)}>
                {rangeShort[r]}
              </button>
            ))}
          </div>
        }
      />

      <SectionLabel>Store snapshot</SectionLabel>
      <div className="pm-kpis">
        {snapshot.map((c) => (
          <KpiCard key={c.label} label={c.label} value={stats ? inr(c.rev ?? 0) : "…"} icon={<IndianRupee />} tone={c.tone}
            sub={stats ? `${(c.ord ?? 0).toLocaleString("en-IN")} orders` : "loading"} />
        ))}
      </div>

      <div className="pm-grid g-11" style={{ marginTop: 14 }}>
        <KpiCard label="Customers" value={stats?.customers != null ? stats.customers.toLocaleString("en-IN") : stats ? "—" : "…"} icon={<Users />} tone="b" sub="live in Shopify" />
        <KpiCard label="Avg order value" value={stats ? inr(stats.aov_all) : "…"} icon={<TrendingUp />} tone="g" sub="all-time, across channels" />
      </div>

      <SectionLabel>Attribution · {activeRange.toLowerCase()}</SectionLabel>
      <div className="pm-chips" style={{ marginBottom: 6 }}>
        {creatorSegments.map((s) => (
          <span key={s} className={`pm-chip${creatorSeg === s ? " on" : ""}`} onClick={() => setCreatorSeg(s)}>
            {s === "All orders" ? s : `🎨 ${s}`}
            {s === "Creators only" && creatorCount > 0 ? ` · ${creatorCount}` : ""}
          </span>
        ))}
      </div>
      {creatorSeg !== "All orders" && (
        <div className="pm-dim" style={{ fontSize: 12, marginBottom: 12 }}>
          {creatorSeg === "Exclude creators"
            ? `Hiding ${creatorCount} ₹0.01 HYPD-creator seed order${creatorCount === 1 ? "" : "s"} from the numbers below.`
            : `Showing only the ${creatorCount} HYPD-creator seed order${creatorCount === 1 ? "" : "s"} (₹0.01 influencer gifts).`}
        </div>
      )}

      <div className="pm-kpis" style={{ marginTop: 6 }}>
        <KpiCard label="Order revenue" value={inr(totals.revenue)} icon={<IndianRupee />} tone="g" sub={activeRange.toLowerCase()} />
        <KpiCard label="Orders" value={totals.orders.toLocaleString("en-IN")} icon={<ShoppingCart />} tone="o"
          sub={totals.tracked > 0 ? `${Math.round((totals.tracked / Math.max(1, totals.orders)) * 100)}% with known source` : "—"} />
        <KpiCard label="Avg order value" value={inr(totals.aov)} icon={<TrendingUp />} tone="t" sub="across all channels" />
        <KpiCard label="Top channel" value={totals.top ? totals.top.source : "—"} icon={<Compass />} tone="b"
          valueStyle={{ fontSize: 20, textTransform: "capitalize" }}
          sub={totals.top ? `${inr(totals.top.revenue)} · ${totals.top.share.toFixed(0)}% of rev` : "—"} />
      </div>

      <SectionLabel>Traffic by channel</SectionLabel>
      <DataTable columns={sourceCols} rows={sources} rowKey={(_, i) => i} empty={loaded ? "No orders in this range" : "Loading…"} />

      <div className="pm-grid g-11" style={{ marginTop: 14 }}>
        <Panel title="Top campaigns" icon={<Tag className="tic" />} caption="Orders carrying a utm_campaign">
          {campaigns.length > 0 ? (
            <div style={{ marginTop: 4 }}><DataTable columns={campaignCols} rows={campaigns} rowKey={(_, i) => i} /></div>
          ) : (
            <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>
              {loaded ? "No tagged campaigns yet — add utm_campaign to your ad/email links" : "Loading…"}
            </div>
          )}
        </Panel>
        <Panel title="Top referrers" icon={<ExternalLink className="tic" />} caption="External sites sending you buyers">
          {referrers.length > 0 ? (
            <div style={{ marginTop: 4 }}><DataTable columns={referrerCols} rows={referrers} rowKey={(_, i) => i} /></div>
          ) : (
            <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>
              {loaded ? "No external referrers in this range" : "Loading…"}
            </div>
          )}
        </Panel>
      </div>

      {loaded && coverage && coverage.total > 0 && coverage.tracked < coverage.total && (
        <div style={{ marginTop: 16, background: "var(--pm-card2)", border: "1px solid var(--pm-line)", borderRadius: 10, padding: "11px 14px", fontSize: 12.5, color: "var(--pm-muted)" }}>
          {coverage.total - coverage.tracked} of {coverage.total} orders have no web journey (direct, HYPD marketplace, or attribution still syncing). Run the orders backfill to fill historical gaps.
        </div>
      )}
    </div>
  );
}
