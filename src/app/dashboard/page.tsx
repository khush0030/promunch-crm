"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PageHeader, KpiStrip, Kpi, Card, LineChart, StackBar, AttentionList, PeriodPicker, Callout } from "@/components/pm";
import { useShellUser } from "@/components/shell/useShellData";
import { formatLakh } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { SalesMetrics } from "@/lib/metrics/sales-aggregate";
import type { Attention } from "@/lib/metrics/attention";

type Period = "7d" | "30d" | "90d";
const PERIODS: readonly Period[] = ["7d", "30d", "90d"];
const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" ? raw : "30d";
}

// Time-of-day greeting + the display title date, both computed against
// India local time (Asia/Kolkata) so the server render and the client
// hydration agree regardless of which region the request is served from.
function greetingWord(d: Date): string {
  const hour = Number(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function titleDate(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "long" });
  const day = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long" });
  return `${weekday}, ${day}`;
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function DashboardPage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <DashboardPageInner />
    </Suspense>
  );
}

function HomeFallback() {
  return (
    <div className="pm2-body">
      <KpiStrip>
        <Kpi label="Sales" value="—" sub="—" />
        <Kpi label="Web store" value="—" sub="—" />
        <Kpi label="Amazon payout" value="—" sub="—" />
        <Kpi label="Repeat buyers" value="—" sub="—" />
      </KpiStrip>
      <div className="pm2-skel" />
      <div className="pm2-g21">
        <div className="pm2-skel" />
        <div className="pm2-skel" />
      </div>
    </div>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));
  const days = PERIOD_DAYS[period];

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams();
      if (p !== "30d") q.set("period", p);
      router.replace(`/dashboard${q.toString() ? `?${q}` : ""}`);
    },
    [router],
  );

  const { user } = useShellUser();
  const firstName = (user?.name || "").split(/\s+/)[0] || "there";
  const now = new Date();

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

  const attentionQ = useQuery({
    queryKey: ["metrics-attention"],
    queryFn: async () => {
      const r = await fetch("/api/metrics/attention", { cache: "no-store" });
      if (!r.ok) throw new Error(`attention ${r.status}`);
      return (await r.json()) as Attention;
    },
  });

  const healthQ = useQuery({
    queryKey: ["wa-health-home"],
    queryFn: async () => {
      const r = await fetch("/api/whatsapp/health", { cache: "no-store" });
      if (!r.ok) throw new Error(`wa-health ${r.status}`);
      return r.json() as Promise<{ aiReplies24h: number | null; failedOutbound24h: number | null }>;
    },
  });

  const header = (
    <PageHeader
      crumb={`Today · Good ${greetingWord(now)}, ${firstName}`}
      title={titleDate(now)}
      actions={
        <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} caption={`vs previous ${days} days`} />
      }
    />
  );

  if (salesQ.isLoading) {
    return (
      <>
        {header}
        <HomeFallback />
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
  const web = sales.channels.find((c) => c.key === "web");
  const amazonRevChannel = sales.channels.find((c) => c.key === "amazon");
  const amazon = sales.amazon;
  const attention = attentionQ.data;
  const health = healthQ.data;

  const topAttention = attention?.items.slice(0, 4) ?? [];
  const restTitles = attention ? attention.items.slice(4, 6).map((i) => i.title) : [];
  const openCount = attention?.counts.open ?? 0;

  const dailyLabels = sales.daily.map((d) =>
    new Date(d.date).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }),
  );

  return (
    <>
      {header}
      <div className="pm2-body">
        <KpiStrip>
          <Kpi
            label="Sales"
            value={formatLakh(sales.total.revenue)}
            delta={pctChange(sales.total.revenue, sales.total.prevRevenue)}
            sub={`${sales.total.orders.toLocaleString("en-IN")} orders`}
            tip="Web store + Amazon + HYPD. Excludes ₹0.01 creator seed orders and refunds."
          />
          <Kpi
            label="Web store"
            value={formatLakh(web?.revenue ?? 0)}
            delta={web ? pctChange(web.revenue, web.prevRevenue) : null}
            sub={`${(web?.orders ?? 0).toLocaleString("en-IN")} orders`}
          />
          <Kpi
            label="Amazon payout"
            value={formatLakh(amazon?.net ?? 0)}
            delta={amazon ? pctChange(amazon.net, amazon.prevNet) : null}
            sub="after fees"
            tip="What Amazon pays out after referral, FBA and closing fees. Before your product cost."
          />
          <Kpi
            label="Repeat buyers"
            value={`${Math.round(sales.repeat.pct)}%`}
            delta={Math.round(sales.repeat.pct - sales.repeat.prevPct)}
            deltaUnit="pts"
            sub="of orders"
          />
        </KpiStrip>

        <Card
          title={`Needs a decision · ${openCount}`}
          flush
          foot={
            topAttention.length > 0 ? (
              <>
                <Link href="/dashboard/attention" className="pm2-lnk">
                  All {openCount} →
                </Link>
                {restTitles.length > 0 && (
                  <span style={{ color: "var(--pm-hint)", marginLeft: "auto" }}>{restTitles.join(" · ")}</span>
                )}
              </>
            ) : undefined
          }
        >
          <AttentionList
            items={topAttention}
            empty={
              <div style={{ color: "var(--pm-hint)", fontSize: 13, padding: "16px" }}>
                Nothing waiting on you right now
              </div>
            }
          />
        </Card>

        <div className="pm2-g21">
          <Card title="Daily sales" basis="₹ per day · all channels">
            <LineChart
              series={[
                { name: "This period", color: "var(--pm-s-web)", values: sales.daily.map((d) => d.revenue) },
                { name: "Previous", color: "var(--pm-hint)", dash: true, values: sales.daily.map((d) => d.prevRevenue) },
              ]}
              labels={dailyLabels}
              yFormat="money"
              fmt={formatLakh}
              aria={`Daily sales, this ${days}-day period vs the previous ${days} days`}
            />
          </Card>

          <Card title="By channel" basis={`${days} days · gross`}>
            <StackBar
              parts={[
                { label: "Web", value: web?.revenue ?? 0, text: formatLakh(web?.revenue ?? 0), color: "var(--pm-s-web)" },
                {
                  label: "Amazon",
                  value: amazonRevChannel?.revenue ?? 0,
                  text: formatLakh(amazonRevChannel?.revenue ?? 0),
                  color: "var(--pm-s-amz)",
                },
                {
                  label: "HYPD",
                  value: sales.channels.find((c) => c.key === "hypd")?.revenue ?? 0,
                  text: formatLakh(sales.channels.find((c) => c.key === "hypd")?.revenue ?? 0),
                  color: "var(--pm-s-hypd)",
                },
              ]}
            />
            {health?.aiReplies24h != null && (
              <div className="pm2-legend" style={{ marginTop: 16 }}>
                <span>
                  <b>{health.aiReplies24h.toLocaleString("en-IN")}</b> AI replies today
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
