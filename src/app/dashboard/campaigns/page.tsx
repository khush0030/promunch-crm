"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Megaphone } from "lucide-react";
import { PageHead, Tabs, FilterChips, DataTable, StatusBadge, EmptyState } from "@/components/pm";
import type { Column, BadgeTone } from "@/components/pm";

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

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  sent: { tone: "green", label: "Sent" },
  scheduled: { tone: "blue", label: "Scheduled" },
  draft: { tone: "gray", label: "Draft" },
  sending: { tone: "gold", label: "Sending" },
  paused: { tone: "gold", label: "Paused" },
};
function statusFor(s: string): { tone: BadgeTone; label: string } {
  return statusMeta[s.toLowerCase()] || { tone: "gray", label: s };
}

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
        const openRate = c.total_sent && c.total_sent > 0 ? parseFloat((((c.total_opened || 0) / c.total_sent) * 100).toFixed(1)) : 0;
        const clickRate = c.total_sent && c.total_sent > 0 ? parseFloat((((c.total_clicked || 0) / c.total_sent) * 100).toFixed(1)) : 0;
        const dateStr = c.sent_at || c.scheduled_at || c.created_at;
        const date = dateStr ? new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
        return {
          id: c.id,
          name: c.name,
          status: c.status,
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

  const columns: Column<CampaignRow>[] = [
    { header: "Campaign", cell: (c) => <span className="pm-b7">{c.name}</span> },
    { header: "Status", cell: (c) => { const sp = statusFor(c.status); return <StatusBadge tone={sp.tone}>{sp.label}</StatusBadge>; } },
    { header: "Sent", cell: (c) => (c.sent > 0 ? c.sent.toLocaleString() : "—") },
    { header: "Open", cell: (c) => (c.openRate > 0 ? `${c.openRate}%` : "—") },
    { header: "Click", cell: (c) => (c.clickRate > 0 ? `${c.clickRate}%` : "—") },
    { header: "Revenue", cell: (c) => (c.revenue > 0 ? <span className="pm-b7" style={{ color: "var(--pm-green)" }}>₹{c.revenue.toLocaleString()}</span> : <span className="pm-dim">—</span>) },
    { header: "Date", cell: (c) => <span className="pm-dim">{c.date}</span> },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Campaigns"
        subtitle="Manage and track your email campaigns"
        actions={<Link href="/dashboard/campaigns/new" className="pm-btn primary"><Plus size={15} /> Create campaign</Link>}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs tabs={tabs.map((t) => ({ key: t, label: t }))} active={activeTab} onSelect={setActiveTab} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--pm-hint)", marginBottom: 16 }}>
          Sort by
          <FilterChips
            chips={[{ key: "date", label: "Date" }, { key: "revenue", label: "Revenue" }, { key: "openRate", label: "Open rate" }]}
            active={sortBy}
            onSelect={(k) => setSortBy(k as SortKey)}
          />
        </div>
      </div>

      {filtered.length > 0 ? (
        <div style={{ opacity: isLoading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} onRowClick={(c) => router.push(`/dashboard/campaigns/${c.id}`)} />
        </div>
      ) : (
        <EmptyState
          icon={<Megaphone />}
          title={loaded ? "No campaigns yet" : "Loading…"}
          cta={loaded ? <Link href="/dashboard/campaigns/new" className="pm-btn primary"><Plus size={15} /> Create campaign</Link> : undefined}
        >
          {loaded ? "Create your first campaign to start sending emails to your contacts and tracking revenue." : undefined}
        </EmptyState>
      )}
    </div>
  );
}
