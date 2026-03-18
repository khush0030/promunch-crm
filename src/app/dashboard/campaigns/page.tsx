"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, TrendingUp } from "lucide-react";

const mockCampaigns = [
  { id: "1", name: "Protein Launch — April", status: "Sent", sent: 11200, openRate: 28.4, clickRate: 6.2, revenue: 8420, date: "Apr 1, 2026" },
  { id: "2", name: "Flash Sale — Weekend Blitz", status: "Sent", sent: 12450, openRate: 31.1, clickRate: 9.8, revenue: 12340, date: "Mar 22, 2026" },
  { id: "3", name: "Weekly Newsletter #42", status: "Sent", sent: 10890, openRate: 22.7, clickRate: 4.1, revenue: 1840, date: "Mar 10, 2026" },
  { id: "4", name: "New Flavor: Mango Madness", status: "Scheduled", sent: 0, openRate: 0, clickRate: 0, revenue: 0, date: "Apr 5, 2026" },
  { id: "5", name: "Member Exclusive Deal", status: "Sent", sent: 6800, openRate: 34.9, clickRate: 11.2, revenue: 6780, date: "Mar 15, 2026" },
  { id: "6", name: "Spring Fitness Campaign", status: "Draft", sent: 0, openRate: 0, clickRate: 0, revenue: 0, date: "—" },
  { id: "7", name: "Weekly Newsletter #41", status: "Sent", sent: 10750, openRate: 21.3, clickRate: 3.8, revenue: 1520, date: "Mar 3, 2026" },
  { id: "8", name: "VIP Re-engagement Push", status: "Scheduled", sent: 0, openRate: 0, clickRate: 0, revenue: 0, date: "Apr 8, 2026" },
];

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  sent: number;
  openRate: number;
  clickRate: number;
  revenue: number;
  date: string;
};

const statusColors: Record<string, { bg: string; color: string }> = {
  Sent: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  sent: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  Scheduled: { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
  scheduled: { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
  Draft: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  draft: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  sending: { bg: "rgba(245, 183, 49, 0.15)", color: "#F5B731" },
  paused: { bg: "rgba(232, 115, 57, 0.15)", color: "#E87339" },
};

const tabs = ["All", "Sent", "Scheduled", "Draft"];
type SortKey = "date" | "revenue" | "openRate";

export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState("All");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>(mockCampaigns);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (activeTab !== "All") params.set("status", activeTab.toLowerCase());

      const res = await fetch(`/api/campaigns?${params}`);
      if (!res.ok) throw new Error("API error");

      const data = await res.json();

      if (data.campaigns && data.campaigns.length > 0) {
        const mapped: CampaignRow[] = data.campaigns.map((c: {
          id: string;
          name: string;
          status: string;
          total_sent?: number;
          total_opened?: number;
          total_clicked?: number;
          revenue_attributed?: number;
          sent_at?: string;
          scheduled_at?: string;
          created_at?: string;
        }) => {
          const openRate = c.total_sent && c.total_sent > 0
            ? parseFloat(((c.total_opened || 0) / c.total_sent * 100).toFixed(1))
            : 0;
          const clickRate = c.total_sent && c.total_sent > 0
            ? parseFloat(((c.total_clicked || 0) / c.total_sent * 100).toFixed(1))
            : 0;

          const dateStr = c.sent_at || c.scheduled_at || c.created_at;
          const date = dateStr
            ? new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "—";

          return {
            id: c.id,
            name: c.name,
            status: c.status.charAt(0).toUpperCase() + c.status.slice(1),
            sent: c.total_sent || 0,
            openRate,
            clickRate,
            revenue: c.revenue_attributed || 0,
            date,
          };
        });

        setCampaigns(mapped);
        setUsingLiveData(true);
      } else {
        setCampaigns(
          mockCampaigns.filter((c) => activeTab === "All" || c.status === activeTab)
        );
        setUsingLiveData(false);
      }
    } catch {
      setCampaigns(
        mockCampaigns.filter((c) => activeTab === "All" || c.status === activeTab)
      );
      setUsingLiveData(false);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const filtered = [...campaigns].sort((a, b) => {
    if (sortBy === "revenue") return b.revenue - a.revenue;
    if (sortBy === "openRate") return b.openRate - a.openRate;
    return 0;
  });

  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>Campaigns</h1>
          <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
            Manage and track your email campaigns
            {usingLiveData && <span style={{ color: "#10b981", marginLeft: "8px" }}>● Live</span>}
          </p>
        </div>
        <Link href="/dashboard/campaigns/new">
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              background: "linear-gradient(135deg, #B91C4A, #8B1539)",
              border: "none",
              borderRadius: "9px",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={16} />
            Create Campaign
          </button>
        </Link>
      </div>

      {/* Tabs + Sort */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "4px", backgroundColor: "#18181b", padding: "4px", borderRadius: "10px", border: "1px solid #27272a" }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: "7px 18px",
                borderRadius: "7px",
                border: "none",
                backgroundColor: activeTab === t ? "#27272a" : "transparent",
                color: activeTab === t ? "#f4f4f5" : "#71717a",
                fontSize: "13px",
                fontWeight: activeTab === t ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", color: "#71717a" }}>Sort by:</span>
          {(["date", "revenue", "openRate"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                padding: "6px 14px",
                borderRadius: "7px",
                border: sortBy === s ? "1px solid #B91C4A" : "1px solid #27272a",
                backgroundColor: sortBy === s ? "rgba(185, 28, 74, 0.1)" : "#18181b",
                color: sortBy === s ? "#E8658B" : "#a1a1aa",
                fontSize: "12px",
                fontWeight: sortBy === s ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {s === "date" ? "Date" : s === "revenue" ? "Revenue" : "Open Rate"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{
        backgroundColor: "#18181b",
        border: "1px solid #27272a",
        borderRadius: "12px",
        overflow: "hidden",
        opacity: isLoading ? 0.7 : 1,
        transition: "opacity 0.2s",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #27272a", backgroundColor: "#1c1c1f" }}>
              {["Campaign Name", "Status", "Sent", "Open Rate", "Click Rate", "Revenue", "Date"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontSize: "11px", fontWeight: 600, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr
                key={c.id}
                style={{ borderBottom: i < filtered.length - 1 ? "1px solid #27272a" : "none", cursor: "pointer", transition: "background 0.1s" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1c1c1f")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <td style={{ padding: "16px" }}>
                  <Link href={`/dashboard/campaigns/${c.id}`}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5" }}>{c.name}</div>
                  </Link>
                </td>
                <td style={{ padding: "16px" }}>
                  <span style={{
                    padding: "3px 10px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: statusColors[c.status]?.bg || "rgba(113,113,122,0.15)",
                    color: statusColors[c.status]?.color || "#a1a1aa",
                  }}>
                    {c.status}
                  </span>
                </td>
                <td style={{ padding: "16px", fontSize: "14px", color: "#a1a1aa" }}>
                  {c.sent > 0 ? c.sent.toLocaleString() : "—"}
                </td>
                <td style={{ padding: "16px" }}>
                  {c.openRate > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <TrendingUp size={13} color="#10b981" />
                      <span style={{ fontSize: "14px", color: "#f4f4f5", fontWeight: 500 }}>{c.openRate}%</span>
                    </div>
                  ) : <span style={{ color: "#52525b" }}>—</span>}
                </td>
                <td style={{ padding: "16px", fontSize: "14px", color: c.clickRate > 0 ? "#f4f4f5" : "#52525b" }}>
                  {c.clickRate > 0 ? `${c.clickRate}%` : "—"}
                </td>
                <td style={{ padding: "16px", fontSize: "14px", fontWeight: 600, color: c.revenue > 0 ? "#10b981" : "#52525b" }}>
                  {c.revenue > 0 ? `₹${c.revenue.toLocaleString()}` : "—"}
                </td>
                <td style={{ padding: "16px", fontSize: "13px", color: "#71717a" }}>{c.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
