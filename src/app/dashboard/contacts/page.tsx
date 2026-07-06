"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, ChevronLeft, ChevronRight, ChevronDown, Users, UserPlus, ShoppingBag, UserMinus, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { PageHead, Toolbar, SearchBar, FilterChips, DataTable, StatusBadge, EmptyState, KpiCard } from "@/components/pm";
import type { Column, BadgeTone, KpiTone } from "@/components/pm";

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

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  inactive: { tone: "gold", label: "Inactive" },
  unsubscribed: { tone: "gray", label: "Unsubscribed" },
  bounced: { tone: "terra", label: "Bounced" },
  VIP: { tone: "terra", label: "VIP" },
  "At Risk": { tone: "terra", label: "At Risk" },
  New: { tone: "blue", label: "New" },
};
function statusFor(s: string): { tone: BadgeTone; label: string } {
  return statusMeta[s] || statusMeta[s?.toLowerCase?.()] || { tone: "gray", label: s };
}

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
  const toast = useToast();
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
  const [audience, setAudience] = useState<{ type: "list" | "segment"; value: string } | null>(null);
  const [facets, setFacets] = useState<{
    lists: { name: string; count: number }[];
    segments: { name: string; count: number }[];
  }>({ lists: [], segments: [] });
  const [stats, setStats] = useState<{ total: number; buyers: number; newThisMonth: number; unsubscribed: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", first_name: "", last_name: "", phone: "" });

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
        ltv: c.total_spent
          ? `₹${parseFloat(String(c.total_spent)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
          : "₹0",
        lastOrder: c.last_purchase_date
          ? new Date(c.last_purchase_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
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

  useEffect(() => {
    fetch("/api/contacts/facets")
      .then((r) => r.json())
      .then((d) => {
        setFacets({ lists: d.lists ?? [], segments: d.segments ?? [] });
        if (d.stats) setStats(d.stats);
      })
      .catch(() => {});
  }, []);

  async function runImport(source: "klaviyo" | "shopify") {
    setImporting(true);
    setImportMsg(`Importing from ${source}…`);
    try {
      const res = await fetch(`/api/import/${source}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const updated = data.updated ? `, ${data.updated} refreshed` : "";
        setImportMsg(`Imported ${data.imported} new contacts${updated} (${data.scanned} scanned, ${data.skippedNoEmail || 0} without email).`);
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

  function exportCsv() {
    const params = new URLSearchParams();
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
    window.open(`/api/contacts/export?${params}`, "_blank");
  }

  async function submitAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.email.trim()) return;
    setAddBusy(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: addForm.email.trim(),
          first_name: addForm.first_name.trim() || undefined,
          last_name: addForm.last_name.trim() || undefined,
          phone: addForm.phone.trim() || undefined,
          source: "manual",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to add contact");
      toast.push({ kind: "success", text: `Added ${j.contact.email}.` });
      setAddOpen(false);
      setAddForm({ email: "", first_name: "", last_name: "", phone: "" });
      fetchContacts();
    } catch (err) {
      toast.push({ kind: "error", text: err instanceof Error ? err.message : "Failed to add contact" });
    } finally {
      setAddBusy(false);
    }
  }

  const showOrderCols = contacts.some((c) => c.orders > 0);

  const columns: Column<ContactRow>[] = [
    {
      header: "Name",
      cell: (c) => (
        <div className="pm-cellname">
          <Avatar name={c.name} size={30} />
          <span className="pm-b7">{c.name}</span>
        </div>
      ),
    },
    { header: "Email", cell: (c) => <span className="pm-dim">{c.email}</span> },
    ...(showOrderCols
      ? ([
          { header: "Orders", cell: (c: ContactRow) => c.orders },
          {
            header: "LTV",
            cell: (c: ContactRow) => (
              <span style={{ color: c.orders > 0 ? "var(--pm-green)" : "var(--pm-hint)", fontWeight: c.orders > 0 ? 600 : 400 }}>{c.ltv}</span>
            ),
          },
          { header: "Last order", cell: (c: ContactRow) => <span className="pm-dim">{c.lastOrder || "—"}</span> },
        ] as Column<ContactRow>[])
      : []),
    {
      header: "Status",
      cell: (c) => {
        const sp = statusFor(c.status);
        return <StatusBadge tone={sp.tone}>{sp.label}</StatusBadge>;
      },
    },
    {
      header: "Lists & segments",
      cell: (c) => (
        <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 240 }}>
          {c.lists.slice(0, 2).map((l) => <span key={`l-${l}`} className="pm-tag" title={l}>{l}</span>)}
          {c.segments.slice(0, 2).map((s) => <span key={`s-${s}`} className="pm-tag" title={s}>{s}</span>)}
          {c.lists.length + c.segments.length > 4 && (
            <span className="pm-dim" style={{ fontSize: 11 }}>+{c.lists.length + c.segments.length - 4}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Contacts"
        subtitle={`${total.toLocaleString("en-IN")} total contacts · manage your subscriber base`}
        actions={
          <>
            {importMsg && (
              <span style={{ fontSize: 12, color: importMsg.startsWith("Imported") ? "var(--pm-green)" : importMsg.startsWith("Importing") ? "var(--pm-muted)" : "var(--pm-terra)" }}>
                {importMsg}
              </span>
            )}
            <button className="pm-btn ghost" onClick={() => setAddOpen(true)}>
              <UserPlus size={15} /> Add contact
            </button>
            <button className="pm-btn ghost" onClick={exportCsv} title="Download the current filtered view as CSV">
              <Download size={15} /> Export CSV
            </button>
            <div style={{ position: "relative" }}>
              <button className="pm-btn primary" disabled={importing} onClick={() => setImportOpen((o) => !o)}>
                <Upload size={15} /> {importing ? "Importing…" : "Import / Sync"} <ChevronDown size={13} />
              </button>
              {importOpen && (
                <>
                  <div onClick={() => setImportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 10, boxShadow: "0 8px 22px rgba(67,55,32,.12)", zIndex: 20, minWidth: 190, overflow: "hidden" }}>
                    {(["klaviyo", "shopify"] as const).map((src) => (
                      <button
                        key={src}
                        onClick={() => { setImportOpen(false); runImport(src); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", fontSize: 13, background: "none", border: "none", textAlign: "left", color: "var(--pm-ink)" }}
                      >
                        <Upload size={13} /> Import from {src === "klaviyo" ? "Klaviyo" : "Shopify"}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        }
      />

      {stats && (
        <div className="pm-kpis" style={{ marginBottom: 16 }}>
          {([
            { label: "Total contacts", value: stats.total.toLocaleString("en-IN"), icon: <Users />, tone: "b" as KpiTone },
            { label: "Buyers", value: stats.buyers.toLocaleString("en-IN"), icon: <ShoppingBag />, tone: "g" as KpiTone },
            { label: "New this month", value: stats.newThisMonth.toLocaleString("en-IN"), icon: <UserPlus />, tone: "t" as KpiTone },
            { label: "Unsubscribed", value: stats.unsubscribed.toLocaleString("en-IN"), icon: <UserMinus />, tone: "o" as KpiTone },
          ]).map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />
          ))}
        </div>
      )}

      <Toolbar>
        <SearchBar value={search} placeholder="Search contacts…" onChange={(v) => { setSearch(v); setPage(1); }} />
        <FilterChips
          chips={filters.map((f) => ({ key: f, label: filterLabels[f] }))}
          active={activeFilter}
          onSelect={(k) => { setActiveFilter(k); setPage(1); }}
        />
        <span className={`pm-chip${showFilters ? " on" : ""}`} onClick={() => setShowFilters((v) => !v)}>More filters</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--pm-hint)" }}>
          Sort by
          <select aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
            style={{ fontFamily: "inherit", fontSize: 12.5, color: "var(--pm-ink)", background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 9, padding: "6px 9px", outline: "none" }}>
            <option value="created_at">Recently added</option>
            <option value="last_purchase_date">Last order</option>
            <option value="total_spent">LTV</option>
            <option value="total_orders">Order count</option>
            <option value="average_order_value">Avg order value</option>
            <option value="email">Email</option>
          </select>
          <button className="pm-btn ghost sm" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} aria-label="Toggle direction">
            {dir === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </Toolbar>

      {(facets.segments.length > 0 || facets.lists.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--pm-hint)", fontWeight: 500 }}>Segments &amp; lists</span>
          <div className="pm-chips">
            {facets.segments.slice(0, 8).map((s) => (
              <span key={`seg-${s.name}`}
                className={`pm-chip${audience?.type === "segment" && audience.value === s.name ? " on" : ""}`}
                title={`Segment · ${s.count} contact${s.count === 1 ? "" : "s"}`}
                onClick={() => { setAudience((a) => (a?.type === "segment" && a.value === s.name ? null : { type: "segment", value: s.name })); setPage(1); }}>
                {s.name}
              </span>
            ))}
            {facets.lists.slice(0, 6).map((l) => (
              <span key={`list-${l.name}`}
                className={`pm-chip${audience?.type === "list" && audience.value === l.name ? " on" : ""}`}
                title={`List · ${l.count} contact${l.count === 1 ? "" : "s"}`}
                onClick={() => { setAudience((a) => (a?.type === "list" && a.value === l.name ? null : { type: "list", value: l.name })); setPage(1); }}>
                {l.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {showFilters && (
        <div className="pm-panel filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) auto", gap: 12, alignItems: "end", marginBottom: 14 }}>
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <label>Min orders</label>
            <input type="number" min={0} title="Minimum orders" placeholder="0" value={minOrders} onChange={(e) => { setMinOrders(e.target.value); setPage(1); }} />
          </div>
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <label>Min LTV (₹)</label>
            <input type="number" min={0} title="Minimum lifetime value" placeholder="0" value={minLtv} onChange={(e) => { setMinLtv(e.target.value); setPage(1); }} />
          </div>
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <label>Last order</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select aria-label="Last order comparison" value={lastOrderOp} onChange={(e) => setLastOrderOp(e.target.value as "within" | "before")}
                style={{ fontFamily: "inherit", fontSize: 13.5, color: "var(--pm-ink)", background: "var(--pm-card2)", border: "1px solid var(--pm-border)", borderRadius: 10, padding: "11px 10px", outline: "none" }}>
                <option value="within">Within last</option>
                <option value="before">Before last</option>
              </select>
              <input type="number" min={0} style={{ flex: 1 }} title="Days" placeholder="Days" value={lastOrderDays} onChange={(e) => { setLastOrderDays(e.target.value); setPage(1); }} />
            </div>
          </div>
          <button className="pm-btn ghost" onClick={() => { setMinOrders(""); setMinLtv(""); setLastOrderDays(""); setLastOrderOp("within"); setPage(1); }}>Clear</button>
        </div>
      )}

      {contacts.length > 0 ? (
        <div style={{ opacity: isLoading ? 0.7 : 1, transition: "opacity 0.2s" }}>
          <DataTable columns={columns} rows={contacts} rowKey={(c) => c.id} onRowClick={(c) => router.push(`/dashboard/contacts/${c.id}`)} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <span className="pm-dim" style={{ fontSize: 12.5 }}>Showing {contacts.length} of {total.toLocaleString("en-IN")}</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button aria-label="Previous" className="pm-btn ghost sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="pm-dim" style={{ fontSize: 12.5, padding: "0 8px" }}>Page {page} / {totalPages}</span>
              <button aria-label="Next" className="pm-btn sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Users />}
          title={loaded ? "No contacts yet" : "Loading…"}
          cta={loaded ? <button className="pm-btn primary" disabled={importing} onClick={() => runImport("shopify")}><Upload size={15} /> Import from Shopify</button> : undefined}
        >
          {loaded ? "Import contacts from Shopify or Klaviyo to get started, or add them manually." : undefined}
        </EmptyState>
      )}

      {addOpen && (
        <>
          <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(43,36,20,.32)", zIndex: 40 }} />
          <div role="dialog" aria-label="Add contact" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(440px, calc(100vw - 32px))", background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 14, boxShadow: "0 18px 48px rgba(67,55,32,.22)", zIndex: 41, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Add contact</h3>
              <button type="button" className="pm-btn ghost sm" onClick={() => setAddOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={submitAddContact}>
              <div className="pm-field">
                <label>Email *</label>
                <input type="email" required autoFocus placeholder="customer@example.com" value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="pm-field">
                  <label>First name</label>
                  <input type="text" placeholder="First" value={addForm.first_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))} />
                </div>
                <div className="pm-field">
                  <label>Last name</label>
                  <input type="text" placeholder="Last" value={addForm.last_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))} />
                </div>
              </div>
              <div className="pm-field">
                <label>Phone</label>
                <input type="tel" placeholder="+91…" value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                <button type="button" className="pm-btn ghost" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</button>
                <button type="submit" className="pm-btn primary" disabled={addBusy || !addForm.email.trim()}>
                  {addBusy ? "Adding…" : "Add contact"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
