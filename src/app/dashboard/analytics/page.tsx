"use client";
import { useState } from "react";
import { DollarSign, Mail, TrendingUp, Users, CheckCircle2, AlertTriangle, ShieldAlert, UserMinus } from "lucide-react";

const dateRanges = ["Last 7 Days", "Last 30 Days", "Last 90 Days"];

const topMetrics = [
  { label: "Email Revenue", value: "₹42,150", change: "+14.2%", icon: DollarSign, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  { label: "Emails Sent", value: "89,234", change: "+8.7%", icon: Mail, color: "#00B4D8", bg: "rgba(0,180,216,0.1)" },
  { label: "Revenue per Email", value: "₹0.47", change: "+5.1%", icon: TrendingUp, color: "#F5B731", bg: "rgba(245,183,49,0.1)" },
  { label: "List Growth", value: "+3.2%", change: "+1.1%", icon: Users, color: "#B91C4A", bg: "rgba(185,28,74,0.1)" },
];

const campaignPerformance = [
  { name: "Flash Sale — Weekend Blitz", sent: "12,450", openRate: "31.1%", clickRate: "9.8%", revenue: "₹12,340" },
  { name: "Protein Launch — April", sent: "11,200", openRate: "28.4%", clickRate: "6.2%", revenue: "₹8,420" },
  { name: "Member Exclusive Deal", sent: "6,800", openRate: "34.9%", clickRate: "11.2%", revenue: "₹6,780" },
  { name: "New Flavor: Mango Madness", sent: "12,100", openRate: "26.3%", clickRate: "5.5%", revenue: "₹3,210" },
  { name: "Weekly Newsletter #42", sent: "10,890", openRate: "22.7%", clickRate: "4.1%", revenue: "₹1,840" },
];

const flowPerformance = [
  { name: "Abandoned Cart Recovery", trigger: "Cart Abandoned", revenue: "₹8,240", conversion: "18.2%" },
  { name: "Welcome Series", trigger: "New Subscriber", revenue: "₹4,120", conversion: "67.0%" },
  { name: "Post-Purchase Thank You", trigger: "Purchase Completed", revenue: "₹2,890", conversion: "—" },
  { name: "Post-Purchase Upsell", trigger: "3 days after purchase", revenue: "₹1,350", conversion: "9.1%" },
  { name: "Win-Back Campaign", trigger: "90 days inactive", revenue: "₹1,940", conversion: "12.4%" },
];

const emailHealth = [
  { label: "Delivery Rate", value: "98.2%", icon: CheckCircle2, color: "#10b981", bg: "rgba(16,185,129,0.1)", note: "Excellent" },
  { label: "Bounce Rate", value: "1.8%", icon: AlertTriangle, color: "#F5B731", bg: "rgba(245,183,49,0.1)", note: "Acceptable" },
  { label: "Spam Rate", value: "0.02%", icon: ShieldAlert, color: "#10b981", bg: "rgba(16,185,129,0.1)", note: "Very Low" },
  { label: "Unsubscribe Rate", value: "0.3%", icon: UserMinus, color: "#a1a1aa", bg: "rgba(161,161,170,0.1)", note: "Normal" },
];

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState("Last 30 Days");

  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Analytics</h1>
          <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
            Performance overview for PROMUNCH email marketing
          </p>
        </div>
        {/* Date range tabs */}
        <div style={{ display: "flex", gap: "4px", backgroundColor: "#18181b", padding: "4px", borderRadius: "10px", border: "1px solid #27272a" }}>
          {dateRanges.map((r) => (
            <button
              key={r}
              onClick={() => setActiveRange(r)}
              style={{
                padding: "7px 18px",
                borderRadius: "7px",
                border: "none",
                backgroundColor: activeRange === r ? "#27272a" : "transparent",
                color: activeRange === r ? "#f4f4f5" : "#71717a",
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

      {/* Top Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {topMetrics.map((metric) => (
          <div
            key={metric.label}
            style={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "12px",
              padding: "20px",
              position: "relative",
              overflow: "hidden",
            }}
          >
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
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#10b981",
                  backgroundColor: "rgba(16,185,129,0.1)",
                  padding: "3px 8px",
                  borderRadius: "20px",
                }}
              >
                {metric.change}
              </div>
            </div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px", marginBottom: "4px" }}>
              {metric.value}
            </div>
            <div style={{ fontSize: "13px", color: "#71717a" }}>{metric.label}</div>
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
          </div>
        ))}
      </div>

      {/* Campaign + Flow Performance */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        {/* Campaign Performance */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Top Campaigns</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Campaign", "Sent", "Open", "Click", "Revenue"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px", borderBottom: "1px solid #27272a" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaignPerformance.map((c, i) => (
                <tr key={i} style={{ borderBottom: i < campaignPerformance.length - 1 ? "1px solid #27272a" : "none" }}>
                  <td style={{ padding: "12px 0", fontSize: "13px", color: "#f4f4f5", fontWeight: 500, maxWidth: "140px" }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>{c.name}</div>
                  </td>
                  <td style={{ padding: "12px 4px", fontSize: "12px", color: "#a1a1aa" }}>{c.sent}</td>
                  <td style={{ padding: "12px 4px", fontSize: "12px", color: "#00B4D8" }}>{c.openRate}</td>
                  <td style={{ padding: "12px 4px", fontSize: "12px", color: "#F5B731" }}>{c.clickRate}</td>
                  <td style={{ padding: "12px 0", fontSize: "13px", fontWeight: 700, color: "#10b981" }}>{c.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Flow Performance */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Top Flows</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Flow", "Trigger", "Revenue", "Conv."].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px", borderBottom: "1px solid #27272a" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flowPerformance.map((f, i) => (
                <tr key={i} style={{ borderBottom: i < flowPerformance.length - 1 ? "1px solid #27272a" : "none" }}>
                  <td style={{ padding: "12px 0", fontSize: "13px", color: "#f4f4f5", fontWeight: 500, maxWidth: "130px" }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>{f.name}</div>
                  </td>
                  <td style={{ padding: "12px 4px", fontSize: "12px", color: "#a1a1aa", maxWidth: "120px" }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.trigger}</div>
                  </td>
                  <td style={{ padding: "12px 4px", fontSize: "13px", fontWeight: 700, color: "#10b981" }}>{f.revenue}</td>
                  <td style={{ padding: "12px 0", fontSize: "13px", color: "#F5B731", fontWeight: 600 }}>{f.conversion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email Health + Subscriber Growth */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "16px" }}>
        {/* Email Health */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Email Health</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {emailHealth.map((item) => (
              <div
                key={item.label}
                style={{
                  backgroundColor: "#1c1c1f",
                  border: "1px solid #27272a",
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
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#f4f4f5" }}>{item.value}</div>
                  <div style={{ fontSize: "12px", color: "#71717a" }}>{item.label}</div>
                  <div style={{ fontSize: "11px", color: item.color, fontWeight: 600, marginTop: "2px" }}>{item.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Subscriber Growth */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "8px" }}>Subscriber Growth</h2>
          <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>This period</p>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {[
              { label: "New Subscribers", value: "+1,240", color: "#10b981", bg: "rgba(16,185,129,0.1)", barWidth: "100%" },
              { label: "Unsubscribed", value: "-89", color: "#ef4444", bg: "rgba(239,68,68,0.1)", barWidth: "7%" },
              { label: "Net Growth", value: "+1,151", color: "#00B4D8", bg: "rgba(0,180,216,0.1)", barWidth: "93%" },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: "#a1a1aa" }}>{item.label}</span>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: item.color }}>{item.value}</span>
                </div>
                <div style={{ height: "6px", backgroundColor: "#27272a", borderRadius: "3px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: item.barWidth,
                      backgroundColor: item.color,
                      borderRadius: "3px",
                      opacity: 0.7,
                    }}
                  />
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
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#00B4D8" }}>12,450</div>
            <div style={{ fontSize: "13px", color: "#71717a", marginTop: "4px" }}>Total Active Subscribers</div>
          </div>
        </div>
      </div>
    </div>
  );
}
