"use client";
import { useEffect, useState } from "react";
import { DollarSign, Mail, TrendingUp, Users, CheckCircle2, AlertTriangle, ShieldAlert, UserMinus } from "lucide-react";
import { supabase } from "@/lib/supabase";

const dateRanges = ["Last 7 Days", "Last 30 Days", "Last 90 Days"];
const rangeDays: Record<string, number> = {
  "Last 7 Days": 7,
  "Last 30 Days": 30,
  "Last 90 Days": 90,
};

type TopMetric = {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
  bg: string;
};

type CampaignPerf = {
  name: string;
  sent: string;
  openRate: string;
  clickRate: string;
  revenue: string;
};

type FlowPerf = {
  name: string;
  trigger: string;
  revenue: string;
  conversion: string;
};

type EmailHealthRow = {
  label: string;
  value: string;
  icon: typeof CheckCircle2;
  color: string;
  bg: string;
  note: string;
};

type Growth = {
  newSubs: number;
  unsubscribed: number;
  net: number;
  totalActive: number;
};

export default function AnalyticsPage() {
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

      const [campaignsRes, flowsRes, contactsRes, eventsRes] = await Promise.all([
        supabase.from("campaigns").select("*").gte("created_at", sinceIso).order("revenue_attributed", { ascending: false }),
        supabase.from("flows").select("*").order("revenue_attributed", { ascending: false }),
        supabase.from("contacts").select("status, created_at"),
        supabase.from("email_events").select("event_type, created_at").gte("created_at", sinceIso),
      ]);

      const campaigns = campaignsRes.data || [];
      const totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalRevenue = campaigns.reduce((s, c) => s + (Number(c.revenue_attributed) || 0), 0);
      const rpe = totalSent > 0 ? totalRevenue / totalSent : 0;

      const allContacts = contactsRes.data || [];
      const totalActive = allContacts.filter((c) => c.status === "active").length;
      const newSubs = allContacts.filter((c) => c.created_at && c.created_at >= sinceIso).length;
      const events = eventsRes.data || [];
      const unsubscribed = events.filter((e) => e.event_type === "unsubscribed").length;
      const delivered = events.filter((e) => e.event_type === "delivered").length;
      const bounced = events.filter((e) => e.event_type === "bounced").length;
      const totalEvts = events.length || 1;

      const listGrowthPct = totalActive > 0 ? ((newSubs - unsubscribed) / totalActive) * 100 : 0;

      setTopMetrics([
        {
          label: "Email Revenue",
          value: totalRevenue > 0 ? `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "",
          icon: DollarSign,
          color: "#10b981",
          bg: "rgba(16,185,129,0.1)",
        },
        {
          label: "Emails Sent",
          value: totalSent > 0 ? totalSent.toLocaleString() : "",
          icon: Mail,
          color: "#00B4D8",
          bg: "rgba(0,180,216,0.1)",
        },
        {
          label: "Revenue per Email",
          value: rpe > 0 ? `₹${rpe.toFixed(2)}` : "",
          icon: TrendingUp,
          color: "#F5B731",
          bg: "rgba(245,183,49,0.1)",
        },
        {
          label: "List Growth",
          value: totalActive > 0 ? `${listGrowthPct >= 0 ? "+" : ""}${listGrowthPct.toFixed(1)}%` : "",
          icon: Users,
          color: "#B91C4A",
          bg: "rgba(185,28,74,0.1)",
        },
      ]);

      setCampaignPerf(
        campaigns.slice(0, 5).map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "",
          openRate: c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "",
          clickRate: c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "",
          revenue: c.revenue_attributed > 0 ? `₹${Number(c.revenue_attributed).toLocaleString()}` : "",
        }))
      );

      setFlowPerf(
        (flowsRes.data || []).slice(0, 5).map((f) => {
          const conv = f.total_entered > 0
            ? ((f.total_converted / f.total_entered) * 100).toFixed(1) + "%"
            : "";
          return {
            name: f.name,
            trigger: (f.trigger_type || "").replace(/_/g, " "),
            revenue: f.revenue_attributed > 0 ? `₹${Number(f.revenue_attributed).toLocaleString()}` : "",
            conversion: conv,
          };
        })
      );

      setEmailHealth([
        {
          label: "Delivery Rate",
          value: events.length > 0 ? `${((delivered / totalEvts) * 100).toFixed(1)}%` : "",
          icon: CheckCircle2,
          color: "#10b981",
          bg: "rgba(16,185,129,0.1)",
          note: "",
        },
        {
          label: "Bounce Rate",
          value: events.length > 0 ? `${((bounced / totalEvts) * 100).toFixed(2)}%` : "",
          icon: AlertTriangle,
          color: "#F5B731",
          bg: "rgba(245,183,49,0.1)",
          note: "",
        },
        {
          label: "Spam Rate",
          value: "",
          icon: ShieldAlert,
          color: "#10b981",
          bg: "rgba(16,185,129,0.1)",
          note: "",
        },
        {
          label: "Unsubscribe Rate",
          value: events.length > 0 ? `${((unsubscribed / totalEvts) * 100).toFixed(2)}%` : "",
          icon: UserMinus,
          color: "#4b5563",
          bg: "rgba(161,161,170,0.1)",
          note: "",
        },
      ]);

      setGrowth({
        newSubs,
        unsubscribed,
        net: newSubs - unsubscribed,
        totalActive,
      });

      setLoaded(true);
    }
    load();
  }, [activeRange]);

  return (
    <div style={{ padding: "32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px" }}>Analytics</h1>
          <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>
            Performance overview for PROMUNCH email marketing
          </p>
        </div>
        <div style={{ display: "flex", gap: "4px", backgroundColor: "#ffffff", padding: "4px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
          {dateRanges.map((r) => (
            <button
              key={r}
              onClick={() => setActiveRange(r)}
              style={{
                padding: "7px 18px",
                borderRadius: "7px",
                border: "none",
                backgroundColor: activeRange === r ? "#e5e7eb" : "transparent",
                color: activeRange === r ? "#111827" : "#6b7280",
                fontSize: "13px",
                fontWeight: activeRange === r ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {(topMetrics.length > 0 ? topMetrics : Array(4).fill(null)).map((metric, idx) => (
          <div
            key={metric?.label || idx}
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              padding: "20px",
              position: "relative",
              overflow: "hidden",
              minHeight: "128px",
            }}
          >
            {metric ? (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "10px",
                      backgroundColor: metric.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <metric.icon size={20} color={metric.color} />
                  </div>
                </div>
                <div style={{ fontSize: "26px", fontWeight: 700, color: "#111827", letterSpacing: "-0.5px", marginBottom: "4px" }}>
                  {metric.value}
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>{metric.label}</div>
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: "80px",
                    height: "80px",
                    background: `radial-gradient(circle at 100% 100%, ${metric.bg}, transparent)`,
                    pointerEvents: "none",
                  }}
                />
              </>
            ) : (
              <div style={{ color: "#d1d5db", fontSize: "13px" }}></div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "20px" }}>Top Campaigns</h2>
          {campaignPerf.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Campaign", "Sent", "Open", "Click", "Revenue"].map((h) => (
                    <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px", borderBottom: "1px solid #e5e7eb" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaignPerf.map((c, i) => (
                  <tr key={i} style={{ borderBottom: i < campaignPerf.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                    <td style={{ padding: "12px 0", fontSize: "13px", color: "#111827", fontWeight: 500, maxWidth: "140px" }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>{c.name}</div>
                    </td>
                    <td style={{ padding: "12px 4px", fontSize: "12px", color: "#4b5563" }}>{c.sent}</td>
                    <td style={{ padding: "12px 4px", fontSize: "12px", color: "#00B4D8" }}>{c.openRate}</td>
                    <td style={{ padding: "12px 4px", fontSize: "12px", color: "#F5B731" }}>{c.clickRate}</td>
                    <td style={{ padding: "12px 0", fontSize: "13px", fontWeight: 700, color: "#10b981" }}>{c.revenue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
              {loaded ? "No campaigns in this range" : ""}
            </div>
          )}
        </div>

        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "20px" }}>Top Flows</h2>
          {flowPerf.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Flow", "Trigger", "Revenue", "Conv."].map((h) => (
                    <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px", borderBottom: "1px solid #e5e7eb" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flowPerf.map((f, i) => (
                  <tr key={i} style={{ borderBottom: i < flowPerf.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                    <td style={{ padding: "12px 0", fontSize: "13px", color: "#111827", fontWeight: 500, maxWidth: "130px" }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>{f.name}</div>
                    </td>
                    <td style={{ padding: "12px 4px", fontSize: "12px", color: "#4b5563", maxWidth: "120px" }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.trigger}</div>
                    </td>
                    <td style={{ padding: "12px 4px", fontSize: "13px", fontWeight: 700, color: "#10b981" }}>{f.revenue}</td>
                    <td style={{ padding: "12px 0", fontSize: "13px", color: "#F5B731", fontWeight: 600 }}>{f.conversion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
              {loaded ? "No flows yet" : ""}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "16px" }}>
        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "20px" }}>Email Health</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {emailHealth.map((item) => (
              <div
                key={item.label}
                style={{
                  backgroundColor: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "10px",
                    backgroundColor: item.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <item.icon size={20} color={item.color} />
                </div>
                <div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#111827" }}>{item.value}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>Subscriber Growth</h2>
          <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "24px" }}>This period</p>

          {growth ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {[
                  { label: "New Subscribers", value: `+${growth.newSubs}`, color: "#10b981" },
                  { label: "Unsubscribed", value: `-${growth.unsubscribed}`, color: "#ef4444" },
                  { label: "Net Growth", value: `${growth.net >= 0 ? "+" : ""}${growth.net}`, color: "#00B4D8" },
                ].map((item) => (
                  <div key={item.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "13px", color: "#4b5563" }}>{item.label}</span>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: item.color }}>{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginTop: "24px",
                  padding: "16px",
                  backgroundColor: "rgba(0,180,216,0.06)",
                  border: "1px solid rgba(0,180,216,0.2)",
                  borderRadius: "10px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#00B4D8" }}>
                  {growth.totalActive.toLocaleString()}
                </div>
                <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>Total Active Subscribers</div>
              </div>
            </>
          ) : (
            <div style={{ color: "#9ca3af", fontSize: "13px" }}></div>
          )}
        </div>
      </div>
    </div>
  );
}
