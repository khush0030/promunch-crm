"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageHeader, KpiStrip, Kpi, Card, Table, Pill, Funnel, HBars, Callout } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { CampaignDetailResponse } from "@/app/api/brevo/campaigns/[id]/route";
import type { DomainRow, ListRow, LinkRow } from "@/lib/brevo-shape";
import { STATUS_LABEL, STATUS_TONE } from "@/components/brevo/CampaignsTab";
import { CampaignActions } from "@/components/brevo/CampaignActions";
import { int, rate, dateTime, getJson, ErrorCallout, SectionView } from "@/components/brevo/format";

// Marketing > Email (Brevo) > one campaign: every report Brevo keeps for it.

export default function BrevoCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ["brevo-campaign", id],
    queryFn: () => getJson<CampaignDetailResponse>(`/api/brevo/campaigns/${id}`),
  });

  const back = (
    <Link className="pm2-btn sm" href="/dashboard/marketing/email">
      <ArrowLeft size={14} /> All campaigns
    </Link>
  );

  if (q.isLoading) {
    return (
      <>
        <PageHeader crumb="Marketing · Email (Brevo)" title="Campaign" actions={back} />
        <div className="pm2-body">
          <div className="pm2-skel" />
        </div>
      </>
    );
  }
  if (q.isError || !q.data) {
    return (
      <>
        <PageHeader crumb="Marketing · Email (Brevo)" title="Campaign" actions={back} />
        <div className="pm2-body">
          <ErrorCallout title="Couldn't load this campaign" error={q.error} onRetry={() => q.refetch()} />
        </div>
      </>
    );
  }

  const { campaign: c, funnel: f } = q.data;
  const sent = f.sent > 0;

  const listCols: TableCol<ListRow>[] = [
    { h: "List", render: (r) => r.name },
    { h: "Delivered", num: true, render: (r) => `${int(r.delivered)} / ${int(r.sent)}` },
    { h: "Opens", num: true, render: (r) => rate(r.openRate) },
    { h: "Clicks", num: true, render: (r) => rate(r.clickRate) },
    { h: "Unsubs", num: true, render: (r) => int(r.unsubscribes) },
    { h: "Bounces", num: true, render: (r) => int(r.hardBounces + r.softBounces) },
  ];
  const domainCols: TableCol<DomainRow>[] = [
    { h: "Inbox provider", render: (r) => r.domain },
    { h: "Delivered", num: true, render: (r) => `${int(r.delivered)} / ${int(r.sent)}` },
    { h: "Opens", num: true, render: (r) => rate(r.openRate) },
    { h: "Clicks", num: true, render: (r) => rate(r.clickRate) },
    { h: "Unsubs", num: true, render: (r) => int(r.unsubscribes) },
    { h: "Bounces", num: true, render: (r) => int(r.hardBounces + r.softBounces) },
  ];
  const linkCols: TableCol<LinkRow>[] = [
    {
      h: "Link",
      render: (r) => (
        <a href={r.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
          {r.label}
        </a>
      ),
    },
    { h: "Clicks", num: true, render: (r) => int(r.clicks) },
  ];

  const meta: [string, string][] = [
    ["Subject", c.subject || "—"],
    ["Preview text", c.previewText || "—"],
    ["From", c.sender || "—"],
    ["Reply-to", c.replyTo || "—"],
    ["Sent to", c.lists.map((l) => l.name).join(", ") || (c.segments.length ? `${c.segments.length} segment(s)` : "—")],
    ["Excluded", c.exclusionLists.map((l) => l.name).join(", ") || "—"],
    ["Created", dateTime(c.createdAt)],
    [c.sentDate ? "Sent" : "Scheduled", dateTime(c.sentDate ?? c.scheduledAt)],
    ["Type", `${c.type}${c.abTesting ? " · A/B test" : ""}${c.tag ? ` · tag ${c.tag}` : ""}`],
  ];

  return (
    <>
      <PageHeader
        crumb={
          <>
            Marketing · <Link href="/dashboard/marketing/email">Email (Brevo)</Link>
          </>
        }
        title={c.name}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Pill tone={STATUS_TONE[c.status] ?? "neu"}>{STATUS_LABEL[c.status] ?? c.status}</Pill>
            {c.shareLink && (
              <a className="pm2-btn sm" href={c.shareLink} target="_blank" rel="noreferrer">
                View email <ExternalLink size={14} />
              </a>
            )}
            {back}
          </div>
        }
      />
      <div className="pm2-body">
        <CampaignActions channel="email" id={c.id} status={c.status} name={c.name} />
        {!sent && <Callout tone="plain" title="Not sent yet" body="Stats appear here once this campaign goes out." />}

        {sent && (
          <>
            <KpiStrip>
              <Kpi label="Delivered" value={int(f.delivered)} sub={`${rate(f.deliveryRate)} of ${int(f.sent)} sent`} />
              <Kpi
                label="Open rate"
                value={rate(f.openRate)}
                sub={`${int(f.opens)} unique opens`}
                tip={f.mppOpens ? `${int(f.mppOpens)} of these are Apple Mail auto-opens, so real reading is lower.` : undefined}
              />
              <Kpi label="Click rate" value={rate(f.clickRate)} sub={`${int(f.clicks)} unique clicks · ${rate(f.clickToOpen)} of openers`} />
              <Kpi label="Unsubscribes" value={int(f.unsubscribes)} sub={`${rate(f.unsubRate)} · ${int(f.complaints)} spam reports`} invert />
            </KpiStrip>

            <div className="pm2-g21">
              <Card title="Funnel" basis="unique people">
                <Funnel
                  steps={[
                    { label: "Sent", value: f.sent, text: int(f.sent) },
                    { label: "Delivered", value: f.delivered, text: int(f.delivered) },
                    { label: "Opened", value: f.opens, text: int(f.opens), tip: f.mppOpens ? `${int(f.mppOpens)} Apple Mail auto-opens included` : undefined },
                    { label: "Clicked", value: f.clicks, text: int(f.clicks) },
                  ]}
                />
              </Card>
              <Card title="Didn't arrive" basis="bounces and complaints">
                <HBars
                  items={[
                    { label: "Soft bounces", value: f.softBounces, text: int(f.softBounces), sub: "temporary: full inbox, server busy", color: "var(--pm-sun)" },
                    { label: "Hard bounces", value: f.hardBounces, text: int(f.hardBounces), sub: "address doesn't exist", color: "var(--pm-s-web)" },
                    { label: "Spam reports", value: f.complaints, text: int(f.complaints), color: "var(--pm-s-web)" },
                  ]}
                />
              </Card>
            </div>

            {q.data.perList.length > 0 && (
              <Card title="By list" basis="each recipient list in this send">
                <Table cols={listCols} rows={q.data.perList} rowKey={(r) => r.listId} card={(r) => ({ title: r.name, value: rate(r.openRate), meta: `${int(r.delivered)} delivered · ${rate(r.clickRate)} clicks` })} />
              </Card>
            )}

            <div className="pm2-g2">
              <Card title="Link clicks" basis="total clicks per link">
                {q.data.breakdownMissing.links && <Callout tone="plain" title="Brevo has no per-link numbers for this send" body="The campaign has clicks, but Brevo returned zero for every link." />}
                <Table cols={linkCols} rows={q.data.links} rowKey={(r) => r.url} card={(r) => ({ title: r.label, value: int(r.clicks) })} empty="No tracked links" />
              </Card>
              <Card title="Devices" basis="unique opens and clicks">
                {q.data.breakdownMissing.devices ? (
                  <div className="pm2-empty">Brevo has no device data for this send.</div>
                ) : (
                  <>
                    <HBars items={q.data.devices.groups.map((g) => ({ label: g.label, value: g.opens + g.clicks, text: `${int(g.opens)} opens`, sub: `${int(g.clicks)} clicks`, color: "var(--pm-s-web)" }))} />
                    {q.data.devices.systems.length > 0 && (
                      <div style={{ marginTop: 14, fontSize: 13, color: "var(--pm-muted)" }}>
                        {q.data.devices.systems.map((s) => `${s.label} ${int(s.opens)}/${int(s.clicks)}`).join(" · ")}
                        <span style={{ display: "block", fontSize: 12 }}>opens/clicks by system</span>
                      </div>
                    )}
                    {q.data.browsers.length > 0 && (
                      <div style={{ marginTop: 10, fontSize: 13, color: "var(--pm-muted)" }}>
                        {q.data.browsers.map((b) => `${b.label} ${int(b.opens)}/${int(b.clicks)}`).join(" · ")}
                        <span style={{ display: "block", fontSize: 12 }}>opens/clicks by browser or mail app</span>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>

            {q.data.domains.length > 0 && (
              <Card title="By inbox provider" basis="where recipients' email is hosted">
                <Table cols={domainCols} rows={q.data.domains} rowKey={(r) => r.domain} card={(r) => ({ title: r.domain, value: rate(r.openRate), meta: `${int(r.delivered)} delivered · ${int(r.hardBounces + r.softBounces)} bounced` })} />
              </Card>
            )}

            {q.data.ab && (
              <Card title="A/B test" basis="Brevo's winner">
                <SectionView s={q.data.ab} gatedTitle="A/B result unavailable">
                  {(ab) => (
                    <KpiStrip cols={3}>
                      <Kpi label="Winner" value={ab.winningVersion ?? "—"} sub={ab.winningCriteria ?? ""} />
                      <Kpi label="Open rate" value={ab.openRate ?? "—"} sub={ab.winningSubjectLine ?? ""} />
                      <Kpi label="Click rate" value={ab.clickRate ?? "—"} sub={ab.winningVersionRate ? `winning version ${ab.winningVersionRate}` : ""} />
                    </KpiStrip>
                  )}
                </SectionView>
              </Card>
            )}
          </>
        )}

        <Card title="Details">
          <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0,1fr)", gap: "8px 18px", margin: 0, fontSize: 14 }}>
            {meta.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ color: "var(--pm-muted)" }}>{k}</dt>
                <dd style={{ margin: 0, wordBreak: "break-word" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
