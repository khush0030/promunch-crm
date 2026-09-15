"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader, KpiStrip, Kpi, Card, BarChart, Table, Delta, PeriodPicker, Callout } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { SalesMetrics } from "@/lib/metrics/sales-aggregate";
import type { ChannelKey } from "@/lib/metrics/channel";

type Period = "7d" | "30d" | "90d" | "12m";
const PERIODS: readonly Period[] = ["7d", "30d", "90d", "12m"];

const PERIOD_CAPTION: Record<Period, string> = {
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
  "90d": "vs previous 90 days",
  "12m": "vs previous 12 months",
};

const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" || raw === "12m" ? raw : "30d";
}

// ISO-8601 week number for a UTC date.
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Group SalesMetrics.daily into ISO weeks, summing revenue only — the daily
// rows carry one combined revenue figure (no per-channel split), so this is
// the weekly TOTAL, not a channel breakdown. Ordered oldest first.
function groupByWeek(daily: SalesMetrics["daily"]): { label: string; revenue: number }[] {
  const map = new Map<string, { order: number; wk: number; revenue: number }>();
  for (const d of daily) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const wk = isoWeekNumber(date);
    const key = `${date.getUTCFullYear()}-${wk}`;
    const cur = map.get(key) ?? { order: date.getTime(), wk, revenue: 0 };
    cur.revenue += d.revenue;
    if (date.getTime() < cur.order) cur.order = date.getTime();
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order)
    .map((v) => ({ label: `Wk ${v.wk}`, revenue: v.revenue }));
}

const CHANNEL_ORDER: ChannelKey[] = ["web", "amazon", "hypd", "other"];
const CHANNEL_COLOR: Record<string, string> = {
  web: "var(--pm-s-web)",
  amazon: "var(--pm-s-amz)",
  hypd: "var(--pm-s-hypd)",
  other: "var(--pm-muted)",
};

type ChannelRow = SalesMetrics["channels"][number];
type ProductRow = SalesMetrics["topProducts"][number];

// useSearchParams needs a Suspense boundary in the App Router.
export default function SalesPage() {
  return (
    <Suspense fallback={<SalesFallback />}>
      <SalesPageInner />
    </Suspense>
  );
}

function SalesFallback() {
  return (
    <div className="pm2-body">
      <KpiStrip>
        <Kpi label="Total sales" value="—" sub="—" />
        <Kpi label="Average order" value="—" sub="—" />
        <Kpi label="New customers" value="—" sub="—" />
        <Kpi label="Repeat buyers" value="—" sub="—" />
      </KpiStrip>
      <div className="pm2-g21">
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
      <div className="pm2-skel" />
    </div>
  );
}

function SalesPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(params.toString());
      if (p === "30d") q.delete("period");
      else q.set("period", p);
      router.replace(`/dashboard/sales${q.toString() ? `?${q}` : ""}`);
    },
    [router, params],
  );

  const salesQ = useQuery({
    queryKey: ["metrics-sales", period],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/sales?period=${period}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`sales ${r.status}`);
      const d = await r.json();
      if (d?.ok === false) throw new Error(d.error || "sales metrics failed");
      return d as SalesMetrics;
    },
    placeholderData: keepPreviousData,
  });

  const header = (
    <PageHeader
      crumb="Sales · Overview"
      title="Sales overview"
      actions={<PeriodPicker options={PERIODS} value={period} onChange={setPeriod} caption={PERIOD_CAPTION[period]} />}
    />
  );

  if (salesQ.isLoading) {
    return (
      <>
        {header}
        <SalesFallback />
      </>
    );
  }

  if (salesQ.isError || !salesQ.data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load sales data"
            body={salesQ.error instanceof Error ? salesQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => salesQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const sales = salesQ.data;
  const periodLabel = PERIOD_LABEL[period];

  const aov = sales.total.orders > 0 ? sales.total.revenue / sales.total.orders : 0;
  const prevAov = sales.total.prevOrders > 0 ? sales.total.prevRevenue / sales.total.prevOrders : 0;

  const useDaily = period === "7d";
  const weeks = useDaily ? null : groupByWeek(sales.daily);
  const dailyLabels = sales.daily.map((d) =>
    new Date(d.date).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }),
  );

  const barCats = useDaily ? dailyLabels : (weeks ?? []).map((w) => w.label);
  const barValues = useDaily ? sales.daily.map((d) => d.revenue) : (weeks ?? []).map((w) => w.revenue);

  const channelRows = CHANNEL_ORDER.map((key) => sales.channels.find((c) => c.key === key))
    .filter((c): c is ChannelRow => !!c)
    .filter((c) => c.revenue !== 0 || c.prevRevenue !== 0);

  // Three columns so the card fits its 1fr slot at laptop width: orders sit
  // under the channel name, the change under the sales figure.
  const channelCols: TableCol<ChannelRow>[] = [
    {
      h: "Channel",
      render: (r) => (
        <>
          <span className="pm2-legend" style={{ margin: 0 }}>
            <span>
              <i style={{ background: CHANNEL_COLOR[r.key] ?? "var(--pm-muted)" }} />
              {r.label}
            </span>
          </span>
          <span className="sub">{r.orders.toLocaleString("en-IN")} orders</span>
        </>
      ),
    },
    {
      h: "Sales",
      num: true,
      render: (r) => (
        <>
          {formatLakh(r.revenue)}
          <span className="sub"><Delta value={pctChange(r.revenue, r.prevRevenue)} /></span>
        </>
      ),
    },
    { h: "Avg order", num: true, render: (r) => formatINR(r.aov) },
  ];

  const productCols: TableCol<ProductRow>[] = [
    { h: "Product", key: "title" },
    { h: "Units", num: true, render: (r) => r.units.toLocaleString("en-IN") },
    { h: "Sales", num: true, render: (r) => formatLakh(r.revenue) },
    { h: "Share", num: true, render: (r) => `${r.share}%` },
  ];

  return (
    <>
      {header}
      <div className="pm2-body">
        <KpiStrip>
          <Kpi
            label="Total sales"
            value={formatLakh(sales.total.revenue)}
            delta={pctChange(sales.total.revenue, sales.total.prevRevenue)}
            sub={`${sales.total.orders.toLocaleString("en-IN")} orders`}
          />
          <Kpi
            label="Average order"
            value={formatINR(aov)}
            delta={pctChange(aov, prevAov)}
            sub="per order"
          />
          <Kpi
            label="New customers"
            value={sales.newCustomers.count.toLocaleString("en-IN")}
            delta={pctChange(sales.newCustomers.count, sales.newCustomers.prevCount)}
            sub="first order ever"
          />
          <Kpi
            label="Repeat buyers"
            value={`${Math.round(sales.repeat.pct)}%`}
            delta={Math.round(sales.repeat.pct - sales.repeat.prevPct)}
            deltaUnit="pts"
            sub="of orders"
            tip="Substitutes for a returning-revenue figure the API doesn't return yet."
          />
        </KpiStrip>

        <div className="pm2-g21">
          <Card title="Sales by channel per week" basis={useDaily ? "gross · ₹ per day" : "gross · ₹ per week"}>
            <BarChart
              cats={barCats}
              series={[{ name: "All channels", color: "var(--pm-s-web)", values: barValues }]}
              fmt={formatLakh}
              yFormat="money"
              labels
              aria={useDaily ? "Daily sales, all channels" : "Weekly sales, all channels"}
            />
          </Card>

          <Card title="Channel scorecard" basis={periodLabel}>
            <Table
              cols={channelCols}
              rows={channelRows}
              rowKey={(r) => r.key}
              card={(r) => ({
                title: r.label,
                value: formatLakh(r.revenue),
                meta: (
                  <>
                    <Delta value={pctChange(r.revenue, r.prevRevenue)} /> · {r.orders.toLocaleString("en-IN")} orders
                    · AOV {formatINR(r.aov)}
                  </>
                ),
              })}
            />
          </Card>
        </div>

        <Card title="Top products" basis={`${periodLabel} · web store + HYPD`}>
          <Table
            cols={productCols}
            rows={sales.topProducts}
            rowKey={(r) => r.title}
            card={(r) => ({
              title: r.title,
              value: formatLakh(r.revenue),
              meta: `${r.units.toLocaleString("en-IN")} units · ${r.share}% of sales`,
            })}
            empty="No product sales in this period"
          />
        </Card>
      </div>
    </>
  );
}
