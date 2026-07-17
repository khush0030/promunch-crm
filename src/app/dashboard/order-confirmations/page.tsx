"use client";

import { useMemo, useState } from "react";
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

// COD confirmation gate — a second, independent Shopify-order feed from
// /api/whatsapp/cod-gate. Only orders that actually went through the gate
// (non-null confirmation_status) come back; joined onto the coverage table
// below by order_number for the per-row chip.
type GateStatus = "pending" | "needs_call" | "confirmed" | "cancelled";

type GateOrder = {
  shopify_id: number;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number | null;
  currency: string | null;
  confirmation_status: GateStatus | null;
  confirmation_sent_at: string | null;
  confirmed_at: string | null;
  confirmed_via: string | null;
  shopify_created_at: string;
};

type GateData = { orders: GateOrder[] };

const GATE_META: Record<GateStatus, { tone: BadgeTone; icon: string; label: string }> = {
  pending: { tone: "gold", icon: "⏳", label: "Pending" },
  needs_call: { tone: "terra", icon: "📞", label: "Needs call" },
  confirmed: { tone: "green", icon: "✅", label: "Confirmed" },
  cancelled: { tone: "gray", icon: "❌", label: "Cancelled" },
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

function telHref(phone: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : undefined;
}

// Gate status chip for the coverage table. Null status = prepaid / pre-gate
// order, so nothing renders — the gate never touched it.
function gateChip(status: GateStatus | null | undefined, via: string | null | undefined) {
  if (!status) return null;
  const meta = GATE_META[status];
  const label = status === "confirmed" && via ? `${meta.label} · via ${via}` : meta.label;
  return <StatusBadge tone={meta.tone}>{`${meta.icon} ${label}`}</StatusBadge>;
}

export default function OrderConfirmationsPage() {
  const toast = useToast();
  const [hours, setHours] = useState(720);
  const [sending, setSending] = useState<string | null>(null); // "all" | order_number
  const [gateBusy, setGateBusy] = useState<string | null>(null); // `${shopify_id}:${action}`
  const [gateError, setGateError] = useState<string | null>(null);

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

  // COD confirmation gate — 14-day window of gate-managed orders (Task 9's
  // GET), fetched alongside the coverage feed above.
  const { data: gateData, refetch: refetchGate } = useQuery({
    queryKey: ["cod-gate"],
    queryFn: async (): Promise<GateData> => {
      try {
        const res = await fetch("/api/whatsapp/cod-gate", { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "load failed");
        return d;
      } catch (e) {
        toast.push({ kind: "error", text: "Could not load COD gate queue." });
        throw e;
      }
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const load = () => Promise.all([refetch(), refetchGate()]);

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

  async function gateAction(o: GateOrder, action: "confirm" | "cancel") {
    if (action === "cancel") {
      const ok = window.confirm(`Cancel ${o.order_number} in Shopify? This cannot be undone.`);
      if (!ok) return;
    }
    const key = `${o.shopify_id}:${action}`;
    setGateBusy(key);
    setGateError(null);
    try {
      const res = await fetch("/api/whatsapp/cod-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopify_id: o.shopify_id, action }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || d.reason || "action failed");
      if (d.outcome === "confirmed") {
        toast.push({ kind: "success", text: `Order ${o.order_number} confirmed and released.` });
      } else if (d.outcome === "cancelled") {
        toast.push({ kind: "success", text: `Order ${o.order_number} cancelled in Shopify.` });
      } else if (d.outcome === "already") {
        toast.push({ kind: "info", text: `Order ${o.order_number} was already ${d.already ?? "resolved"}.` });
      } else if (d.outcome === "guard_failed") {
        toast.push({ kind: "info", text: `Could not auto-cancel ${o.order_number} (${d.reason ?? "blocked"}) - handle it in Shopify.` });
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setGateError(`${o.order_number}: ${msg}`);
      toast.push({ kind: "error", text: `Gate action failed: ${msg}` });
    } finally {
      setGateBusy(null);
    }
  }

  const s = data?.summary;
  const outstanding = (data?.orders ?? []).filter((o) => isOutstanding(o.status));
  const eligible = s ? Math.max(s.total - s.cancelled - s.noPhone, 0) : 0;
  const coverageLow = !!s && s.coveragePct < 50;

  const gateOrders = useMemo(() => gateData?.orders ?? [], [gateData]);
  const needsCall = useMemo(
    () => gateOrders.filter((o) => o.confirmation_status === "needs_call"),
    [gateOrders],
  );
  const gateByOrderNumber = useMemo(() => new Map(gateOrders.map((o) => [o.order_number, o])), [gateOrders]);
  const gateCounts = useMemo(() => {
    const c: Record<GateStatus, number> = { pending: 0, needs_call: 0, confirmed: 0, cancelled: 0 };
    for (const o of gateOrders) if (o.confirmation_status) c[o.confirmation_status]++;
    return c;
  }, [gateOrders]);

  const gateColumns: Column<GateOrder>[] = [
    { header: "Order", cell: (o) => <span className="pm-b7" style={{ whiteSpace: "nowrap" }}>{o.order_number}</span> },
    {
      header: "Customer",
      cell: (o) => (
        <div>
          <div className="pm-b7">{o.customer_name || "—"}</div>
          {o.customer_phone && (
            <a className="pm-dim" style={{ fontSize: 11 }} href={telHref(o.customer_phone)}>
              {o.customer_phone}
            </a>
          )}
        </div>
      ),
    },
    {
      header: "Amount",
      cell: (o) => <span className="pm-b7" style={{ whiteSpace: "nowrap" }}>{money(o.total_price, o.currency)}</span>,
    },
    {
      header: "Waiting",
      cell: (o) => <span className="pm-dim" style={{ whiteSpace: "nowrap" }}>{timeAgo(o.confirmation_sent_at)}</span>,
    },
    {
      header: "Actions",
      cell: (o) => (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="pm-btn primary sm" onClick={() => gateAction(o, "confirm")} disabled={gateBusy !== null}>
            {gateBusy === `${o.shopify_id}:confirm` ? "Confirming…" : "Confirm & release"}
          </button>
          <button
            className="pm-btn ghost sm"
            style={{ color: "var(--pm-terra)" }}
            onClick={() => gateAction(o, "cancel")}
            disabled={gateBusy !== null}
          >
            {gateBusy === `${o.shopify_id}:cancel` ? "Cancelling…" : "Cancel order"}
          </button>
        </div>
      ),
    },
  ];

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
    {
      header: "COD gate",
      cell: (o) => {
        const g = gateByOrderNumber.get(o.order_number);
        return gateChip(g?.confirmation_status, g?.confirmed_via);
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

          <div className="pm-dim" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, marginTop: 16 }}>
            <span>⏳ {gateCounts.pending} pending</span>
            <span>✅ {gateCounts.confirmed} confirmed</span>
            <span>📞 {gateCounts.needs_call} needs call</span>
            <span>❌ {gateCounts.cancelled} cancelled</span>
          </div>

          <SectionLabel>COD gate - needs a call</SectionLabel>
          {gateError && <p style={{ color: "var(--pm-terra)", fontSize: 12.5 }}>{gateError}</p>}
          <DataTable
            columns={gateColumns}
            rows={needsCall}
            rowKey={(o) => o.shopify_id}
            empty="No calls needed 🎉"
          />

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
