"use client";

// /dashboard/inbox/reports — Inbox → Reports (prototype tk-reports). How fast
// the team answers and solves WhatsApp tickets: volume, first human reply,
// on-time share against the 4h target, solve time, tickets by topic and by
// person, and a day-by-day volume chart. Reads GET /api/inbox/tickets/reports
// only; nothing on this page writes or messages anyone.

import { Suspense, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { BarChart, Callout, Card, HBars, Kpi, KpiStrip, PageHeader, Table } from "@/components/pm";
import type { HBarItem, TableCol } from "@/components/pm";
import { pctChange } from "@/lib/metrics/period";
import { parseReportPeriod, REPORT_PERIODS, spanText, type ReportPeriod, type TicketReport } from "@/lib/inbox/ticket-reports";
import { PeriodSeg } from "@/app/dashboard/sales/insights-ui";
import s from "./reports.module.css";

const PERIOD_WORD: Record<ReportPeriod, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

type TeamUser = { email: string | null; name: string };
type PersonRow = TicketReport["people"][number] & { name: string };

export default function InboxReportsPage() {
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" style={{ minHeight: 400 }} /></div>}>
      <ReportsInner />
    </Suspense>
  );
}

function ReportsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const period = parseReportPeriod(params.get("period"));

  const setPeriod = useCallback(
    (p: ReportPeriod) => {
      router.replace(`/dashboard/inbox/reports${p === "7d" ? "" : `?period=${p}`}`);
    },
    [router],
  );

  const q = useQuery({
    queryKey: ["inbox-ticket-report", period],
    queryFn: async (): Promise<TicketReport> => {
      const r = await fetch(`/api/inbox/tickets/reports?period=${period}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `reports ${r.status}`);
      return j as TicketReport;
    },
    placeholderData: keepPreviousData,
  });

  const teamQ = useQuery({
    queryKey: ["team-names"],
    queryFn: async (): Promise<TeamUser[]> => {
      const r = await fetch("/api/team", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      return r.ok ? ((j.users ?? []) as TeamUser[]) : [];
    },
    staleTime: 60_000,
  });
  const nameOf = useCallback(
    (email: string) => teamQ.data?.find((u) => u.email === email)?.name || email.split("@")[0],
    [teamQ.data],
  );

  const rep = q.data;
  const word = PERIOD_WORD[period];

  const summary = rep ? (
    rep.opened === 0 ? (
      <>No tickets opened in the last {word}.</>
    ) : (
      <>
        <b>{rep.opened.toLocaleString("en-IN")} tickets</b> in the last {word}.
        {rep.firstReplyMin != null ? (
          <>
            {" "}
            When a teammate replied, it took <b>{spanText(rep.firstReplyMin)}</b> (median).
          </>
        ) : null}
        {rep.onTimePct != null ? (
          <>
            {" "}
            <b>{rep.onTimePct}%</b> got a reply within 4 hours.
          </>
        ) : null}
      </>
    )
  ) : undefined;

  const header = (
    <PageHeader
      crumb="Inbox"
      title="Reports"
      summary={summary}
      actions={<PeriodSeg options={REPORT_PERIODS} value={period} onChange={setPeriod} />}
    />
  );

  const topicItems: HBarItem[] = useMemo(
    () =>
      (rep?.topics ?? []).map((t) => ({
        label: t.word,
        value: t.count,
        text: t.count.toLocaleString("en-IN"),
        sub: t.prevCount > 0 ? `${t.prevCount} before` : undefined,
      })),
    [rep],
  );

  const people: PersonRow[] = useMemo(() => (rep?.people ?? []).map((p) => ({ ...p, name: nameOf(p.assignee) })), [rep, nameOf]);

  if (q.isError && !rep) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load the report"
            body={q.error instanceof Error ? q.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>
                <RefreshCw size={14} aria-hidden /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  if (!rep) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <div className="pm2-skel" style={{ minHeight: 120 }} />
          <div className="pm2-skel" style={{ minHeight: 280 }} />
        </div>
      </>
    );
  }

  const personCols: TableCol<PersonRow>[] = [
    { h: "Who", render: (r) => <b>{r.name}</b> },
    { h: "Solved", num: true, render: (r) => r.solved.toLocaleString("en-IN") },
    { h: "Open now", num: true, render: (r) => r.open.toLocaleString("en-IN") },
    { h: "First reply", num: true, render: (r) => (r.firstReplyMin == null ? "None yet" : spanText(r.firstReplyMin)) },
  ];

  // Day bars for 7 and 30 days; 90 days reads better as weeks.
  const dm = (date: string) => {
    const [, m, day] = date.split("-");
    return `${Number(day)}/${Number(m)}`;
  };
  const weekly = rep.days > 31;
  const buckets: { label: string; opened: number }[] = [];
  if (weekly) {
    // Weeks end on the last day, so the newest bucket is always a full week.
    const d = rep.daily;
    for (let end = d.length; end > 0; end -= 7) {
      const slice = d.slice(Math.max(0, end - 7), end);
      buckets.unshift({ label: dm(slice[0].date), opened: slice.reduce((n, x) => n + x.opened, 0) });
    }
  } else {
    for (const x of rep.daily) buckets.push({ label: dm(x.date), opened: x.opened });
  }

  return (
    <>
      {header}
      <div className="pm2-body">
        <KpiStrip>
          <Kpi
            label="Opened"
            value={rep.opened.toLocaleString("en-IN")}
            delta={pctChange(rep.opened, rep.prevOpened)}
            invert
            sub={`${rep.openNow} open now`}
          />
          <Kpi
            label="First reply"
            value={spanText(rep.firstReplyMin)}
            sub={rep.prevFirstReplyMin != null ? `${spanText(rep.prevFirstReplyMin)} before` : "Median, by a person"}
            tip="Median time from a ticket opening to the first reply typed by a teammate. Bot replies don't count."
          />
          <Kpi
            label="On time"
            value={rep.onTimePct == null ? "None yet" : `${rep.onTimePct}%`}
            delta={rep.onTimePct != null && rep.prevOnTimePct != null ? rep.onTimePct - rep.prevOnTimePct : null}
            deltaUnit="pts"
            sub="Target: reply within 4h"
          />
          <Kpi
            label="Solved"
            value={rep.solved.toLocaleString("en-IN")}
            delta={pctChange(rep.solved, rep.prevSolved)}
            sub={rep.solveHours != null ? `${spanText(rep.solveHours * 60)} to solve` : "Median time to solve"}
          />
        </KpiStrip>

        <div className={s.g2}>
          <Card title="Tickets by topic" basis={`opened in the last ${word}`}>
            {topicItems.length ? (
              <HBars items={topicItems} />
            ) : (
              <p className={s.empty}>No tickets opened in this period.</p>
            )}
            {topicItems.length ? (
              <p className={s.note}>
                Topics come from the bot when it opens a ticket.{" "}
                <Link className="pm2-lnk" href="/dashboard/inbox/tickets">
                  See open tickets by topic
                </Link>
              </p>
            ) : null}
          </Card>
          <Card title="By person" basis={`last ${word}`} flush>
            <Table
              cols={personCols}
              rows={people}
              rowKey={(r) => r.assignee}
              card={(r) => ({
                title: r.name,
                value: `${r.solved} solved`,
                meta: `${r.open} open now · first reply ${r.firstReplyMin == null ? "none yet" : spanText(r.firstReplyMin)}`,
              })}
              empty="Nobody has been assigned a ticket in this period."
            />
            {rep.unassignedOpen > 0 ? (
              <p className={`${s.note} ${s.pad}`}>
                {rep.unassignedOpen} open {rep.unassignedOpen === 1 ? "ticket has" : "tickets have"} nobody on {rep.unassignedOpen === 1 ? "it" : "them"}.
              </p>
            ) : null}
          </Card>
        </div>

        <Card title={weekly ? "Tickets per week" : "Tickets per day"} basis={weekly ? "opened, week starting" : `opened, last ${word}`}>
          <BarChart
            cats={buckets.map((b) => b.label)}
            series={[{ name: "Opened", color: "var(--pm-cyan)", values: buckets.map((b) => b.opened) }]}
            aria={weekly ? "Tickets opened per week" : "Tickets opened per day"}
            labels={buckets.length <= 14}
            height={180}
          />
        </Card>

        <p className={s.foot}>
          WhatsApp tickets. A reply counts when a teammate sends it from the CRM; bot replies and automatic messages do not.
          Days are in IST.
        </p>
      </div>
    </>
  );
}
