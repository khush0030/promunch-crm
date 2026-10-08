"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { HBars, StackBar, Table, Callout } from "@/components/pm";
import type { TableCol, HBarItem, StackPart } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { WebMetrics } from "@/lib/metrics/web-aggregate";
import { InsightsHead, PeriodSeg, Kpi, DeltaText, ChartCard, changeWords } from "../insights-ui";
import s from "../insights.module.css";

type Period = "7d" | "30d" | "90d";
const PERIODS: readonly Period[] = ["7d", "30d", "90d"];

const PERIOD_LABEL: Record<Period, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" ? raw : "30d";
}

// Business-name source -> the same channel colours used elsewhere in Sales.
// Anything without a dedicated colour falls back to muted.
const SOURCE_COLOR: Record<string, string> = {
  "Instagram ads": "var(--pm-s-web)",
  WhatsApp: "var(--pm-s-wa)",
  Creators: "var(--pm-s-hypd)",
  "Not tracked": "#CFC7B9",
};

type CampaignRow = WebMetrics["campaigns"][number];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// useSearchParams needs a Suspense boundary in the App Router.
export default function WebStorePage() {
  return (
    <Suspense fallback={<WebStoreFallback />}>
      <WebStorePageInner />
    </Suspense>
  );
}

function WebStoreFallback() {
  return (
    <div className="pm2-body">
      <div className={`${s.kpis} ${s.k4}`}>
        <div className="pm2-skel" />
        <div className="pm2-skel" />
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
      <div className="pm2-skel" />
      <div className={s.g2}>
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
    </div>
  );
}

function WebStorePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(params.toString());
      if (p === "30d") q.delete("period");
      else q.set("period", p);
      router.replace(`/dashboard/sales/web${q.toString() ? `?${q}` : ""}`);
    },
    [router, params],
  );

  const webQ = useQuery({
    queryKey: ["metrics-web", period],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/web?period=${period}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`web ${r.status}`);
      const d = await r.json();
      if (d?.ok === false) throw new Error(d.error || "web metrics failed");
      return d as WebMetrics;
    },
    placeholderData: keepPreviousData,
  });

  const web = webQ.data;
  const periodLabel = PERIOD_LABEL[period];
  const salesDelta = web ? pctChange(web.total.revenue, web.total.prevRevenue) : null;

  const summary = web ? (
    <>
      promunch.in sold <b>{formatLakh(web.total.revenue)}</b> in {periodLabel}
      {changeWords(salesDelta) ? `, ${changeWords(salesDelta)} on the ${periodLabel} before` : ""}.{" "}
      <b>{Math.round(web.repeat.pct)}% of orders</b> came from people who had bought before.
    </>
  ) : null;

  const header = (
    <InsightsHead title="Website" summary={summary} actions={<PeriodSeg options={PERIODS} value={period} onChange={setPeriod} />} />
  );

  if (webQ.isLoading) {
    return (
      <>
        {header}
        <WebStoreFallback />
      </>
    );
  }

  if (webQ.isError || !web) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load web store data"
            body={webQ.error instanceof Error ? webQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn sm" onClick={() => webQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const hbarItems: HBarItem[] = web.sources.map((x) => ({
    label: x.label,
    value: x.revenue,
    text: formatLakh(x.revenue),
    sub: `${x.orders.toLocaleString("en-IN")} ${x.orders === 1 ? "order" : "orders"}`,
    color: SOURCE_COLOR[x.label] ?? "var(--pm-muted)",
  }));

  const { newRevenue, returningRevenue, newAov, returningAov } = web.newVsReturning;
  const stackParts: StackPart[] = [
    { label: "Returning", value: returningRevenue, text: formatLakh(returningRevenue), color: "var(--pm-s-web)" },
    { label: "New", value: newRevenue, text: formatLakh(newRevenue), color: "#CFC7B9" },
  ];

  const campaignCols: TableCol<CampaignRow>[] = [
    {
      h: "Campaign",
      render: (r) => (
        <>
          {r.name}
          <span className="sub">{r.source}</span>
        </>
      ),
    },
    { h: "Orders", num: true, render: (r) => r.orders.toLocaleString("en-IN") },
    { h: "Sales", num: true, render: (r) => formatLakh(r.revenue) },
  ];

  const untrackedOrders = web.tracking.totalOrders - web.tracking.attributedOrders;
  const mostlyUntracked = web.tracking.totalOrders > 0 && web.tracking.attributedOrders / web.tracking.totalOrders < 0.5;
  const tracked = web.sources.filter((x) => x.label !== "Not tracked" && x.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const trackedSum = tracked.reduce((t, x) => t + x.revenue, 0);
  const topSource = tracked[0];

  const sourceTakeaway = mostlyUntracked ? (
    <>
      <em className={s.plain}>{pct(untrackedOrders, web.tracking.totalOrders)}%</em> of orders have no source
    </>
  ) : topSource ? (
    <>
      {topSource.label} brings <em className={s.plain}>{pct(topSource.revenue, trackedSum)}%</em> of tracked sales
    </>
  ) : (
    "No orders in this period"
  );

  const nrTotal = newRevenue + returningRevenue;
  const nrTakeaway =
    nrTotal <= 0 ? (
      "No orders in this period"
    ) : returningAov > 0 && newAov > 0 && Math.abs(returningAov - newAov) >= 1 ? (
      <>
        Returning buyers spend <em className={s.plain}>{formatINR(Math.abs(returningAov - newAov))}</em>{" "}
        {returningAov > newAov ? "more" : "less"} per order
      </>
    ) : (
      <>
        Returning buyers bring <em className={s.plain}>{pct(returningRevenue, nrTotal)}%</em> of sales
      </>
    );

  const bestCampaign = web.campaigns.length > 0 ? [...web.campaigns].sort((a, b) => b.revenue - a.revenue)[0] : null;

  // Last order Shopify gave a source for, in IST. Only claim tracking
  // "stopped" when that was more than 3 days before this data was loaded.
  const lastAttr = web.tracking.lastAttributedAt ? new Date(web.tracking.lastAttributedAt) : null;
  const stoppedDate =
    lastAttr && webQ.dataUpdatedAt - lastAttr.getTime() > 3 * 86_400_000
      ? lastAttr.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })
      : null;

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={`${s.kpis} ${s.k4}`}>
          <Kpi label="Sales" value={formatLakh(web.total.revenue)}>
            <DeltaText value={salesDelta} /> vs the {periodLabel} before
          </Kpi>
          <Kpi label="Orders" value={web.total.orders.toLocaleString("en-IN")}>
            <DeltaText value={pctChange(web.total.orders, web.total.prevOrders)} />
          </Kpi>
          <Kpi label="Average order" value={formatINR(web.aov.value)}>
            <DeltaText value={pctChange(web.aov.value, web.aov.prev)} />
          </Kpi>
          <Kpi label="Returning" value={`${Math.round(web.repeat.pct)}%`}>
            <DeltaText value={web.repeat.pct - web.repeat.prevPct} unit="pts" /> of orders
          </Kpi>
        </div>

        <ChartCard id="ins-web-sources" title="Where orders came from" basis="first source that brought the customer" takeaway={sourceTakeaway}>
          <HBars items={hbarItems} />
          {mostlyUntracked && (
            <p className={s.note}>
              <span className={`${s.tg} ${s.warn}`}>Source missing</span>{" "}
              {untrackedOrders.toLocaleString("en-IN")} of {web.tracking.totalOrders.toLocaleString("en-IN")} orders have no
              traffic source.
              {stoppedDate ? ` Shopify stopped sending it after ${stoppedDate}.` : ""}{" "}
              Until it comes back, this chart only shows what Shopify knows.
            </p>
          )}
        </ChartCard>

        <div className={s.g2}>
          <ChartCard id="ins-web-nr" title="New vs returning" basis={`${periodLabel} · sales`} takeaway={nrTakeaway}>
            <StackBar parts={stackParts} />
            <div className={s.nr}>
              <div>
                <span>Returning buyers pay</span>
                <b>{formatINR(returningAov)}</b>
              </div>
              <div>
                <span>New buyers pay</span>
                <b>{formatINR(newAov)}</b>
              </div>
            </div>
          </ChartCard>

          <ChartCard
            id="ins-web-campaigns"
            title="Best campaigns"
            basis="from utm_campaign"
            takeaway={
              bestCampaign ? (
                <>
                  {bestCampaign.name} brought <em className={s.plain}>{formatLakh(bestCampaign.revenue)}</em>
                </>
              ) : undefined
            }
          >
            <Table
              cols={campaignCols}
              rows={web.campaigns}
              rowKey={(r) => r.name}
              card={(r) => ({
                title: r.name,
                value: formatLakh(r.revenue),
                meta: `${r.source} · ${r.orders.toLocaleString("en-IN")} orders`,
              })}
              empty="No campaign links in this period"
            />
          </ChartCard>
        </div>

        <p className={s.footerNote}>promunch.in orders only. Excludes ₹0.01 HYPD creator seed orders.</p>
      </div>
    </>
  );
}
