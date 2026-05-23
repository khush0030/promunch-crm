"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Upload, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

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

const statusPill: Record<string, { cls: string; label: string }> = {
  active: { cls: "green", label: "Active" },
  Active: { cls: "green", label: "Active" },
  inactive: { cls: "amber", label: "Inactive" },
  Inactive: { cls: "amber", label: "Inactive" },
  unsubscribed: { cls: "grey", label: "Unsubscribed" },
  Unsubscribed: { cls: "grey", label: "Unsubscribed" },
  bounced: { cls: "accent", label: "Bounced" },
  Bounced: { cls: "accent", label: "Bounced" },
  VIP: { cls: "accent", label: "VIP" },
  "At Risk": { cls: "accent", label: "At Risk" },
  New: { cls: "blue", label: "New" },
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
  const router = useRouter();
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
  const [importOpen, setImportOpen] = useState(false);
  // Klaviyo list / segment filter — at most one active at a time.
  const [audience, setAudience] = useState<{ type: "list" | "segment"; value: string } | null>(
    null
  );
  const [facets, setFacets] = useState<{
    lists: { name: string; count: number }[];
    segments: { name: string; count: number }[];
  }>({ lists: [], segments: [] });

  const fetchContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (search) params.set("search", search);
      if (activeFilter !== "All") params.set("status", activeFilter);
      if (audience?.type === "list") params.set("list", audience.value);
      if (audience?.type === "segment") params.set("segment", audience.value);
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
          ? new Date(c.last_purchase_date).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "",
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
  }, [search, activeFilter, audience, page, minOrders, minLtv, lastOrderDays, lastOrderOp, sort, dir]);

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300);
    return () => clearTimeout(timer);
  }, [fetchContacts]);

  // Klaviyo lists & segments available for filter chips.
  useEffect(() => {
    fetch("/api/contacts/facets")
      .then((r) => r.json())
      .then((d) => setFacets({ lists: d.lists ?? [], segments: d.segments ?? [] }))
      .catch(() => {});
  }, []);

  async function runImport(source: "klaviyo" | "shopify") {
    setImporting(true);
    setImportMsg(`Importing from ${source}…`);
    try {
      const res = await fetch(`/api/import/${source}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setImportMsg(
          `Imported ${data.imported} contacts (${data.scanned} scanned, ${data.skippedNoEmail || 0} skipped without email).`
        );
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
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <div className="sub">
            {total.toLocaleString("en-IN")} total contacts · manage your subscriber base
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {importMsg && (
            <span
              style={{
                fontSize: 12,
                color: importMsg.startsWith("Imported")
                  ? "var(--green)"
                  : importMsg.startsWith("Importing")
                  ? "var(--text-2)"
                  : "var(--accent)",
              }}
            >
              {importMsg}
            </span>
          )}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn primary"
              disabled={importing}
              onClick={() => setImportOpen((o) => !o)}
            >
              <Upload size={14} />
              {importing ? "Importing…" : "Import / Sync"}
              <ChevronDown size={13} />
            </button>
            {importOpen && (
              <>
                <div
                  onClick={() => setImportOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 19 }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "var(--card-shadow)",
                    zIndex: 20,
                    minWidth: 190,
                    overflow: "hidden",
                  }}
                >
                  {(["klaviyo", "shopify"] as const).map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => {
                        setImportOpen(false);
                        runImport(src);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "9px 12px",
                        fontSize: 13,
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        color: "var(--text)",
                      }}
                    >
                      <Upload size={13} /> Import from {src === "klaviyo" ? "Klaviyo" : "Shopify"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="search">
          <Search size={15} />
          <input
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="chips">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${activeFilter === f ? " active" : ""}`}
              onClick={() => {
                setActiveFilter(f);
                setPage(1);
              }}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`chip${showFilters ? " active" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          More filters
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-3)" }}>
          Sort by
          <select
            aria-label="Sort"
            className="input"
            style={{ padding: "5px 8px", fontSize: 12.5, width: "auto" }}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="created_at">Recently added</option>
            <option value="last_purchase_date">Last order</option>
            <option value="total_spent">LTV</option>
            <option value="total_orders">Order count</option>
            <option value="average_order_value">Avg order value</option>
            <option value="email">Email</option>
          </select>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label="Toggle direction"
          >
            {dir === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </div>

      {(facets.segments.length > 0 || facets.lists.length > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>
            Segments &amp; lists
          </span>
          <div className="chips">
            {facets.segments.slice(0, 8).map((s) => (
              <button
                key={`seg-${s.name}`}
                type="button"
                className={`chip${
                  audience?.type === "segment" && audience.value === s.name ? " active" : ""
                }`}
                title={`Segment · ${s.count} contact${s.count === 1 ? "" : "s"}`}
                onClick={() => {
                  setAudience((a) =>
                    a?.type === "segment" && a.value === s.name
                      ? null
                      : { type: "segment", value: s.name }
                  );
                  setPage(1);
                }}
              >
                {s.name}
              </button>
            ))}
            {facets.lists.slice(0, 6).map((l) => (
              <button
                key={`list-${l.name}`}
                type="button"
                className={`chip${
                  audience?.type === "list" && audience.value === l.name ? " active" : ""
                }`}
                title={`List · ${l.count} contact${l.count === 1 ? "" : "s"}`}
                onClick={() => {
                  setAudience((a) =>
                    a?.type === "list" && a.value === l.name
                      ? null
                      : { type: "list", value: l.name }
                  );
                  setPage(1);
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showFilters && (
        <div className="card card-pad section" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) auto", gap: 12, alignItems: "end" }}>
          <div className="field">
            <label>Min orders</label>
            <input
              type="number"
              min={0}
              className="input"
              title="Minimum orders"
              placeholder="0"
              value={minOrders}
              onChange={(e) => {
                setMinOrders(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label>Min LTV (₹)</label>
            <input
              type="number"
              min={0}
              className="input"
              title="Minimum lifetime value"
              placeholder="0"
              value={minLtv}
              onChange={(e) => {
                setMinLtv(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label>Last order</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                aria-label="Last order comparison"
                className="input"
                style={{ width: "auto" }}
                value={lastOrderOp}
                onChange={(e) => setLastOrderOp(e.target.value as "within" | "before")}
              >
                <option value="within">Within last</option>
                <option value="before">Before last</option>
              </select>
              <input
                type="number"
                min={0}
                className="input"
                style={{ flex: 1 }}
                title="Days"
                placeholder="Days"
                value={lastOrderDays}
                onChange={(e) => {
                  setLastOrderDays(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setMinOrders("");
              setMinLtv("");
              setLastOrderDays("");
              setLastOrderOp("within");
              setPage(1);
            }}
          >
            Clear
          </button>
        </div>
      )}

      {contacts.length > 0 ? (
        <div className="card" style={{ opacity: isLoading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Orders</th>
                <th>Lifetime value</th>
                <th>Last order</th>
                <th>Status</th>
                <th>Lists &amp; Segments</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const sp = statusPill[c.status] || { cls: "grey", label: c.status };
                return (
                  <tr
                    key={c.id}
                    className="clickable"
                    onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  >
                    <td>
                      <div className="cell-main">
                        <Avatar name={c.name} size={26} />
                        <span className="nm">{c.name}</span>
                      </div>
                    </td>
                    <td className="muted">{c.email}</td>
                    <td className="num">{c.orders}</td>
                    <td
                      className="num"
                      style={{
                        color: c.orders > 0 ? "var(--green)" : "var(--text-3)",
                        fontWeight: c.orders > 0 ? 500 : 400,
                      }}
                    >
                      {c.ltv}
                    </td>
                    <td className="muted">{c.lastOrder || "—"}</td>
                    <td>
                      <span className={`pill ${sp.cls}`}>
                        <span className="dot" style={{ background: `var(--${sp.cls === "grey" ? "text-3" : sp.cls})` }} />
                        {sp.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 240 }}>
                        {c.lists.slice(0, 2).map((l) => (
                          <span key={`l-${l}`} className="tag" title={l}>
                            {l}
                          </span>
                        ))}
                        {c.segments.slice(0, 2).map((s) => (
                          <span key={`s-${s}`} className="tag" title={s}>
                            {s}
                          </span>
                        ))}
                        {c.lists.length + c.segments.length > 4 && (
                          <span className="muted" style={{ fontSize: 11 }}>
                            +{c.lists.length + c.segments.length - 4}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span className="muted" style={{ fontSize: 12.5 }}>
              Showing {contacts.length} of {total.toLocaleString("en-IN")}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                aria-label="Previous"
                className="btn ghost sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="muted" style={{ fontSize: 12.5, padding: "0 8px" }}>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                aria-label="Next"
                className="btn sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3>{loaded ? "No contacts yet" : "Loading…"}</h3>
          {loaded && (
            <p>Import contacts from Shopify or Klaviyo to get started, or add them manually.</p>
          )}
          {loaded && (
            <button
              type="button"
              className="btn primary"
              disabled={importing}
              onClick={() => runImport("shopify")}
            >
              <Upload size={14} /> Import from Shopify
            </button>
          )}
        </div>
      )}
    </div>
  );
}
