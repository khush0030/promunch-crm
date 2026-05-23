"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

// Order-confirmation coverage. Shows every Shopify order in the window and
// whether its WhatsApp "order confirmed!" message went out — so a miss is
// visible, and one click re-sends every order that slipped through.

type OrderStatus = "sent" | "missing" | "failed" | "gave_up" | "no_phone" | "cancelled";

type Order = {
  order_number: string;
  customer_name: string | null;
  phone: string | null;
  total: number | null;
  currency: string | null;
  created_at: string;
  status: OrderStatus;
  detail: string | null;
  confirmed_at: string | null;
};

type Data = {
  generatedAt: string;
  hours: number;
  summary: {
    total: number;
    sent: number;
    outstanding: number;
    noPhone: number;
    cancelled: number;
    coveragePct: number;
  };
  orders: Order[];
};

const STATUS_META: Record<OrderStatus, { pill: string; label: string }> = {
  sent: { pill: "green", label: "Confirmed" },
  missing: { pill: "amber", label: "Not sent" },
  failed: { pill: "accent", label: "Failed" },
  gave_up: { pill: "accent", label: "Gave up" },
  no_phone: { pill: "grey", label: "No phone" },
  cancelled: { pill: "grey", label: "Cancelled" },
};

const PERIODS: { h: number; label: string }[] = [
  { h: 6, label: "6h" },
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

const isOutstanding = (s: OrderStatus) => s === "missing" || s === "failed" || s === "gave_up";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function money(n: number | null, cur: string | null): string {
  if (n == null) return "—";
  const sym = (cur ?? "INR") === "INR" ? "₹" : `${cur} `;
  return sym + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OrderConfirmationsPage() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null); // "all" | order_number

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/confirmations?hours=${hours}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "load failed");
      setData(d);
    } catch {
      toast.push({ kind: "error", text: "Could not load confirmation coverage." });
    } finally {
      setLoading(false);
    }
  }, [hours, toast]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function send(orders: string[] | null, key: string) {
    if (orders && orders.length === 0) return;
    setSending(key);
    try {
      const res = await fetch("/api/whatsapp/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orders ? { orders } : {}),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "send failed");
      toast.push({
        kind: d.failed ? "info" : "success",
        text: `Sent ${d.resent ?? 0} confirmation(s)${d.failed ? ` · ${d.failed} failed` : ""}.`,
      });
      await load();
    } catch (e) {
      toast.push({ kind: "error", text: `Send failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setSending(null);
    }
  }

  const s = data?.summary;
  const outstanding = (data?.orders ?? []).filter((o) => isOutstanding(o.status));
  const coverageColor =
    !s ? "var(--text)" : s.coveragePct >= 99 ? "var(--green)" : s.coveragePct >= 90 ? "var(--amber)" : "var(--accent)";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Order Confirmations</h1>
          <div className="sub">
            Every Shopify order &amp; whether its WhatsApp confirmation was sent
            {data ? ` · checked ${timeAgo(data.generatedAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {PERIODS.map((p) => (
              <button
                key={p.h}
                type="button"
                className={`tab${hours === p.h ? " active" : ""}`}
                onClick={() => setHours(p.h)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => send(outstanding.map((o) => o.order_number), "all")}
            disabled={sending !== null || outstanding.length === 0}
          >
            <Send size={14} />
            {sending === "all"
              ? "Sending…"
              : outstanding.length > 0
              ? `Send all missing (${outstanding.length})`
              : "All confirmed"}
          </button>
          <button type="button" className="btn" onClick={load} aria-label="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="card card-pad muted">Loading confirmation coverage…</div>
      ) : !data || !s ? (
        <div className="card card-pad muted">No coverage data.</div>
      ) : (
        <>
          <div className="kpi-grid section">
            <div className="kpi">
              <div className="label">Coverage</div>
              <div className="value" style={{ color: coverageColor }}>{s.coveragePct}%</div>
              <div className="delta flat">{s.sent} of {Math.max(s.total - s.cancelled - s.noPhone, 0)} eligible orders</div>
            </div>
            <div className="kpi">
              <div className="label">Missing confirmation</div>
              <div className="value" style={{ color: s.outstanding > 0 ? "var(--accent)" : "var(--green)" }}>
                {s.outstanding}
              </div>
              <div className="delta flat">not sent / failed — needs a resend</div>
            </div>
            <div className="kpi">
              <div className="label">Confirmed</div>
              <div className="value">{s.sent}</div>
              <div className="delta flat">WhatsApp message delivered</div>
            </div>
            <div className="kpi">
              <div className="label">Not eligible</div>
              <div className="value">{s.noPhone + s.cancelled}</div>
              <div className="delta flat">{s.noPhone} no phone · {s.cancelled} cancelled</div>
            </div>
          </div>

          <div className="card card-pad section">
            <div className="card-title">Orders · last {data.hours >= 24 ? `${data.hours / 24}d` : `${data.hours}h`}</div>
            <div className="card-sub">
              {s.total} order{s.total === 1 ? "" : "s"} · auto-refreshes every 30s. Resend any row that slipped through.
            </div>
            {data.orders.length === 0 ? (
              <div className="empty" style={{ marginTop: 14 }}>
                No orders in this window.
              </div>
            ) : (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Placed</th>
                    <th>Total</th>
                    <th>Confirmation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => {
                    const meta = STATUS_META[o.status];
                    const can = isOutstanding(o.status);
                    return (
                      <tr key={o.order_number}>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{o.order_number}</td>
                        <td>
                          {o.customer_name || "—"}
                          {o.phone && (
                            <div className="muted" style={{ fontSize: 11 }}>{o.phone}</div>
                          )}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(o.created_at)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{money(o.total, o.currency)}</td>
                        <td>
                          <span className={`pill ${meta.pill}`}>{meta.label}</span>
                          {o.status === "sent" && o.confirmed_at && (
                            <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                              {timeAgo(o.confirmed_at)}
                            </span>
                          )}
                          {o.detail && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{o.detail}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {can && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => send([o.order_number], o.order_number)}
                              disabled={sending !== null}
                            >
                              {sending === o.order_number ? "Sending…" : "Resend"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
