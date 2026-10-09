"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  RefreshCw,
  Send,
  Phone,
  PhoneMissed,
  MessageCircle,
  Check,
  CheckCheck,
  X,
  Clock,
  AlertCircle,
  Info,
  Minus,
  Download,
  Search,
} from "lucide-react";
import { PageHeader, Card, Table, StackBar, Callout, PeriodPicker, ConfirmDialog, KpiStrip, Kpi } from "@/components/pm";
import type { TableCol, StackPart } from "@/components/pm";
import { CallRules } from "./CallRules";
import { useAccess } from "@/components/shell/useAccess";
import { canOpenHref } from "@/lib/access";
import { formatINR } from "@/lib/metrics/money";
import { initials } from "@/lib/pm/avatar";
import { useToast } from "@/components/ui/Toast";
import type { ChannelKey } from "@/lib/metrics/channel";
import {
  CHANNEL_LABEL, channelCounts, chipOf, filterOrders, formatPhone, isCreatorSeed, toCsv, viewTotals, type OrderChannel,
} from "@/lib/orders-view";
import s from "./orders.module.css";

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

// Section tabs (nav.ts): Confirm COD (no param) · All orders (?tab=all) ·
// Call rules (?tab=rules). The old ?tab=coverage link opens All orders,
// where Coverage now lives as a section.
type Tab = "call" | "all" | "rules";

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
  channel?: ChannelKey | null;
  is_creator?: boolean | null;
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

const isOutstanding = (st: ConfirmStatus) => st === "missing" || st === "failed" || st === "gave_up";

function telHref(phone: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : undefined;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

type Tone = "good" | "warn" | "bad" | "info" | "mute";

// Status = coloured text + small icon, never a filled block.
function StatusText({ tone, icon, inline, children }: { tone: Tone; icon: ReactNode; inline?: boolean; children: ReactNode }) {
  return (
    <span className={`${s.st} ${tone === "mute" ? "" : s[tone]} ${inline ? s.stI : ""}`}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

// Waiting time: minutes under 1h, hours below 24, days above — properly
// pluralised ("1 hour" vs "2 hours").
function waitingText(iso: string | null): string {
  const h = hoursSince(iso);
  if (h == null) return "—";
  if (h < 1) {
    const m = Math.max(1, Math.round(h * 60));
    return `${m} min`;
  }
  if (h < 24) {
    const hr = Math.round(h);
    return `${hr} ${hr === 1 ? "hour" : "hours"}`;
  }
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
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
  const ic = (I: typeof Check) => <I aria-hidden="true" />;
  if (!status) return <StatusText inline tone="mute" icon={ic(Minus)}>Prepaid</StatusText>;
  if (status === "pending") return <StatusText inline tone="info" icon={ic(MessageCircle)}>Waiting for tap</StatusText>;
  if (status === "needs_call") return <StatusText inline tone="warn" icon={ic(PhoneMissed)}>Needs a call</StatusText>;
  if (status === "cancelled") return <StatusText inline tone="mute" icon={ic(X)}>Cancelled</StatusText>;
  return (
    <StatusText inline tone="good" icon={ic(Check)}>
      {via === "manual" ? "Confirmed by call" : "Confirmed"}
    </StatusText>
  );
}

// Used by the "Confirmation coverage" tab.
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
  if (raw === "all" || raw === "coverage") return "all";
  return raw === "rules" ? "rules" : "call";
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
  // Call rules read WhatsApp flow settings (WhatsApp marketing area); show a
  // plain no-access card instead of a page of 403 errors for other members.
  const access = useAccess();
  const canRules = !access || canOpenHref(access, "/dashboard/whatsapp?tab=flows");
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
  const [channel, setChannel] = useState<OrderChannel>("all");
  const [search, setSearch] = useState("");

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
  const pendingTap = useMemo(() => gateOrders.filter((o) => o.confirmation_status === "pending"), [gateOrders]);
  const sumWaiting = useMemo(
    () => sumOnHold + pendingTap.reduce((sum, o) => sum + (o.total_price ?? 0), 0),
    [sumOnHold, pendingTap],
  );
  const confirmedTap = gateOrders.filter((o) => o.confirmation_status === "confirmed" && o.confirmed_via === "button").length;
  const confirmedCall = gateOrders.filter((o) => o.confirmation_status === "confirmed" && o.confirmed_via === "manual").length;
  const cancelledCount = gateOrders.filter((o) => o.confirmation_status === "cancelled").length;

  // All orders view: channel chip + search, then the confirmation chip.
  const isCodWaiting = useCallback((o: ConfirmOrder) => {
    const g = gateByOrderNumber.get(o.order_number);
    return g?.confirmation_status === "pending" || g?.confirmation_status === "needs_call";
  }, [gateByOrderNumber]);
  const channelRows = useMemo(() => filterOrders(confirmData?.orders ?? [], channel, search), [confirmData, channel, search]);
  const counts = useMemo(() => channelCounts(confirmData?.orders ?? []), [confirmData]);
  const sortedOrders = useMemo(() => {
    const rows = channelRows.filter((o) => {
      if (filter === "missing") return isOutstanding(o.status);
      if (filter === "cancelled") {
        const g = gateByOrderNumber.get(o.order_number);
        return o.status === "cancelled" || g?.confirmation_status === "cancelled";
      }
      if (filter === "cod") return isCodWaiting(o);
      return true;
    });
    return [...rows].sort((a, b) => Number(isOutstanding(b.status)) - Number(isOutstanding(a.status)));
  }, [channelRows, filter, gateByOrderNumber, isCodWaiting]);

  // Export = exactly the rows on screen (channel, search and status applied).
  const exportCsv = useCallback(() => {
    const confirmLabel: Record<ConfirmStatus, string> = {
      sent: "Sent", missing: "Missing", failed: "Failed", gave_up: "Gave up", no_phone: "No phone", cancelled: "Cancelled",
    };
    const gateLabel = (o: ConfirmOrder) => {
      const g = gateByOrderNumber.get(o.order_number);
      if (!g?.confirmation_status) return "Prepaid";
      if (g.confirmation_status === "confirmed") return g.confirmed_via === "manual" ? "Confirmed by call" : "Confirmed";
      return { pending: "Waiting for tap", needs_call: "Needs a call", cancelled: "Cancelled" }[g.confirmation_status];
    };
    const csv = toCsv(
      ["Order", "Placed", "Customer", "Phone", "Channel", "Total (INR)", "WhatsApp confirmation", "COD"],
      sortedOrders.map((o) => [
        o.order_number,
        new Date(o.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        o.customer_name ?? "",
        formatPhone(o.phone),
        isCreatorSeed(o) ? "HYPD creator seed" : CHANNEL_LABEL[chipOf(o)],
        o.total ?? "",
        confirmLabel[o.status],
        gateLabel(o),
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `promunch-orders-${period}${channel === "all" ? "" : `-${channel}`}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedOrders, gateByOrderNumber, period, channel]);

  const TITLES: Record<Tab, string> = { call: "Confirm COD", all: "All orders", rules: "Call rules" };
  const summary: ReactNode =
    tab === "rules" ? (
      <>When the voice agent calls, how often, and what it says. Only the owner or an admin can change them.</>
    ) : !confirmData ? undefined : tab === "all" ? (
      (() => {
        const t = viewTotals(confirmData.orders);
        return (
          <>
            <b>
              {t.orders} order{t.orders === 1 ? "" : "s"} ({formatINR(t.revenue)})
            </b>{" "}
            in the last {PERIOD_LABEL[period]}{t.seeds > 0 ? `, not counting ${t.seeds} creator seed${t.seeds === 1 ? "" : "s"}` : ""}.{" "}
            {confirmData.summary.coveragePct}% got a WhatsApp confirmation.
          </>
        );
      })()
    ) : needsCall.length > 0 ? (
      <>
        <b>
          {needsCall.length} cash-on-delivery order{needsCall.length === 1 ? "" : "s"} ({formatINR(sumOnHold)})
        </b>{" "}
        {needsCall.length === 1 ? "isn't" : "aren't"} confirmed yet. {needsCall.length === 1 ? "It won't" : "They won't"} ship until
        someone confirms.
      </>
    ) : pendingTap.length > 0 ? (
      <>
        Nothing needs a call. <b>{pendingTap.length} cash-on-delivery order{pendingTap.length === 1 ? " is" : "s are"}</b> waiting
        for a WhatsApp tap.
      </>
    ) : (
      <>All cash-on-delivery orders in the last {PERIOD_LABEL[period]} are confirmed or cancelled.</>
    );

  const header = (
    <PageHeader
      crumb="Orders & COD"
      title={TITLES[tab]}
      summary={summary}
      actions={
        tab === "rules" ? undefined : (
          <>
            <PeriodPicker options={PERIODS} value={period} onChange={setPeriod} />
            {tab === "all" && confirmData && (
              <button type="button" className="pm2-btn" onClick={exportCsv} title="Download the orders shown below as a CSV file">
                <Download size={14} /> Export
              </button>
            )}
            {outstanding.length > 0 && (
              <button type="button" className="pm2-btn pri pm2-d-only" onClick={() => setResendOpen(true)}>
                <Send size={14} /> Resend {outstanding.length} missing
              </button>
            )}
          </>
        )
      }
    />
  );

  if (tab === "rules") {
    return (
      <>
        {header}
        <div className="pm2-body">
          {canRules ? (
            <CallRules />
          ) : (
            <Callout title="Call rules are managed by the WhatsApp team" body="Ask an admin for WhatsApp marketing access to change when COD and cart calls go out." />
          )}
        </div>
      </>
    );
  }

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

  // Right-hand actions for a COD order. Same handlers as before: Call is a
  // tel: link, Confirm runs gateAction(o, "confirm"), Cancel opens the
  // ConfirmDialog via setCancelTarget (never cancels directly).
  const callLink = (o: GateOrder) => (
    <a
      className={s.btn}
      href={telHref(o.customer_phone)}
      aria-label={`Call ${o.customer_name || "customer"}`}
      aria-disabled={!o.customer_phone || undefined}
      style={!o.customer_phone ? { opacity: 0.5, pointerEvents: "none" } : undefined}
    >
      <Phone aria-hidden="true" />
      <span className={s.bl}>Call</span>
    </a>
  );

  const codRow = (o: GateOrder, lane: "warn" | "good") => {
    const name = o.customer_name || formatPhone(o.customer_phone) || "Customer";
    const wa = waLabel(confirmByOrderNumber.get(o.order_number)?.status);
    const waiting = waitingText(o.confirmation_sent_at);
    return (
      <div className={s.row} key={o.shopify_id}>
        <span className={`${s.av} ${s[lane]}`} aria-hidden="true">
          {initials(name)}
        </span>
        <div className={s.tx}>
          <b className={s.name}>{name}</b>
          <span className={s.meta}>
            <b>{o.order_number}</b> · {formatINR(o.total_price ?? 0)} COD
            {o.customer_name && o.customer_phone && <span className={s.phone}> · {formatPhone(o.customer_phone)}</span>}
          </span>
          {lane === "warn" ? (
            <StatusText
              tone={wa === "Sent" ? "warn" : "bad"}
              icon={wa === "Sent" ? <Clock aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            >
              Waiting {waiting} · {wa === "Sent" ? "no WhatsApp tap" : `WhatsApp ${wa.toLowerCase()}`}
            </StatusText>
          ) : (
            <StatusText tone="good" icon={<CheckCheck aria-hidden="true" />}>
              WhatsApp sent {waiting} ago · moves to Needs a call after 6 hours
            </StatusText>
          )}
        </div>
        <div className={s.acts}>
          {callLink(o)}
          {lane === "warn" && (
            <>
              <button
                type="button"
                className={s.btn}
                disabled={gateBusy !== null}
                onClick={() => gateAction(o, "confirm")}
                aria-label={`Confirm order ${o.order_number}`}
              >
                <Check aria-hidden="true" />
                <span className={s.bl}>{gateBusy === `${o.shopify_id}:confirm` ? "Confirming…" : "Confirm"}</span>
              </button>
              <button
                type="button"
                className={`${s.btn} ${s.ghost} ${s.icon}`}
                disabled={gateBusy !== null}
                onClick={() => setCancelTarget(o)}
                aria-label={`Cancel order ${o.order_number}`}
                title="Cancel order"
              >
                <X aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const allCols: TableCol<ConfirmOrder>[] = [
    {
      h: "Order",
      render: (o) => (
        <div>
          <div>{o.order_number}</div>
          <span className="sub">{isCreatorSeed(o) ? "HYPD creator seed" : CHANNEL_LABEL[chipOf(o)]}</span>
        </div>
      ),
    },
    {
      h: "Customer",
      render: (o) => (
        <div>
          <div>{o.customer_name || "—"}</div>
          {o.phone && <span className="sub">{formatPhone(o.phone)}</span>}
        </div>
      ),
    },
    { h: "Placed", render: (o) => timeAgo(o.created_at) },
    { h: "Total", num: true, render: (o) => formatINR(o.total ?? 0) },
    {
      h: "Confirmation",
      render: (o) => {
        const canResend = o.status === "missing" || o.status === "failed";
        const tone: Tone = o.status === "sent" ? "good" : canResend ? "warn" : o.status === "gave_up" ? "warn" : "mute";
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
        const icon =
          o.status === "sent" ? <Check aria-hidden="true" /> : tone === "warn" ? <AlertCircle aria-hidden="true" /> : <Minus aria-hidden="true" />;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
            <StatusText inline tone={tone} icon={icon}>
              {label}
            </StatusText>
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

  return (
    <>
      {header}
      <div className="pm2-body">
        {tab === "call" && (
          <>
            <KpiStrip>
              <Kpi
                label={<span className={`${s.dot} ${s.good}`}>Confirmed</span>}
                value={confirmedTap + confirmedCall}
                sub={`${confirmedTap} by tap · ${confirmedCall} by call`}
              />
              <Kpi
                label={<span className={`${s.dot} ${s.warn}`}>Waiting</span>}
                value={needsCall.length + pendingTap.length}
                sub={`${formatINR(sumWaiting)} on hold`}
              />
              <Kpi
                label={<span className={`${s.dot} ${s.bad}`}>Cancelled</span>}
                value={cancelledCount}
                sub="Stopped before shipping"
              />
              <Kpi
                label={<span className={`${s.dot} ${s.info}`}>WhatsApp sent</span>}
                value={`${confirmData.summary.coveragePct}%`}
                sub={`of orders · last ${PERIOD_LABEL[period]}`}
              />
            </KpiStrip>

            <div className={`${s.laneH} ${s.warn}`}>
              <span className={s.lic} aria-hidden="true">
                <PhoneMissed />
              </span>
              <b>Needs a call</b>
              <span className={s.laneN}>{needsCall.length}</span>
              <span className={s.hint}>No WhatsApp tap in 6 hours · {formatINR(sumOnHold)} on hold</span>
            </div>
            <div className={s.lane}>
              {needsCall.length === 0 ? (
                <div className={s.empty}>No COD orders waiting for a call</div>
              ) : (
                needsCall.map((o) => codRow(o, "warn"))
              )}
            </div>

            {pendingTap.length > 0 && (
              <>
                <div className={`${s.laneH} ${s.good}`}>
                  <span className={s.lic} aria-hidden="true">
                    <MessageCircle />
                  </span>
                  <b>Waiting for WhatsApp tap</b>
                  <span className={s.laneN}>{pendingTap.length}</span>
                  <span className={s.hint}>Moves to Needs a call after 6 hours</span>
                </div>
                <div className={s.lane}>{pendingTap.map((o) => codRow(o, "good"))}</div>
              </>
            )}

            <div className={s.note}>
              <Info aria-hidden="true" />
              <div>
                <b>How it works:</b> every cash-on-delivery order gets WhatsApp Confirm / Cancel buttons and shipping waits
                for a tap. After 6 hours without a tap, the order shows up under Needs a call so someone can ring the
                customer.
              </div>
            </div>
          </>
        )}

        {tab === "all" && (
          <>
            <div className={s.toolbar}>
              <span className="pm2-chips" role="group" aria-label="Channel">
                {(["all", "web", "hypd", "amazon", "other"] as const)
                  .filter((c) => c === "all" || c === "web" || c === "hypd" || counts[c] > 0)
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`pm2-chip${channel === c ? " on" : ""}`}
                      aria-pressed={channel === c}
                      onClick={() => setChannel(c)}
                    >
                      {c === "all" ? "All channels" : CHANNEL_LABEL[c]} <em>{counts[c]}</em>
                    </button>
                  ))}
              </span>
              <label className={s.search}>
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order number, name, phone"
                  aria-label="Search orders by order number, name or phone"
                />
              </label>
            </div>
            <span className="pm2-chips" role="group" aria-label="Confirmation">
              <button type="button" className={`pm2-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
                Any status <em>{channelRows.length}</em>
              </button>
              <button type="button" className={`pm2-chip${filter === "missing" ? " on" : ""}`} onClick={() => setFilter("missing")}>
                Missing <em>{channelRows.filter((o) => isOutstanding(o.status)).length}</em>
              </button>
              <button type="button" className={`pm2-chip${filter === "cod" ? " on" : ""}`} onClick={() => setFilter("cod")}>
                COD waiting <em>{channelRows.filter(isCodWaiting).length}</em>
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
                empty={search || channel !== "all" ? "No orders match this search." : "No orders in this window."}
                card={(o) => {
                  const g = gateByOrderNumber.get(o.order_number);
                  return {
                    title: `${o.order_number} · ${o.customer_name || formatPhone(o.phone) || "—"}`,
                    value: formatINR(o.total ?? 0),
                    meta: (
                      <>
                        <span>{timeAgo(o.created_at)} · {isCreatorSeed(o) ? "Creator seed" : CHANNEL_LABEL[chipOf(o)]}</span>
                        {gateChip(g?.confirmation_status, g?.confirmed_via)}
                      </>
                    ),
                  };
                }}
              />
            </Card>

            <h2 className={s.secH}>Coverage</h2>
            <CoverageCards confirmData={confirmData} gateOrders={gateOrders} period={period} />
            <div className={s.note}>
              <Info aria-hidden="true" />
              <div>
                <b>How confirmations work:</b> every order gets a WhatsApp confirmation within a minute of coming in.
                Cash-on-delivery orders get Confirm / Cancel buttons, and shipping waits for a tap. After 6 hours without
                a tap, the order shows up on Confirm COD so someone can ring the customer.
              </div>
            </div>
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
