"use client";

// Insights → Repeat & cohorts (prototype an-retention). Website buyers: how
// many come back, how soon, what they spend, a first-order-month cohort grid,
// when the second order lands, and the customer groups the WhatsApp segments
// use. Reads GET /api/metrics/buyers?view=repeat only.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { BarChart, Callout } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import type { RepeatMetrics } from "@/lib/metrics/buyers-aggregate";
import { InsightsHead, Kpi, ChartCard } from "../insights-ui";
import s from "../insights.module.css";
import b from "../buyers.module.css";

type Group = { rfm_tier: string; customers: number; spend: number };
type Repeat = RepeatMetrics & { groups: Group[] | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

// Same tiers and words as the WhatsApp campaign segment picker.
const GROUPS: { tier: string; label: string; hint: string; color: string }[] = [
  { tier: "rfm:vip", label: "VIP", hint: "₹3k+ spent or 5+ orders", color: "#9C5B5D" },
  { tier: "rfm:loyal", label: "Loyal", hint: "2 to 4 orders, last one in 90 days", color: "#D57E80" },
  { tier: "rfm:new", label: "New", hint: "First order in the last 30 days", color: "var(--pm-green)" },
  { tier: "rfm:one_time", label: "Bought once", hint: "One order, 1 to 3 months ago", color: "#B9B0A3" },
  { tier: "rfm:at_risk", label: "At risk", hint: "Last order 3 to 6 months ago", color: "#D99A00" },
  { tier: "rfm:dormant", label: "Dormant", hint: "Nothing in 6 months", color: "#DDD6CA" },
];

function heatBg(v: number, max: number): string {
  const a = max > 0 ? 0.08 + 0.62 * Math.min(1, v / max) : 0.08;
  return `rgba(31, 142, 156, ${a.toFixed(2)})`;
}

export default function RepeatPage() {
  const q = useQuery({
    queryKey: ["metrics-buyers", "repeat"],
    queryFn: async (): Promise<Repeat> => {
      const r = await fetch("/api/metrics/buyers?view=repeat", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) throw new Error(d.error || `buyers ${r.status}`);
      return d as Repeat;
    },
    staleTime: 60_000,
  });
  const m = q.data;

  const summary = m ? (
    m.repeatPct == null ? (
      <>Not enough website buyers yet to measure repeat orders.</>
    ) : (
      <>
        <b>{m.repeatPct}% of buyers</b> come back for a second order.
        {m.medianDaysToSecond != null ? (
          <>
            {" "}
            Half of those who do return within <b>{Math.round(m.medianDaysToSecond)} days</b>.
          </>
        ) : null}
      </>
    )
  ) : undefined;

  const header = <InsightsHead title="Repeat & cohorts" summary={summary} />;

  if (q.isError) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load repeat buyers"
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
          <div className={s.kpis}>
            <div className="pm2-skel" />
            <div className="pm2-skel" />
            <div className="pm2-skel" />
          </div>
          <div className="pm2-skel" style={{ minHeight: 300 }} />
        </div>
      </>
    );
  }

  const cellMax = Math.max(0, ...m.cohorts.flatMap((c) => c.cells.filter((v): v is number => v != null)));
  const firstCol = m.cohorts.map((c) => c.cells[0]).filter((v): v is number => v != null);
  const cohortTakeaway =
    firstCol.length >= 2 ? (
      <>
        Month-1 return went from {firstCol[0]}% to <em className={firstCol[firstCol.length - 1] >= firstCol[0] ? undefined : s.neg}>{firstCol[firstCol.length - 1]}%</em>
      </>
    ) : undefined;

  const peak = m.secondOrderWeeks.reduce((best, w, i, all) => (w.buyers > all[best].buyers ? i : best), 0);
  const anySecond = m.secondOrderWeeks.some((w) => w.buyers > 0);

  const groups = m.groups
    ? GROUPS.map((g) => ({ ...g, n: m.groups!.find((x) => x.rfm_tier === g.tier)?.customers ?? 0 }))
    : null;
  const groupTotal = groups ? groups.reduce((n, g) => n + g.n, 0) : 0;
  const groupMax = groups ? Math.max(1, ...groups.map((g) => g.n)) : 1;

  return (
    <>
      {header}
      <div className="pm2-body">
        <div className={s.kpis}>
          <Kpi label="Repeat rate" value={m.repeatPct == null ? "None yet" : `${m.repeatPct}%`} red>
            Of {m.repeatBase.toLocaleString("en-IN")} new buyers from 30+ days ago
          </Kpi>
          <Kpi label="Time to 2nd order" value={m.medianDaysToSecond == null ? "None yet" : `${Math.round(m.medianDaysToSecond)} days`}>
            Median, for buyers who came back
          </Kpi>
          <Kpi label="Spend per buyer" value={m.spendPerBuyer == null ? "None yet" : formatINR(m.spendPerBuyer)}>
            All their website orders so far
          </Kpi>
        </div>

        <ChartCard id="ins-rep-cohorts" title="Who came back, by first-order month" takeaway={cohortTakeaway}>
          <p className={s.note} style={{ marginTop: 0 }}>
            Each square: % of that month&apos;s new buyers who ordered again in that month after their first. Darker means more. Blank
            squares haven&apos;t finished yet.
          </p>
          <div className={b.heatWrap}>
            <table className={b.heat}>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Buyers</th>
                  {m.cohorts[0]?.cells.map((_, i) => <th key={i}>{i + 1} mo</th>)}
                </tr>
              </thead>
              <tbody>
                {m.cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className={b.lab}>{monthWord(c.month)}</td>
                    <td className={b.n}>{c.buyers.toLocaleString("en-IN")}</td>
                    {c.cells.map((v, i) =>
                      v == null ? (
                        <td key={i} className={b.blank} />
                      ) : (
                        <td key={i} style={{ background: heatBg(v, cellMax) }}>
                          {v}%
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <div className={s.g2}>
          <ChartCard
            id="ins-rep-second"
            title="When the second order comes"
            takeaway={anySecond ? <>Most come back in week <em className={s.plain}>{m.secondOrderWeeks[peak].label.replace("w", "")}</em></> : undefined}
          >
            {anySecond ? (
              <>
                <BarChart
                  cats={m.secondOrderWeeks.map((w) => w.label)}
                  series={[{ name: "Buyers", color: "var(--pm-cyan)", values: m.secondOrderWeeks.map((w) => w.buyers) }]}
                  labels
                  highlight={peak}
                  aria="Weeks from first to second order"
                  height={190}
                />
                <p className={s.note}>Weeks after the first order.</p>
              </>
            ) : (
              <p className={s.empty}>No second orders yet.</p>
            )}
          </ChartCard>

          <ChartCard
            id="ins-rep-groups"
            title="Customer groups"
            right={
              <Link className={s.txtLink} href="/dashboard/email/audiences">
                Message a group <ArrowRight aria-hidden />
              </Link>
            }
          >
            {groups ? (
              <>
                <p className={s.note} style={{ marginTop: 0, marginBottom: 12 }}>
                  {groupTotal.toLocaleString("en-IN")} buyers with a phone, grouped by how recently and how often they buy. Refreshed
                  nightly; the same groups the WhatsApp campaigns use.
                </p>
                <div className={b.groups}>
                  {groups.map((g) => (
                    <div key={g.tier} className={b.grp}>
                      <span className={b.dot} style={{ background: g.color }} />
                      <b>{g.label}</b>
                      <span className={b.n}>{g.n.toLocaleString("en-IN")}</span>
                      <span className={b.bar}>
                        <i style={{ width: `${(g.n / groupMax) * 100}%`, background: g.color }} />
                      </span>
                      <span className={b.d}>{g.hint}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className={s.empty}>Customer groups are not available right now.</p>
            )}
          </ChartCard>
        </div>

        <p className={s.footerNote}>
          promunch.in orders only, since {new Date(m.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. A buyer is
          their phone number, else their email. Excludes HYPD creator seeds, refunds and ₹0 orders.
        </p>
      </div>
    </>
  );
}
