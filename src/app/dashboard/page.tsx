"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  PartyPopper,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkle,
  TriangleAlert,
} from "lucide-react";
import { Callout } from "@/components/pm";
import { useShellUser } from "@/components/shell/useShellData";
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
const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};
const DEFAULT_PERIOD: Period = "7d";

function parsePeriodParam(raw: string | null): Period {
  return raw === "30d" || raw === "90d" ? raw : DEFAULT_PERIOD;
}

// Hero tile label: "Sales this week" for 7 days, else the window in words.
function salesLabel(days: number): string {
  return days === 7 ? "Sales this week" : `Sales · last ${days} days`;
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
      if (p === DEFAULT_PERIOD) q.delete("period");
      else q.set("period", p);
      router.replace(`/dashboard${q.toString() ? `?${q}` : ""}`);
    },
    [router, params],
  );

  // full_name (first word) when set, else the email prefix (useShellUser
  // already falls back to it). Shown uppercase by the display type.
  const { user } = useShellUser();
  const firstName = (user?.name || user?.email?.split("@")[0] || "").split(
    /\s+/,
  )[0];
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
        parts.push(
          <span key="a">Quiet one. Nothing needs you right now.</span>,
        );
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
            Good {greetingWord(now)}
            {firstName ? `, ${firstName}` : ""}.
          </h1>
          {summary.length > 0 && <p className={s.sum}>{summary}</p>}
        </div>
        <div className={s.acts}>
          <span
            className={`pm2-seg ${s.seg}`}
            role="group"
            aria-label="Period"
          >
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={p === period ? "on" : undefined}
                aria-pressed={p === period}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </span>
          {top && (
            <Link href={top.href} className={`pm2-btn pri ${s.primary}`}>
              {primaryLabel(top)}
            </Link>
          )}
        </div>
      </header>
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
  const allClear =
    !!attention && !attentionQ.isError && items.length === 0;

  return (
    <>
      {header}
      <div className="pm2-body">
        {/* ---- KPI tiles: Sales is the page's one red element ---- */}
        <div className={s.kpis}>
          <Link
            href="/dashboard/sales"
            className={`${s.kpi} ${s.hero}`}
            title="Web store + Amazon + HYPD. Excludes ₹0.01 creator seed orders and refunds."
          >
            <span className={s.kpiL}>{salesLabel(days)}</span>
            <span className={s.kpiV}>{formatINR(sales.total.revenue)}</span>
            <span className={s.kpiD}>
              <DeltaText value={salesDelta} /> vs the {days} days before · all
              channels
            </span>
          </Link>
          <Link href={`/dashboard/sales?period=${days}d`} className={s.kpi}>
            <span className={s.kpiL}>Orders</span>
            <span className={s.kpiV}>
              {sales.total.orders.toLocaleString("en-IN")}
            </span>
            <span className={s.kpiD}>
              {cod?.count != null && (
                <span>
                  {cod.count.toLocaleString("en-IN")} COD to confirm ·{" "}
                </span>
              )}
              <DeltaText
                value={pctChange(sales.total.orders, sales.total.prevOrders)}
              />
            </span>
          </Link>
          <Link href="/dashboard/attention" className={s.kpi}>
            <span className={s.kpiL}>Needs you</span>
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

        {allClear ? (
          <>
            {/* ---- All clear: nothing needs the team ---- */}
            <section className={`${s.card} ${s.clear}`} aria-labelledby="home-clear">
              <div className={s.art} aria-hidden>
                <PartyPopper />
                <span className={s.sticker}>All clear</span>
              </div>
              <h3 id="home-clear">Crunch time is over</h3>
              <p>
                No orders to confirm, no tickets waiting, no drafts to approve.
                We&apos;ll ping you the moment something lands.
              </p>
              <Link
                className="pm2-btn"
                href={`/dashboard/assistant?q=${encodeURIComponent("How did the week go?")}`}
              >
                Ask Maya how the week went
              </Link>
            </section>
            {running.length > 0 && (
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
                <div className={s.run}>
                  {running.map((c) => (
                    <RunningRow key={c.id} c={c} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          /* ---- Needs you + side column ---- */
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
        )}

        {/* ---- Sales area chart, full width ---- */}
        <section className={s.card} aria-labelledby="home-sales">
          <div className={s.secT}>
            <h3 id="home-sales">Sales, last {days} days</h3>
            <Link className={s.txtLink} href="/dashboard/sales">
              Insights
              <ArrowRight />
            </Link>
          </div>
          <p className={s.takeaway}>
            {formatLakh(sales.total.revenue)}
            {salesDelta !== null ? (
              <>
                ,{" "}
                <em className={Math.round(salesDelta) < 0 ? s.neg : undefined}>
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
          <AreaChart
            labels={dailyLabels}
            current={sales.daily.map((d) => d.revenue)}
            previous={sales.daily.map((d) => d.prevRevenue)}
            fmt={formatLakh}
            aria={`Daily sales, this ${days}-day period vs the previous ${days} days`}
          />
          <div className={s.keys}>
            <span>
              <i style={{ background: "var(--pm-brand)" }} />
              Last {days} days
            </span>
            <span>
              <i style={{ background: "#CFC7B9" }} />
              {days} days before (dashed)
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

// Area chart for Home (prototype "area" type): the current period as a red
// line with a soft red fill, the period before as a dashed grey line. Draws
// at the container's real width so text never stretches.
function AreaChart({
  labels,
  current,
  previous,
  fmt,
  aria,
}: {
  labels: string[];
  current: number[];
  previous: number[];
  fmt: (n: number) => string;
  aria: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const narrow = W > 0 && W < 520;
  const H = narrow ? 200 : 240;
  const pad = { l: 48, r: narrow ? 52 : 60, t: 18, b: 28 };
  const n = Math.max(current.length, 1);
  const width = Math.max(240, W);
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const all = [...current, ...previous].filter((v) => Number.isFinite(v));
  const peak = Math.max(0, ...all);
  const raw = peak / 3 || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const tick = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => t >= raw) ?? raw;
  const max = tick * Math.max(3, Math.ceil(peak / tick));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const x = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const path = (vals: number[]) =>
    vals
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v || 0).toFixed(1)}`)
      .join("");
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += tick) ticks.push(v);
  const every = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
  const last = current.length - 1;
  const red = "var(--pm-brand)";

  return (
    <div ref={ref} className={s.chart}>
      {W > 0 && current.length > 0 && (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={aria}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#EFEBE3" />
              <text className={s.ax} x={pad.l - 8} y={y(v) + 4} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          <path
            d={`${path(current)}L${x(last)} ${y(0)}L${x(0)} ${y(0)}Z`}
            fill={red}
            opacity={0.12}
          />
          {previous.length > 0 && (
            <path
              d={path(previous)}
              fill="none"
              stroke="#CFC7B9"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          <path
            d={path(current)}
            fill="none"
            stroke={red}
            strokeWidth={2.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={x(last)} cy={y(current[last] || 0)} r={4} fill={red} stroke="#fff" strokeWidth={2} />
          <text className={s.ev} x={x(last) + 8} y={y(current[last] || 0) + 4} fill={red}>
            {fmt(current[last] || 0)}
          </text>
          {labels.map((lb, i) =>
            i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2) ? (
              <text
                key={i}
                className={s.ax}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              >
                {lb}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
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
