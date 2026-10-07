"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { BarChart, HBars, PeriodPicker, Callout } from "@/components/pm";
import type { HBarItem } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { SalesMetrics } from "@/lib/metrics/sales-aggregate";
import type { ChannelKey } from "@/lib/metrics/channel";
import { InsightsHead, Kpi, DeltaText, ChartCard, changeWords, shortName } from "./insights-ui";
import s from "./insights.module.css";

type Period = "7d" | "30d" | "90d" | "12m";
const PERIODS: readonly Period[] = ["7d", "30d", "90d", "12m"];

const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" || raw === "12m" ? raw : "30d";
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

type Bucket = { label: string; revenue: number; days: number };

// Monday-start weeks (UTC), labelled by the first day that falls in the
// window. Sums revenue only: daily rows carry one all-channel figure.
function groupByWeek(daily: SalesMetrics["daily"]): Bucket[] {
  const out: (Bucket & { key: string })[] = [];
  for (const d of daily) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.revenue += d.revenue;
      last.days += 1;
    } else {
      out.push({ key, label: fmtDay(d.date), revenue: d.revenue, days: 1 });
    }
  }
  return out;
}

function groupByMonth(daily: SalesMetrics["daily"]): Bucket[] {
  const out: (Bucket & { key: string })[] = [];
  for (const d of daily) {
    const key = d.date.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.revenue += d.revenue;
      last.days += 1;
    } else {
      const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" });
      out.push({ key, label, revenue: d.revenue, days: 1 });
    }
  }
  return out;
}

const CHANNEL_COLOR: Record<ChannelKey, string> = {
  web: "var(--pm-s-web)",
  amazon: "var(--pm-s-amz)",
  hypd: "var(--pm-s-hypd)",
  other: "var(--pm-muted)",
  creator: "var(--pm-muted)",
};

type ChannelRow = SalesMetrics["channels"][number];

// Channel name as it reads mid-sentence ("the web store", "other marketplaces").
function midLabel(label: string): string {
  if (label === "Web store") return "the web store";
  if (label === "Other marketplaces") return "other marketplaces";
  return label;
}

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
      <div className={s.kpis}>
        <div className="pm2-skel" />
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
      <div className={s.g21}>
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
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

  const sales = salesQ.data;
  const periodLabel = PERIOD_LABEL[period];
  const actions = <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} />;

  // Channels with any money in either window, biggest first.
  const channels: ChannelRow[] = sales
    ? sales.channels.filter((c) => c.revenue !== 0 || c.prevRevenue !== 0).sort((a, b) => b.revenue - a.revenue)
    : [];
  const channelSum = channels.reduce((t, c) => t + Math.max(0, c.revenue), 0);
  const shareOf = (v: number) => (channelSum > 0 ? Math.round((Math.max(0, v) / channelSum) * 100) : 0);
  const salesDelta = sales ? pctChange(sales.total.revenue, sales.total.prevRevenue) : null;

  const summary = sales ? (
    <>
      <b>{formatLakh(sales.total.revenue)}</b> in the last {periodLabel}
      {changeWords(salesDelta) ? `, ${changeWords(salesDelta)} on the ${periodLabel} before` : ""}.
      {channelSum > 0 && (
        <>
          {" "}
          {channels
            .filter((c) => shareOf(c.revenue) >= 1)
            .map((c, i) => `${i === 0 ? c.label : midLabel(c.label)} ${i === 0 ? "brings " : ""}${shareOf(c.revenue)}%`)
            .join(", ")}
          .
        </>
      )}
    </>
  ) : null;

  const header = <InsightsHead title="Sales" summary={summary} actions={actions} />;

  if (salesQ.isLoading) {
    return (
      <>
        {header}
        <SalesFallback />
      </>
    );
  }

  if (salesQ.isError || !sales) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load sales data"
            body={salesQ.error instanceof Error ? salesQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn sm" onClick={() => salesQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const aov = sales.total.orders > 0 ? sales.total.revenue / sales.total.orders : 0;
  const prevAov = sales.total.prevOrders > 0 ? sales.total.prevRevenue / sales.total.prevOrders : 0;

  const buckets: Bucket[] =
    period === "7d"
      ? sales.daily.map((d) => ({ label: fmtDay(d.date), revenue: d.revenue, days: 1 }))
      : period === "12m"
        ? groupByMonth(sales.daily)
        : groupByWeek(sales.daily);
  const unit = period === "7d" ? "day" : period === "12m" ? "month" : "week";
  const full = unit === "week" ? 7 : 28;
  const partFirst = unit !== "day" && buckets.length > 1 && buckets[0].days < full ? buckets[0] : null;
  const partLast = unit !== "day" && buckets.length > 1 && buckets[buckets.length - 1].days < full ? buckets[buckets.length - 1] : null;
  const partNote = [
    partFirst ? `The first bar covers ${partFirst.days} ${partFirst.days === 1 ? "day" : "days"}` : null,
    partLast ? `${partFirst ? "the last" : "The last"} bar covers ${partLast.days} ${partLast.days === 1 ? "day" : "days"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const lead = channels[0] && channelSum > 0 ? channels[0] : null;
  const periodQ = period === "30d" || period === "12m" ? "" : `?period=${period}`;
  const channelHref = (k: ChannelKey): string | null =>
    k === "web" ? `/dashboard/sales/web${periodQ}` : k === "amazon" ? `/dashboard/sales/amazon${periodQ}` : null;

  const products = sales.topProducts;
  const productItems: HBarItem[] = products.map((p) => ({
    label: p.title,
    value: p.revenue,
    text: formatLakh(p.revenue),
    sub: `${p.units.toLocaleString("en-IN")} sold`,
    color: "var(--pm-s-web)",
    tip: `${p.title}: ${formatINR(p.revenue)} · ${p.units.toLocaleString("en-IN")} units · ${p.share}% of sales`,
  }));
  const topProduct = products[0];

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={s.kpis}>
          <Kpi
            hero
            label={`Sales · ${periodLabel}`}
            value={formatINR(sales.total.revenue)}
            title="Web store + Amazon + HYPD. Excludes ₹0.01 creator seed orders."
          >
            <DeltaText value={salesDelta} /> vs the {periodLabel} before
          </Kpi>
          <Kpi label="Orders" value={sales.total.orders.toLocaleString("en-IN")}>
            <DeltaText value={pctChange(sales.total.orders, sales.total.prevOrders)} /> ·{" "}
            {sales.newCustomers.count.toLocaleString("en-IN")} new customers
          </Kpi>
          <Kpi label="Average order" value={formatINR(aov)}>
            <DeltaText value={pctChange(aov, prevAov)} /> · {Math.round(sales.repeat.pct)}% from repeat buyers
          </Kpi>
        </div>

        <div className={s.g21}>
          <ChartCard
            id="ins-sales-chart"
            title={`Sales per ${unit}`}
            basis="all channels"
            takeaway={
              <>
                {formatLakh(sales.total.revenue)}
                {salesDelta !== null ? (
                  <>
                    ,{" "}
                    <em className={Math.round(salesDelta) < 0 ? s.neg : undefined}>{changeWords(salesDelta)}</em> on the{" "}
                    {periodLabel} before
                  </>
                ) : (
                  " this period, nothing in the period before"
                )}
              </>
            }
          >
            <BarChart
              cats={buckets.map((b) => b.label)}
              series={[{ name: "All channels", color: "var(--pm-s-web)", values: buckets.map((b) => b.revenue) }]}
              fmt={formatLakh}
              yFormat="money"
              labels={buckets.length <= 16}
              // The best bucket stays full colour; the rest are muted.
              highlight={buckets.length > 1 ? buckets.reduce((bi, b, i) => (b.revenue > buckets[bi].revenue ? i : bi), 0) : undefined}
              aria={`Sales per ${unit}, all channels`}
            />
            {partNote && <p className={s.note}>{partNote}. Bars are labelled by their first day.</p>}
          </ChartCard>

          <ChartCard
            id="ins-channels"
            title="By channel"
            basis={periodLabel}
            takeaway={
              lead ? (
                <>
                  {lead.label} brings <em className={s.plain}>{shareOf(lead.revenue)}%</em> of sales
                </>
              ) : (
                "No channel sales in this period"
              )
            }
          >
            <div className={s.chan}>
              {channels.map((c) => {
                const href = channelHref(c.key);
                const amz = c.key === "amazon" ? sales.amazon : null;
                const body = (
                  <>
                    <span className={s.chTop}>
                      <span className={s.dot} style={{ background: CHANNEL_COLOR[c.key] }} />
                      <b>{c.label}</b>
                      <span className={s.chV}>{formatLakh(c.revenue)}</span>
                      <span className={s.chD}>
                        <DeltaText value={pctChange(c.revenue, c.prevRevenue)} />
                      </span>
                    </span>
                    <span className={s.btBar}>
                      <i style={{ width: `${shareOf(c.revenue)}%`, background: CHANNEL_COLOR[c.key] }} />
                    </span>
                    <span className={s.chS}>
                      {shareOf(c.revenue)}% · {c.orders.toLocaleString("en-IN")} orders · avg {formatINR(c.aov)}
                      {amz ? ` · ${formatLakh(amz.net)} after Amazon fees` : ""}
                    </span>
                  </>
                );
                return href ? (
                  <Link key={c.key} href={href} className={s.chR}>
                    {body}
                  </Link>
                ) : (
                  <div key={c.key} className={s.chR}>
                    {body}
                  </div>
                );
              })}
            </div>
          </ChartCard>
        </div>

        <ChartCard
          id="ins-products"
          title="Top products"
          basis="web store + HYPD"
          takeaway={
            topProduct ? (
              <>
                {shortName(topProduct.title)} leads with <em className={s.plain}>{Math.round(topProduct.share)}%</em> of sales
              </>
            ) : undefined
          }
        >
          {productItems.length === 0 ? <p className={s.empty}>No product sales in this period</p> : <HBars items={productItems} />}
        </ChartCard>

        <p className={s.footerNote}>
          Web store, Amazon and HYPD. Excludes ₹0.01 HYPD creator seed orders. New and repeat buyers count web store and HYPD
          orders.
        </p>
      </div>
    </>
  );
}
