"use client";
import { useEffect, useState } from "react";
import { IndianRupee, Mail, Coins, TrendingUp, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { KpiCard, Panel, MiniBar, StatLine, DataTable } from "@/components/pm";
import type { Column, KpiTone } from "@/components/pm";
import { StudioHeader } from "@/components/email-studio/StudioHeader";

const dateRanges = ["Last 7 Days", "Last 30 Days", "Last 90 Days"];
const rangeShort: Record<string, string> = { "Last 7 Days": "7 days", "Last 30 Days": "30 days", "Last 90 Days": "90 days" };
const rangeDays: Record<string, number> = { "Last 7 Days": 7, "Last 30 Days": 30, "Last 90 Days": 90 };

type TopMetric = { label: string; value: string; icon: React.ReactNode; tone: KpiTone; sub: string; up: boolean };
type CampaignPerf = { name: string; sent: string; openRate: string; clickRate: string; revenue: string };
type FlowPerf = { name: string; trigger: string; revenue: string; conversion: string };
type EmailHealthRow = { label: string; value: string; pct: number; color: string };
type Growth = { newSubs: number; unsubscribed: number; net: number; totalActive: number };

export default function AnalyticsPage() {
  const supabase = createSupabaseBrowserClient();
  const [activeRange, setActiveRange] = useState("Last 30 Days");
  const [topMetrics, setTopMetrics] = useState<TopMetric[]>([]);
  const [campaignPerf, setCampaignPerf] = useState<CampaignPerf[]>([]);
  const [flowPerf, setFlowPerf] = useState<FlowPerf[]>([]);
  const [emailHealth, setEmailHealth] = useState<EmailHealthRow[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const days = rangeDays[activeRange];
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const contactCount = (opts: { status?: string; since?: string }) => {
        let q = supabase.from("contacts").select("status", { count: "exact", head: true });
        if (opts.status) q = q.eq("status", opts.status);
        if (opts.since) q = q.gte("created_at", opts.since);
        return q.then((r) => r.count ?? 0);
      };
      const eventCount = (type?: string) => {
        let q = supabase.from("email_events").select("event_type", { count: "exact", head: true }).gte("created_at", sinceIso);
        if (type) q = q.eq("event_type", type);
        return q.then((r) => r.count ?? 0);
      };

      const [campaignsRes, flowsRes, totalActive, newSubs, totalEventsRaw, delivered, bounced, unsubscribed] =
        await Promise.all([
          supabase.from("campaigns").select("*").gte("created_at", sinceIso).order("revenue_attributed", { ascending: false }),
          supabase.from("flows").select("*").order("revenue_attributed", { ascending: false }),
          contactCount({ status: "active" }),
          contactCount({ since: sinceIso }),
          eventCount(),
          eventCount("delivered"),
          eventCount("bounced"),
          eventCount("unsubscribed"),
        ]);

      const campaigns = campaignsRes.data || [];
      const totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalRevenue = campaigns.reduce((s, c) => s + (Number(c.revenue_attributed) || 0), 0);
      const rpe = totalSent > 0 ? totalRevenue / totalSent : 0;

      const totalEvts = totalEventsRaw || 1;
      const listGrowthPct = totalActive > 0 ? ((newSubs - unsubscribed) / totalActive) * 100 : 0;

      setTopMetrics([
        { label: "Email revenue", value: totalRevenue > 0 ? `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0", icon: <IndianRupee />, tone: "g", sub: totalRevenue > 0 ? "this period" : "no sends in range", up: totalRevenue > 0 },
        { label: "Emails sent", value: totalSent > 0 ? totalSent.toLocaleString() : "0", icon: <Mail />, tone: "b", sub: totalSent > 0 ? "this period" : "no campaigns yet", up: totalSent > 0 },
        { label: "Revenue / email", value: rpe > 0 ? `₹${rpe.toFixed(2)}` : "₹0", icon: <Coins />, tone: "o", sub: rpe > 0 ? "vs prev." : "—", up: rpe > 0 },
        { label: "List growth", value: totalActive > 0 ? `${listGrowthPct >= 0 ? "+" : ""}${listGrowthPct.toFixed(1)}%` : "0%", icon: <TrendingUp />, tone: "g", sub: newSubs > 0 ? `${newSubs} net new` : "—", up: newSubs > 0 },
      ]);

      setCampaignPerf(
        campaigns.slice(0, 5).map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "—",
          // A resend can count more opens than sends; a rate never reads above 100%.
          openRate: c.total_sent > 0 ? Math.min(100, (c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "—",
          clickRate: c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "—",
          revenue: c.revenue_attributed > 0 ? `₹${Number(c.revenue_attributed).toLocaleString()}` : "—",
        }))
      );

      setFlowPerf(
        (flowsRes.data || []).slice(0, 5).map((f) => ({
          name: f.name,
          trigger: (f.trigger_type || "").replace(/_/g, " "),
          revenue: f.revenue_attributed > 0 ? `₹${Number(f.revenue_attributed).toLocaleString()}` : "—",
          conversion: f.total_entered > 0 ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%" : "—",
        }))
      );

      const deliveryPct = totalEventsRaw > 0 ? (delivered / totalEvts) * 100 : 0;
      const bouncePct = totalEventsRaw > 0 ? (bounced / totalEvts) * 100 : 0;
      const unsubPct = totalEventsRaw > 0 ? (unsubscribed / totalEvts) * 100 : 0;
      setEmailHealth([
        { label: "Delivery rate", value: totalEventsRaw > 0 ? `${deliveryPct.toFixed(1)}%` : "—", pct: deliveryPct, color: "var(--pm-green)" },
        { label: "Bounce rate", value: totalEventsRaw > 0 ? `${bouncePct.toFixed(2)}%` : "—", pct: Math.min(100, bouncePct * 10), color: "var(--pm-gold)" },
        { label: "Spam rate", value: "—", pct: 0, color: "var(--pm-blue)" },
        { label: "Unsubscribe rate", value: totalEventsRaw > 0 ? `${unsubPct.toFixed(2)}%` : "—", pct: Math.min(100, unsubPct * 10), color: "var(--pm-hint)" },
      ]);

      setGrowth({ newSubs, unsubscribed, net: newSubs - unsubscribed, totalActive });
      setLoaded(true);
    }
    load();
  }, [activeRange]);

  const campaignCols: Column<CampaignPerf>[] = [
    { header: "Campaign", cell: (c) => <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160, fontWeight: 600 }}>{c.name}</div> },
    { header: "Sent", cell: (c) => c.sent },
    { header: "Open", cell: (c) => c.openRate },
    { header: "Click", cell: (c) => c.clickRate },
    { header: "Revenue", cell: (c) => <span className="pm-b7">{c.revenue}</span> },
  ];
  const flowCols: Column<FlowPerf>[] = [
    { header: "Flow", cell: (f) => <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130, fontWeight: 600 }}>{f.name}</div> },
    { header: "Trigger", cell: (f) => <span className="pm-dim" style={{ textTransform: "capitalize" }}>{f.trigger}</span> },
    { header: "Revenue", cell: (f) => <span className="pm-b7">{f.revenue}</span> },
    { header: "Conv.", cell: (f) => f.conversion },
  ];

  const healthEmpty = !loaded || emailHealth.every((h) => h.value === "—");

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
      <div className="pm-kpis">
        {topMetrics.map((m) => (
          <KpiCard key={m.label} label={m.label} value={m.value} icon={m.icon} tone={m.tone} sub={m.sub} spark deltaDir={m.up ? "up" : "flat"} />
        ))}
      </div>

      <div className="pm-grid g-2-1" style={{ marginTop: 16 }}>
        <Panel title="Subscriber growth" icon={<Users className="tic" />} caption="This period">
          {growth ? (
            <>
              <StatLine
                items={[
                  { n: `+${growth.newSubs}`, l: "New subscribers", color: "var(--pm-green)" },
                  { n: growth.unsubscribed > 0 ? `−${growth.unsubscribed}` : "0", l: "Unsubscribed", color: growth.unsubscribed > 0 ? "var(--pm-terra)" : "var(--pm-ink)" },
                  { n: `${growth.net >= 0 ? "+" : ""}${growth.net}`, l: "Net growth", color: growth.net >= 0 ? "var(--pm-green)" : "var(--pm-terra)" },
                ]}
              />
              {/* Calm: a hairline row, not a filled block. */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--pm-line)", display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ font: "400 28px/1 var(--pm-display)", color: "var(--pm-ink)" }}>{growth.totalActive.toLocaleString("en-IN")}</span>
                <span style={{ fontSize: 14.5, color: "var(--pm-ink2)" }}>active subscribers</span>
              </div>
            </>
          ) : (
            <div className="pm-dim" style={{ fontSize: 13 }}>Loading…</div>
          )}
        </Panel>

        <Panel title="Email health" icon={<Mail className="tic" />} caption="Deliverability signals">
          {emailHealth.map((item) => (
            <MiniBar key={item.label} label={item.label} value={item.value} pct={item.pct} color={item.color} />
          ))}
          {healthEmpty && (
            <div style={{ marginTop: 12, fontSize: 14, color: "var(--pm-muted)" }}>
              Health metrics populate after your first campaign is sent.
            </div>
          )}
        </Panel>
      </div>

      <div className="pm-grid g-11" style={{ marginTop: 14 }}>
        <Panel title="Top campaigns" icon={<Mail className="tic" />}>
          {campaignPerf.length > 0 ? (
            <div style={{ marginTop: 4 }}><DataTable columns={campaignCols} rows={campaignPerf} rowKey={(_, i) => i} /></div>
          ) : (
            <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>{loaded ? "No campaigns in this range" : "Loading…"}</div>
          )}
        </Panel>
        <Panel title="Top flows" icon={<TrendingUp className="tic" />}>
          {flowPerf.length > 0 ? (
            <div style={{ marginTop: 4 }}><DataTable columns={flowCols} rows={flowPerf} rowKey={(_, i) => i} /></div>
          ) : (
            <div className="pm-dim" style={{ textAlign: "center", fontSize: 12.5, padding: "32px 0" }}>{loaded ? "No flows yet" : "Loading…"}</div>
          )}
        </Panel>
      </div>
    </div>
    </>
  );
}
