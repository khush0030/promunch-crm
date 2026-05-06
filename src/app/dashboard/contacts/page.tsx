"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Upload, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";

type ContactRow = {
  id: string;
  name: string;
  email: string;
  orders: number;
  ltv: string;
  lastOrder: string;
  status: string;
  tags: string[];
  lists: string[];
  segments: string[];
};

const statusColors: Record<string, { bg: string; color: string }> = {
  VIP: { bg: "rgba(185, 28, 74, 0.15)", color: "#E8658B" },
  Active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  "At Risk": { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  inactive: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  New: { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
  unsubscribed: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  Unsubscribed: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  bounced: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  Bounced: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
};

const filters = ["All", "active", "inactive", "unsubscribed", "bounced"];
const filterLabels: Record<string, string> = {
  All: "All",
  active: "Active",
  inactive: "Inactive",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
};

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [minOrders, setMinOrders] = useState("");
  const [minLtv, setMinLtv] = useState("");
  const [lastOrderDays, setLastOrderDays] = useState("");
  const [lastOrderOp, setLastOrderOp] = useState<"within" | "before">("within");
  const [sort, setSort] = useState("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);

  const fetchContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "15",
      });

      if (search) params.set("search", search);
      if (activeFilter !== "All") params.set("status", activeFilter);
      if (minOrders) params.set("minOrders", minOrders);
      if (minLtv) params.set("minLtv", minLtv);
      if (lastOrderDays) {
        params.set("lastOrderDays", lastOrderDays);
        params.set("lastOrderOp", lastOrderOp);
      }
      params.set("sort", sort);
      params.set("dir", dir);

      const res = await fetch(`/api/contacts?${params}`);
      if (!res.ok) throw new Error("API error");

      const data = await res.json();

      const mapped: ContactRow[] = (data.contacts || []).map((c: {
        id: string;
        first_name?: string;
        last_name?: string;
        email: string;
        total_orders?: number;
        total_spent?: number;
        last_purchase_date?: string;
        status?: string;
        tags?: string[];
        klaviyo_lists?: string[];
        klaviyo_segments?: string[];
      }) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email.split("@")[0],
        email: c.email,
        orders: c.total_orders || 0,
        ltv: c.total_spent ? `₹${parseFloat(String(c.total_spent)).toFixed(2)}` : "₹0",
        lastOrder: c.last_purchase_date
          ? new Date(c.last_purchase_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "—",
        status: c.status || "active",
        tags: c.tags || [],
        lists: c.klaviyo_lists || [],
        segments: c.klaviyo_segments || [],
      }));

      setContacts(mapped);
      setTotal(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch {
      setContacts([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setIsLoading(false);
      setLoaded(true);
    }
  }, [search, activeFilter, page, minOrders, minLtv, lastOrderDays, lastOrderOp, sort, dir]);

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300);
    return () => clearTimeout(timer);
  }, [fetchContacts]);

  async function runImport(source: "klaviyo" | "shopify") {
    setImporting(true);
    setImportMsg(`Importing from ${source}…`);
    try {
      const res = await fetch(`/api/import/${source}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setImportMsg(`Imported ${data.imported} contacts (${data.scanned} scanned, ${data.skippedNoEmail || 0} skipped without email).`);
        fetchContacts();
      } else {
        setImportMsg(`Import failed: ${data.error || "unknown error"}`);
      }
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ padding: "32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>
            Contacts
          </h1>
          <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
            {total.toLocaleString()} total contacts · manage your subscriber base
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {importMsg && (
            <span style={{ fontSize: "12px", color: importMsg.startsWith("Imported") ? "#10b981" : importMsg.startsWith("Importing") ? "#a1a1aa" : "#ef4444" }}>
              {importMsg}
            </span>
          )}
          <button
            type="button"
            disabled={importing}
            onClick={() => runImport("klaviyo")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              background: importing ? "#27272a" : "linear-gradient(135deg, #00B4D8, #0084a8)",
              border: "none",
              borderRadius: "9px",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: importing ? "not-allowed" : "pointer",
              opacity: importing ? 0.6 : 1,
            }}
          >
            <Upload size={16} />
            {importing ? "Importing…" : "Import from Klaviyo"}
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => runImport("shopify")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              background: importing ? "#27272a" : "linear-gradient(135deg, #B91C4A, #8B1539)",
              border: "none",
              borderRadius: "9px",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: importing ? "not-allowed" : "pointer",
              opacity: importing ? 0.6 : 1,
            }}
          >
            <Upload size={16} />
            Import from Shopify
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
          <Search size={16} color="#71717a" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{
              width: "100%",
              padding: "10px 12px 10px 38px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "9px",
              color: "#f4f4f5",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => { setActiveFilter(f); setPage(1); }}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: activeFilter === f ? "1px solid #B91C4A" : "1px solid #27272a",
                backgroundColor: activeFilter === f ? "rgba(185, 28, 74, 0.15)" : "#18181b",
                color: activeFilter === f ? "#E8658B" : "#a1a1aa",
                fontSize: "13px",
                fontWeight: activeFilter === f ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "9px 14px",
            backgroundColor: showFilters ? "rgba(185, 28, 74, 0.1)" : "#18181b",
            border: showFilters ? "1px solid #B91C4A" : "1px solid #27272a",
            borderRadius: "8px",
            color: showFilters ? "#E8658B" : "#a1a1aa",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          More filters
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <ArrowUpDown size={14} color="#71717a" />
          <select
            aria-label="Sort contacts by"
            title="Sort by"
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            style={{
              padding: "8px 10px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              color: "#a1a1aa",
              fontSize: "13px",
              outline: "none",
            }}
          >
            <option value="created_at">Recently added</option>
            <option value="last_purchase_date">Last order date</option>
            <option value="total_spent">LTV</option>
            <option value="total_orders">Order count</option>
            <option value="average_order_value">Avg order value</option>
            <option value="email">Email</option>
          </select>
          <button
            type="button"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            style={{
              padding: "8px 12px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              color: "#a1a1aa",
              fontSize: "13px",
              cursor: "pointer",
              minWidth: "44px",
            }}
          >
            {dir === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </div>

      {showFilters && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr) auto",
            gap: "12px",
            marginBottom: "20px",
            padding: "16px",
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "10px",
            alignItems: "end",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Min orders</label>
            <input
              type="number"
              min={0}
              value={minOrders}
              onChange={(e) => { setMinOrders(e.target.value); setPage(1); }}
              placeholder="e.g. 1"
              style={{
                width: "100%",
                padding: "8px 10px",
                backgroundColor: "#0e0e10",
                border: "1px solid #27272a",
                borderRadius: "8px",
                color: "#f4f4f5",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Min LTV (₹)</label>
            <input
              type="number"
              min={0}
              value={minLtv}
              onChange={(e) => { setMinLtv(e.target.value); setPage(1); }}
              placeholder="e.g. 500"
              style={{
                width: "100%",
                padding: "8px 10px",
                backgroundColor: "#0e0e10",
                border: "1px solid #27272a",
                borderRadius: "8px",
                color: "#f4f4f5",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#71717a", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Last order</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <select
                aria-label="Last order comparison"
                title="Last order comparison"
                value={lastOrderOp}
                onChange={(e) => setLastOrderOp(e.target.value as "within" | "before")}
                style={{
                  padding: "8px 10px",
                  backgroundColor: "#0e0e10",
                  border: "1px solid #27272a",
                  borderRadius: "8px",
                  color: "#a1a1aa",
                  fontSize: "13px",
                  outline: "none",
                }}
              >
                <option value="within">Within last</option>
                <option value="before">Before last</option>
              </select>
              <input
                type="number"
                min={0}
                value={lastOrderDays}
                onChange={(e) => { setLastOrderDays(e.target.value); setPage(1); }}
                placeholder="days"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  backgroundColor: "#0e0e10",
                  border: "1px solid #27272a",
                  borderRadius: "8px",
                  color: "#f4f4f5",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMinOrders("");
              setMinLtv("");
              setLastOrderDays("");
              setLastOrderOp("within");
              setPage(1);
            }}
            style={{
              padding: "8px 14px",
              backgroundColor: "transparent",
              border: "1px solid #27272a",
              borderRadius: "8px",
              color: "#a1a1aa",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}

      <div
        style={{
          backgroundColor: "#18181b",
          border: "1px solid #27272a",
          borderRadius: "12px",
          overflow: "hidden",
          opacity: isLoading ? 0.7 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {contacts.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #27272a", backgroundColor: "#1c1c1f" }}>
                {["Name", "Email", "Orders", "LTV", "Last Order", "Status", "Lists & Segments"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#52525b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: i < contacts.length - 1 ? "1px solid #27272a" : "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1c1c1f")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <td style={{ padding: "14px 16px" }}>
                    <Link href={`/dashboard/contacts/${c.id}`}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div
                          style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #B91C4A, #8B1539)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#fff",
                            flexShrink: 0,
                          }}
                        >
                          {c.name.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "#f4f4f5", cursor: "pointer" }}>
                          {c.name}
                        </span>
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "13px", color: "#a1a1aa" }}>{c.email}</td>
                  <td style={{ padding: "14px 16px", fontSize: "13px", color: "#f4f4f5", fontWeight: 500 }}>{c.orders}</td>
                  <td style={{ padding: "14px 16px", fontSize: "13px", fontWeight: 600, color: "#10b981" }}>{c.ltv}</td>
                  <td style={{ padding: "14px 16px", fontSize: "13px", color: "#a1a1aa" }}>{c.lastOrder}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: 600,
                        backgroundColor: statusColors[c.status]?.bg || "rgba(113,113,122,0.15)",
                        color: statusColors[c.status]?.color || "#a1a1aa",
                      }}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "240px" }}>
                      {c.lists.slice(0, 2).map((l) => (
                        <span
                          key={`l-${l}`}
                          title={l}
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            backgroundColor: "rgba(0, 180, 216, 0.1)",
                            color: "#00B4D8",
                            maxWidth: "120px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l}
                        </span>
                      ))}
                      {c.segments.slice(0, 2).map((s) => (
                        <span
                          key={`s-${s}`}
                          title={s}
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            backgroundColor: "rgba(245, 183, 49, 0.1)",
                            color: "#F5B731",
                            maxWidth: "120px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s}
                        </span>
                      ))}
                      {c.lists.length + c.segments.length > 4 && (
                        <span style={{ padding: "2px 6px", fontSize: "11px", color: "#52525b" }}>
                          +{c.lists.length + c.segments.length - 4}
                        </span>
                      )}
                      {c.lists.length === 0 && c.segments.length === 0 && (
                        <span style={{ fontSize: "11px", color: "#3f3f46" }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "64px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "15px", color: "#a1a1aa", fontWeight: 600, marginBottom: "8px" }}>
              {loaded ? "No contacts yet" : "Loading…"}
            </div>
            {loaded && (
              <div style={{ fontSize: "13px", color: "#71717a", maxWidth: "360px", margin: "0 auto" }}>
                Import contacts from Shopify or Klaviyo to get started, or add them manually.
              </div>
            )}
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
          <span style={{ fontSize: "13px", color: "#71717a" }}>
            Showing {contacts.length} of {total} contacts
          </span>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button
              type="button"
              aria-label="Previous page"
              title="Previous page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                padding: "7px 12px",
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                color: page <= 1 ? "#3f3f46" : "#a1a1aa",
                cursor: page <= 1 ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 3) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  padding: "7px 12px",
                  backgroundColor: page === p ? "rgba(185, 28, 74, 0.15)" : "#18181b",
                  border: page === p ? "1px solid #B91C4A" : "1px solid #27272a",
                  borderRadius: "8px",
                  color: page === p ? "#E8658B" : "#a1a1aa",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: page === p ? 600 : 400,
                }}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              title="Next page"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                padding: "7px 12px",
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                color: page >= totalPages ? "#3f3f46" : "#a1a1aa",
                cursor: page >= totalPages ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
