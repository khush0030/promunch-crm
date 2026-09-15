"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader, KpiStrip, Kpi, Card, HBars, StackBar, Table, PeriodPicker, Callout } from "@/components/pm";
import type { TableCol, HBarItem, StackPart } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { WebMetrics } from "@/lib/metrics/web-aggregate";

type Period = "7d" | "30d" | "90d";
const PERIODS: readonly Period[] = ["7d", "30d", "90d"];

const PERIOD_CAPTION: Record<Period, string> = {
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
  "90d": "vs previous 90 days",
};

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" ? raw : "30d";
}

// Business-name source -> the same channel colours used elsewhere in Sales.
// Anything without a dedicated colour falls back to muted.
const SOURCE_COLOR: Record<string, string> = {
  "Instagram ads": "var(--pm-s-web)",
  WhatsApp: "var(--pm-s-wa)",
  Creators: "var(--pm-s-hypd)",
  "Not tracked": "var(--pm-line)",
};

type CampaignRow = WebMetrics["campaigns"][number];

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
      <KpiStrip>
        <Kpi label="Web sales" value="—" sub="—" />
        <Kpi label="Average order" value="—" sub="—" />
        <Kpi label="Repeat buyers" value="—" sub="—" />
        <Kpi label="Untracked" value="—" sub="—" />
      </KpiStrip>
      <div className="pm2-skel" />
      <div className="pm2-g21">
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
      <div className="pm2-skel" />
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

  const header = (
    <PageHeader
      crumb="Sales · Web store"
      title="Web store"
      actions={<PeriodPicker options={PERIODS} value={period} onChange={setPeriod} caption={PERIOD_CAPTION[period]} />}
    />
  );

  if (webQ.isLoading) {
    return (
      <>
        {header}
        <WebStoreFallback />
      </>
    );
  }

  if (webQ.isError || !webQ.data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load web store data"
            body={webQ.error instanceof Error ? webQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => webQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const web = webQ.data;

  const hbarItems: HBarItem[] = web.sources.map((s) => ({
    label: s.label,
    value: s.revenue,
    text: formatLakh(s.revenue),
    sub: `${s.orders.toLocaleString("en-IN")} orders`,
    color: SOURCE_COLOR[s.label] ?? "var(--pm-muted)",
  }));

  const stackParts: StackPart[] = [
    { label: "New", value: web.newVsReturning.newRevenue, text: formatLakh(web.newVsReturning.newRevenue), color: "var(--pm-s-web)" },
    {
      label: "Returning",
      value: web.newVsReturning.returningRevenue,
      text: formatLakh(web.newVsReturning.returningRevenue),
      color: "var(--pm-orange)",
    },
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

  const showHonestyCallout = web.tracking.totalOrders > 0 && web.tracking.attributedOrders / web.tracking.totalOrders < 0.5;
  const untrackedOrders = web.tracking.totalOrders - web.tracking.attributedOrders;
  const stoppedDate = web.tracking.lastAttributedAt
    ? new Date(web.tracking.lastAttributedAt).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <>
      {header}
      <div className="pm2-body">
        <KpiStrip>
          <Kpi
            label="Web sales"
            value={formatLakh(web.total.revenue)}
            delta={pctChange(web.total.revenue, web.total.prevRevenue)}
            sub={`${web.total.orders.toLocaleString("en-IN")} orders`}
          />
          <Kpi
            label="Average order"
            value={formatINR(web.aov.value)}
            delta={pctChange(web.aov.value, web.aov.prev)}
            sub="per order"
          />
          <Kpi
            label="Repeat buyers"
            value={`${Math.round(web.repeat.pct)}%`}
            delta={Math.round(web.repeat.pct - web.repeat.prevPct)}
            deltaUnit="pts"
            sub="of orders"
          />
          <Kpi
            label="Untracked"
            value={`${Math.round(web.untracked.pct)}%`}
            delta={Math.round(web.untracked.pct - web.untracked.prevPct)}
            deltaUnit="pts"
            sub="orders with no source"
            invert
            tip="Orders where Shopify recorded no traffic source. Lower is better."
          />
        </KpiStrip>

        {showHonestyCallout && (
          <Callout
            tone="sun"
            title="Shopify isn't reporting where orders come from"
            body={
              stoppedDate
                ? `${untrackedOrders.toLocaleString("en-IN")} of ${web.tracking.totalOrders.toLocaleString("en-IN")} orders in this period have no traffic source. Attribution stopped on 2 June 2026, when the storefront's sales channel changed. Until Shopify sends it again, this chart can only show what it knows.`
                : `${untrackedOrders.toLocaleString("en-IN")} of ${web.tracking.totalOrders.toLocaleString("en-IN")} orders in this period have no traffic source. Until Shopify sends it again, this chart can only show what it knows.`
            }
          />
        )}

        <Card title="Where orders came from" basis="first source that brought the customer">
          <HBars items={hbarItems} />
        </Card>

        <div className="pm2-g21">
          <Card title="New vs returning" basis="per order">
            <StackBar parts={stackParts} />
            <div style={{ display: "flex", marginTop: 14, gap: 20 }}>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--pm-muted)" }}>Returning pay</div>
                <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: "-.02em", marginTop: 4 }}>
                  {formatINR(web.newVsReturning.returningAov)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--pm-muted)" }}>New pay</div>
                <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: "-.02em", marginTop: 4 }}>
                  {formatINR(web.newVsReturning.newAov)}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Best campaigns" basis="from utm_campaign">
            <Table
              cols={campaignCols}
              rows={web.campaigns}
              rowKey={(r) => r.name}
              card={(r) => ({
                title: r.name,
                value: formatLakh(r.revenue),
                meta: `${r.source} · ${r.orders.toLocaleString("en-IN")} orders`,
              })}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
