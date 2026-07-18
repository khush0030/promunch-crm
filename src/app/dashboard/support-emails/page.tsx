"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import {
  PageHead,
  Toolbar,
  SearchBar,
  FilterChips,
  DataTable,
  StatusBadge,
} from "@/components/pm";
import type { Column, BadgeTone } from "@/components/pm";
import { apiFetch } from "@/lib/api-fetch";

type Thread = {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  lead_category?: string | null;
  urgency?: string | null;
  score?: number | null;
  classification_meta?: { rationale?: string } | null;
};

const statusTone: Record<string, BadgeTone> = {
  pending: "gold",
  sent: "green",
  skipped: "gray",
  failed: "terra",
};
const statusLabel: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
};

const urgencyTone: Record<string, BadgeTone> = {
  critical: "terra",
  high: "terra",
  medium: "gold",
  low: "gray",
};
const urgencyLabel: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const categoryTone: Record<string, BadgeTone> = {
  complaint: "terra",
  wholesale: "blue",
  partnership_inquiry: "blue",
  order_tracking: "gold",
  job_application: "gray",
  spam: "gray",
  general: "gray",
  customer_support: "gray",
};
const categoryLabel: Record<string, string> = {
  customer_support: "Support",
  order_tracking: "Order Tracking",
  complaint: "Complaint",
  partnership_inquiry: "Partnership",
  wholesale: "Wholesale",
  job_application: "Job",
  spam: "Spam",
  general: "General",
};

const filters = [
  { key: "pending", label: "Pending" },
  { key: "", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "skipped", label: "Skipped" },
  { key: "failed", label: "Failed" },
];

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function SupportEmailsPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [facets, setFacets] = useState<{
    pending: number;
    categories: { name: string; count: number }[];
  }>({ pending: 0, categories: [] });

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (status) params.set("status", status);
    if (category) params.set("lead_category", category);
    if (search) params.set("search", search);
    try {
      const data = await apiFetch<{ threads?: Thread[]; total?: number; pages?: number }>(`/api/support-emails?${params}`);
      setThreads(data.threads || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setLoadError(null);
    } catch (e) {
      // keep whatever is on screen; the empty state below explains the failure
      setLoadError(e instanceof Error ? e.message : "Couldn't load support emails");
    } finally {
      setLoaded(true);
    }
  }, [page, status, category, search]);

  useEffect(() => {
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  useEffect(() => {
    fetch("/api/support-emails/facets")
      .then((r) => r.json())
      .then((d) => setFacets({ pending: d.pending ?? 0, categories: d.categories ?? [] }))
      .catch(() => {});
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  }

  const statusChips = filters.map((f) => ({
    key: f.key || "all",
    label: f.key === "pending" && facets.pending > 0 ? `${f.label} ${facets.pending}` : f.label,
  }));

  const columns: Column<Thread>[] = [
    {
      header: "From",
      cell: (t) => {
        const name = t.from_name || t.from_email.split("@")[0];
        return (
          <div className="pm-cellname">
            <Avatar name={name} size={30} />
            <div>
              <div className="pm-b7">{name}</div>
              <div className="pm-dim" style={{ fontSize: 11 }}>{t.from_email}</div>
            </div>
          </div>
        );
      },
    },
    {
      header: "Subject",
      width: "34%",
      cell: (t) => (
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.subject || "(no subject)"}
          </div>
          {t.snippet && (
            <div className="pm-dim" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.snippet}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Category",
      cell: (t) =>
        t.lead_category ? (
          <StatusBadge tone={categoryTone[t.lead_category] ?? "gray"}>
            {categoryLabel[t.lead_category] || t.lead_category}
          </StatusBadge>
        ) : (
          <span className="pm-dim">—</span>
        ),
    },
    {
      header: "Urgency",
      cell: (t) =>
        t.urgency ? (
          <StatusBadge tone={urgencyTone[t.urgency] ?? "gray"}>{urgencyLabel[t.urgency] || t.urgency}</StatusBadge>
        ) : (
          <span className="pm-dim">—</span>
        ),
    },
    {
      header: "Score",
      cell: (t) => (t.score != null ? <span className="pm-b7">{t.score}</span> : <span className="pm-dim">—</span>),
    },
    {
      header: "Status",
      cell: (t) => (
        <StatusBadge tone={statusTone[t.status] ?? "gold"}>{statusLabel[t.status] || t.status}</StatusBadge>
      ),
    },
    {
      header: "Received",
      cell: (t) => <span className="pm-dim">{timeAgo(t.created_at)}</span>,
    },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Support Emails"
        subtitle={`Inbox replies handled by the Slack approval bot · ${total.toLocaleString("en-IN")} threads`}
        actions={
          <button className="pm-btn ghost" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} /> {refreshing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <Toolbar>
        <SearchBar
          value={search}
          placeholder="Search threads, senders, subjects…"
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <FilterChips
          chips={statusChips}
          active={status || "all"}
          onSelect={(k) => {
            setStatus(k === "all" ? "" : k);
            setPage(1);
          }}
        />
      </Toolbar>

      {facets.categories.length > 0 && (
        <div className="pm-chips" style={{ marginBottom: 14 }}>
          {[...facets.categories]
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
            .map((c) => (
              <span
                key={c.name}
                className={`pm-tag${category === c.name ? " on" : ""}`}
                style={
                  category === c.name
                    ? { background: "var(--pm-green-soft)", borderColor: "var(--pm-green)", color: "var(--pm-green)", cursor: "pointer" }
                    : { cursor: "pointer" }
                }
                title={`${c.count} email${c.count === 1 ? "" : "s"}`}
                onClick={() => {
                  setCategory((v) => (v === c.name ? "" : c.name));
                  setPage(1);
                }}
              >
                {categoryLabel[c.name] || c.name}
                <span style={{ opacity: 0.6, marginLeft: 4 }}>{c.count}</span>
              </span>
            ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={threads}
        rowKey={(t) => t.id}
        onRowClick={(t) => router.push(`/dashboard/support-emails/${t.id}`)}
        empty={
          !loaded ? "Loading…"
          : loadError ? (
            <span>
              Couldn’t load support emails: {loadError}{" "}
              <button className="pm-btn ghost sm" style={{ marginLeft: 8 }} onClick={refresh}>
                <RefreshCw size={13} /> Retry
              </button>
            </span>
          )
          : "No support emails yet"
        }
      />

      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <span className="pm-dim" style={{ fontSize: 12.5 }}>
            Page {page} of {pages}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="pm-btn ghost sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <button className="pm-btn sm" disabled={page === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
