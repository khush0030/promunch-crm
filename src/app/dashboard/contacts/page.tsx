"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Upload, ChevronLeft, ChevronRight, Filter } from "lucide-react";

const mockContacts = [
  { id: "1", name: "Alex Mitchell", email: "alex.m@gmail.com", orders: 8, ltv: "₹432.50", lastOrder: "Mar 12, 2026", status: "VIP", tags: ["VIP", "Protein Lover"] },
  { id: "2", name: "Sarah Chen", email: "sarah.chen@outlook.com", orders: 5, ltv: "₹287.80", lastOrder: "Mar 10, 2026", status: "Active", tags: ["Repeat Buyer"] },
  { id: "3", name: "Marcus Johnson", email: "m.johnson@gmail.com", orders: 2, ltv: "₹98.40", lastOrder: "Feb 28, 2026", status: "At Risk", tags: ["New"] },
  { id: "4", name: "Priya Sharma", email: "priya.s@yahoo.com", orders: 12, ltv: "₹684.20", lastOrder: "Mar 15, 2026", status: "VIP", tags: ["VIP", "Snack Fan", "Protein Lover"] },
  { id: "5", name: "Tyler Brooks", email: "tbrooks@gmail.com", orders: 3, ltv: "₹156.90", lastOrder: "Mar 5, 2026", status: "Active", tags: ["Repeat Buyer"] },
  { id: "6", name: "Emma Rodriguez", email: "emma.r@icloud.com", orders: 1, ltv: "₹54.99", lastOrder: "Mar 14, 2026", status: "New", tags: ["New"] },
  { id: "7", name: "James Park", email: "jpark@gmail.com", orders: 7, ltv: "₹398.30", lastOrder: "Mar 8, 2026", status: "Active", tags: ["Protein Lover"] },
  { id: "8", name: "Olivia Turner", email: "olivia.t@hotmail.com", orders: 15, ltv: "₹823.70", lastOrder: "Mar 16, 2026", status: "VIP", tags: ["VIP", "Snack Fan"] },
  { id: "9", name: "Ryan Williams", email: "rwilliams@gmail.com", orders: 1, ltv: "₹44.99", lastOrder: "Jan 20, 2026", status: "At Risk", tags: ["Churning"] },
  { id: "10", name: "Zoe Campbell", email: "zoe.c@gmail.com", orders: 4, ltv: "₹212.60", lastOrder: "Mar 11, 2026", status: "Active", tags: ["Repeat Buyer"] },
  { id: "11", name: "Nathan Lee", email: "nathan.lee@outlook.com", orders: 9, ltv: "₹512.40", lastOrder: "Mar 9, 2026", status: "VIP", tags: ["VIP", "Protein Lover"] },
  { id: "12", name: "Amara Okafor", email: "amara.ok@gmail.com", orders: 2, ltv: "₹109.80", lastOrder: "Feb 15, 2026", status: "At Risk", tags: [] },
  { id: "13", name: "David Kim", email: "dkim@gmail.com", orders: 6, ltv: "₹341.20", lastOrder: "Mar 7, 2026", status: "Active", tags: ["Snack Fan"] },
  { id: "14", name: "Mia Thompson", email: "mia.t@icloud.com", orders: 1, ltv: "₹39.99", lastOrder: "Mar 13, 2026", status: "New", tags: ["New"] },
  { id: "15", name: "Lucas Davis", email: "ldavis@yahoo.com", orders: 11, ltv: "₹621.50", lastOrder: "Mar 14, 2026", status: "VIP", tags: ["VIP", "Repeat Buyer"] },
];

type ContactRow = {
  id: string;
  name: string;
  email: string;
  orders: number;
  ltv: string;
  lastOrder: string;
  status: string;
  tags: string[];
};

const statusColors: Record<string, { bg: string; color: string }> = {
  VIP: { bg: "rgba(185, 28, 74, 0.15)", color: "#E8658B" },
  Active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  active: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
  "At Risk": { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  inactive: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  New: { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
  unsubscribed: { bg: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa" },
  bounced: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
};

const filters = ["All", "Active", "VIP", "At Risk", "New"];

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [contacts, setContacts] = useState<ContactRow[]>(mockContacts);
  const [total, setTotal] = useState(mockContacts.length);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [usingLiveData, setUsingLiveData] = useState(false);

  const fetchContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "15",
      });

      if (search) params.set("search", search);
      if (activeFilter !== "All") params.set("status", activeFilter);

      const res = await fetch(`/api/contacts?${params}`);
      if (!res.ok) throw new Error("API error");

      const data = await res.json();

      if (data.contacts && data.contacts.length > 0) {
        const mapped: ContactRow[] = data.contacts.map((c: {
          id: string;
          first_name?: string;
          last_name?: string;
          email: string;
          total_orders?: number;
          total_spent?: number;
          last_purchase_date?: string;
          status?: string;
          tags?: string[];
        }) => ({
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email.split("@")[0],
          email: c.email,
          orders: c.total_orders || 0,
          ltv: c.total_spent ? `₹${parseFloat(String(c.total_spent)).toFixed(2)}` : "₹0",
          lastOrder: c.last_purchase_date
            ? new Date(c.last_purchase_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "—",
          status: c.status
            ? c.status.charAt(0).toUpperCase() + c.status.slice(1)
            : "Active",
          tags: c.tags || [],
        }));

        setContacts(mapped);
        setTotal(data.total);
        setTotalPages(data.pages || 1);
        setUsingLiveData(true);
      } else {
        // DB empty — show mock data filtered
        const filtered = mockContacts.filter((c) => {
          const matchSearch =
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.email.toLowerCase().includes(search.toLowerCase());
          const matchFilter = activeFilter === "All" || c.status === activeFilter;
          return matchSearch && matchFilter;
        });
        setContacts(filtered);
        setTotal(filtered.length);
        setTotalPages(1);
        setUsingLiveData(false);
      }
    } catch {
      // Fallback to mock
      const filtered = mockContacts.filter((c) => {
        const matchSearch =
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.email.toLowerCase().includes(search.toLowerCase());
        const matchFilter = activeFilter === "All" || c.status === activeFilter;
        return matchSearch && matchFilter;
      });
      setContacts(filtered);
      setTotal(filtered.length);
      setTotalPages(1);
      setUsingLiveData(false);
    } finally {
      setIsLoading(false);
    }
  }, [search, activeFilter, page]);

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300);
    return () => clearTimeout(timer);
  }, [fetchContacts]);

  return (
    <div style={{ padding: "32px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f4f4f5", letterSpacing: "-0.5px" }}>
            Contacts
          </h1>
          <p style={{ color: "#71717a", marginTop: "4px", fontSize: "14px" }}>
            {total} total contacts · manage your subscriber base
            {usingLiveData && <span style={{ color: "#10b981", marginLeft: "8px" }}>● Live</span>}
          </p>
        </div>
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
          <Upload size={16} />
          Import from Shopify
        </button>
      </div>

      {/* Search + Filter */}
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
              {f}
            </button>
          ))}
        </div>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "9px 14px",
            backgroundColor: "#18181b",
            border: "1px solid #27272a",
            borderRadius: "8px",
            color: "#a1a1aa",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          <Filter size={14} />
          Filters
        </button>
      </div>

      {/* Table */}
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
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #27272a", backgroundColor: "#1c1c1f" }}>
              {["Name", "Email", "Orders", "LTV", "Last Order", "Status", "Tags"].map((h) => (
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
                        {c.name.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
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
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {c.tags.map((tag: string) => (
                      <span
                        key={tag}
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          backgroundColor: "#27272a",
                          color: "#a1a1aa",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
        <span style={{ fontSize: "13px", color: "#71717a" }}>
          Showing {contacts.length} of {total} contacts
        </span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button
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
    </div>
  );
}
