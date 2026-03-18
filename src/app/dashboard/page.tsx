"use client";
import { useState, useEffect } from "react";
import { DollarSign, Users, Mail, TrendingUp, ArrowUpRight, ShoppingCart, Heart, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const mockStats = [
  {
    label: "Total Revenue",
    value: "₹47,832",
    change: "+12.5%",
    icon: DollarSign,
    color: "#F5B731",
    bg: "rgba(245, 183, 49, 0.1)",
  },
  {
    label: "Active Subscribers",
    value: "12,450",
    change: "+3.2%",
    icon: Users,
    color: "#00B4D8",
    bg: "rgba(0, 180, 216, 0.1)",
  },
  {
    label: "Email Open Rate",
    value: "24.3%",
    change: "+1.8%",
    icon: Mail,
    color: "#B91C4A",
    bg: "rgba(185, 28, 74, 0.1)",
  },
  {
    label: "Flow Revenue",
    value: "₹18,240",
    change: "+8.7%",
    icon: TrendingUp,
    color: "#E87339",
    bg: "rgba(232, 115, 57, 0.1)",
  },
];

const mockCampaigns = [
  { name: "Protein Launch — April", sent: "11,200", openRate: "28.4%", clickRate: "6.2%", revenue: "₹8,420" },
  { name: "Flash Sale — Weekend", sent: "12,450", openRate: "31.1%", clickRate: "9.8%", revenue: "₹12,340" },
  { name: "Weekly Newsletter #42", sent: "10,890", openRate: "22.7%", clickRate: "4.1%", revenue: "₹1,840" },
  { name: "New Flavor Announcement", sent: "12,100", openRate: "26.3%", clickRate: "5.5%", revenue: "₹3,210" },
  { name: "Member Exclusive Deal", sent: "6,800", openRate: "34.9%", clickRate: "11.2%", revenue: "₹6,780" },
];

const mockFlows = [
  { name: "Abandoned Cart", revenue: "₹8,240", icon: ShoppingCart, color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)" },
  { name: "Welcome Series", revenue: "₹4,120", icon: Heart, color: "#B91C4A", bg: "rgba(185, 28, 74, 0.1)" },
  { name: "Post-Purchase", revenue: "₹2,890", icon: TrendingUp, color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
  { name: "Win-Back", revenue: "₹1,940", icon: RefreshCw, color: "#F5B731", bg: "rgba(245, 183, 49, 0.1)" },
];

interface LiveStats {
  contactCount: number;
  campaignCount: number;
  activeContactCount: number;
  totalSent: number;
  totalOpened: number;
}

export default function DashboardPage() {
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [liveCampaigns, setLiveCampaigns] = useState<Array<{
    name: string; sent: string; openRate: string; clickRate: string; revenue: string;
  }> | null>(null);
  const [liveFlows, setLiveFlows] = useState<Array<{
    name: string; revenue: string; icon: typeof ShoppingCart; color: string; bg: string;
  }> | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [contactsRes, campaignsRes, flowsRes] = await Promise.all([
          supabase.from("contacts").select("id, status", { count: "exact" }),
          supabase.from("campaigns").select("*").order("created_at", { ascending: false }).limit(5),
          supabase.from("flows").select("*").eq("status", "active"),
        ]);

        if (!contactsRes.error) {
          const allContacts = contactsRes.data || [];
          const activeCount = allContacts.filter((c) => c.status === "active").length;

          setLiveStats({
            contactCount: contactsRes.count || 0,
            campaignCount: 0,
            activeContactCount: activeCount,
            totalSent: 0,
            totalOpened: 0,
          });
        }

        if (!campaignsRes.error && campaignsRes.data && campaignsRes.data.length > 0) {
          const campaigns = campaignsRes.data.map((c) => {
            const openRate = c.total_sent > 0
              ? ((c.total_opened / c.total_sent) * 100).toFixed(1) + "%"
              : "—";
            const clickRate = c.total_sent > 0
              ? ((c.total_clicked / c.total_sent) * 100).toFixed(1) + "%"
              : "—";
            return {
              name: c.name,
              sent: c.total_sent > 0 ? c.total_sent.toLocaleString() : "—",
              openRate,
              clickRate,
              revenue: c.revenue_attributed > 0 ? `₹${c.revenue_attributed.toLocaleString()}` : "—",
            };
          });
          setLiveCampaigns(campaigns);
        }

        if (!flowsRes.error && flowsRes.data && flowsRes.data.length > 0) {
          const flowIconMap = [ShoppingCart, Heart, TrendingUp, RefreshCw];
          const flowColorMap = ["#ef4444", "#B91C4A", "#10b981", "#F5B731"];
          const flowBgMap = [
            "rgba(239, 68, 68, 0.1)",
            "rgba(185, 28, 74, 0.1)",
            "rgba(16, 185, 129, 0.1)",
            "rgba(245, 183, 49, 0.1)",
          ];
          const flows = flowsRes.data.slice(0, 4).map((f, i) => ({
            name: f.name,
            revenue: f.revenue_attributed > 0 ? `₹${f.revenue_attributed.toLocaleString()}` : "₹0",
            icon: flowIconMap[i % flowIconMap.length],
            color: flowColorMap[i % flowColorMap.length],
            bg: flowBgMap[i % flowBgMap.length],
          }));
          setLiveFlows(flows);
        }
      } catch {
        // Fall back to mock data silently
      }
    }

    loadData();
  }, []);

  // Build stats array — override with live data if available
  const stats = mockStats.map((s, i) => {
    if (liveStats && i === 1) {
      // Active Subscribers
      const count = liveStats.contactCount;
      return { ...s, value: count > 0 ? count.toLocaleString() : s.value };
    }
    return s;
  });

  const campaigns = liveCampaigns && liveCampaigns.length > 0 ? liveCampaigns : mockCampaigns;
  const flows = liveFlows && liveFlows.length > 0 ? liveFlows : mockFlows;

  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>
          Dashboard
        </h1>
        <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
          Welcome back — here&apos;s what&apos;s happening with PROMUNCH CRM
        </p>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
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
                  backgroundColor: stat.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <stat.icon size={20} color={stat.color} />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#10b981",
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  padding: "3px 8px",
                  borderRadius: "20px",
                }}
              >
                <ArrowUpRight size={12} />
                {stat.change}
              </div>
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px", marginBottom: "4px" }}>
              {stat.value}
            </div>
            <div style={{ fontSize: "13px", color: "#71717a" }}>{stat.label}</div>
            {/* Subtle gradient decoration */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: "80px",
                height: "80px",
                background: `radial-gradient(circle at 100% 100%, ${stat.bg}, transparent)`,
                pointerEvents: "none",
              }}
            />
          </div>
        ))}
      </div>

      {/* Revenue Chart + List Health */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "16px", marginBottom: "24px" }}>
        {/* Revenue Chart */}
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Revenue Over Time</h2>
              <p style={{ fontSize: "13px", color: "#71717a", marginTop: "2px" }}>Last 30 days</p>
            </div>
            <select
              style={{
                backgroundColor: "#27272a",
                border: "1px solid #3f3f46",
                borderRadius: "8px",
                color: "#f4f4f5",
                padding: "6px 12px",
                fontSize: "13px",
                outline: "none",
              }}
            >
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>Last 90 days</option>
            </select>
          </div>

          {/* Mock Chart */}
          <div style={{ position: "relative", height: "200px" }}>
            <svg width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#B91C4A" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#B91C4A" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,160 C50,140 100,120 150,100 C200,80 220,70 260,60 C300,50 320,55 360,45 C400,35 430,40 470,30 C510,20 550,25 600,20 L600,200 L0,200 Z"
                fill="url(#chartGrad)"
              />
              <path
                d="M0,160 C50,140 100,120 150,100 C200,80 220,70 260,60 C300,50 320,55 360,45 C400,35 430,40 470,30 C510,20 550,25 600,20"
                fill="none"
                stroke="#B91C4A"
                strokeWidth="2.5"
              />
              {/* Data points */}
              {[
                [0, 160], [100, 120], [200, 80], [300, 50], [400, 35], [500, 25], [600, 20]
              ].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="4" fill="#B91C4A" />
              ))}
              {/* Grid lines */}
              {[40, 80, 120, 160].map((y) => (
                <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="#27272a" strokeWidth="1" />
              ))}
            </svg>
            {/* Y-axis labels */}
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              {["₹20k", "₹15k", "₹10k", "₹5k", "₹0"].map((l) => (
                <span key={l} style={{ fontSize: "10px", color: "#52525b" }}>{l}</span>
              ))}
            </div>
          </div>
        </div>

        {/* List Health */}
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5", marginBottom: "4px" }}>List Health</h2>
          <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "24px" }}>
            {liveStats && liveStats.contactCount > 0
              ? `${liveStats.contactCount.toLocaleString()} total contacts`
              : "12,450 total contacts"}
          </p>

          {/* Donut Chart Mock */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
            <div style={{ position: "relative", width: "140px", height: "140px" }}>
              <svg width="140" height="140" viewBox="0 0 140 140">
                {/* Background circle */}
                <circle cx="70" cy="70" r="54" fill="none" stroke="#27272a" strokeWidth="20" />
                {/* Active: 78% ≈ 339 deg */}
                <circle
                  cx="70" cy="70" r="54"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="20"
                  strokeDasharray="339.29 100"
                  strokeDashoffset="85"
                  transform="rotate(-90 70 70)"
                  strokeLinecap="round"
                />
                {/* Inactive: 15% */}
                <circle
                  cx="70" cy="70" r="54"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="20"
                  strokeDasharray="65 374"
                  strokeDashoffset="-254"
                  transform="rotate(-90 70 70)"
                  strokeLinecap="round"
                />
                {/* Bounced: 7% */}
                <circle
                  cx="70" cy="70" r="54"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="20"
                  strokeDasharray="30 409"
                  strokeDashoffset="-319"
                  transform="rotate(-90 70 70)"
                  strokeLinecap="round"
                />
                <text x="70" y="66" textAnchor="middle" fill="#f4f4f5" fontSize="20" fontWeight="700">78%</text>
                <text x="70" y="82" textAnchor="middle" fill="#71717a" fontSize="10">Active</text>
              </svg>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { label: "Active", value: liveStats && liveStats.activeContactCount > 0 ? liveStats.activeContactCount.toLocaleString() : "9,711", pct: "78%", color: "#10b981" },
              { label: "Inactive", value: "1,868", pct: "15%", color: "#3b82f6" },
              { label: "Bounced", value: "871", pct: "7%", color: "#ef4444" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: item.color, flexShrink: 0 }} />
                <span style={{ fontSize: "13px", color: "#a1a1aa", flex: 1 }}>{item.label}</span>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#f4f4f5" }}>{item.value}</span>
                <span style={{ fontSize: "12px", color: "#52525b", width: "34px", textAlign: "right" }}>{item.pct}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Recent Campaigns */}
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Recent Campaigns</h2>
            <a href="/dashboard/campaigns" style={{ fontSize: "13px", color: "#B91C4A", fontWeight: 500 }}>View all →</a>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Campaign", "Sent", "Open Rate", "Clicks", "Revenue"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px", paddingBottom: "12px", borderBottom: "1px solid #27272a" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #27272a" }}>
                  <td style={{ padding: "12px 0", fontSize: "13px", color: "#f4f4f5", fontWeight: 500, maxWidth: "180px" }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                  </td>
                  <td style={{ padding: "12px 8px", fontSize: "13px", color: "#a1a1aa" }}>{c.sent}</td>
                  <td style={{ padding: "12px 8px", fontSize: "13px", color: "#a1a1aa" }}>{c.openRate}</td>
                  <td style={{ padding: "12px 8px", fontSize: "13px", color: "#a1a1aa" }}>{c.clickRate}</td>
                  <td style={{ padding: "12px 0", fontSize: "13px", color: "#10b981", fontWeight: 600 }}>{c.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Active Flows */}
        <div
          style={{
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f4f4f5" }}>Active Flows</h2>
            <a href="/dashboard/flows" style={{ fontSize: "13px", color: "#B91C4A", fontWeight: 500 }}>View all →</a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {flows.map((flow) => (
              <div
                key={flow.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "14px",
                  backgroundColor: "#1c1c1f",
                  borderRadius: "10px",
                  border: "1px solid #27272a",
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "10px",
                    backgroundColor: flow.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <flow.icon size={18} color={flow.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{flow.name}</div>
                  <div style={{ fontSize: "12px", color: "#71717a", marginTop: "2px" }}>Automated</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#10b981" }}>{flow.revenue}</div>
                  <div style={{ fontSize: "11px", color: "#71717a" }}>revenue</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
