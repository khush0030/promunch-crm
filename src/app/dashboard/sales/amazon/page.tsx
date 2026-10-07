"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw, DownloadCloud } from "lucide-react";
import { Callout, PeriodPicker } from "@/components/pm";
import type { PageHeaderTab } from "@/components/pm";
import { formatLakh } from "@/lib/metrics/money";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import type { AmazonTabKey } from "./types";
import { timeAgo, PERIOD_LABEL } from "./format";
import { InsightsHead, shortName } from "../insights-ui";
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

  const setQuery = useCallback(
    (next: { period?: Period; tab?: AmazonTabKey }) => {
      const q = new URLSearchParams(params.toString());
      const p = next.period ?? period;
      const t = next.tab ?? tab;
      if (p === "30d") q.delete("period");
      else q.set("period", p);
      if (t === "overview") q.delete("tab");
      else q.set("tab", t);
      const qs = q.toString();
      router.replace(`/dashboard/sales/amazon${qs ? `?${qs}` : ""}`);
    },
    [router, params, period, tab],
  );

  const setPeriod = useCallback((p: Period) => setQuery({ period: p }), [setQuery]);
  const setTab = useCallback((t: AmazonTabKey) => setQuery({ tab: t }), [setQuery]);

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

  const tabs: PageHeaderTab[] = [
    { label: "Overview", key: "overview" },
    { label: "Stock", key: "stock", count: data?.stock.atRisk },
    { label: "Product profit", key: "profit" },
    { label: "Payouts", key: "payouts" },
    { label: "Orders", key: "orders" },
  ];

  // One plain-words summary from real data: what Amazon paid out of what
  // customers paid, and the worst stock fact.
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
                Amazon paid you <b>{formatLakh(money.paidToYou)}</b> from {formatLakh(money.customersPaid)} of sales in{" "}
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
      tabs={tabs}
      activeTab={tab}
      onTab={(k) => setTab(k as AmazonTabKey)}
      actions={
        <>
          <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} />
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
        {tab === "overview" && <OverviewTab data={data} onTab={setTab} />}
        {tab === "stock" && <StockTab data={data} />}
        {tab === "profit" && <ProfitTab data={data} onCostSaved={refetchFresh} />}
        {tab === "payouts" && <PayoutsTab data={data} />}
        {tab === "orders" && <OrdersTab data={data} />}
      </div>
    </>
  );
}
