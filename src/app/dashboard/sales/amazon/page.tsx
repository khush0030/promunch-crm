"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw, DownloadCloud } from "lucide-react";
import { Callout } from "@/components/pm";
import { formatLakh } from "@/lib/metrics/money";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import type { AmazonTabKey } from "./types";
import { timeAgo, PERIOD_LABEL } from "./format";
import { InsightsHead, PeriodSeg, shortName } from "../insights-ui";
import s from "../insights.module.css";
import { OverviewTab } from "./tabs/Overview";
import { StockTab } from "./tabs/Stock";
import { ProfitTab } from "./tabs/Profit";
import { PayoutsTab } from "./tabs/Payouts";
import { OrdersTab } from "./tabs/Orders";

type Period = "7d" | "30d" | "90d";
const PERIODS: readonly Period[] = ["7d", "30d", "90d"];


function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" ? raw : "30d";
}

function parseTabParam(raw: string | null): AmazonTabKey {
  return raw === "stock" || raw === "profit" || raw === "payouts" || raw === "orders" ? raw : "overview";
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function AmazonSalesPage() {
  return (
    <Suspense fallback={<AmazonFallback />}>
      <AmazonSalesPageInner />
    </Suspense>
  );
}

function AmazonFallback() {
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

function AmazonSalesPageInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));
  const tab = parseTabParam(params.get("tab"));

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(params.toString());
      if (p === "30d") q.delete("period");
      else q.set("period", p);
      const qs = q.toString();
      router.replace(`/dashboard/sales/amazon${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, params],
  );

  // One sectioned page (prototype an-amazon). The old sub-tabs live on as
  // anchors: ?tab=stock|profit|payouts|orders scrolls to that section.
  const goTo = useCallback((t: AmazonTabKey) => {
    const el = document.getElementById(`amazon-${t}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const amzQ = useQuery({
    queryKey: ["metrics-amazon", period],
    queryFn: async () => {
      const r = await fetch(`/api/amazon?period=${period}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`amazon ${r.status}`);
      const d = await r.json();
      if (d?.ok === false) throw new Error(d.error || "amazon metrics failed");
      return d as AmazonMetrics;
    },
    placeholderData: keepPreviousData,
  });

  // The route caches its response for 60s per period, so a plain refetch
  // right after a write (a saved cost price, a triggered sync) can echo the
  // stale cache back. `?fresh=1` bypasses it and re-seeds the query cache
  // directly so the UI reflects the change immediately.
  const refetchFresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/amazon?period=${period}&fresh=1`, { cache: "no-store" });
      const d = await r.json();
      if (d?.ok !== false) queryClient.setQueryData(["metrics-amazon", period], d);
    } catch {
      // best-effort — the normal 60s cache will pick it up shortly regardless
    }
  }, [period, queryClient]);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/amazon", { method: "POST" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.detail || "sync failed");
      await refetchFresh();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "sync failed");
    } finally {
      setSyncing(false);
    }
  }, [refetchFresh]);

  const data = amzQ.data;
  const hasData = !!data;
  const scrolled = useRef(false);
  useEffect(() => {
    if (!hasData || scrolled.current) return;
    scrolled.current = true;
    if (tab !== "overview") requestAnimationFrame(() => goTo(tab));
  }, [hasData, tab, goTo]);

  // One plain-words summary from real data: what you earned (customer
  // payments minus Amazon's fees and refunds, money.paidToYou) out of what
  // customers paid, and the worst stock fact. This is NOT the bank deposit
  // total; that is payouts.paidOut, shown as "Settled to your bank".
  const summary = data
    ? (() => {
        const { money, skus } = data;
        const oos = skus.filter((x) => x.outOfStock);
        const soonest = skus
          .filter((x) => typeof x.daysLeft === "number" && x.daysLeft < 14)
          .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))[0];
        const share = money.customersPaid > 0 ? Math.round((money.paidToYou / money.customersPaid) * 100) : null;
        return (
          <>
            {share != null ? (
              <>
                You earned <b>{formatLakh(money.paidToYou)}</b> after Amazon&apos;s fees, from {formatLakh(money.customersPaid)} of sales in{" "}
                {PERIOD_LABEL[period]} ({share}%).{" "}
              </>
            ) : (
              <>No Amazon sales in the last {PERIOD_LABEL[period]}. </>
            )}
            {oos.length > 1 ? (
              <b>{oos.length} products are out of stock.</b>
            ) : oos.length === 1 ? (
              <b>{shortName(oos[0].shortTitle)} is out of stock.</b>
            ) : soonest ? (
              <b>
                {shortName(soonest.shortTitle)} runs out in {soonest.daysLeft as number} {soonest.daysLeft === 1 ? "day" : "days"}.
              </b>
            ) : null}
          </>
        );
      })()
    : null;

  const header = (
    <InsightsHead
      title="Amazon"
      summary={summary}
      actions={
        <>
          <PeriodSeg options={PERIODS} value={period} onChange={setPeriod} />
          <span className={`${s.synced} pm2-d-only`}>{data ? `synced ${timeAgo(data.sync.lastSyncedAt)}` : ""}</span>
          <button type="button" className="pm2-btn ghost pm2-d-only" disabled={syncing} onClick={syncNow}>
            <DownloadCloud size={14} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
        </>
      }
    />
  );

  if (amzQ.isLoading) {
    return (
      <>
        {header}
        <AmazonFallback />
      </>
    );
  }

  if (amzQ.isError || !data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load Amazon data"
            body={amzQ.error instanceof Error ? amzQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn sm" onClick={() => amzQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="pm2-body">
        {syncError && (
          <Callout
            tone="plain"
            title="Sync failed"
            body={syncError}
            action={
              <button type="button" className="pm2-btn sm" onClick={syncNow}>
                Retry
              </button>
            }
          />
        )}
        <section id="amazon-overview" className={s.anchor} aria-label="Overview">
          <OverviewTab data={data} onTab={goTo} />
        </section>
        <section id="amazon-stock" className={s.anchor} aria-label="Stock">
          <StockTab data={data} />
        </section>
        <section id="amazon-profit" className={s.anchor} aria-label="Product profit">
          <ProfitTab data={data} onCostSaved={refetchFresh} />
        </section>
        <section id="amazon-payouts" className={s.anchor} aria-label="Payouts">
          <PayoutsTab data={data} />
        </section>
        <section id="amazon-orders" className={s.anchor} aria-label="Amazon orders">
          <OrdersTab data={data} />
        </section>
      </div>
    </>
  );
}
