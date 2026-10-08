"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, ChevronLeft, ChevronRight, MoreHorizontal, Plus, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHeader, EmptyState } from "@/components/pm";
import { apiFetch } from "@/lib/api-fetch";
import css from "./contacts.module.css";

type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  orders: number;
  spent: number;
  ltv: string;
  lastOrder: string;
  status: string;
  tags: string[];
  lists: string[];
  segments: string[];
};

// Group = what the row already tells us (status + order count), shown as
// coloured text with a small dot. Bounced is the only red one.
function groupFor(r: ContactRow): { label: string; cls: string } {
  const st = (r.status || "active").toLowerCase();
  if (st === "bounced") return { label: "Email bounced", cls: css.gBounced };
  if (st === "unsubscribed") return { label: "Unsubscribed", cls: css.gUnsub };
  if (st === "inactive") return { label: "Inactive", cls: css.gInactive };
  if (r.orders >= 2) return { label: "Repeat buyer", cls: css.gRepeat };
  if (r.orders === 1) return { label: "One order", cls: css.gOne };
  return { label: "Signed up", cls: css.gSigned };
}

// "+919335497559" -> "+91 93354 97559"; anything else as stored.
function prettyPhone(p: string): string {
  const m = p.replace(/\s+/g, "").match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [minOrders, setMinOrders] = useState("");
  const [minLtv, setMinLtv] = useState("");
  const [lastOrderDays, setLastOrderDays] = useState("");
  const [lastOrderOp, setLastOrderOp] = useState<"within" | "before">("within");
  const [sort, setSort] = useState("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    setLoadError(null);
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

      const data = await apiFetch<{
        contacts?: {
          id: string;
          first_name?: string;
          last_name?: string;
          email: string | null;
          phone?: string | null;
          city?: string | null;
          total_orders?: number;
          total_spent?: number;
          last_purchase_date?: string;
          status?: string;
          tags?: string[];
          klaviyo_lists?: string[];
          klaviyo_segments?: string[];
        }[];
        total?: number;
        pages?: number;
      }>(`/api/contacts?${params}`);

      const mapped: ContactRow[] = (data.contacts || []).map((c) => ({
        id: c.id,
        city: c.city?.trim() || null,
        spent: Number(c.total_spent) || 0,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.email ? c.email.split("@")[0] : c.phone || "Contact"),
        email: c.email || null,
        phone: c.phone || null,
        orders: c.total_orders || 0,
        ltv: c.total_spent
          ? `₹${parseFloat(String(c.total_spent)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
          : "₹0",
        lastOrder: c.last_purchase_date ? shortDate(c.last_purchase_date) : "",
        status: c.status || "active",
        tags: c.tags || [],
        lists: c.klaviyo_lists || [],
        segments: c.klaviyo_segments || [],
      }));

      setContacts(mapped);
      setTotal(data.total || 0);
      setTotalPages(data.pages || 1);
    } catch (e) {
      // Keep whatever is on screen and surface the failure — a fetch error must
      // not masquerade as "No contacts" / total 0.
      setLoadError(e instanceof Error ? e.message : "Couldn't load contacts");
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

  const moreOn = showFilters || !!minOrders || !!minLtv || !!lastOrderDays || audience !== null;
  const repeatOn = minOrders === "2";
  const n = (v: number) => v.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        crumb="Customers"
        title="Customers"
        actions={
          <>
            <div className={css.menuWrap}>
              <button
                type="button"
                className="pm2-btn"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={importing}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <MoreHorizontal size={16} /> {importing ? "Importing…" : "More"}
              </button>
              {menuOpen && (
                <>
                  <div className={css.menuScrim} onClick={() => setMenuOpen(false)} />
                  <div className={css.menu} role="menu">
                    {(["shopify", "klaviyo"] as const).map((src) => (
                      <button key={src} type="button" role="menuitem" disabled={importing} onClick={() => { setMenuOpen(false); runImport(src); }}>
                        <Upload /> Import from {src === "klaviyo" ? "Klaviyo" : "Shopify"}
                      </button>
                    ))}
                    <hr />
                    <button type="button" role="menuitem" title="Download the current filtered view as CSV" onClick={() => { setMenuOpen(false); exportCsv(); }}>
                      <Download /> Export this view as CSV
                    </button>
                  </div>
                </>
              )}
            </div>
            <button type="button" className={`pm2-btn pri ${css.addBtn}`} onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Add customer
            </button>
          </>
        }
      />

      <div className="pm2-body">
        <p className={css.sum}>
          {loadError && contacts.length === 0 ? (
            "Couldn’t load customers."
          ) : stats ? (
            <>
              <b>{n(stats.total)} people</b> who bought or signed up. {n(stats.buyers)} have ordered, {n(stats.newThisMonth)} joined this month
              {stats.unsubscribed > 0 ? `, ${n(stats.unsubscribed)} unsubscribed` : ""}.
            </>
          ) : (
            <>
              <b>{n(total)} people</b> who bought or signed up.
            </>
          )}
        </p>
        {importMsg && (
          <div
            className={`${css.note} ${importMsg.startsWith("Imported") ? css.noteGood : importMsg.startsWith("Importing") ? css.noteBusy : css.noteBad}`}
            role="status"
          >
            {importMsg}
          </div>
        )}

        <div className={css.tools}>
          <label className={css.search}>
            <Search aria-hidden />
            <input
              type="search"
              aria-label="Search customers"
              placeholder="Name, phone or email"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </label>
          <div className={css.chips} role="group" aria-label="Filter customers">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={activeFilter === f}
                className={`${css.chip}${activeFilter === f ? ` ${css.chipOn}` : ""}`}
                onClick={() => { setActiveFilter(f); setPage(1); }}
              >
                {filterLabels[f]}
              </button>
            ))}
            <span className={css.sep} aria-hidden />
            <button
              type="button"
              aria-pressed={repeatOn}
              className={`${css.chip}${repeatOn ? ` ${css.chipOn}` : ""}`}
              onClick={() => { setMinOrders(repeatOn ? "" : "2"); setPage(1); }}
            >
              Bought 2+ times
            </button>
            <button
              type="button"
              aria-expanded={showFilters}
              className={`${css.chip}${moreOn ? ` ${css.chipOn}` : ""}`}
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal /> More filters
            </button>
          </div>
        </div>

        {showFilters && (
          <div className={css.filters}>
            <div className={css.fGrid}>
              <label className={css.fld}>
                <span>Min orders</span>
                <input className={css.inp} type="number" min={0} placeholder="0" value={minOrders} onChange={(e) => { setMinOrders(e.target.value); setPage(1); }} />
              </label>
              <label className={css.fld}>
                <span>Min spent (₹)</span>
                <input className={css.inp} type="number" min={0} placeholder="0" value={minLtv} onChange={(e) => { setMinLtv(e.target.value); setPage(1); }} />
              </label>
              <div className={css.fld}>
                <span>Last order</span>
                <div className={css.pair}>
                  <select className={css.inp} aria-label="Last order comparison" value={lastOrderOp} onChange={(e) => setLastOrderOp(e.target.value as "within" | "before")}>
                    <option value="within">Within last</option>
                    <option value="before">Before last</option>
                  </select>
                  <input className={css.inp} type="number" min={0} aria-label="Days" placeholder="Days" value={lastOrderDays} onChange={(e) => { setLastOrderDays(e.target.value); setPage(1); }} />
                </div>
              </div>
              <div className={css.fld}>
                <span>Sort by</span>
                <div className={css.pair}>
                  <select className={css.inp} style={{ flex: 1, width: "100%" }} aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                    <option value="created_at">Recently added</option>
                    <option value="last_purchase_date">Last order</option>
                    <option value="total_spent">Spent</option>
                    <option value="total_orders">Order count</option>
                    <option value="average_order_value">Avg order value</option>
                    <option value="email">Email</option>
                  </select>
                  <button type="button" className="pm2-btn sm" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} aria-label="Toggle direction">
                    {dir === "desc" ? "↓" : "↑"}
                  </button>
                </div>
              </div>
            </div>

            {(facets.segments.length > 0 || facets.lists.length > 0) && (
              <div className={css.audRow}>
                <div className={css.fld}><span>Segments &amp; lists</span></div>
                <div className={css.chips} style={{ flexWrap: "wrap", margin: 0, padding: 0, width: "auto", overflow: "visible" }}>
                  {facets.segments.slice(0, 8).map((sg) => {
                    const on = audience?.type === "segment" && audience.value === sg.name;
                    return (
                      <button key={`seg-${sg.name}`} type="button" aria-pressed={on}
                        className={`${css.chip}${on ? ` ${css.chipOn}` : ""}`}
                        title={`Segment · ${sg.count} contact${sg.count === 1 ? "" : "s"}`}
                        onClick={() => { setAudience((a) => (a?.type === "segment" && a.value === sg.name ? null : { type: "segment", value: sg.name })); setPage(1); }}>
                        {sg.name}
                      </button>
                    );
                  })}
                  {facets.lists.slice(0, 6).map((l) => {
                    const on = audience?.type === "list" && audience.value === l.name;
                    return (
                      <button key={`list-${l.name}`} type="button" aria-pressed={on}
                        className={`${css.chip}${on ? ` ${css.chipOn}` : ""}`}
                        title={`List · ${l.count} contact${l.count === 1 ? "" : "s"}`}
                        onClick={() => { setAudience((a) => (a?.type === "list" && a.value === l.name ? null : { type: "list", value: l.name })); setPage(1); }}>
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={css.fFoot}>
              <button type="button" className="pm2-btn ghost sm" onClick={() => { setMinOrders(""); setMinLtv(""); setLastOrderDays(""); setLastOrderOp("within"); setAudience(null); setPage(1); }}>
                Clear filters
              </button>
            </div>
          </div>
        )}

        {contacts.length > 0 ? (
          <>
            <div className={`${css.card}${isLoading ? ` ${css.loading}` : ""}`}>
              <table className={css.tbl}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className={css.r}>Orders</th>
                    <th className={css.r}>Spent</th>
                    <th>Last order</th>
                    <th>Group</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((r) => {
                    const g = groupFor(r);
                    const sub = [r.city, r.phone ? prettyPhone(r.phone) : null, r.email].filter(Boolean).join(" · ");
                    const open = () => router.push(`/dashboard/contacts/${r.id}`);
                    return (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={(e) => { if (e.key === "Enter") open(); }}
                      >
                        <td className={css.main}>
                          <b>{r.name}</b>
                          <span title={sub || undefined}>{sub || "No phone or email"}</span>
                        </td>
                        <td className={css.r} data-l="Orders">
                          {r.orders > 0 ? r.orders : <span className={css.nil}>–</span>}
                        </td>
                        <td className={css.r} data-l="Spent">
                          {r.spent > 0 ? <span className={css.spent}>{r.ltv}</span> : <span className={css.nil}>–</span>}
                        </td>
                        <td data-l="Last order">
                          {r.lastOrder ? <span className={css.date}>{r.lastOrder}</span> : <span className={css.nil}>–</span>}
                        </td>
                        <td>
                          <span className={`${css.grp} ${g.cls}`}>{g.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={css.pager}>
              <span>Showing {contacts.length} of {n(total)}</span>
              <div className={css.pagerBtns}>
                <button type="button" aria-label="Previous" className="pm2-btn ghost sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft size={14} /> Previous
                </button>
                <span>{page} / {totalPages}</span>
                <button type="button" aria-label="Next" className="pm2-btn sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        ) : loadError ? (
          <EmptyState
            icon={<Users />}
            title="Couldn’t load customers"
            cta={<button type="button" className="pm2-btn" onClick={() => fetchContacts()}>Retry</button>}
          >
            {loadError}
          </EmptyState>
        ) : (
          <EmptyState
            icon={<Users />}
            title={loaded ? "No customers match" : "Loading…"}
            cta={loaded ? <button type="button" className="pm2-btn" disabled={importing} onClick={() => runImport("shopify")}><Upload size={15} /> Import from Shopify</button> : undefined}
          >
            {loaded ? "Try a different search or filter, import from Shopify or Klaviyo, or add someone by hand." : undefined}
          </EmptyState>
        )}
      </div>

      {addOpen && (
        <div className="pm2-dialog-backdrop" onClick={() => setAddOpen(false)}>
          <div role="dialog" aria-label="Add customer" className={css.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={css.dHead}>
              <h3>Add customer</h3>
              <button type="button" className="pm2-btn ghost sm" onClick={() => setAddOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={submitAddContact} className={css.dForm}>
              <label className={css.fld}>
                <span>Email *</span>
                <input className={css.inp} type="email" required autoFocus placeholder="customer@example.com" value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <div className={css.dTwo}>
                <label className={css.fld}>
                  <span>First name</span>
                  <input className={css.inp} type="text" placeholder="First" value={addForm.first_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))} />
                </label>
                <label className={css.fld}>
                  <span>Last name</span>
                  <input className={css.inp} type="text" placeholder="Last" value={addForm.last_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))} />
                </label>
              </div>
              <label className={css.fld}>
                <span>Phone</span>
                <input className={css.inp} type="tel" placeholder="+91…" value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <div className={css.dFoot}>
                <button type="button" className="pm2-btn ghost" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</button>
                <button type="submit" className="pm2-btn pri" disabled={addBusy || !addForm.email.trim()}>
                  {addBusy ? "Adding…" : "Add customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
