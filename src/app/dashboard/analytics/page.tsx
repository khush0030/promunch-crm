"use client";

// Email -> Results. Every number comes from /api/email-studio/results, which
// uses the exact definitions of the Email overview (/api/email-studio/overview)
// for the chosen window: Email Studio send ledgers (campaign_emails +
// email_sends), email_attributions for revenue, and the consented, unsuppressed
// audience for "can email". No legacy tables, no browser Supabase client.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IndianRupee, Mail, MousePointerClick, TrendingUp, Users } from "lucide-react";
import { KpiCard, Panel, MiniBar, StatLine, DataTable } from "@/components/pm";
import type { Column } from "@/components/pm";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { getJson, inr, pct } from "@/components/email-studio/api";
import css from "./analytics.module.css";

const dateRanges = ["Last 7 Days", "Last 30 Days", "Last 90 Days"];
const rangeShort: Record<string, string> = { "Last 7 Days": "7 days", "Last 30 Days": "30 days", "Last 90 Days": "90 days" };
const rangeDays: Record<string, number> = { "Last 7 Days": 7, "Last 30 Days": 30, "Last 90 Days": 90 };

type Line = { id: string; name: string; sent: number; opens: number; clicks: number; orders: number; revenue: number };
type Results = {
  days: number;
  emailsSent: number;
  campaignSent: number;
  flowSent: number;
  opens: number;
  clicks: number;
  clickRate: number | null;
  openRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  bounced: number;
  complained: number;
  revenue: number;
  flowRevenue: number;
  orders: number;
  unsubscribed: number;
  subscribers: number | null;
  campaigns: Line[];
  automations: Line[];
};

const n = (x: number) => x.toLocaleString("en-IN");
const rate = (part: number, whole: number) => (whole > 0 ? pct(part / whole) : "–");

// Phone layout for the top-lines tables: one card per row, nothing clipped.
function LineCards({ rows }: { rows: Line[] }) {
  return (
    <div className={css.cards}>
      {rows.map((c) => (
        <div key={c.id} className={css.card}>
          <div className={css.name}>{c.name}</div>
          <dl className={css.stats}>
            <div><dt>Sent</dt><dd>{c.sent ? n(c.sent) : "–"}</dd></div>
            <div><dt>Clicked</dt><dd>{rate(c.clicks, c.sent)}</dd></div>
            <div><dt>Revenue</dt><dd className="pm-b7">{c.revenue ? inr(c.revenue) : "–"}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState("Last 30 Days");
  const days = rangeDays[activeRange];
  const q = useQuery({
    queryKey: ["email-studio-results", days],
    queryFn: () => getJson<Results>(`/api/email-studio/results?days=${days}`),
  });
  const d = q.data;
  const span = rangeShort[activeRange];

  const lineCols = (label: string): Column<Line>[] => [
    { header: label, cell: (c) => <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170, fontWeight: 600 }}>{c.name}</div> },
    { header: "Sent", cell: (c) => (c.sent ? n(c.sent) : "–") },
    { header: "Clicked", cell: (c) => rate(c.clicks, c.sent) },
    { header: "Revenue", cell: (c) => <span className="pm-b7">{c.revenue ? inr(c.revenue) : "–"}</span> },
  ];

  const kpis = [
    {
      label: `Revenue · ${span}`,
      value: d ? inr(d.revenue) : "…",
      icon: <IndianRupee />,
      tone: "g" as const,
      sub: d ? `${d.orders} orders · ${inr(d.flowRevenue)} from automations` : "",
      up: !!d && d.revenue > 0,
    },
    {
      label: "Emails sent",
      value: d ? n(d.emailsSent) : "…",
      icon: <Mail />,
      tone: "b" as const,
      sub: d ? `${n(d.campaignSent)} from campaigns · ${n(d.flowSent)} from automations` : "",
      up: !!d && d.emailsSent > 0,
    },
    {
      label: "Clicked",
      value: d ? pct(d.clickRate) : "…",
      icon: <MousePointerClick />,
      tone: "o" as const,
      sub: d ? `${n(d.clicks)} ${d.clicks === 1 ? "click" : "clicks"}${d.emailsSent ? ` · ${inr(d.revenue / d.emailsSent)} per email` : ""}` : "",
      up: !!d && d.clicks > 0,
    },
    {
      label: "Can email",
      value: d ? (d.subscribers != null ? n(d.subscribers) : "–") : "…",
      icon: <Users />,
      tone: "g" as const,
      sub: "said yes and have an email",
      up: false,
    },
  ];

  // Rates are drawn on a scale where the warning limit sits mid-bar.
  const bar = (r: number | null, limit: number) => (r == null ? 0 : Math.min(100, (r / (limit * 2)) * 100));

  return (
    <>
      <StudioHeader
        tab="results"
        title="Results"
        summary="How email is doing, and whether inboxes still trust you."
        actions={
          <div className="pm2-seg" role="group" aria-label="Period">
            {dateRanges.map((r) => (
              <button key={r} type="button" className={activeRange === r ? "on" : ""} aria-pressed={activeRange === r} onClick={() => setActiveRange(r)}>{rangeShort[r]}</button>
            ))}
          </div>
        }
      />
      <div className="pm-page">
        {q.error && (
          <div role="alert" style={{ marginBottom: 14, fontSize: 14, color: "var(--pm-terra)" }}>
            Could not load results: {(q.error as Error).message}
          </div>
        )}
        <div className="pm-kpis">
          {kpis.map((m) => (
            <KpiCard key={m.label} label={m.label} value={m.value} icon={m.icon} tone={m.tone} sub={m.sub} deltaDir={m.up ? "up" : "flat"} />
          ))}
        </div>

        <div className="pm-grid g-2-1" style={{ marginTop: 16 }}>
          <Panel title="Engagement" icon={<TrendingUp className="tic" />} caption={`Last ${span}`}>
            {d ? (
              <>
                <StatLine
                  items={[
                    { n: n(d.emailsSent), l: "Emails sent", color: "var(--pm-ink)" },
                    { n: n(d.opens), l: `Opened · ${pct(d.openRate)}`, color: "var(--pm-ink)" },
                    { n: n(d.clicks), l: `Clicked · ${pct(d.clickRate)}`, color: "var(--pm-green)" },
                    { n: n(d.unsubscribed), l: "Unsubscribed", color: "var(--pm-ink)" },
                  ]}
                />
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--pm-line)", fontSize: 14, color: "var(--pm-ink2)" }}>
                  Clicks are the number to trust. Opens run high because Apple Mail opens every email for privacy.
                </div>
              </>
            ) : (
              <div className="pm-dim" style={{ fontSize: 13 }}>Loading…</div>
            )}
          </Panel>

          <Panel title="Inbox health" icon={<Mail className="tic" />} caption="Campaign sends">
            <MiniBar label="Bounce rate (keep under 2%)" value={d ? pct(d.bounceRate) : "…"} pct={bar(d?.bounceRate ?? null, 0.02)} color="var(--pm-gold)" />
            <MiniBar label="Spam complaints (keep under 0.1%)" value={d ? pct(d.complaintRate) : "…"} pct={bar(d?.complaintRate ?? null, 0.001)} color="var(--pm-terra)" />
            {d && d.bounceRate == null && (
              <div style={{ marginTop: 12, fontSize: 14, color: "var(--pm-muted)" }}>
                No campaign sends in the last {span}. Health shows once a campaign goes out.
              </div>
            )}
          </Panel>
        </div>

        <div className="pm-grid g-11" style={{ marginTop: 14 }}>
          <Panel title="Top campaigns" icon={<Mail className="tic" />} caption={`Sent in the last ${span}`}>
            {d?.campaigns.length ? (
              <>
                <div className={css.table} style={{ marginTop: 4 }}><DataTable columns={lineCols("Campaign")} rows={d.campaigns.slice(0, 5)} rowKey={(c) => c.id} /></div>
                <LineCards rows={d.campaigns.slice(0, 5)} />
              </>
            ) : (
              <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>{d ? "No campaigns sent in this range" : "Loading…"}</div>
            )}
          </Panel>
          <Panel title="Top automations" icon={<TrendingUp className="tic" />} caption={`Sent in the last ${span}`}>
            {d?.automations.length ? (
              <>
                <div className={css.table} style={{ marginTop: 4 }}><DataTable columns={lineCols("Automation")} rows={d.automations.slice(0, 5)} rowKey={(c) => c.id} /></div>
                <LineCards rows={d.automations.slice(0, 5)} />
              </>
            ) : (
              <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>{d ? "No automation emails in this range" : "Loading…"}</div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
