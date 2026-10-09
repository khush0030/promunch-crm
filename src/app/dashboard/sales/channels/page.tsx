"use client";

// Insights → Channels. Every sales channel side by side (web store, HYPD,
// Amazon, other marketplaces): totals, split, sales over time by channel,
// and which products sell best where. Reads GET /api/metrics/channels only;
// its channel totals come from the same aggregation as the Sales tab.

import { Fragment, Suspense, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { BarChart, Callout, StackBar, Table, Tag } from "@/components/pm";
import type { BarSeries, StackPart, TableCol } from "@/components/pm";
import { formatINR, formatLakh } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { ChannelsMetrics, SalesChannel, SkuRow } from "@/lib/metrics/channels-aggregate";
import { InsightsHead, PeriodSeg, Kpi, DeltaText, ChartCard, changeWords, shortName } from "../insights-ui";
import s from "../insights.module.css";
import c from "./channels.module.css";

type Period = "7d" | "30d" | "90d" | "12m";
const PERIODS: readonly Period[] = ["7d", "30d", "90d", "12m"];
const PERIOD_LABEL: Record<Period, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "12m": "12 months" };

// Same colours as the Sales tab's "By channel" card. "Other" is a neutral
// fold-in, never a fifth hue.
const COLOR: Record<SalesChannel, string> = {
  web: "var(--pm-s-web)",
  hypd: "var(--pm-s-hypd)",
  amazon: "var(--pm-s-amz)",
  other: "var(--pm-muted)",
};
const LABEL: Record<SalesChannel, string> = { web: "Web store", hypd: "HYPD", amazon: "Amazon", other: "Other marketplaces" };
const SHORT: Record<SalesChannel, string> = { web: "Web", hypd: "HYPD", amazon: "Amazon", other: "Other" };
// Stack order bottom to top in the chart, and column order in the table.
const ORDER: SalesChannel[] = ["web", "amazon", "hypd", "other"];

const MIN_PREV_ORDERS = 10;
// A % change only shows against a real baseline (not 0, not a near-empty one).
function steadyChange(current: number, previous: number, minPrev = 0): number | null {
  if (previous <= 0 || previous < minPrev || previous < Math.abs(current) * 0.05) return null;
  return pctChange(current, previous);
}

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" || raw === "12m" ? raw : "30d";
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

type Day = ChannelsMetrics["dailyByChannel"][number];
type Bucket = { label: string; days: number; v: Record<SalesChannel, number> };

// Days as-is for 7 days, Monday-start weeks for 30/90 days, months for 12
// months; the same bucketing as the Sales tab's chart.
function bucketize(daily: Day[], period: Period): Bucket[] {
  const out: (Bucket & { key: string })[] = [];
  for (const d of daily) {
    let key: string;
    let label: string;
    if (period === "7d") {
      key = d.date;
      label = fmtDay(d.date);
    } else if (period === "12m") {
      key = d.date.slice(0, 7);
      label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" });
    } else {
      const date = new Date(`${d.date}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
      label = fmtDay(d.date);
    }
    const last = out[out.length - 1];
    if (last && last.key === key) {
      for (const ch of ORDER) last.v[ch] += d[ch];
      last.days += 1;
    } else {
      out.push({ key, label, days: 1, v: { web: d.web, hypd: d.hypd, amazon: d.amazon, other: d.other } });
    }
  }
  return out;
}

const n = (v: number) => Math.round(v).toLocaleString("en-IN");

export default function ChannelsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ChannelsInner />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="pm2-body">
      <div className={s.kpis}>
        <div className="pm2-skel" />
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
      <div className="pm2-skel" style={{ minHeight: 320 }} />
    </div>
  );
}

type Rank = "revenue" | "units";
type Filter = "all" | SalesChannel;
const TOP_N = 15;

function ChannelsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));
  const setPeriod = useCallback(
    (p: Period) => router.replace(`/dashboard/sales/channels${p === "30d" ? "" : `?period=${p}`}`),
    [router],
  );
  const [rank, setRank] = useState<Rank>("revenue");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);

  const q = useQuery({
    queryKey: ["metrics-channels", period],
    queryFn: async (): Promise<ChannelsMetrics> => {
      const r = await fetch(`/api/metrics/channels?period=${period}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) throw new Error(d.error || `channels ${r.status}`);
      return d as ChannelsMetrics;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const m = q.data;
  const word = PERIOD_LABEL[period];

  // Channels with money in either window, biggest first.
  const channels = useMemo(
    () =>
      m
        ? m.sales.channels
            .filter((ch) => ch.revenue !== 0 || ch.prevRevenue !== 0)
            .sort((a, b) => b.revenue - a.revenue)
            .map((ch) => ({ ...ch, key: ch.key as SalesChannel }))
        : [],
    [m],
  );
  const chanSum = channels.reduce((t, ch) => t + Math.max(0, ch.revenue), 0);
  const shareOf = (v: number) => (chanSum > 0 ? Math.round((Math.max(0, v) / chanSum) * 100) : 0);
  const live = new Set(channels.map((ch) => ch.key));

  // Product table rows for the current rank + filter.
  const skuRows = useMemo(() => {
    if (!m) return [];
    const metric = (r: SkuRow) =>
      filter === "all" ? (rank === "revenue" ? r.revenue : r.units) : rank === "revenue" ? r.byChannel[filter].revenue : r.byChannel[filter].units;
    return m.skus
      .filter((r) => filter === "all" || r.byChannel[filter].revenue > 0 || r.byChannel[filter].units > 0)
      .slice()
      .sort((a, b) => metric(b) - metric(a) || b.revenue - a.revenue || a.name.localeCompare(b.name));
  }, [m, rank, filter]);

  const salesDelta = m ? steadyChange(m.sales.total.revenue, m.sales.total.prevRevenue) : null;
  const lead = channels[0] && chanSum > 0 ? channels[0] : null;
  const topSku = m?.skus[0];

  const summary = m ? (
    <>
      <b>{formatLakh(m.sales.total.revenue)}</b> across all channels in the last {word}
      {changeWords(salesDelta) ? `, ${changeWords(salesDelta)} on the ${word} before` : ""}.
      {lead ? (
        <>
          {" "}
          {lead.label} leads with {shareOf(lead.revenue)}%
          {topSku ? (
            <>
              , and <b>{shortName(topSku.name, 40)}</b> is the top product
            </>
          ) : null}
          .
        </>
      ) : null}
    </>
  ) : undefined;

  const header = <InsightsHead title="Channels" summary={summary} actions={<PeriodSeg options={PERIODS} value={period} onChange={setPeriod} />} />;

  if (q.isLoading) {
    return (
      <>
        {header}
        <Fallback />
      </>
    );
  }
  if (q.isError || !m) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load channel data"
            body={q.error instanceof Error ? q.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const t = m.sales.total;
  const aov = t.orders > 0 ? t.revenue / t.orders : 0;
  const prevAov = t.prevOrders > 0 ? t.prevRevenue / t.prevOrders : 0;
  const ordersDelta = steadyChange(t.orders, t.prevOrders, MIN_PREV_ORDERS);
  const aovDelta = t.prevOrders >= MIN_PREV_ORDERS ? steadyChange(aov, prevAov) : null;

  // ---- split ----
  const parts: StackPart[] = channels
    .filter((ch) => ch.revenue > 0)
    .map((ch) => ({ label: ch.label, value: ch.revenue, text: `${shareOf(ch.revenue)}%`, color: COLOR[ch.key] }));

  type ChanRow = (typeof channels)[number];
  const chanCols: TableCol<ChanRow>[] = [
    {
      h: "Channel",
      render: (r) => (
        <span className={c.chName}>
          <i className={c.sw} style={{ background: COLOR[r.key] }} aria-hidden />
          {r.label}
        </span>
      ),
    },
    { h: "Sales", num: true, render: (r) => formatINR(r.revenue) },
    { h: "Share", num: true, render: (r) => `${shareOf(r.revenue)}%` },
    { h: "Orders", num: true, render: (r) => n(r.orders) },
    { h: "Avg order", num: true, render: (r) => (r.orders > 0 ? formatINR(r.aov) : "–") },
    {
      h: `vs ${word} before`,
      num: true,
      render: (r) => {
        const d = steadyChange(r.revenue, r.prevRevenue);
        return d !== null ? <DeltaText value={d} /> : <span className={s.muted}>{r.prevRevenue <= 0 ? "new" : "–"}</span>;
      },
    },
  ];

  // ---- chart ----
  const buckets = bucketize(m.dailyByChannel, period);
  const unit = period === "7d" ? "day" : period === "12m" ? "month" : "week";
  const series: BarSeries[] = ORDER.filter((ch) => live.has(ch) && m.dailyByChannel.some((d) => d[ch] !== 0)).map((ch) => ({
    name: LABEL[ch],
    color: COLOR[ch],
    values: buckets.map((b) => Math.max(0, b.v[ch])),
    tipValues: buckets.map((b) => b.v[ch]),
  }));
  const full = unit === "week" ? 7 : 28;
  const partial = unit !== "day" && buckets.length > 1 && (buckets[0].days < full || buckets[buckets.length - 1].days < full);

  // ---- best per channel ----
  const bestPer = ORDER.filter((ch) => live.has(ch)).map((ch) => {
    const top = [...m.skus].filter((r) => r.byChannel[ch].revenue > 0).sort((a, b) => b.byChannel[ch].revenue - a.byChannel[ch].revenue)[0];
    const tot = m.skuTotals[ch].revenue;
    return { ch, top, share: top && tot > 0 ? Math.round((top.byChannel[ch].revenue / tot) * 100) : 0 };
  });

  // ---- product table ----
  const tableChannels = ORDER.filter((ch) => m.skuTotals[ch].revenue !== 0 || m.skuTotals[ch].units !== 0);
  const visible = showAll ? skuRows : skuRows.slice(0, TOP_N);
  const filterTotal = filter === "all" ? null : m.skuTotals[filter].revenue;
  const cell = (r: SkuRow, ch: SalesChannel) => {
    const v = r.byChannel[ch];
    if (v.revenue === 0 && v.units === 0) return <span className={c.nil}>–</span>;
    return (
      <>
        {formatINR(v.revenue)}
        <span className="sub">{n(v.units)} units</span>
      </>
    );
  };
  const skuCols: TableCol<SkuRow>[] = [
    { h: "#", render: (r) => <span className={c.rank}>{skuRows.indexOf(r) + 1}</span> },
    {
      h: "Product",
      render: (r) => (
        <span className={c.prod}>
          <b title={r.name}>{shortName(r.name, 40)}</b>
          <span className="sub">
            {r.codes.slice(0, 3).join(" · ")}
            {r.codes.length > 3 ? ` +${r.codes.length - 3}` : ""}
          </span>
        </span>
      ),
    },
    ...(filter === "all"
      ? [
          {
            h: rank === "revenue" ? "Total" : "Total units",
            num: true,
            render: (r: SkuRow) => (
              <>
                <b>{rank === "revenue" ? formatINR(r.revenue) : n(r.units)}</b>
                <span className="sub">{rank === "revenue" ? `${n(r.units)} units` : formatINR(r.revenue)}</span>
              </>
            ),
          } as TableCol<SkuRow>,
          ...tableChannels.map((ch) => ({ h: SHORT[ch], num: true, render: (r: SkuRow) => cell(r, ch) }) as TableCol<SkuRow>),
          { h: "Share", num: true, render: (r: SkuRow) => `${r.share}%` } as TableCol<SkuRow>,
          {
            h: "Best on",
            render: (r: SkuRow) =>
              r.best ? (
                <span className={c.chName}>
                  <i className={c.sw} style={{ background: COLOR[r.best] }} aria-hidden />
                  {SHORT[r.best]}
                </span>
              ) : (
                "–"
              ),
          } as TableCol<SkuRow>,
        ]
      : [
          { h: `${SHORT[filter]} sales`, num: true, render: (r: SkuRow) => <b>{formatINR(r.byChannel[filter].revenue)}</b> } as TableCol<SkuRow>,
          { h: "Units", num: true, render: (r: SkuRow) => n(r.byChannel[filter].units) } as TableCol<SkuRow>,
          {
            h: `Share of ${SHORT[filter]}`,
            num: true,
            render: (r: SkuRow) =>
              filterTotal && filterTotal > 0 ? `${Math.round((r.byChannel[filter].revenue / filterTotal) * 1000) / 10}%` : "–",
          } as TableCol<SkuRow>,
          {
            h: "All channels",
            num: true,
            render: (r: SkuRow) => (
              <>
                {formatINR(r.revenue)}
                <span className="sub">{n(r.units)} units</span>
              </>
            ),
          } as TableCol<SkuRow>,
        ]),
  ];

  const filterOpts: Filter[] = ["all", ...tableChannels];
  const amazonShort = m.sales.amazon ? m.skuTotals.amazon.revenue - m.sales.amazon.gross : 0;

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={s.kpis}>
          <Kpi hero label={`Sales · ${word}`} value={formatINR(t.revenue)} title="Web store + Amazon + HYPD + other marketplaces. Excludes ₹0.01 creator seed orders.">
            {salesDelta !== null ? (
              <>
                <DeltaText value={salesDelta} /> vs the {word} before
              </>
            ) : null}
          </Kpi>
          <Kpi label="Orders" value={n(t.orders)}>
            {ordersDelta !== null ? (
              <>
                <DeltaText value={ordersDelta} /> vs before
              </>
            ) : (
              `${channels.length} ${channels.length === 1 ? "channel" : "channels"}`
            )}
          </Kpi>
          <Kpi label="Average order" value={formatINR(aov)}>
            {aovDelta !== null ? (
              <>
                <DeltaText value={aovDelta} /> vs before
              </>
            ) : null}
          </Kpi>
        </div>

        <ChartCard
          id="ch-split"
          title="Channel split"
          basis={word}
          takeaway={
            lead ? (
              <>
                {lead.label} brings <em className={s.plain}>{shareOf(lead.revenue)}%</em> of sales
              </>
            ) : (
              "No sales in this period"
            )
          }
        >
          {parts.length > 0 && <StackBar parts={parts} />}
          <div className={c.gapTop}>
            <Table
              cols={chanCols}
              rows={channels}
              rowKey={(r) => r.key}
              card={(r) => ({
                title: (
                  <span className={c.chName}>
                    <i className={c.sw} style={{ background: COLOR[r.key] }} aria-hidden />
                    {r.label}
                  </span>
                ),
                value: formatINR(r.revenue),
                meta: (
                  <>
                    {shareOf(r.revenue)}% · {n(r.orders)} orders{r.orders > 0 ? ` · avg ${formatINR(r.aov)}` : ""}
                    {steadyChange(r.revenue, r.prevRevenue) !== null ? (
                      <>
                        {" · "}
                        <DeltaText value={steadyChange(r.revenue, r.prevRevenue)} />
                      </>
                    ) : null}
                  </>
                ),
              })}
              empty="No channel sales in this period"
            />
          </div>
          {m.sales.amazon && m.sales.amazon.gross !== 0 && (
            <p className={s.note}>
              Amazon is what customers paid, after refunds. After Amazon fees you keep {formatINR(m.sales.amazon.net)}.
            </p>
          )}
        </ChartCard>

        <ChartCard
          id="ch-time"
          title={`Sales per ${unit} by channel`}
          basis={word}
          takeaway={
            buckets.length > 1 ? (
              <>
                Best {unit}: {buckets.reduce((bi, b) => (ORDER.reduce((a, ch) => a + b.v[ch], 0) > ORDER.reduce((a, ch) => a + bi.v[ch], 0) ? b : bi), buckets[0]).label}
              </>
            ) : undefined
          }
        >
          {series.length === 0 ? (
            <p className={s.empty}>No sales in this period</p>
          ) : (
            <BarChart
              cats={buckets.map((b) => b.label)}
              series={series}
              fmt={formatLakh}
              yFormat="money"
              labels={buckets.length <= 16}
              aria={`Sales per ${unit} by channel`}
            />
          )}
          {partial && <p className={s.note}>The first and last bars can cover part of a {unit}. Bars are labelled by their first day.</p>}
        </ChartCard>

        <ChartCard id="ch-best" title="Best product on each channel" basis={word}>
          <div className={c.best}>
            {bestPer.map(({ ch, top, share }) => (
              <div key={ch} className={c.bestC}>
                <span className={c.bestL}>
                  <i className={c.sw} style={{ background: COLOR[ch] }} aria-hidden />
                  {LABEL[ch]}
                </span>
                {top ? (
                  <>
                    <b className={c.bestN} title={top.name}>
                      {shortName(top.name, 48)}
                    </b>
                    <span className={c.bestV}>{formatLakh(top.byChannel[ch].revenue)}</span>
                    <span className={c.bestS}>
                      {n(top.byChannel[ch].units)} units · {share}% of {SHORT[ch]} product sales
                    </span>
                  </>
                ) : (
                  <span className={c.bestS}>No product sales</span>
                )}
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          id="ch-products"
          title="Top products across channels"
          basis={`${skuRows.length} ${skuRows.length === 1 ? "product" : "products"}`}
          takeaway={
            skuRows[0] ? (
              <>
                {shortName(skuRows[0].name)} leads
                {filter === "all" ? (
                  <>
                    {" "}
                    with <em className={s.plain}>{skuRows[0].share}%</em> of product sales
                  </>
                ) : (
                  <> on {LABEL[filter]}</>
                )}
              </>
            ) : undefined
          }
        >
          <div className={c.ctrls}>
            <span className={`pm2-seg ${c.seg}`} role="group" aria-label="Rank by">
              {(["revenue", "units"] as Rank[]).map((r) => (
                <button key={r} type="button" className={rank === r ? "on" : undefined} aria-pressed={rank === r} onClick={() => setRank(r)}>
                  {r === "revenue" ? "By sales" : "By units"}
                </button>
              ))}
            </span>
            <span className={`pm2-seg ${c.seg}`} role="group" aria-label="Channel">
              {filterOpts.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? "on" : undefined}
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setShowAll(false);
                  }}
                >
                  {f === "all" ? "All channels" : SHORT[f]}
                </button>
              ))}
            </span>
          </div>
          <Table
            cols={skuCols}
            rows={visible}
            rowKey={(r) => r.key}
            card={(r) => {
              const v = filter === "all" ? { revenue: r.revenue, units: r.units } : r.byChannel[filter];
              return {
                title: (
                  <>
                    {skuRows.indexOf(r) + 1}. {shortName(r.name, 48)}
                  </>
                ),
                value: rank === "revenue" ? formatINR(v.revenue) : `${n(v.units)} units`,
                meta: (
                  <>
                    {tableChannels
                      .filter((ch) => r.byChannel[ch].revenue !== 0 || r.byChannel[ch].units !== 0)
                      .map((ch, i) => (
                        <Fragment key={ch}>
                          {i > 0 ? " · " : ""}
                          {SHORT[ch]} {formatLakh(r.byChannel[ch].revenue)} ({n(r.byChannel[ch].units)})
                        </Fragment>
                      ))}
                    {r.best && filter === "all" ? ` · best on ${SHORT[r.best]}` : ""}
                  </>
                ),
              };
            }}
            empty="No product sales in this period"
          />
          {skuRows.length > TOP_N && (
            <div className={c.more}>
              <button type="button" className="pm2-btn sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show top ${TOP_N}` : `Show all ${skuRows.length}`}
              </button>
            </div>
          )}
          <SkuNotes matched={m.matchedSkus} amazonGap={amazonShort} />
        </ChartCard>

        <p className={s.footerNote}>
          Web store, HYPD, Amazon and other marketplaces. Excludes ₹0.01 HYPD creator seed orders, ₹0 orders, and voided or refunded
          orders, the same as the Sales tab.
        </p>
      </div>
    </>
  );
}

function SkuNotes({ matched, amazonGap }: { matched: number; amazonGap: number }): ReactNode {
  return (
    <div className={c.notes}>
      <p>
        <Tag tone="grey" size="sm">
          How products match
        </Tag>{" "}
        There is no Amazon to Shopify product mapping yet, so a product only appears in both columns when its Amazon seller SKU is the
        exact same code as the Shopify SKU ({matched} {matched === 1 ? "product does" : "products do"} this period). Other Amazon listings
        show under their Amazon name. Amazon SKUs on the same ASIN are grouped as one listing.
      </p>
      <p>
        Web store and HYPD product sales are units × price before order discounts and shipping, so they do not add up exactly to the channel
        totals above. Amazon product sales are what customers paid after refunds
        {Math.abs(amazonGap) >= 1 ? `. They come from per-SKU finance entries, so they differ from the Amazon channel total by ${formatINR(Math.abs(amazonGap))}` : ""}.
      </p>
    </div>
  );
}
