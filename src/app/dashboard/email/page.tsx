"use client";

// Email Studio home: last 30 days at a glance, what's queued, what needs an
// admin, and deliverability health (bounce + spam rates vs Gmail's limits).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Mail, MailCheck } from "lucide-react";
import { KpiStrip, Kpi, Card, Callout } from "@/components/pm";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { getJson, inr, pct, when } from "@/components/email-studio/api";
import s from "@/components/email-studio/studio.module.css";
import l from "@/components/email-studio/list.module.css";

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
  if (rate == null) return <span className={`${l.status} ${l.stNeu}`}>no sends yet</span>;
  if (rate >= crit) return <span className={`${l.status} ${l.stCrit}`}>{pct(rate)} · too high</span>;
  if (rate >= warn) return <span className={`${l.status} ${l.stWarn}`}>{pct(rate)} · watch</span>;
  return <span className={`${l.status} ${l.stGood}`}>{pct(rate)} · healthy</span>;
}

function healthWord(d: Overview | undefined): string {
  if (!d || (d.bounceRate == null && d.complaintRate == null)) return "no campaign sends yet";
  if ((d.bounceRate ?? 0) >= 0.02 || (d.complaintRate ?? 0) >= 0.001) return "needs attention";
  if ((d.bounceRate ?? 0) >= 0.01 || (d.complaintRate ?? 0) >= 0.0008) return "watch it";
  return "good";
}

export default function EmailStudioHome() {
  const q = useQuery({ queryKey: ["email-studio-overview"], queryFn: () => getJson<Overview>("/api/email-studio/overview") });
  const d = q.data;
  return (
    <>
      <StudioHeader
        tab="home"
        title="Email"
        summary={
          d ? (
            <>
              Email made <b>{inr(d.revenue)}</b> in 30 days, {inr(d.flowRevenue)} of it from automations.{" "}
              {d.subscribers != null && <><b>{d.subscribers.toLocaleString("en-IN")}</b> people can get your emails. </>}
              {d.domain && <>Sending from <b>{d.domain}</b>.</>}
            </>
          ) : (
            "Loading the last 30 days…"
          )
        }
        actions={<NewCampaignButton />}
      />
      <div className="pm2-body">
        {q.error && <Callout tone="crit" title="Could not load Email Studio" body={(q.error as Error).message} />}
        {d?.warmupMax != null && (
          <Callout
            tone="plain"
            title="Domain warm-up is on"
            body={`The new sending domain${d.domain ? ` (${d.domain})` : ""} is building its reputation, so each campaign is capped at ${d.warmupMax} people and needs an admin's approval. Send to your most engaged customers first. An admin can lift this in Settings, Brand & email.`}
            action={<Link className="pm2-btn sm" href="/dashboard/email/settings">Open warm-up settings</Link>}
          />
        )}
        <KpiStrip cols={3}>
          <Kpi label="Revenue · 30 days" value={d ? inr(d.revenue) : "…"} sub={d ? `${d.orders} orders · ${inr(d.flowRevenue)} from automations` : ""} tip="Shopify orders credited to an email in the last 30 days (link tag, or ordered within 5 days of clicking)." />
          <Kpi label="Clicked" value={d ? pct(d.clickRate) : "…"} sub={d ? `${d.clicks} clicks · ${d.emailsSent.toLocaleString("en-IN")} emails sent` : ""} tip="The number that matters. Opens are inflated by Apple Mail." />
          <Kpi label="Can email" value={d?.subscribers != null ? d.subscribers.toLocaleString("en-IN") : "…"} sub="said yes and have an email" />
        </KpiStrip>
        <div className="pm2-g2">
          <Card title="Needs approval" right={d?.pending.length ? <span className={l.count}>{d.pending.length}</span> : undefined}>
            {!d?.pending.length ? (
              <span className={s.hint}>Nothing waiting. Campaigns sent for approval show up here.</span>
            ) : (
              d.pending.map((p) => (
                <Link key={p.id} className={l.homeRow} href={`/dashboard/email/campaigns/${p.id}`}>
                  <span className={l.lic}><Mail /></span>
                  <span style={{ minWidth: 0 }}>
                    <b>{p.name}</b>
                    <small>{p.created_by ? `Sent for approval by ${p.created_by.split("@")[0]}` : "Waiting for an admin"}</small>
                  </span>
                  <span className="pm2-btn">Review</span>
                </Link>
              ))
            )}
          </Card>
          <Card title="Coming up" basis="scheduled campaigns">
            {!d?.upcoming.length ? (
              <div className={s.stack}>
                <span className={s.hint}>Nothing scheduled.</span>
                <Link className="pm2-lnk" href="/dashboard/email/templates">Start from a template</Link>
              </div>
            ) : (
              d.upcoming.map((u) => (
                <div key={u.id} className={l.kv}>
                  <Link className="pm2-lnk" href={`/dashboard/email/campaigns/${u.id}`}>{u.name}</Link>
                  <span className={s.hint}>{when(u.scheduled_at)}</span>
                </div>
              ))
            )}
          </Card>
        </div>
        <Card title="Inbox health" basis="last 30 days, campaigns">
          <div className={l.kv}><span>Bounce rate (keep under 2%)</span>{health(d?.bounceRate ?? null, 0.01, 0.02)}</div>
          <div className={l.kv}><span>Spam complaints (keep under 0.1%)</span>{health(d?.complaintRate ?? null, 0.0008, 0.001)}</div>
          <div className={l.kv}><span>Emails sent</span><b>{d ? `${d.emailsSent.toLocaleString("en-IN")} · ${d.campaignSent} from campaigns, ${d.flowSent} from automations` : "…"}</b></div>
        </Card>
        <div className={l.note}>
          <MailCheck />
          <div>
            <b>Sending health: {healthWord(d)}.</b> Gmail starts sending to spam above 0.3% complaints, and Studio stops you well before that. Every email has an unsubscribe link and only goes to people with an email who said yes.
          </div>
        </div>
      </div>
    </>
  );
}
