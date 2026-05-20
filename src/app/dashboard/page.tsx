"use client";
import { useState, useEffect } from "react";
import { DollarSign, Users, Mail, TrendingUp, ShoppingCart, Heart, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const flowIconMap = [ShoppingCart, Heart, TrendingUp, RefreshCw];
const flowColorMap = ["#ef4444", "#B91C4A", "#10b981", "#F5B731"];
const flowBgMap = [
  "rgba(239, 68, 68, 0.1)",
  "rgba(185, 28, 74, 0.1)",
  "rgba(16, 185, 129, 0.1)",
  "rgba(245, 183, 49, 0.1)",
];

interface StatCard { label: string; value: string; icon: typeof DollarSign; color: string; bg: string; }
interface CampaignRow { name: string; sent: string; openRate: string; clickRate: string; revenue: string; }
interface FlowRow { name: string; revenue: string; icon: typeof ShoppingCart; color: string; bg: string; }
interface ListHealth { total: number; active: number; inactive: number; bounced: number; unsubscribed: number; }

export default function DashboardPage() {
  const [stats, setStats] = useState<StatCard[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [listHealth, setListHealth] = useState<ListHealth | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadData() {
      const [contactsRes, campaignsRes, flowsRes, ordersRes] = await Promise.all([
        supabase.from("contacts").select("id, status"),
        supabase.from("campaigns").select("*").order("created_at", { ascending: false }).limit(5),
        supabase.from("flows").select("*").eq("status", "active"),
        supabase.from("orders").select("total_amount, status"),
      ]);

      const contactRows = contactsRes.data || [];
      const totalContacts = contactRows.length;
      const activeCount = contactRows.filter((c) => c.status === "active").length;
      const inactiveCount = contactRows.filter((c) => c.status === "inactive").length;
      const bouncedCount = contactRows.filter((c) => c.status === "bounced").length;
      const unsubCount = contactRows.filter((c) => c.status === "unsubscribed").length;

      const orderRows = ordersRes.data || [];
      const totalRevenue = orderRows.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      const campaignRows = campaignsRes.data || [];
      const totalSent = campaignRows.reduce((s, c) => s + (c.total_sent || 0), 0);
      const totalOpened = campaignRows.reduce((s, c) => s + (c.total_opened || 0), 0);
      const flowRevenue = (flowsRes.data || []).reduce((s, f) => s + (Number(f.revenue_attributed) || 0), 0);
      const openRatePct = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) + "%" : "0%";

      setStats([
        { label: "Total Revenue", value: `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "#F5B731", bg: "rgba(245, 183, 49, 0.1)" },
        { label: "Active Subscribers", value: totalContacts.toLocaleString(), icon: Users, color: "#00B4D8", bg: "rgba(0, 180, 216, 0.1)" },
        { label: "Email Open Rate", value: openRatePct, icon: Mail, color: "#B91C4A", bg: "rgba(185, 28, 74, 0.1)" },
        { label: "Flow Revenue", value: `₹${flowRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, icon: TrendingUp, color: "#E87339", bg: "rgba(232, 115, 57, 0.1)" },
      ]);

      setCampaigns(
        campaignRows.map((c) => ({
          name: c.name,
          sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "0",
          openRate: c.total_sent > 0 ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          clickRate: c.total_sent > 0 ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%" : "0%",
          revenue: c.revenue_attributed > 0 ? `₹${Number(c.revenue_attributed).toLocaleString()}` : "₹0",
        }))
      );

      setFlows(
        (flowsRes.data || []).slice(0, 4).map((f, i) => ({
          name: f.name,
          revenue: f.revenue_attributed > 0 ? `₹${Number(f.revenue_attributed).toLocaleString()}` : "₹0",
          icon: flowIconMap[i % flowIconMap.length],
          color: flowColorMap[i % flowColorMap.length],
          bg: flowBgMap[i % flowBgMap.length],
        }))
      );

      setListHealth({
        total: totalContacts, active: activeCount, inactive: inactiveCount,
        bounced: bouncedCount, unsubscribed: unsubCount,
      });
      setLoaded(true);
    }
    loadData();
  }, []);

  if (!loaded) return null;

  const activePct = listHealth && listHealth.total > 0 ? (listHealth.active / listHealth.total) * 100 : 0;
  const card = {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px",
    boxShadow: "0 1px 2px rgba(17,24,39,0.04)",
  } as const;

  return (
    <div style={{ padding: "32px", maxWidth: "1400px", margin: "0 auto" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", letterSpacing: "-0.3px" }}>Dashboard</h1>
        <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>Overview of your CRM activity</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ ...card, padding: "20px", minHeight: "120px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: stat.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <stat.icon size={20} color={stat.color} />
              </div>
            </div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#111827", letterSpacing: "-0.3px", marginBottom: "4px" }}>{stat.value}</div>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {listHealth && listHealth.total > 0 && (
        <div style={{ ...card, marginBottom: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>List Health</h2>
          <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "20px" }}>{listHealth.total.toLocaleString()} total contacts</p>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "32px", alignItems: "center" }}>
            <div style={{ position: "relative", width: "140px", height: "140px" }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="54" fill="none" stroke="#e5e7eb" strokeWidth="18" />
                <circle cx="70" cy="70" r="54" fill="none" stroke="#10b981" strokeWidth="18"
                  strokeDasharray={`${(activePct / 100) * 339.29} 339.29`}
                  transform="rotate(-90 70 70)" strokeLinecap="round" />
                <text x="70" y="66" textAnchor="middle" fill="#111827" fontSize="20" fontWeight="700">{Math.round(activePct)}%</text>
                <text x="70" y="84" textAnchor="middle" fill="#6b7280" fontSize="11">Active</text>
              </svg>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
              {[
                { label: "Active", value: listHealth.active, color: "#10b981" },
                { label: "Inactive", value: listHealth.inactive, color: "#3b82f6" },
                { label: "Bounced", value: listHealth.bounced, color: "#ef4444" },
                { label: "Unsubscribed", value: listHealth.unsubscribed, color: "#9ca3af" },
              ].map((item) => {
                const pct = listHealth.total > 0 ? ((item.value / listHealth.total) * 100).toFixed(0) : "0";
                return (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: "13px", color: "#4b5563", flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{item.value.toLocaleString()}</span>
                    <span style={{ fontSize: "12px", color: "#9ca3af", width: "36px", textAlign: "right" }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {(campaigns.length > 0 || flows.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: campaigns.length && flows.length ? "1fr 1fr" : "1fr", gap: "16px" }}>
          {campaigns.length > 0 && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Recent Campaigns</h2>
                <a href="/dashboard/campaigns" style={{ fontSize: "13px", color: "#B91C4A", fontWeight: 500 }}>View all →</a>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Campaign", "Sent", "Open", "Click", "Revenue"].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "10px", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "12px 0", fontSize: "13px", color: "#111827", fontWeight: 500, maxWidth: "180px" }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: "13px", color: "#4b5563" }}>{c.sent}</td>
                      <td style={{ padding: "12px 8px", fontSize: "13px", color: "#4b5563" }}>{c.openRate}</td>
                      <td style={{ padding: "12px 8px", fontSize: "13px", color: "#4b5563" }}>{c.clickRate}</td>
                      <td style={{ padding: "12px 0", fontSize: "13px", color: "#10b981", fontWeight: 600 }}>{c.revenue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {flows.length > 0 && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#111827" }}>Active Flows</h2>
                <a href="/dashboard/flows" style={{ fontSize: "13px", color: "#B91C4A", fontWeight: 500 }}>View all →</a>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {flows.map((flow) => (
                  <div key={flow.name} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px", backgroundColor: "#f9fafb", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: flow.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <flow.icon size={18} color={flow.color} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{flow.name}</div>
                      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>Automated</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#10b981" }}>{flow.revenue}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
