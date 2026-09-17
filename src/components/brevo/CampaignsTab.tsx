"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { KpiStrip, Kpi, Card, Table, Pill } from "@/components/pm";
import type { TableCol, PillTone } from "@/components/pm";
import type { CampaignRow, CampaignsResponse } from "@/lib/brevo-campaigns";
import { int, rate, day, clock, getJson, ErrorCallout } from "./format";

export const STATUS_TONE: Record<string, PillTone> = {
  sent: "good",
  queued: "info",
  inProcess: "info",
  scheduled: "info",
  draft: "neu",
  suspended: "warn",
  cancelled: "warn",
  archive: "neu",
};

export const STATUS_LABEL: Record<string, string> = { inProcess: "sending", archive: "archived" };

export const campaignsKey = ["brevo-campaigns"] as const;
export const fetchCampaigns = (fresh = false) => getJson<CampaignsResponse>(`/api/brevo/campaigns${fresh ? "?fresh=1" : ""}`);

export function CampaignsTab() {
  const q = useQuery({ queryKey: campaignsKey, queryFn: () => fetchCampaigns() });

  if (q.isLoading) {
    return (
      <>
        <KpiStrip>
          <Kpi label="Emails delivered" value="—" sub="—" />
          <Kpi label="Open rate" value="—" sub="—" />
          <Kpi label="Click rate" value="—" sub="—" />
          <Kpi label="Unsubscribes" value="—" sub="—" />
        </KpiStrip>
        <div className="pm2-skel" />
      </>
    );
  }
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load Brevo campaigns" error={q.error} onRetry={() => q.refetch()} />;

  const { summary: s, campaigns } = q.data;

  const cols: TableCol<CampaignRow>[] = [
    {
      h: "Campaign",
      render: (r) => (
        <>
          <Link href={`/dashboard/marketing/email/${r.id}`}>{r.name}</Link>
          <span className="sub">{r.subject || "No subject"}</span>
        </>
      ),
    },
    { h: "Status", render: (r) => <Pill tone={STATUS_TONE[r.status] ?? "neu"}>{STATUS_LABEL[r.status] ?? r.status}</Pill> },
    { h: "Date", render: (r) => day(r.date) },
    { h: "Delivered", num: true, render: (r) => (r.sent ? `${int(r.delivered)} / ${int(r.sent)}` : "—") },
    { h: "Opens", num: true, render: (r) => rate(r.openRate) },
    { h: "Clicks", num: true, render: (r) => rate(r.clickRate) },
    { h: "Unsubs", num: true, render: (r) => (r.sent ? int(r.unsubscribes) : "—") },
    { h: "Bounces", num: true, render: (r) => (r.sent ? int(r.bounces) : "—") },
  ];

  return (
    <>
      <KpiStrip>
        <Kpi label="Emails delivered" value={int(s.delivered)} sub={`${s.campaignsSent} campaign${s.campaignsSent === 1 ? "" : "s"}, last ${s.windowDays} days`} />
        <Kpi
          label="Open rate"
          value={rate(s.openRate)}
          sub="unique opens / delivered"
          tip={s.mppShare != null ? `About ${Math.round(s.mppShare)}% of opens are Apple Mail auto-opens, so real reading is lower. Clicks are the honest signal.` : undefined}
        />
        <Kpi label="Click rate" value={rate(s.clickRate)} sub="unique clicks / delivered" />
        <Kpi label="Unsubscribes" value={int(s.unsubscribes)} sub={`${int(s.bounces)} bounced`} />
      </KpiStrip>

      <Card
        title="All campaigns"
        basis={`from Brevo · updated ${clock(q.data.fetchedAt)}`}
        right={
          <Link className="pm2-btn pri sm" href="/dashboard/marketing/email/new">
            <Plus size={14} /> New campaign
          </Link>
        }
      >
        <Table
          cols={cols}
          rows={campaigns}
          rowKey={(r) => r.id}
          card={(r) => ({
            title: <Link href={`/dashboard/marketing/email/${r.id}`}>{r.name}</Link>,
            value: rate(r.openRate),
            meta: `${STATUS_LABEL[r.status] ?? r.status} · ${day(r.date)}${r.sent ? ` · ${int(r.delivered)} delivered · ${rate(r.clickRate)} clicks` : ""}`,
          })}
          empty="No campaigns in Brevo yet"
        />
      </Card>
    </>
  );
}
