"use client";

import { useQuery } from "@tanstack/react-query";
import { KpiStrip, Kpi, Card, Table, Callout } from "@/components/pm";
import { getJson, inr, pct, when } from "./api";
import s from "./studio.module.css";

type Report = {
  campaign: { name: string; subject: string; status: string; sent_at: string | null };
  funnel: { recipients: number; accepted: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number; unsubscribed: number; failed: number };
  links: { url: string; count: number }[];
  orders: { order_number: string | null; order_at: string; revenue: number; model: string }[];
  revenue: number;
};

// One campaign's results. Clicks and revenue lead; opens are shown with a
// caveat because Apple Mail Privacy Protection auto-opens every email.
export function ReportView({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["email-studio-report", id],
    queryFn: () => getJson<Report>(`/api/email-studio/campaigns/${id}/report`),
    refetchInterval: 60_000,
  });
  if (q.isLoading) return <div className="pm2-skel" style={{ minHeight: 300 }} />;
  if (q.error || !q.data) return <Callout tone="crit" title="Could not load the report" body={(q.error as Error)?.message} />;
  const { funnel: f, links, orders, revenue, campaign } = q.data;
  const base = f.accepted || 1;

  return (
    <div className={s.stack} style={{ gap: 16 }}>
      <KpiStrip>
        <Kpi label="Revenue" value={inr(revenue)} sub={`${orders.length} order${orders.length === 1 ? "" : "s"} from this email`} tip="Orders with this email's link tag, or placed within 5 days of clicking it. Updated every 3 hours." />
        <Kpi label="Clicked" value={f.clicked.toLocaleString("en-IN")} sub={`${pct(f.clicked / base)} of sent`} tip="People who tapped at least one link." />
        <Kpi label="Delivered" value={f.delivered.toLocaleString("en-IN")} sub={`of ${f.accepted.toLocaleString("en-IN")} sent`} />
        <Kpi label="Opened" value={f.opened.toLocaleString("en-IN")} sub={`${pct(f.opened / base)} · inflated by Apple Mail`} tip="Apple Mail opens every email automatically for privacy, so opens run high. Trust clicks and revenue more." />
      </KpiStrip>
      <KpiStrip cols={4}>
        <Kpi label="Unsubscribed" value={f.unsubscribed} sub={pct(f.unsubscribed / base)} />
        <Kpi label="Bounced" value={f.bounced} sub={f.bounced / base > 0.02 ? "over 2%: clean the list" : pct(f.bounced / base)} />
        <Kpi label="Marked as spam" value={f.complained} sub={f.complained / base > 0.001 ? "over 0.1%: slow down" : pct(f.complained / base)} />
        <Kpi label="Failed to send" value={f.failed} sub={campaign.sent_at ? `sent ${when(campaign.sent_at)}` : ""} />
      </KpiStrip>
      <div className="pm2-g2">
        <Card title="Links clicked" basis="unique people per link">
          {links.length === 0 ? (
            <div className={s.hint}>No clicks yet.</div>
          ) : (
            links.map((l) => (
              <div key={l.url} className={s.linkRow}>
                <span title={l.url}>{l.url.replace(/^https?:\/\//, "")}</span>
                <b>{l.count}</b>
              </div>
            ))
          )}
        </Card>
        <Card title="Orders from this email" basis="Shopify">
          <Table
            cols={[
              { h: "Order", render: (o) => (o.order_number ? `#${o.order_number}` : "–") },
              { h: "When", render: (o) => when(o.order_at) },
              { h: "How", render: (o) => (o.model === "utm" ? "link tag" : "clicked, ordered in 5 days") },
              { h: "Value", num: true, render: (o) => inr(Number(o.revenue)) },
            ]}
            rows={orders}
            rowKey={(o, i) => `${o.order_number}-${i}`}
            empty={<span className={s.hint}>No orders credited yet. Attribution runs every 3 hours.</span>}
          />
        </Card>
      </div>
    </div>
  );
}
