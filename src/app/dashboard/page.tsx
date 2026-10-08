"use client";

import { Suspense, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  ChevronRight,
  CornerDownRight,
  Mail,
  MessageCircle,
  PackageX,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkle,
  TriangleAlert,
} from "lucide-react";
import { LineChart, StackBar, PeriodPicker, Callout } from "@/components/pm";
import { useShellUser } from "@/components/shell/useShellData";
import { SectionTabs } from "@/components/shell/SectionTabs";
import { useCampaigns } from "@/components/whatsapp/campaigns/api";
import { progressOf } from "@/components/whatsapp/campaigns/logic";
import type { Campaign } from "@/components/whatsapp/types";
import { formatINR, formatLakh } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { SalesMetrics } from "@/lib/metrics/sales-aggregate";
import type { Attention, AttentionItem } from "@/lib/metrics/attention";
import s from "./home.module.css";

type Period = "7d" | "30d" | "90d";
const PERIODS: readonly Period[] = ["7d", "30d", "90d"];
const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };

function parsePeriodParam(raw: string | null): Period {
  return raw === "7d" || raw === "90d" ? raw : "30d";
}

// Time-of-day greeting + the eyebrow date/time, both computed against
// India local time (Asia/Kolkata) so every region renders the same words.
function greetingWord(d: Date): string {
  const hour = Number(
    d.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function eyebrowDate(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
  const day = d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
  const time = d
    .toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${weekday}, ${day} · ${time}`;
}

// Plain-words button label for the top attention item (the page's one red element).
function primaryLabel(item: AttentionItem): string {
  if (item.id === "cod-needs-call") return "Confirm COD orders";
  if (item.id === "wa-tickets-open") return "Answer tickets";
  if (item.id === "email-drafts-pending") return "Review email drafts";
  if (item.id.startsWith("amazon-")) return "Restock Amazon";
  if (item.id.startsWith("campaign-paused-")) return "View campaign";
  return item.cta;
}

function itemIcon(item: AttentionItem): ReactNode {
  if (item.id === "cod-needs-call") return <PhoneCall />;
  if (item.id === "wa-tickets-open") return <AlarmClock />;
  if (item.id === "email-drafts-pending") return <Mail />;
  if (item.id.startsWith("amazon-")) return <PackageX />;
  if (item.id.startsWith("campaign-")) return <MessageCircle />;
  return <TriangleAlert />;
}

// The top item as a sentence fragment. Titles are already plain words that
// start with a count or a name, so they are used as written.
function topPhrase(item: AttentionItem): string {
  return item.id.startsWith("campaign-paused-")
    ? `${item.title}, paused by Meta's daily limit`
    : item.title;
}

function DeltaText({
  value,
  suffix,
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value === null || !Number.isFinite(value)) return null;
  const r = Math.round(value);
  const cls = r > 0 ? s.up : r < 0 ? s.down : s.flat;
  const txt = r === 0 ? "±0%" : `${r > 0 ? "▲" : "▼"} ${Math.abs(r)}%`;
  return (
    <span className={cls}>
      {txt}
      {suffix}
    </span>
  );
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

function DashboardPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parsePeriodParam(params.get("period"));
  const days = PERIOD_DAYS[period];

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(params.toString());
      if (p === "30d") q.delete("period");
      else q.set("period", p);
      router.replace(`/dashboard${q.toString() ? `?${q}` : ""}`);
    },
    [router, params],
  );

  const { user } = useShellUser();
  const firstName = (user?.name || "").split(/\s+/)[0] || "there";
  const now = new Date();

  const salesQ = useQuery({
    queryKey: ["metrics-sales", period],
    queryFn: async () => {
      const r = await fetch(`/api/metrics/sales?period=${period}`, {
        cache: "no-store",
      });
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
      return r.json() as Promise<{
        aiReplies24h: number | null;
        failedOutbound24h: number | null;
      }>;
    },
  });

  // Same query (and cache key) the WhatsApp campaigns screen uses.
  const campaignsQ = useCampaigns();

  const sales = salesQ.data;
  const attention = attentionQ.data;
  const items = attention?.items ?? [];
  const top = items[0];
  const openCount = attention?.counts.open ?? items.length;
  const salesDelta = sales
    ? pctChange(sales.total.revenue, sales.total.prevRevenue)
    : null;

  const summary = (() => {
    const parts: ReactNode[] = [];
    if (sales && salesDelta !== null) {
      const r = Math.round(salesDelta);
      parts.push(
        <span key="s">
          Sales are{" "}
          <b>{r === 0 ? "flat" : `${r > 0 ? "up" : "down"} ${Math.abs(r)}%`}</b>{" "}
          on the {days} days before.{" "}
        </span>,
      );
    } else if (sales) {
      parts.push(
        <span key="s">
          <b>{formatLakh(sales.total.revenue)}</b> in sales over the last {days}{" "}
          days.{" "}
        </span>,
      );
    }
    if (attention) {
      if (top) {
        parts.push(
          <span key="a">
            <b>
              {openCount} {openCount === 1 ? "thing needs" : "things need"} you
            </b>
            , starting with {topPhrase(top)}.
          </span>,
        );
      } else {
        parts.push(<span key="a">Nothing needs you right now.</span>);
      }
    }
    return parts;
  })();

  const header = (
    <>
      <header className={s.ph}>
        <div className={s.phText}>
          <span className={s.eyebrow} suppressHydrationWarning>
            ★ {eyebrowDate(now)}
          </span>
          <h1 className={s.title} suppressHydrationWarning>
            Good {greetingWord(now)}, {firstName}.
          </h1>
          {summary.length > 0 && <p className={s.sum}>{summary}</p>}
        </div>
        <div className={s.acts}>
          <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} />
          {top && (
            <Link href={top.href} className={`pm2-btn pri ${s.primary}`}>
              {primaryLabel(top)}
            </Link>
          )}
        </div>
      </header>
      <SectionTabs />
    </>
  );

  if (salesQ.isLoading) {
    return (
      <>
        {header}
        <HomeFallback />
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
            body={
              salesQ.error instanceof Error
                ? salesQ.error.message
                : "Something went wrong."
            }
            action={
              <button
                type="button"
                className="pm2-btn sm"
                onClick={() => salesQ.refetch()}
              >
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const health = healthQ.data;
  const web = sales.channels.find((c) => c.key === "web");
  const amazonCh = sales.channels.find((c) => c.key === "amazon");
  const hypd = sales.channels.find((c) => c.key === "hypd");
  const cod = items.find((i) => i.id === "cod-needs-call");
  const topItems = items.slice(0, 5);

  const running = (campaignsQ.data ?? [])
    .filter(
      (c) =>
        c.status === "sending" ||
        c.status === "paused" ||
        c.status === "scheduled",
    )
    .sort((a, b) => statusRank(a) - statusRank(b))
    .slice(0, 3);

  const dailyLabels = sales.daily.map((d) =>
    new Date(d.date).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    }),
  );
  const prevTotal = sales.total.prevRevenue;
  const channelParts = [
    { label: "Web store", revenue: web?.revenue ?? 0 },
    { label: "Amazon", revenue: amazonCh?.revenue ?? 0 },
    { label: "HYPD", revenue: hypd?.revenue ?? 0 },
  ];
  const channelSum = channelParts.reduce((t, c) => t + c.revenue, 0);
  const leadCh =
    channelSum > 0
      ? [...channelParts].sort((x, y) => y.revenue - x.revenue)[0]
      : null;
  const lead = leadCh
    ? {
        label: leadCh.label,
        share: Math.round((leadCh.revenue / channelSum) * 100),
      }
    : null;

  return (
    <>
      {header}
      <div className="pm2-body">
        {/* ---- KPI tiles ---- */}
        <div className={s.kpis}>
          <Link
            href="/dashboard/sales"
            className={`${s.kpi} ${s.hero}`}
            title="Web store + Amazon + HYPD. Excludes ₹0.01 creator seed orders and refunds."
          >
            <span className={s.kpiL}>
              Sales · {days} days
              <ArrowRight />
            </span>
            <span className={s.kpiV}>{formatINR(sales.total.revenue)}</span>
            <span className={s.kpiD}>
              <DeltaText value={salesDelta} /> vs the {days} days before · all
              channels
            </span>
          </Link>
          <Link href="/dashboard/sales/orders" className={s.kpi}>
            <span className={s.kpiL}>
              Orders
              <ArrowRight />
            </span>
            <span className={s.kpiV}>
              {sales.total.orders.toLocaleString("en-IN")}
            </span>
            <span className={s.kpiD}>
              {cod?.count != null && (
                <span>
                  {cod.count.toLocaleString("en-IN")} COD to confirm ·
                </span>
              )}
              <DeltaText
                value={pctChange(sales.total.orders, sales.total.prevOrders)}
              />
            </span>
          </Link>
          <Link href="/dashboard/attention" className={s.kpi}>
            <span className={s.kpiL}>
              Needs you
              <ArrowRight />
            </span>
            <span className={s.kpiV}>
              {attention ? openCount.toLocaleString("en-IN") : "–"}
            </span>
            <span className={s.kpiD}>
              {attention
                ? `${attention.counts.orders.toLocaleString("en-IN")} orders · ${attention.counts.inbox.toLocaleString("en-IN")} in the inbox`
                : attentionQ.isError
                  ? "Couldn't load"
                  : "Loading…"}
            </span>
          </Link>
        </div>

        {/* ---- Needs you + side column ---- */}
        <div className={s.g21}>
          <section
            className={`${s.card} ${s.flush}`}
            aria-labelledby="home-needs-you"
          >
            <div className={s.secT}>
              <h3 id="home-needs-you">Needs you</h3>
              {items.length > 0 && (
                <Link className={s.txtLink} href="/dashboard/attention">
                  See all {openCount}
                  <ArrowRight />
                </Link>
              )}
            </div>
            {attentionQ.isLoading ? (
              <p className={s.empty}>Loading…</p>
            ) : attentionQ.isError ? (
              <p className={s.empty}>
                Couldn&apos;t load what needs you. Try again in a moment.
              </p>
            ) : topItems.length === 0 ? (
              <p className={s.empty}>Nothing waiting on you right now.</p>
            ) : (
              topItems.map((it) => (
                <Link key={it.id} href={it.href} className={s.todo}>
                  <span className={`${s.ic} ${s[it.severity]}`} aria-hidden>
                    {itemIcon(it)}
                  </span>
                  <span className={s.tx}>
                    <b>{it.title}</b>
                    <span>{it.context}</span>
                  </span>
                  {it.amount != null && (
                    <span
                      className={`${s.goV}${it.severity === "crit" ? ` ${s.crit}` : ""}`}
                    >
                      {formatINR(it.amount)}
                      {it.amountLabel && <small>{it.amountLabel}</small>}
                    </span>
                  )}
                  <ChevronRight className={s.goC} aria-hidden />
                </Link>
              ))
            )}
          </section>

          <div className={s.stack}>
            <section
              className={`${s.card} ${s.maya}`}
              aria-labelledby="home-maya"
            >
              <div className={s.mayaHead}>
                <span className={s.mayaIc} aria-hidden>
                  <Sparkle />
                </span>
                <div>
                  <h3 id="home-maya">Ask Maya</h3>
                  <p>Your data, in plain answers.</p>
                </div>
              </div>
              <Link className={s.mayaAsk} href="/dashboard/assistant">
                <Search aria-hidden />
                Ask anything about sales, customers…
              </Link>
              <div className={s.qs}>
                {[
                  salesDelta !== null && salesDelta < 0
                    ? `Why are sales down this ${days === 7 ? "week" : "month"}?`
                    : `Why are sales up this ${days === 7 ? "week" : "month"}?`,
                  "Which customers should we win back?",
                ].map((q) => (
                  <Link
                    key={q}
                    className={s.q}
                    href={`/dashboard/assistant?q=${encodeURIComponent(q)}`}
                  >
                    <CornerDownRight aria-hidden />
                    {q}
                  </Link>
                ))}
              </div>
            </section>

            {campaignsQ.data && (
              <section className={s.card} aria-labelledby="home-running">
                <div className={s.secT}>
                  <h3 id="home-running">Running now</h3>
                  <Link
                    className={s.txtLink}
                    href="/dashboard/whatsapp/campaigns"
                  >
                    All
                    <ArrowRight />
                  </Link>
                </div>
                {running.length === 0 ? (
                  <p className={s.runEmpty}>
                    No WhatsApp campaigns sending or scheduled.
                  </p>
                ) : (
                  <div className={s.run}>
                    {running.map((c) => (
                      <RunningRow key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* ---- Sales chart + channel split ---- */}
        <div className={s.g21}>
          <section className={s.card} aria-labelledby="home-sales">
            <div className={s.secT}>
              <h3 id="home-sales">Sales, last {days} days</h3>
              <Link className={s.txtLink} href="/dashboard/sales">
                Sales
                <ArrowRight />
              </Link>
            </div>
            <p className={s.takeaway}>
              {formatLakh(sales.total.revenue)}
              {salesDelta !== null ? (
                <>
                  ,{" "}
                  <em
                    className={Math.round(salesDelta) < 0 ? s.neg : undefined}
                  >
                    {Math.round(salesDelta) === 0
                      ? "level"
                      : `${salesDelta > 0 ? "up" : "down"} ${Math.abs(Math.round(salesDelta))}%`}
                  </em>{" "}
                  on the {days} days before
                </>
              ) : prevTotal === 0 ? (
                " this period, nothing in the period before"
              ) : null}
            </p>
            <LineChart
              series={[
                {
                  name: "This period",
                  color: "var(--pm-s-web)",
                  values: sales.daily.map((d) => d.revenue),
                },
                {
                  name: "Before",
                  color: "#CFC7B9",
                  dash: true,
                  values: sales.daily.map((d) => d.prevRevenue),
                },
              ]}
              labels={dailyLabels}
              yFormat="money"
              fmt={formatLakh}
              aria={`Daily sales, this ${days}-day period vs the previous ${days} days`}
            />
            <div className={s.keys}>
              <span>
                <i style={{ background: "var(--pm-s-web)" }} />
                Last {days} days
              </span>
              <span>
                <i style={{ background: "#CFC7B9" }} />
                {days} days before (dashed)
              </span>
            </div>
          </section>

          <section className={s.card} aria-labelledby="home-channels">
            <div className={s.secT}>
              <h3 id="home-channels">By channel</h3>
            </div>
            {lead && (
              <p className={s.takeaway}>
                {lead.label} brings <em className={s.plain}>{lead.share}%</em>{" "}
                of sales
              </p>
            )}
            <span className={s.splitT}>{days} days · gross</span>
            <StackBar
              parts={[
                {
                  label: "Web",
                  value: web?.revenue ?? 0,
                  text: formatLakh(web?.revenue ?? 0),
                  color: "var(--pm-s-web)",
                },
                {
                  label: "Amazon",
                  value: amazonCh?.revenue ?? 0,
                  text: formatLakh(amazonCh?.revenue ?? 0),
                  color: "var(--pm-s-amz)",
                },
                {
                  label: "HYPD",
                  value: hypd?.revenue ?? 0,
                  text: formatLakh(hypd?.revenue ?? 0),
                  color: "var(--pm-s-hypd)",
                },
              ]}
              legendExtra={
                health?.aiReplies24h != null ? (
                  <span>
                    <b>{health.aiReplies24h.toLocaleString("en-IN")}</b>{" "}
                    WhatsApp AI replies today
                  </span>
                ) : undefined
              }
            />
          </section>
        </div>
      </div>
    </>
  );
}

function statusRank(c: Campaign): number {
  return c.status === "sending" ? 0 : c.status === "paused" ? 1 : 2;
}

function RunningRow({ c }: { c: Campaign }) {
  const p = progressOf(c);
  const tag =
    c.status === "sending"
      ? { cls: s.good, text: c.resume_at ? "Resumes later" : "Sending" }
      : c.status === "paused"
        ? { cls: s.warn, text: "Paused" }
        : { cls: s.info, text: "Scheduled" };
  const when =
    c.status === "scheduled" && c.scheduled_at
      ? new Date(c.scheduled_at).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
  return (
    <Link className={s.rn} href={`/dashboard/whatsapp/campaigns/${c.id}`}>
      <span className={s.cj} aria-hidden>
        <MessageCircle />
      </span>
      <span className={s.rnM}>
        <span className={s.rnT}>
          <b>{c.name}</b>
          <span className={`${s.tg} ${tag.cls}`}>{tag.text}</span>
        </span>
        {c.status !== "scheduled" && p.percent != null && (
          <span className={s.bar}>
            <i style={{ width: `${p.percent}%` }} />
          </span>
        )}
        <span className={s.rnS}>
          {when
            ? `Starts ${when} · WhatsApp`
            : `${p.reached.toLocaleString("en-IN")}${p.total ? ` of ${p.total.toLocaleString("en-IN")}` : ""} sent · WhatsApp`}
        </span>
      </span>
    </Link>
  );
}
