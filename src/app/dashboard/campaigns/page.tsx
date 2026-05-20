"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

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

const statusPill: Record<string, { cls: string; label: string }> = {
  sent: { cls: "green", label: "Sent" },
  Sent: { cls: "green", label: "Sent" },
  scheduled: { cls: "blue", label: "Scheduled" },
  Scheduled: { cls: "blue", label: "Scheduled" },
  draft: { cls: "grey", label: "Draft" },
  Draft: { cls: "grey", label: "Draft" },
  sending: { cls: "amber", label: "Sending" },
  Sending: { cls: "amber", label: "Sending" },
  paused: { cls: "amber", label: "Paused" },
  Paused: { cls: "amber", label: "Paused" },
};

const tabs = ["All", "Sent", "Scheduled", "Draft"];
type SortKey = "date" | "revenue" | "openRate";

export default function CampaignsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("All");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (activeTab !== "All") params.set("status", activeTab.toLowerCase());

      const res = await fetch(`/api/campaigns?${params}`);
      if (!res.ok) throw new Error("API error");

      const data = await res.json();
      const mapped: CampaignRow[] = (data.campaigns || []).map((c: {
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
        const openRate =
          c.total_sent && c.total_sent > 0
            ? parseFloat((((c.total_opened || 0) / c.total_sent) * 100).toFixed(1))
            : 0;
        const clickRate =
          c.total_sent && c.total_sent > 0
            ? parseFloat((((c.total_clicked || 0) / c.total_sent) * 100).toFixed(1))
            : 0;
        const dateStr = c.sent_at || c.scheduled_at || c.created_at;
        const date = dateStr
          ? new Date(dateStr).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "";
        return {
          id: c.id,
          name: c.name,
          status: c.status.charAt(0).toUpperCase() + c.status.slice(1),
          sent: c.total_sent || 0,
          openRate,
          clickRate,
          revenue: Number(c.revenue_attributed) || 0,
          date,
        };
      });
      setCampaigns(mapped);
    } catch {
      setCampaigns([]);
    } finally {
      setIsLoading(false);
      setLoaded(true);
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
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <div className="sub">Manage and track your email campaigns</div>
        </div>
        <Link href="/dashboard/campaigns/new" className="btn primary">
          <Plus size={14} /> Create campaign
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="tabs" style={{ marginBottom: 0, border: "none" }}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              className={`tab${activeTab === t ? " active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-3)" }}>
          Sort by
          <div className="chips">
            {(["date", "revenue", "openRate"] as SortKey[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${sortBy === s ? " active" : ""}`}
                onClick={() => setSortBy(s)}
              >
                {s === "date" ? "Date" : s === "revenue" ? "Revenue" : "Open rate"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="card" style={{ opacity: isLoading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Open</th>
                <th>Click</th>
                <th>Revenue</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const sp = statusPill[c.status] || { cls: "grey", label: c.status };
                return (
                  <tr
                    key={c.id}
                    className="clickable"
                    onClick={() => router.push(`/dashboard/campaigns/${c.id}`)}
                  >
                    <td>
                      <div className="cell-main">
                        <span className="nm">{c.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${sp.cls}`}>{sp.label}</span>
                    </td>
                    <td className="num">{c.sent > 0 ? c.sent.toLocaleString() : "—"}</td>
                    <td className="num">{c.openRate > 0 ? `${c.openRate}%` : "—"}</td>
                    <td className="num">{c.clickRate > 0 ? `${c.clickRate}%` : "—"}</td>
                    <td
                      className="num"
                      style={{
                        color: c.revenue > 0 ? "var(--green)" : "var(--text-3)",
                        fontWeight: c.revenue > 0 ? 500 : 400,
                      }}
                    >
                      {c.revenue > 0 ? `₹${c.revenue.toLocaleString()}` : "—"}
                    </td>
                    <td className="muted">{c.date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m3 11 18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
          </div>
          <h3>{loaded ? "No campaigns yet" : "Loading…"}</h3>
          {loaded && <p>Create your first campaign to start sending emails to your contacts and tracking revenue.</p>}
          {loaded && (
            <Link href="/dashboard/campaigns/new" className="btn primary">
              <Plus size={14} /> Create campaign
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
