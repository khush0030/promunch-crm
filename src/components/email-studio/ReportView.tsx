"use client";

import { useQuery } from "@tanstack/react-query";
import { KpiStrip, Kpi, Card, HBars, Table, Callout } from "@/components/pm";
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

  const topLink = links[0];
  const linkLabel = (url: string) => url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\?.*$/, "");
  const trustBad = f.bounced / base > 0.02 || f.complained / base > 0.001;

  return (
    <div className={s.stack} style={{ gap: 16 }}>
      <p className={s.sumLine}>
        <span>
          Went to <b>{f.accepted.toLocaleString("en-IN")}</b> people{campaign.sent_at ? ` on ${when(campaign.sent_at)}` : ""}.{" "}
          <b>{orders.length} order{orders.length === 1 ? "" : "s"}, {inr(revenue)}.</b>
        </span>
      </p>
      <KpiStrip>
        <Kpi label="Delivered" value={f.delivered.toLocaleString("en-IN")} sub={`${pct(f.delivered / base)} of ${f.accepted.toLocaleString("en-IN")} sent`} />
        <Kpi label="Opened" value={pct(f.opened / base)} sub={`${f.opened.toLocaleString("en-IN")} people · inflated by Apple Mail`} tip="Apple Mail opens every email automatically for privacy, so opens run high. Trust clicks and revenue more." />
        <Kpi label="Clicked" value={pct(f.clicked / base)} sub={`${f.clicked.toLocaleString("en-IN")} people`} tip="People who tapped at least one link." />
        <Kpi label="Revenue" value={inr(revenue)} sub={`${orders.length} order${orders.length === 1 ? "" : "s"} from this email`} tip="Orders with this email's link tag, or placed within 5 days of clicking it. Updated every 3 hours." />
      </KpiStrip>
      <div className="pm2-g2">
        <Card title="What they clicked" basis="unique people per link">
          {links.length === 0 ? (
            <div className={s.hint}>No clicks yet.</div>
          ) : (
            <div className={s.stack}>
              <p className={s.takeaway}>
                <b>{linkLabel(topLink.url)}</b> got the most clicks ({topLink.count}).
              </p>
              <HBars
                items={links.slice(0, 8).map((x) => ({ label: linkLabel(x.url), value: x.count, text: x.count.toLocaleString("en-IN"), tip: x.url, color: "var(--pm-ink2)" }))}
              />
            </div>
          )}
        </Card>
        <Card title="Inbox trust" basis="this campaign">
          <p className={s.takeaway}>
            {trustBad ? "Too many bounces or spam marks. Clean the list and slow down." : "Inboxes still trust you. Bounces and spam marks are under the limits."}
          </p>
          <div className={s.trust}>
            <div><span>Unsubscribed</span><b>{f.unsubscribed.toLocaleString("en-IN")}</b><em>{pct(f.unsubscribed / base)}</em></div>
            <div><span>Bounced</span><b className={f.bounced / base > 0.02 ? s.bad : undefined}>{f.bounced.toLocaleString("en-IN")}</b><em>{f.bounced / base > 0.02 ? "over 2%" : pct(f.bounced / base)}</em></div>
            <div><span>Marked as spam</span><b className={f.complained / base > 0.001 ? s.bad : undefined}>{f.complained.toLocaleString("en-IN")}</b><em>{f.complained / base > 0.001 ? "over 0.1%" : pct(f.complained / base)}</em></div>
            <div><span>Failed to send</span><b>{f.failed.toLocaleString("en-IN")}</b><em>{f.failed ? "check the address" : "none"}</em></div>
          </div>
        </Card>
      </div>
      <div>
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
