"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw, Send } from "lucide-react";
import { PageHeader, Card, Table, Pill, StackBar, Callout, PeriodPicker, ConfirmDialog } from "@/components/pm";
import type { PageHeaderTab, TableCol, StackPart } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import { useToast } from "@/components/ui/Toast";

// Orders & COD (Task 1.6) — replaces /dashboard/order-confirmations. Joins
// two existing reads: confirmation coverage (every Shopify order in the
// window + whether its WhatsApp confirmation went out) and the COD
// confirmation gate (orders that got Confirm/Cancel buttons). Both existing
// POSTs (resend + gate confirm/cancel) are the only writes; nothing new was
// added on the write side.

type Period = "24h" | "7d" | "30d";
const PERIODS: readonly Period[] = ["24h", "7d", "30d"];
const HOURS: Record<Period, number> = { "24h": 24, "7d": 168, "30d": 720 };
const PERIOD_LABEL: Record<Period, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

type Tab = "call" | "all" | "coverage";

type ConfirmStatus = "sent" | "missing" | "failed" | "gave_up" | "no_phone" | "cancelled";

type ConfirmOrder = {
  order_number: string;
  customer_name: string | null;
  phone: string | null;
  total: number | null;
  currency: string | null;
  created_at: string;
  status: ConfirmStatus;
  detail: string | null;
  confirmed_at: string | null;
};

type ConfirmData = {
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
  orders: ConfirmOrder[];
};

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
  confirmed_via: "button" | "manual" | null;
  shopify_created_at: string;
};

type GateData = { orders: GateOrder[] };

const isOutstanding = (s: ConfirmStatus) => s === "missing" || s === "failed" || s === "gave_up";

function telHref(phone: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : undefined;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

// Waiting pill: crit past 12h, warn past 4h, neu below. Minutes under 1h,
// hours below 24, days above — properly pluralised ("1 hour" vs "2 hours").
function waitingPill(iso: string | null) {
  const h = hoursSince(iso);
  if (h == null) return <Pill tone="neu">—</Pill>;
  const tone = h > 12 ? "crit" : h > 4 ? "warn" : "neu";
  let text: string;
  if (h < 1) {
    const m = Math.max(1, Math.round(h * 60));
    text = `${m} min`;
  } else if (h < 24) {
    const hr = Math.round(h);
    text = `${hr} ${hr === 1 ? "hour" : "hours"}`;
  } else {
    const d = Math.floor(h / 24);
    text = `${d} ${d === 1 ? "day" : "days"}`;
  }
  return <Pill tone={tone as "crit" | "warn" | "neu"}>{text}</Pill>;
}

// The confirmations feed only tells us "delivered" vs "not" (it collapses
// wa_messages sent/delivered/read into one "sent" bucket) — the granular
// tick isn't in that route's response, so a gated order (its template did go
// out, or it wouldn't be waiting on a customer tap) reads as "Sent".
function waLabel(status: ConfirmStatus | undefined): string {
  if (status === "no_phone") return "Not on WhatsApp";
  if (status === "failed" || status === "gave_up") return "Failed";
  return "Sent";
}

function gateChip(status: GateStatus | null | undefined, via: "button" | "manual" | null | undefined) {
  if (!status) return <Pill tone="neu">Prepaid</Pill>;
  if (status === "pending") return <Pill tone="neu">Pending</Pill>;
  if (status === "needs_call") return <Pill tone="crit">Needs a call</Pill>;
  if (status === "cancelled") return <Pill tone="neu">Cancelled</Pill>;
  return <Pill tone="good">{via === "manual" ? "Confirmed by call" : "Confirmed"}</Pill>;
}

// Shared by "Needs a call" and "Confirmation coverage" tabs.
function CoverageCards({
  confirmData,
  gateOrders,
  period,
}: {
  confirmData: ConfirmData;
  gateOrders: GateOrder[];
  period: Period;
}) {
  const s = confirmData.summary;
  const eligible = Math.max(s.total - s.cancelled - s.noPhone, 0);
  const missing = s.noPhone + s.outstanding;

  const confirmedTap = gateOrders.filter((o) => o.confirmation_status === "confirmed" && o.confirmed_via === "button").length;
  const confirmedCall = gateOrders.filter((o) => o.confirmation_status === "confirmed" && o.confirmed_via === "manual").length;
  const cancelled = gateOrders.filter((o) => o.confirmation_status === "cancelled").length;
  const waiting = gateOrders.filter((o) => o.confirmation_status === "pending" || o.confirmation_status === "needs_call").length;

  const parts: StackPart[] = [
    { label: "Confirmed by tap", value: confirmedTap, text: String(confirmedTap), color: "var(--pm-green)" },
    { label: "Confirmed by call", value: confirmedCall, text: String(confirmedCall), color: "var(--pm-cyan)" },
    { label: "Cancelled", value: cancelled, text: String(cancelled), color: "var(--pm-terra)" },
    { label: "Waiting", value: waiting, text: String(waiting), color: "var(--pm-gold)" },
  ];

  return (
    <div className="pm2-g2">
      <Card title="Confirmation coverage" basis={PERIOD_LABEL[period]}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 34, fontWeight: 700, fontFamily: "var(--pm-display)" }}>{s.coveragePct}%</span>
          <span style={{ fontSize: 13, color: "var(--pm-muted)", textAlign: "right" }}>
            {s.sent} of {eligible} orders got a
            <br />
            WhatsApp confirmation
          </span>
        </div>
        <div className="pm2-meter">
          <div style={{ width: `${Math.min(100, Math.max(0, s.coveragePct))}%`, background: "var(--pm-green)" }} />
        </div>
        <div style={{ fontSize: 13, color: "var(--pm-muted)", marginTop: 8 }}>
          {missing} missing: {s.noPhone} not on WhatsApp, {s.outstanding} failed
        </div>
      </Card>
      <Card title="COD outcomes" basis={`${PERIOD_LABEL[period]} · ${gateOrders.length} COD orders`}>
        <StackBar parts={parts} />
      </Card>
    </div>
  );
}

function parseTab(raw: string | null): Tab {
  return raw === "all" || raw === "coverage" ? raw : "call";
}
function parsePeriod(raw: string | null): Period {
  return raw === "24h" || raw === "30d" ? raw : "7d";
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersFallback />}>
      <OrdersPageInner />
    </Suspense>
  );
}

function OrdersFallback() {
  return (
    <div className="pm2-body">
      <div className="pm2-skel" />
      <div className="pm2-skel" />
    </div>
  );
}

function OrdersPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const period = parsePeriod(params.get("period"));
  const tab = parseTab(params.get("tab"));
  const hours = HOURS[period];

  const setQuery = useCallback(
    (next: { period?: Period; tab?: Tab }) => {
      const q = new URLSearchParams(params.toString());
      const p = next.period ?? period;
      const t = next.tab ?? tab;
      if (p === "7d") q.delete("period");
      else q.set("period", p);
      if (t === "call") q.delete("tab");
      else q.set("tab", t);
      const qs = q.toString();
      router.replace(`/dashboard/sales/orders${qs ? `?${qs}` : ""}`);
    },
    [router, params, period, tab],
  );
  const setPeriod = useCallback((p: Period) => setQuery({ period: p }), [setQuery]);
  const setTab = useCallback((t: Tab) => setQuery({ tab: t }), [setQuery]);

  const confirmQ = useQuery({
    queryKey: ["orders-confirmations", hours],
    queryFn: async (): Promise<ConfirmData> => {
      const r = await fetch(`/api/whatsapp/confirmations?hours=${hours}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `confirmations ${r.status}`);
      return d;
    },
    placeholderData: keepPreviousData,
  });

  const gateQ = useQuery({
    queryKey: ["orders-cod-gate", hours],
    queryFn: async (): Promise<GateData> => {
      const r = await fetch(`/api/whatsapp/cod-gate?hours=${hours}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `cod-gate ${r.status}`);
      return d;
    },
    placeholderData: keepPreviousData,
  });

  const reload = useCallback(() => Promise.all([confirmQ.refetch(), gateQ.refetch()]), [confirmQ, gateQ]);

  const [gateBusy, setGateBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<GateOrder | null>(null);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [rowResendBusy, setRowResendBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "missing" | "cod" | "cancelled">("all");

  const gateAction = useCallback(
    async (o: GateOrder, action: "confirm" | "cancel") => {
      const key = `${o.shopify_id}:${action}`;
      setGateBusy(key);
      try {
        const res = await fetch("/api/whatsapp/cod-gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopify_id: o.shopify_id, action }),
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || d.reason || "action failed");
        if (d.outcome === "confirmed") toast.push({ kind: "success", text: `Order ${o.order_number} confirmed and released.` });
        else if (d.outcome === "cancelled") toast.push({ kind: "success", text: `Order ${o.order_number} cancelled in Shopify.` });
        else if (d.outcome === "already") toast.push({ kind: "info", text: `Order ${o.order_number} was already ${d.already ?? "resolved"}.` });
        else if (d.outcome === "guard_failed")
          toast.push({ kind: "info", text: `Could not auto-cancel ${o.order_number} (${d.reason ?? "blocked"}) - handle it in Shopify.` });
        if (action === "cancel") setCancelTarget(null);
        await reload();
      } catch (e) {
        toast.push({ kind: "error", text: `Action failed: ${e instanceof Error ? e.message : "unknown error"}` });
      } finally {
        setGateBusy(null);
      }
    },
    [reload, toast],
  );

  const resend = useCallback(
    async (orders: string[] | null, key: "all" | string) => {
      if (key === "all") setResendBusy(true);
      else setRowResendBusy(key);
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
        if (key === "all") setResendOpen(false);
        await confirmQ.refetch();
      } catch (e) {
        toast.push({ kind: "error", text: `Send failed: ${e instanceof Error ? e.message : "unknown"}` });
      } finally {
        setResendBusy(false);
        setRowResendBusy(null);
      }
    },
    [confirmQ, toast],
  );

  const confirmData = confirmQ.data;
  const gateOrders = useMemo(() => gateQ.data?.orders ?? [], [gateQ.data]);
  const needsCall = useMemo(() => gateOrders.filter((o) => o.confirmation_status === "needs_call"), [gateOrders]);
  const gateByOrderNumber = useMemo(() => new Map(gateOrders.map((o) => [o.order_number, o])), [gateOrders]);
  const confirmByOrderNumber = useMemo(
    () => new Map((confirmData?.orders ?? []).map((o) => [o.order_number, o])),
    [confirmData],
  );
  const outstanding = useMemo(() => (confirmData?.orders ?? []).filter((o) => isOutstanding(o.status)), [confirmData]);
  const sumOnHold = useMemo(() => needsCall.reduce((sum, o) => sum + (o.total_price ?? 0), 0), [needsCall]);

  const tabs: PageHeaderTab[] = [
    { label: "Needs a call", key: "call", count: needsCall.length },
    { label: "All orders", key: "all", count: confirmData?.summary.total },
    { label: "Confirmation coverage", key: "coverage" },
  ];

  const header = (
    <PageHeader
      crumb="Sales · Orders & COD"
      title="Orders & COD"
      tabs={tabs}
      activeTab={tab}
      onTab={(k) => setTab(k as Tab)}
      actions={
        <>
          <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} />
          {outstanding.length > 0 && (
            <button type="button" className="pm2-btn pri pm2-d-only" onClick={() => setResendOpen(true)}>
              <Send size={14} /> Resend {outstanding.length} missing
            </button>
          )}
        </>
      }
    />
  );

  const loading = confirmQ.isLoading || gateQ.isLoading;
  const error = confirmQ.error || gateQ.error;

  if (loading) {
    return (
      <>
        {header}
        <OrdersFallback />
      </>
    );
  }

  if (error || !confirmData) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load orders"
            body={error instanceof Error ? error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={reload}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  const callCols: TableCol<GateOrder>[] = [
    { h: "Order", render: (o) => o.order_number },
    {
      h: "Customer",
      render: (o) => (
        <div>
          <div>{o.customer_name || "—"}</div>
          {o.customer_phone && <span className="sub">{o.customer_phone}</span>}
        </div>
      ),
    },
    { h: "Amount", num: true, render: (o) => formatINR(o.total_price ?? 0) },
    { h: "Waiting", render: (o) => waitingPill(o.confirmation_sent_at) },
    { h: "WhatsApp", render: (o) => waLabel(confirmByOrderNumber.get(o.order_number)?.status) },
    {
      h: "",
      render: (o) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a
            className="pm2-btn pri sm"
            href={telHref(o.customer_phone)}
            style={!o.customer_phone ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          >
            Call
          </a>
          <button type="button" className="pm2-btn sm" disabled={gateBusy !== null} onClick={() => gateAction(o, "confirm")}>
            {gateBusy === `${o.shopify_id}:confirm` ? "Confirming…" : "Confirm"}
          </button>
          <button type="button" className="pm2-btn ghost sm" disabled={gateBusy !== null} onClick={() => setCancelTarget(o)}>
            Cancel
          </button>
        </div>
      ),
    },
  ];

  const allCols: TableCol<ConfirmOrder>[] = [
    { h: "Order", render: (o) => o.order_number },
    {
      h: "Customer",
      render: (o) => (
        <div>
          <div>{o.customer_name || "—"}</div>
          {o.phone && <span className="sub">{o.phone}</span>}
        </div>
      ),
    },
    { h: "Placed", render: (o) => timeAgo(o.created_at) },
    { h: "Total", num: true, render: (o) => formatINR(o.total ?? 0) },
    {
      h: "Confirmation",
      render: (o) => {
        const canResend = o.status === "missing" || o.status === "failed";
        const tone = o.status === "sent" ? "good" : canResend ? "crit" : o.status === "gave_up" ? "warn" : "neu";
        const label =
          o.status === "sent"
            ? "Sent"
            : o.status === "missing"
              ? "Missing"
              : o.status === "failed"
                ? "Failed"
                : o.status === "gave_up"
                  ? "Gave up"
                  : o.status === "no_phone"
                    ? "No phone"
                    : "Cancelled";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Pill tone={tone}>{label}</Pill>
            {canResend && (
              <button
                type="button"
                className="pm2-btn ghost sm"
                disabled={rowResendBusy !== null}
                onClick={() => resend([o.order_number], o.order_number)}
              >
                {rowResendBusy === o.order_number ? "Sending…" : "Resend"}
              </button>
            )}
          </div>
        );
      },
    },
    {
      h: "COD",
      render: (o) => {
        const g = gateByOrderNumber.get(o.order_number);
        return gateChip(g?.confirmation_status, g?.confirmed_via);
      },
    },
  ];

  const filteredOrders = confirmData.orders.filter((o) => {
    if (filter === "missing") return isOutstanding(o.status);
    if (filter === "cancelled") {
      const g = gateByOrderNumber.get(o.order_number);
      return o.status === "cancelled" || g?.confirmation_status === "cancelled";
    }
    if (filter === "cod") {
      const g = gateByOrderNumber.get(o.order_number);
      return g?.confirmation_status === "pending" || g?.confirmation_status === "needs_call";
    }
    return true;
  });
  const sortedOrders = [...filteredOrders].sort((a, b) => Number(isOutstanding(b.status)) - Number(isOutstanding(a.status)));

  return (
    <>
      {header}
      <div className="pm2-body">
        {tab === "call" && (
          <>
            {needsCall.length > 0 && (
              <Callout
                tone="sun"
                title={`${needsCall.length} cash-on-delivery order${needsCall.length === 1 ? "" : "s"} haven't been confirmed by the customer`}
                body="They got the WhatsApp Confirm / Cancel buttons and didn't tap either within 6 hours. Shipping is on hold until someone confirms."
              />
            )}
            <Card title={`Call list · ${formatINR(sumOnHold)} on hold`}>
              <Table
                cols={callCols}
                rows={needsCall}
                rowKey={(o) => o.shopify_id}
                empty="No COD orders waiting for a call"
                card={(o) => ({
                  title: `${o.order_number} · ${o.customer_name || o.customer_phone || "—"}`,
                  value: formatINR(o.total_price ?? 0),
                  meta: (
                    <>
                      {waitingPill(o.confirmation_sent_at)}
                      <span>{waLabel(confirmByOrderNumber.get(o.order_number)?.status)}</span>
                      <span style={{ width: "100%" }} />
                      <a
                        className="pm2-btn pri sm"
                        href={telHref(o.customer_phone)}
                        style={!o.customer_phone ? { opacity: 0.5, pointerEvents: "none" } : undefined}
                      >
                        Call
                      </a>
                      <button type="button" className="pm2-btn sm" disabled={gateBusy !== null} onClick={() => gateAction(o, "confirm")}>
                        {gateBusy === `${o.shopify_id}:confirm` ? "Confirming…" : "Confirm"}
                      </button>
                      <button type="button" className="pm2-btn ghost sm" disabled={gateBusy !== null} onClick={() => setCancelTarget(o)}>
                        Cancel
                      </button>
                    </>
                  ),
                })}
              />
            </Card>
            <CoverageCards confirmData={confirmData} gateOrders={gateOrders} period={period} />
          </>
        )}

        {tab === "all" && (
          <>
            <span className="pm2-chips">
              <button type="button" className={`pm2-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
                All <em>{confirmData.orders.length}</em>
              </button>
              <button type="button" className={`pm2-chip${filter === "missing" ? " on" : ""}`} onClick={() => setFilter("missing")}>
                Missing <em>{outstanding.length}</em>
              </button>
              <button type="button" className={`pm2-chip${filter === "cod" ? " on" : ""}`} onClick={() => setFilter("cod")}>
                COD waiting <em>{needsCall.length + gateOrders.filter((o) => o.confirmation_status === "pending").length}</em>
              </button>
              <button type="button" className={`pm2-chip${filter === "cancelled" ? " on" : ""}`} onClick={() => setFilter("cancelled")}>
                Cancelled
              </button>
            </span>
            <Card>
              <Table
                cols={allCols}
                rows={sortedOrders}
                rowKey={(o) => o.order_number}
                empty="No orders in this window."
                card={(o) => {
                  const g = gateByOrderNumber.get(o.order_number);
                  return {
                    title: `${o.order_number} · ${o.customer_name || o.phone || "—"}`,
                    value: formatINR(o.total ?? 0),
                    meta: (
                      <>
                        <span>{timeAgo(o.created_at)}</span>
                        {gateChip(g?.confirmation_status, g?.confirmed_via)}
                      </>
                    ),
                  };
                }}
              />
            </Card>
          </>
        )}

        {tab === "coverage" && (
          <>
            <CoverageCards confirmData={confirmData} gateOrders={gateOrders} period={period} />
            <Card title="How confirmations work">
              <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--pm-ink)" }}>
                Every order gets a WhatsApp confirmation within a minute of coming in.
              </p>
              <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--pm-ink)" }}>
                Cash-on-delivery orders get Confirm / Cancel buttons, and shipping waits for a tap.
              </p>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--pm-ink)" }}>
                After 6 hours without a tap, the order shows up on Needs a call so someone can ring the customer.
              </p>
            </Card>
          </>
        )}
      </div>

      {cancelTarget && (
        <ConfirmDialog
          title={`Cancel order ${cancelTarget.order_number} for ${cancelTarget.customer_name || "this customer"}?`}
          body="This tells the customer and stops shipping."
          confirmLabel="Cancel order"
          keepLabel="Keep"
          danger
          busy={gateBusy === `${cancelTarget.shopify_id}:cancel`}
          onConfirm={() => gateAction(cancelTarget, "cancel")}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {resendOpen && (
        <ConfirmDialog
          title={`Send a WhatsApp confirmation to ${outstanding.length} customer${outstanding.length === 1 ? "" : "s"} who didn't get one?`}
          body="Each of them gets exactly one message."
          confirmLabel="Send"
          keepLabel="Keep"
          busy={resendBusy}
          onConfirm={() => resend(null, "all")}
          onClose={() => setResendOpen(false)}
        />
      )}
    </>
  );
}
