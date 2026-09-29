"use client";

// Email Studio home: last 30 days at a glance, what's queued, what needs an
// admin, and deliverability health (bounce + spam rates vs Gmail's limits).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { KpiStrip, Kpi, Card, Callout, Pill } from "@/components/pm";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { getJson, inr, pct, when } from "@/components/email-studio/api";
import s from "@/components/email-studio/studio.module.css";

type Overview = {
  emailsSent: number;
  campaignSent: number;
  flowSent: number;
  clicks: number;
  clickRate: number | null;
  openRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  revenue: number;
  flowRevenue: number;
  orders: number;
  subscribers: number | null;
  upcoming: { id: string; name: string; scheduled_at: string }[];
  pending: { id: string; name: string; created_by: string | null }[];
  warmupMax: number | null;
  approvalThreshold: number;
  domain: string | null;
};

function health(rate: number | null, warn: number, crit: number) {
  if (rate == null) return <Pill tone="neu">no sends yet</Pill>;
  if (rate >= crit) return <Pill tone="crit">{pct(rate)} · too high</Pill>;
  if (rate >= warn) return <Pill tone="warn">{pct(rate)} · watch</Pill>;
  return <Pill tone="good">{pct(rate)} · healthy</Pill>;
}

export default function EmailStudioHome() {
  const q = useQuery({ queryKey: ["email-studio-overview"], queryFn: () => getJson<Overview>("/api/email-studio/overview") });
  const d = q.data;
  return (
    <>
      <StudioHeader tab="home" actions={<NewCampaignButton />} />
      <div className="pm2-body">
        {q.error && <Callout tone="crit" title="Could not load Email Studio" body={(q.error as Error).message} />}
        {d?.warmupMax != null && (
          <Callout
            tone="sun"
            title="Domain warm-up is on"
            body={`The new sending domain${d.domain ? ` (${d.domain})` : ""} is building its reputation, so each campaign is capped at ${d.warmupMax} people and needs an admin's approval. Send to your most engaged customers first. An admin can lift this in Brand & settings.`}
          />
        )}
        {!!d?.pending.length && (
          <Callout
            tone="plain"
            title={`${d.pending.length} campaign${d.pending.length === 1 ? "" : "s"} waiting for approval`}
            body={d.pending.map((p) => (
              <div key={p.id}>
                <Link className="pm2-lnk" href={`/dashboard/email/campaigns/${p.id}`}>{p.name}</Link>
                {p.created_by ? ` · from ${p.created_by}` : ""}
              </div>
            ))}
          />
        )}
        <KpiStrip>
          <Kpi label="Email revenue" value={d ? inr(d.revenue) : "…"} sub={d ? `${d.orders} orders · ${inr(d.flowRevenue)} from automations` : ""} tip="Shopify orders credited to an email in the last 30 days (link tag, or ordered within 5 days of clicking)." />
          <Kpi label="Emails sent" value={d ? d.emailsSent.toLocaleString("en-IN") : "…"} sub={d ? `${d.campaignSent} campaigns · ${d.flowSent} automations` : ""} />
          <Kpi label="Click rate" value={d ? pct(d.clickRate) : "…"} sub={d ? `${d.clicks} clicks` : ""} tip="The number that matters. Opens are inflated by Apple Mail." />
          <Kpi label="Subscribers" value={d?.subscribers != null ? d.subscribers.toLocaleString("en-IN") : "…"} sub="consented, reachable" />
        </KpiStrip>
        <div className="pm2-g2">
          <Card title="Coming up" basis="scheduled campaigns">
            {!d?.upcoming.length ? (
              <div className={s.stack}>
                <span className={s.hint}>Nothing scheduled.</span>
                <Link className="pm2-lnk" href="/dashboard/email/templates">Start from a Diwali template →</Link>
              </div>
            ) : (
              d.upcoming.map((u) => (
                <div key={u.id} className={s.linkRow}>
                  <Link className="pm2-lnk" href={`/dashboard/email/campaigns/${u.id}`}>{u.name}</Link>
                  <span>{when(u.scheduled_at)}</span>
                </div>
              ))
            )}
          </Card>
          <Card title="Inbox health" basis="last 30 days, campaigns">
            <div className={s.checklist}>
              <div className={s.linkRow}><span>Bounce rate (keep under 2%)</span>{health(d?.bounceRate ?? null, 0.01, 0.02)}</div>
              <div className={s.linkRow}><span>Spam complaints (keep under 0.1%)</span>{health(d?.complaintRate ?? null, 0.0008, 0.001)}</div>
              <div className={s.linkRow}><span>Sending from</span><b>{d?.domain ?? "…"}</b></div>
            </div>
            <div className={s.hint} style={{ marginTop: 10 }}>
              Gmail starts sending to spam above 0.3% complaints. Studio stops you well before that.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
