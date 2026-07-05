"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw, Send, Percent, AlertCircle, CircleCheck, Ban } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHead, SectionLabel, KpiCard, DataTable, StatusBadge } from "@/components/pm";
import type { Column, BadgeTone } from "@/components/pm";

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

const STATUS_META: Record<OrderStatus, { tone: BadgeTone; label: string }> = {
  sent: { tone: "green", label: "Confirmed" },
  missing: { tone: "terra", label: "Missing" },
  failed: { tone: "terra", label: "Failed" },
  gave_up: { tone: "terra", label: "Gave up" },
  no_phone: { tone: "gray", label: "Not eligible" },
  cancelled: { tone: "gray", label: "Not eligible" },
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
  const [hours, setHours] = useState(720);
  const [sending, setSending] = useState<string | null>(null); // "all" | order_number

  // Replaces the old load() + mount effect + 30s setInterval poll.
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["order-confirmations", hours],
    queryFn: async (): Promise<Data> => {
      try {
        const res = await fetch(`/api/whatsapp/confirmations?hours=${hours}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "load failed");
        return d;
      } catch (e) {
        toast.push({ kind: "error", text: "Could not load confirmation coverage." });
        throw e;
      }
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const load = () => refetch();

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
  const eligible = s ? Math.max(s.total - s.cancelled - s.noPhone, 0) : 0;
  const coverageLow = !!s && s.coveragePct < 50;

  const columns: Column<Order>[] = [
    { header: "Order", cell: (o) => <span className="pm-b7" style={{ whiteSpace: "nowrap" }}>{o.order_number}</span> },
    {
      header: "Customer",
      cell: (o) => (
        <div>
          <div className="pm-b7">{o.customer_name || "—"}</div>
          {o.phone && <div className="pm-dim" style={{ fontSize: 11 }}>{o.phone}</div>}
        </div>
      ),
    },
    { header: "Placed", cell: (o) => <span className="pm-dim" style={{ whiteSpace: "nowrap" }}>{timeAgo(o.created_at)}</span> },
    { header: "Total", cell: (o) => <span className="pm-b7" style={{ whiteSpace: "nowrap" }}>{money(o.total, o.currency)}</span> },
    {
      header: "Confirmation",
      cell: (o) => {
        const meta = STATUS_META[o.status];
        const can = isOutstanding(o.status);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge tone={meta.tone} icon={o.status === "sent" ? <CircleCheck /> : undefined}>{meta.label}</StatusBadge>
            {o.status === "sent" && o.confirmed_at && <span className="pm-dim" style={{ fontSize: 11 }}>{timeAgo(o.confirmed_at)}</span>}
            {can && (
              <button className="pm-btn ghost sm" onClick={() => send([o.order_number], o.order_number)} disabled={sending !== null}>
                {sending === o.order_number ? "Sending…" : "Resend"}
              </button>
            )}
            {o.detail && <div className="pm-dim" style={{ fontSize: 11, flexBasis: "100%" }}>{o.detail}</div>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Order Confirmations"
        subtitle={
          <>
            Every Shopify order &amp; whether its WhatsApp confirmation was sent
            {data ? ` · checked ${timeAgo(data.generatedAt)}` : ""}
          </>
        }
        actions={
          <>
            <div className="pm-ranges">
              {PERIODS.map((p) => (
                <button key={p.h} className={hours === p.h ? "on" : ""} onClick={() => setHours(p.h)}>
                  {p.label}
                </button>
              ))}
            </div>
            <button
              className="pm-btn primary"
              onClick={() => send(outstanding.map((o) => o.order_number), "all")}
              disabled={sending !== null || outstanding.length === 0}
            >
              <Send size={15} />
              {sending === "all" ? "Sending…" : outstanding.length > 0 ? `Send all missing (${outstanding.length})` : "All confirmed"}
            </button>
            <button className="pm-btn ghost" onClick={load} aria-label="Refresh">
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
      />

      {isLoading ? (
        <div className="pm-panel pm-dim">Loading confirmation coverage…</div>
      ) : !data || !s ? (
        <div className="pm-panel pm-dim">No coverage data.</div>
      ) : (
        <>
          <div className="pm-kpis" style={{ marginBottom: 16 }}>
            <KpiCard
              label="Coverage"
              value={`${s.coveragePct}%`}
              icon={<Percent />}
              tone={coverageLow ? "t" : "g"}
              valueColor={coverageLow ? "var(--pm-terra)" : undefined}
              sub={`${s.sent} of ${eligible} eligible orders`}
            />
            <KpiCard
              label="Missing confirmation"
              value={s.outstanding}
              icon={<AlertCircle />}
              tone="t"
              valueColor={s.outstanding > 0 ? "var(--pm-terra)" : undefined}
              sub="not sent / failed — needs resend"
            />
            <KpiCard label="Confirmed" value={s.sent} icon={<CircleCheck />} tone="g" sub="WhatsApp message delivered" />
            <KpiCard
              label="Not eligible"
              value={s.noPhone + s.cancelled}
              icon={<Ban />}
              tone="b"
              sub={`${s.noPhone} no phone · ${s.cancelled} cancelled`}
            />
          </div>

          <SectionLabel>Orders · last {data.hours >= 24 ? `${data.hours / 24}d` : `${data.hours}h`}</SectionLabel>
          <DataTable
            columns={columns}
            rows={data.orders}
            rowKey={(o) => o.order_number}
            empty="No orders in this window."
          />
        </>
      )}
    </div>
  );
}
