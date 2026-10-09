"use client";

// Insights → What people buy (prototype an-products). Website orders: sales
// by product, products bought together, order sizes around the ₹599
// free-shipping line, and which first product brings buyers back. Reads
// GET /api/metrics/buyers?view=products only.

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { BarChart, Callout, HBars, Table } from "@/components/pm";
import type { HBarItem, TableCol } from "@/components/pm";
import { formatLakh } from "@/lib/metrics/money";
import { FREE_SHIPPING_FROM, type ProductMetrics } from "@/lib/metrics/buyers-aggregate";
import { InsightsHead, PeriodSeg, ChartCard, shortName } from "../insights-ui";
import s from "../insights.module.css";
import b from "../buyers.module.css";

type Period = "30d" | "90d";
const PERIODS: readonly Period[] = ["30d", "90d"];
const PERIOD_LABEL: Record<Period, string> = { "30d": "30 days", "90d": "90 days" };

type FirstRow = ProductMetrics["firstProduct"][number];

// Short axis labels (fit six bars at 390 px); same order as the API's sizes.
const SIZE_SHORT = ["<₹400", "₹400+", "₹600+", "₹800+", "₹1k+", "₹1.5k+"];

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" style={{ minHeight: 400 }} /></div>}>
      <ProductsInner />
    </Suspense>
  );
}

function ProductsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period: Period = params.get("period") === "90d" ? "90d" : "30d";
  const setPeriod = useCallback(
    (p: Period) => router.replace(`/dashboard/sales/products${p === "30d" ? "" : "?period=90d"}`),
    [router],
  );

  const q = useQuery({
    queryKey: ["metrics-buyers", "products", period],
    queryFn: async (): Promise<ProductMetrics> => {
      const r = await fetch(`/api/metrics/buyers?view=products&period=${period}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) throw new Error(d.error || `products ${r.status}`);
      return d as ProductMetrics;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const m = q.data;
  const word = PERIOD_LABEL[period];

  const best = m?.firstProduct.length ? [...m.firstProduct].sort((a, b2) => b2.pct - a.pct)[0] : null;
  const topFirst = best && best.pct > 0 ? best : null;
  const summary = m ? (
    m.products.length ? (
      <>
        <b>{shortName(m.products[0].title, 40)}</b> sold the most in the last {word}.
        {topFirst ? (
          <>
            {" "}
            People who start with <b>{shortName(topFirst.label, 40)}</b> come back the most.
          </>
        ) : null}
      </>
    ) : (
      <>No website orders in the last {word}.</>
    )
  ) : undefined;

  const header = <InsightsHead title="What people buy" summary={summary} actions={<PeriodSeg options={PERIODS} value={period} onChange={setPeriod} />} />;

  if (q.isError && !m) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load products"
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
  if (!m) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <div className={s.g2}>
            <div className="pm2-skel" style={{ minHeight: 280 }} />
            <div className="pm2-skel" style={{ minHeight: 280 }} />
          </div>
        </div>
      </>
    );
  }

  const prodItems: HBarItem[] = m.products.map((p) => ({
    label: p.title,
    value: p.revenue,
    text: formatLakh(p.revenue),
    sub: `${p.units.toLocaleString("en-IN")} sold`,
  }));
  const freeIdx = m.sizes.findIndex((x) => x.label.startsWith("₹600"));
  const firstCols: TableCol<FirstRow>[] = [
    { h: "First order had", render: (r) => <b>{r.label}</b> },
    { h: "Buyers", num: true, render: (r) => r.buyers.toLocaleString("en-IN") },
    { h: "Came back", num: true, render: (r) => <b className={topFirst && r.label === topFirst.label ? s.up : undefined}>{r.pct}%</b> },
  ];

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={s.g2}>
          <ChartCard id="ins-buy-products" title="Sales by product" basis={`last ${word}`}>
            {prodItems.length ? <HBars items={prodItems} /> : <p className={s.empty}>No product sales in this period.</p>}
          </ChartCard>

          <ChartCard id="ins-buy-pairs" title="Bought together" basis={`${m.multiItemOrders.toLocaleString("en-IN")} orders with 2+ products`}>
            {m.pairs.length ? (
              <div className={b.pairs}>
                {m.pairs.map((p) => (
                  <div key={`${p.a}|${p.b}`} className={b.pair}>
                    <b>
                      {shortName(p.a, 36)} + {shortName(p.b, 36)}
                    </b>
                    <span>
                      In {p.pct}% of orders with 2+ products ({p.orders.toLocaleString("en-IN")})
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={s.empty}>No orders with more than one product in this period.</p>
            )}
          </ChartCard>
        </div>

        <div className={s.g2}>
          <ChartCard
            id="ins-buy-sizes"
            title="Order sizes"
            basis={`${m.orders.toLocaleString("en-IN")} orders`}
            takeaway={
              m.orders ? (
                <>
                  <em className={s.plain}>{m.justAboveFreeShipping.toLocaleString("en-IN")}</em> orders sit just above the ₹{FREE_SHIPPING_FROM} free-shipping line
                </>
              ) : undefined
            }
          >
            <BarChart
              cats={SIZE_SHORT}
              series={[{ name: "Orders", color: "var(--pm-cyan)", values: m.sizes.map((x) => x.orders) }]}
              labels
              highlight={freeIdx >= 0 ? freeIdx : undefined}
              aria="Orders by order value"
              height={190}
            />
            <p className={s.note}>Just above means ₹{FREE_SHIPPING_FROM} to ₹{FREE_SHIPPING_FROM + 200}.</p>
          </ChartCard>

          <ChartCard id="ins-buy-first" title="First product, came back?" basis="new buyers, first order 1 to 6 months ago">
            <Table
              cols={firstCols}
              rows={m.firstProduct}
              rowKey={(r) => r.label}
              card={(r) => ({ title: r.label, value: `${r.pct}% came back`, meta: `${r.buyers.toLocaleString("en-IN")} buyers` })}
              empty="Not enough first orders yet (each row needs 5 buyers)."
            />
          </ChartCard>
        </div>

        <p className={s.footerNote}>
          promunch.in orders only. Product names as on the order. Excludes HYPD creator seeds, refunds and ₹0 orders. The period picker changes
          the first three cards; the last one always looks at first orders 1 to 6 months old.
        </p>
      </div>
    </>
  );
}
