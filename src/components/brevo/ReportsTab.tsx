"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { KpiStrip, Kpi, Card, BarChart, LineChart, PeriodPicker, HBars, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { ReportsResponse } from "@/app/api/brevo/reports/route";
import type { DailyRow, TrendBucket } from "@/lib/brevo-shape";
import { int, rate, clock, getJson, ErrorCallout, SectionView } from "./format";

type Days = "7d" | "30d" | "90d";
const PERIODS: readonly Days[] = ["7d", "30d", "90d"];

const num = (row: DailyRow, k: string) => (typeof row[k] === "number" ? (row[k] as number) : 0);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

const WA_LABEL: Record<string, string> = { sent: "Sent", delivered: "Delivered", read: "Read", error: "Failed", soft_bounce: "Soft bounce", hard_bounce: "Hard bounce", unsubscribe: "Unsubscribed", reply: "Replied" };

// Rates per month as a table: a line chart would drop to 0% in months with no
// sends, which reads as "nobody opened".
const monthCols: TableCol<TrendBucket>[] = [
  { h: "Month", render: (b) => b.label },
  { h: "Campaigns", num: true, render: (b) => b.campaigns },
  { h: "Delivered", num: true, render: (b) => int(b.delivered) },
  { h: "Opens", num: true, render: (b) => rate(b.openRate) },
  { h: "Clicks", num: true, render: (b) => rate(b.clickRate) },
  { h: "Unsubs", num: true, render: (b) => int(b.unsubscribes) },
];

export function ReportsTab({ period, onPeriod }: { period: Days; onPeriod: (p: Days) => void }) {
  const days = period.replace("d", "");
  const q = useQuery({
    queryKey: ["brevo-reports", days],
    queryFn: () => getJson<ReportsResponse>(`/api/brevo/reports?days=${days}`),
    placeholderData: keepPreviousData,
  });

  const picker = <PeriodPicker options={PERIODS} value={period} onChange={onPeriod} caption={`last ${days} days, IST`} />;

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load Brevo reports" error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {picker}
        <span style={{ fontSize: 12.5, color: "var(--pm-muted)" }}>updated {clock(r.fetchedAt)}</span>
      </div>

      <Card title="Email campaigns" basis={`campaigns that delivered mail, last ${r.days} days`}>
        <SectionView s={r.campaigns} gatedTitle="Campaign reports unavailable">
          {({ summary: s, trend }) => (
            <>
              <KpiStrip>
                <Kpi label="Campaigns sent" value={int(s.campaignsSent)} sub={`${int(s.delivered)} delivered`} />
                <Kpi label="Open rate" value={rate(s.openRate)} sub="unique opens / delivered" tip={s.mppShare != null ? `${Math.round(s.mppShare)}% of opens are Apple Mail auto-opens.` : undefined} />
                <Kpi label="Click rate" value={rate(s.clickRate)} sub="unique clicks / delivered" />
                <Kpi label="Unsubscribes" value={int(s.unsubscribes)} sub={`${int(s.bounces)} bounced`} invert />
              </KpiStrip>
              <div className="pm2-g2" style={{ marginTop: 16 }}>
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--pm-muted)", marginBottom: 6 }}>Delivered per month</div>
                  <BarChart
                    cats={trend.map((b) => b.label)}
                    series={[{ name: "Delivered", color: "var(--pm-s-web)", values: trend.map((b) => b.delivered) }]}
                    yFormat="count"
                    labels
                    aria="Emails delivered per month"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--pm-muted)", marginBottom: 6 }}>Months with sends</div>
                  <Table
                    cols={monthCols}
                    rows={trend.filter((b) => b.campaigns > 0).reverse()}
                    rowKey={(b) => b.key}
                    card={(b) => ({ title: b.label, value: rate(b.openRate), meta: `${b.campaigns} campaigns · ${int(b.delivered)} delivered · ${rate(b.clickRate)} clicks` })}
                    empty="No campaigns delivered in the last 6 months"
                  />
                </div>
              </div>
            </>
          )}
        </SectionView>
      </Card>

      <div className="pm2-g2">
        <Card title="Orders from email" basis="Shopify orders with Brevo UTM tags">
          <SectionView s={r.emailOrders} gatedTitle="Order attribution unavailable">
            {(o) => (
              <>
                <KpiStrip cols={3}>
                  <Kpi label="Orders" value={int(o.orders)} sub={`of ${int(o.totalOrders)} orders`} />
                  <Kpi label="Revenue" value={`₹${int(o.revenue)}`} sub="creator seeds excluded" />
                  <Kpi label="Untracked orders" value={int(o.untracked)} sub="no UTM data from Shopify" invert />
                </KpiStrip>
                {o.byCampaign.length > 0 ? (
                  <HBars items={o.byCampaign.slice(0, 8).map((c) => ({ label: c.campaign, value: c.revenue, text: `₹${int(c.revenue)}`, sub: `${c.orders} orders`, color: "var(--pm-s-web)" }))} />
                ) : (
                  <div className="pm2-empty">
                    No orders tagged as coming from Brevo in this period.{o.untracked > o.totalOrders / 2 ? " Most orders carry no UTM data from Shopify at all, so this undercounts." : ""} Set a UTM campaign on each campaign so orders can be tied back.
                  </div>
                )}
              </>
            )}
          </SectionView>
        </Card>
        <Card title="Brevo revenue attribution" basis="Brevo's own tracking">
          <SectionView s={r.brevoRevenue} gatedTitle="Needs Brevo eCommerce">
            {(b) =>
              b.results.length === 0 ? (
                <div className="pm2-empty">No attributed revenue in this period.</div>
              ) : (
                <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
                  {Object.entries(b.totals).map(([k, v]) => (
                    <div key={k}>
                      {k}: <strong>{typeof v === "number" ? int(v) : String(v)}</strong>
                    </div>
                  ))}
                </div>
              )
            }
          </SectionView>
        </Card>
      </div>

      <Card title="Engagement from webhooks" basis="events Brevo pushed to the CRM in this period">
        <SectionView s={r.engagement} gatedTitle="Webhooks not connected">
          {(e) =>
            e.total === 0 ? (
              <div className="pm2-empty">No webhook events in this period.</div>
            ) : (
              <div className="pm2-g2">
                <HBars items={Object.entries(e.byEvent).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v, text: int(v), color: "var(--pm-s-web)" }))} />
                <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <strong>Most clicked links</strong>
                  {e.topLinks.length === 0 ? <span style={{ color: "var(--pm-muted)" }}>No clicks yet.</span> : e.topLinks.map((l) => (
                    <div key={l.url} style={{ wordBreak: "break-all" }}>
                      {int(l.clicks)} · {l.url}
                    </div>
                  ))}
                </div>
              </div>
            )
          }
        </SectionView>
      </Card>

      <div className="pm2-g2">
        <Card title="Transactional email" basis="single emails sent through Brevo's API">
          <SectionView s={r.transactional} gatedTitle="Transactional email reports unavailable">
            {({ totals, daily }) =>
              (totals.requests ?? 0) === 0 ? (
                <div className="pm2-empty">No transactional email sent through Brevo in this period. Order and invite emails go out through Resend.</div>
              ) : (
                <>
                  <KpiStrip cols={3}>
                    <Kpi label="Delivered" value={int(totals.delivered)} sub={`of ${int(totals.requests)} requested`} />
                    <Kpi label="Unique opens" value={int(totals.uniqueOpens)} sub={rate(totals.delivered ? (totals.uniqueOpens / totals.delivered) * 100 : null)} />
                    <Kpi label="Bounced / blocked" value={int((totals.hardBounces ?? 0) + (totals.softBounces ?? 0) + (totals.blocked ?? 0))} sub={`${int(totals.spamReports)} spam reports`} invert />
                  </KpiStrip>
                  <LineChart
                    labels={daily.map((d) => shortDay(d.date))}
                    series={[
                      { name: "Delivered", color: "var(--pm-s-web)", values: daily.map((d) => num(d, "delivered")) },
                      { name: "Unique opens", color: "var(--pm-orange)", values: daily.map((d) => num(d, "uniqueOpens")) },
                    ]}
                    yFormat="count"
                    aria="Transactional email per day"
                  />
                </>
              )
            }
          </SectionView>
        </Card>

        <Card title="SMS" basis="transactional SMS through Brevo">
          <SectionView s={r.sms} gatedTitle="SMS isn't set up">
            {({ totals, daily }) =>
              (totals.requests ?? 0) === 0 ? (
                <div className="pm2-empty">No SMS sent in this period.</div>
              ) : (
                <>
                  <KpiStrip cols={3}>
                    <Kpi label="Delivered" value={int(totals.delivered)} sub={`of ${int(totals.requests)} requested`} />
                    <Kpi label="Replies" value={int(totals.replied)} sub={`${int(totals.unsubscribed)} unsubscribed`} />
                    <Kpi label="Failed" value={int((totals.hardBounces ?? 0) + (totals.softBounces ?? 0) + (totals.blocked ?? 0) + (totals.rejected ?? 0))} sub="bounced, blocked or rejected" invert />
                  </KpiStrip>
                  <LineChart
                    labels={daily.map((d) => shortDay(d.date))}
                    series={[{ name: "Delivered", color: "var(--pm-s-web)", values: daily.map((d) => num(d, "delivered")) }]}
                    yFormat="count"
                    aria="SMS delivered per day"
                  />
                </>
              )
            }
          </SectionView>
        </Card>
      </div>

      <Card title="WhatsApp through Brevo" basis="report only. WhatsApp sending stays on the CRM's Meta connection">
        <SectionView s={r.whatsapp} gatedTitle="Brevo WhatsApp isn't on this plan">
          {({ counts, total }) =>
            total === 0 ? (
              <div className="pm2-empty">No WhatsApp activity in Brevo. All PROMUNCH WhatsApp runs through Meta directly (see WhatsApp → Analytics).</div>
            ) : (
              <HBars
                items={Object.entries(counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => ({ label: WA_LABEL[k] ?? k, value: v, text: int(v), color: "var(--pm-s-wa)" }))}
              />
            )
          }
        </SectionView>
      </Card>
    </>
  );
}
