"use client";
import Link from "next/link";
import { ChevronLeft, Smartphone, Monitor, Tablet } from "lucide-react";

const campaign = {
  name: "Flash Sale — Weekend Blitz",
  status: "Sent",
  date: "Mar 22, 2026",
  stats: {
    sent: 12450,
    delivered: 12218,
    opened: 3800,
    clicked: 1220,
    converted: 341,
    revenue: 12340,
  },
};

const funnelSteps = [
  { label: "Sent", value: 12450, pct: 100, color: "#3b82f6" },
  { label: "Delivered", value: 12218, pct: 98.1, color: "#B91C4A" },
  { label: "Opened", value: 3800, pct: 30.5, color: "#F5B731" },
  { label: "Clicked", value: 1220, pct: 9.8, color: "#10b981" },
  { label: "Converted", value: 341, pct: 2.7, color: "#ef4444" },
];

const links = [
  { url: "promunch.com/sale/whey-protein", clicks: 487, unique: 412 },
  { url: "promunch.com/sale/protein-bars", clicks: 312, unique: 278 },
  { url: "promunch.com/shop", clicks: 244, unique: 210 },
  { url: "promunch.com/sale/snack-box", clicks: 177, unique: 155 },
];

const devices = [
  { label: "Mobile", pct: 62, color: "#B91C4A", icon: Smartphone },
  { label: "Desktop", pct: 35, color: "#3b82f6", icon: Monitor },
  { label: "Tablet", pct: 3, color: "#10b981", icon: Tablet },
];

export default function CampaignDetailPage() {
  return (
    <div style={{ padding: "32px" }}>
      <Link href="/dashboard/campaigns">
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#71717a", fontSize: "14px", marginBottom: "24px", cursor: "pointer" }}>
          <ChevronLeft size={16} />
          Back to Campaigns
        </div>
      </Link>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#f4f4f5" }}>{campaign.name}</h1>
            <span style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "13px", fontWeight: 600, backgroundColor: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
              {campaign.status}
            </span>
          </div>
          <p style={{ fontSize: "14px", color: "#71717a" }}>Sent {campaign.date}</p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "Sent", value: campaign.stats.sent.toLocaleString(), color: "#3b82f6" },
          { label: "Delivered", value: campaign.stats.delivered.toLocaleString(), color: "#B91C4A" },
          { label: "Opened", value: campaign.stats.opened.toLocaleString(), color: "#F5B731" },
          { label: "Clicked", value: campaign.stats.clicked.toLocaleString(), color: "#10b981" },
          { label: "Converted", value: campaign.stats.converted.toLocaleString(), color: "#ef4444" },
          { label: "Revenue", value: `₹${campaign.stats.revenue.toLocaleString()}`, color: "#10b981" },
        ].map((s) => (
          <div key={s.label} style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "10px", padding: "16px" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: s.color, marginBottom: "4px" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "#71717a" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        {/* Funnel */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "24px" }}>Performance Funnel</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {funnelSteps.map((step, i) => (
              <div key={step.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: "#a1a1aa" }}>{step.label}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5" }}>
                    {step.value.toLocaleString()} <span style={{ color: "#52525b", fontWeight: 400 }}>({step.pct}%)</span>
                  </span>
                </div>
                <div style={{ height: "8px", backgroundColor: "#27272a", borderRadius: "4px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${step.pct}%`,
                      backgroundColor: step.color,
                      borderRadius: "4px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                {i < funnelSteps.length - 1 && (
                  <div style={{ height: "8px", display: "flex", justifyContent: "center" }}>
                    <div style={{ width: "1px", height: "8px", backgroundColor: "#27272a" }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Device Breakdown */}
        <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "24px" }}>Device Breakdown</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {devices.map((d) => (
              <div key={d.label}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: `${d.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <d.icon size={16} color={d.color} />
                  </div>
                  <span style={{ fontSize: "14px", color: "#f4f4f5", flex: 1 }}>{d.label}</span>
                  <span style={{ fontSize: "18px", fontWeight: 700, color: d.color }}>{d.pct}%</span>
                </div>
                <div style={{ height: "10px", backgroundColor: "#27272a", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${d.pct}%`, backgroundColor: d.color, borderRadius: "5px" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Link Clicks */}
      <div style={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "12px", padding: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "20px" }}>Link Click Breakdown</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["URL", "Total Clicks", "Unique Clicks", "Share"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0 0 12px 0", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid #27272a" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {links.map((l, i) => {
              const share = Math.round((l.clicks / 1220) * 100);
              return (
                <tr key={i} style={{ borderBottom: i < links.length - 1 ? "1px solid #27272a" : "none" }}>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "#B91C4A" }}>{l.url}</td>
                  <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{l.clicks}</td>
                  <td style={{ padding: "14px 16px", fontSize: "14px", color: "#a1a1aa" }}>{l.unique}</td>
                  <td style={{ padding: "14px 0", width: "200px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ flex: 1, height: "6px", backgroundColor: "#27272a", borderRadius: "3px" }}>
                        <div style={{ height: "100%", width: `${share}%`, backgroundColor: "#B91C4A", borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "12px", color: "#71717a", width: "32px" }}>{share}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
