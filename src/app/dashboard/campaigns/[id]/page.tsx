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
  { label: "Sent", value: 12450, pct: 100, color: "var(--blue)" },
  { label: "Delivered", value: 12218, pct: 98.1, color: "var(--accent)" },
  { label: "Opened", value: 3800, pct: 30.5, color: "var(--amber)" },
  { label: "Clicked", value: 1220, pct: 9.8, color: "var(--green)" },
  { label: "Converted", value: 341, pct: 2.7, color: "var(--accent)" },
];

const links = [
  { url: "promunch.com/sale/whey-protein", clicks: 487, unique: 412 },
  { url: "promunch.com/sale/protein-bars", clicks: 312, unique: 278 },
  { url: "promunch.com/shop", clicks: 244, unique: 210 },
  { url: "promunch.com/sale/snack-box", clicks: 177, unique: 155 },
];

const devices = [
  { label: "Mobile", pct: 62, color: "var(--accent)", icon: Smartphone },
  { label: "Desktop", pct: 35, color: "var(--blue)", icon: Monitor },
  { label: "Tablet", pct: 3, color: "var(--green)", icon: Tablet },
];

export default function CampaignDetailPage() {
  return (
    <div style={{ padding: "32px" }}>
      <Link href="/dashboard/campaigns">
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-2)", fontSize: "14px", marginBottom: "24px", cursor: "pointer" }}>
          <ChevronLeft size={16} />
          Back to Campaigns
        </div>
      </Link>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "var(--text)" }}>{campaign.name}</h1>
            <span style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "13px", fontWeight: 600, backgroundColor: "rgba(16, 185, 129, 0.15)", color: "var(--green)" }}>
              {campaign.status}
            </span>
          </div>
          <p style={{ fontSize: "14px", color: "var(--text-2)" }}>Sent {campaign.date}</p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "Sent", value: campaign.stats.sent.toLocaleString(), color: "var(--blue)" },
          { label: "Delivered", value: campaign.stats.delivered.toLocaleString(), color: "var(--accent)" },
          { label: "Opened", value: campaign.stats.opened.toLocaleString(), color: "var(--amber)" },
          { label: "Clicked", value: campaign.stats.clicked.toLocaleString(), color: "var(--green)" },
          { label: "Converted", value: campaign.stats.converted.toLocaleString(), color: "var(--accent)" },
          { label: "Revenue", value: `₹${campaign.stats.revenue.toLocaleString()}`, color: "var(--green)" },
        ].map((s) => (
          <div key={s.label} style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: s.color, marginBottom: "4px" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "var(--text-2)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        {/* Funnel */}
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "24px" }}>Performance Funnel</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {funnelSteps.map((step, i) => (
              <div key={step.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-2)" }}>{step.label}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
                    {step.value.toLocaleString()} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({step.pct}%)</span>
                  </span>
                </div>
                <div style={{ height: "8px", backgroundColor: "var(--border)", borderRadius: "4px", overflow: "hidden" }}>
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
                    <div style={{ width: "1px", height: "8px", backgroundColor: "var(--border)" }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Device Breakdown */}
        <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "24px" }}>Device Breakdown</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {devices.map((d) => (
              <div key={d.label}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: `${d.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <d.icon size={16} color={d.color} />
                  </div>
                  <span style={{ fontSize: "14px", color: "var(--text)", flex: 1 }}>{d.label}</span>
                  <span style={{ fontSize: "18px", fontWeight: 700, color: d.color }}>{d.pct}%</span>
                </div>
                <div style={{ height: "10px", backgroundColor: "var(--border)", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${d.pct}%`, backgroundColor: d.color, borderRadius: "5px" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Link Clicks */}
      <div style={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "20px" }}>Link Click Breakdown</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["URL", "Total Clicks", "Unique Clicks", "Share"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0 0 12px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {links.map((l, i) => {
              const share = Math.round((l.clicks / 1220) * 100);
              return (
                <tr key={i} style={{ borderBottom: i < links.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "var(--accent)" }}>{l.url}</td>
                  <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>{l.clicks}</td>
                  <td style={{ padding: "14px 16px", fontSize: "14px", color: "var(--text-2)" }}>{l.unique}</td>
                  <td style={{ padding: "14px 0", width: "200px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ flex: 1, height: "6px", backgroundColor: "var(--border)", borderRadius: "3px" }}>
                        <div style={{ height: "100%", width: `${share}%`, backgroundColor: "var(--accent)", borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--text-2)", width: "32px" }}>{share}%</span>
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
