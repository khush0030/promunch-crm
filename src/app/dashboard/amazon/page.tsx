"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, DownloadCloud, IndianRupee, Minus, Wallet, Tag, CircleCheck, Package } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHead, SectionLabel, KpiCard, Panel, DataTable, StatusBadge } from "@/components/pm";
import type { Column } from "@/components/pm";

// Amazon financials dashboard. Reads /api/amazon (server-side SP-API mirror).
// Shows sales/net with the Amazon-fee breakdown, settlement reconciliation
// (computed lines vs bank deposit), recent orders, and low FBA stock.

type Roll = {
  gross: number; promo: number; referralFee: number; fbaFee: number;
  otherFees: number; fees: number; net: number; feePct: number; events: number;
};
type Settlement = {
  settlement_id: string; currency: string; total_deposit: number;
  period_start: string | null; period_end: string | null; deposit_date: string | null;
  gross_sales: number; fees_total: number; refunds_total: number; line_sum: number;
  variance: number; reconciled: boolean; recon_note: string | null;
  breakdown: Record<string, number> | null;
};
type Order = { id: string; status: string | null; date: string | null; total: number; currency: string; channel: string };
type LowStock = { seller_sku: string; product_name: string | null; fulfillable_quantity: number; inbound_shipped: number };
type Data = {
  ok: boolean;
  financials: { today: Roll; d7: Roll; d30: Roll; d90: Roll };
  orders: { recent: Order[]; total: number };
  inventory: { lowStock: LowStock[]; skuCount: number };
  settlements: Settlement[];
  sync: { key: string; watermark: string | null; updated_at: string }[];
};

const RANGES = [
  { key: "today", label: "Today" },
  { key: "d7", label: "7d" },
  { key: "d30", label: "30d" },
  { key: "d90", label: "90d" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const inr0 = (n: number) => "₹" + Math.round(n ?? 0).toLocaleString("en-IN");
const inrShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

// Dependency-free SVG chart: gross sales vs net deposit per settlement period,
// with fee% labelled. Net bar can dip below the zero line (negative payout).
function SettlementChart({ data }: { data: Settlement[] }) {
  const rows = [...data].reverse(); // oldest → newest
  if (rows.length === 0) return null;
  const W = Math.max(rows.length * 88, 320);
  const H = 200, padT = 22, padB = 30;
  const vals = rows.flatMap((s) => [Number(s.gross_sales) || 0, Number(s.total_deposit) || 0]);
  const maxV = Math.max(0, ...vals);
  const minV = Math.min(0, ...vals);
  const range = maxV - minV || 1;
  const y = (v: number) => padT + (1 - (v - minV) / range) * (H - padT - padB);
  const zeroY = y(0);
  const slotW = W / rows.length;
  const barW = Math.min(20, slotW / 3.2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gross sales vs net deposit by settlement">
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--pm-line)" strokeWidth={1} />
      {rows.map((s, i) => {
        const cx = i * slotW + slotW / 2;
        const g = Number(s.gross_sales) || 0;
        const n = Number(s.total_deposit) || 0;
        const gy = y(g), ny = y(n);
        const feePct = g ? Math.round((Math.abs(Number(s.fees_total) || 0) / g) * 100) : 0;
        return (
          <g key={s.settlement_id}>
            <rect x={cx - barW - 1} y={Math.min(gy, zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - gy))} rx={2} fill="var(--pm-green)" opacity={0.30} />
            <rect x={cx + 1} y={Math.min(ny, zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - ny))} rx={2} fill={n >= 0 ? "var(--pm-green)" : "var(--pm-terra)"} />
            <text x={cx} y={Math.min(gy, ny) - 6} textAnchor="middle" fontSize={9} fill="var(--pm-muted)">{feePct}% fee</text>
            <text x={cx} y={H - 16} textAnchor="middle" fontSize={9} fill="var(--pm-muted)">{fmtDate(s.period_end)}</text>
            <text x={cx} y={H - 4} textAnchor="middle" fontSize={9} fill={n >= 0 ? "var(--pm-green)" : "var(--pm-terra)"}>{inrShort(n)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AmazonPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("d30");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/amazon", { cache: "no-store" });
      const d = await res.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/amazon", { method: "POST" });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.detail || `Sync failed (${d.status ?? res.status})`);
      toast.push({ kind: "success", text: "Amazon sync triggered — refreshing." });
      await load();
    } catch (e) {
      toast.push({ kind: "error", text: `Sync failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setSyncing(false);
    }
  }

  // Freshest watermark across sync sections — shows the user how current the data is.
  const lastSync = data?.sync?.reduce<string | null>((latest, s) => {
    const t = s.updated_at;
    return t && (!latest || t > latest) ? t : latest;
  }, null) ?? null;

  const r = data?.financials[range];

  const settlementCols: Column<Settlement>[] = [
    { header: "Period", cell: (s) => <span className="pm-b7" style={{ whiteSpace: "nowrap" }}>{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</span> },
    { header: "Gross", cell: (s) => inr0(s.gross_sales) },
    { header: "Fees", cell: (s) => <span style={{ color: "var(--pm-terra)" }}>{inr0(s.fees_total)}</span> },
    { header: "Refunds", cell: (s) => <span style={{ color: "var(--pm-terra)" }}>{inr0(s.refunds_total)}</span> },
    { header: "Deposit", cell: (s) => <span className="pm-b7">{inr0(s.total_deposit)}</span> },
    { header: "Variance", cell: (s) => <span style={{ color: Math.abs(s.variance) < 1 ? "var(--pm-muted)" : "var(--pm-terra)" }}>{inr0(s.variance)}</span> },
    {
      header: "Status",
      cell: (s) =>
        s.reconciled ? (
          <StatusBadge tone="green" icon={<CircleCheck />}>Reconciled</StatusBadge>
        ) : (
          <StatusBadge tone="terra">Variance</StatusBadge>
        ),
    },
  ];

  const orderCols: Column<Order>[] = [
    { header: "Order", cell: (o) => <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}>{o.id}</span> },
    { header: "Date", cell: (o) => <span className="pm-dim">{fmtDate(o.date)}</span> },
    { header: "Channel", cell: (o) => o.channel },
    { header: "Status", cell: (o) => <span className="pm-dim">{o.status}</span> },
    { header: "Total", cell: (o) => <span className="pm-b7">{inr0(o.total)}</span> },
  ];

  return (
    <div className="pm-page">
      <PageHead
        title="Amazon"
        subtitle={
          <>
            Sales, fees, net &amp; settlement reconciliation from Seller Central
            {data ? ` · ${data.orders.total} orders · ${data.inventory.skuCount} SKUs` : ""}
            {lastSync ? ` · synced ${fmtDate(lastSync)}` : ""}
          </>
        }
        actions={
          <>
            <div className="pm-ranges">
              {RANGES.map((p) => (
                <button key={p.key} className={range === p.key ? "on" : ""} onClick={() => setRange(p.key)}>{p.label}</button>
              ))}
            </div>
            <button className="pm-btn ghost" onClick={load} aria-label="Refresh"><RefreshCw size={15} /> Refresh</button>
            <button className="pm-btn primary" onClick={syncNow} disabled={syncing}><DownloadCloud size={15} /> {syncing ? "Syncing…" : "Sync now"}</button>
          </>
        }
      />

      {loading && !data ? (
        <div className="pm-panel pm-dim">Loading Amazon financials…</div>
      ) : !data || !r ? (
        <div className="pm-panel pm-dim">No Amazon data yet. Run the sync.</div>
      ) : (
        <>
          <div className="pm-kpis">
            <KpiCard label="Gross sales" value={inr0(r.gross)} icon={<IndianRupee />} tone="g" sub={`${r.events} finance events`} />
            <KpiCard label="Amazon fees" value={inr0(r.fees)} icon={<Minus />} tone="t" valueColor="var(--pm-terra)" sub={`${r.feePct}% of gross · FBA ${inr0(r.fbaFee)}`} />
            <KpiCard label="Net kept" value={inr0(r.net)} icon={<Wallet />} tone="g" valueColor={r.net >= 0 ? "var(--pm-green)" : "var(--pm-terra)"} sub="what you actually keep" />
            <KpiCard label="Promotions" value={inr0(r.promo)} icon={<Tag />} tone="o" sub="discounts applied" />
          </div>

          <div className="pm-grid g-2-1" style={{ marginTop: 16 }}>
            <Panel title="Gross vs net by settlement" icon={<IndianRupee className="tic" />} caption="Net deposit after fees · ₹">
              {data.settlements.length > 0 ? (
                <div className="pm-chartbox sm" style={{ height: "auto" }}><SettlementChart data={data.settlements} /></div>
              ) : (
                <div className="pm-dim" style={{ fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>No settlements ingested yet.</div>
              )}
            </Panel>
            <Panel title="Low FBA stock" icon={<Package className="tic" />} caption="≤ 10 fulfillable units">
              {data.inventory.lowStock.length === 0 ? (
                <div className="pm-dim" style={{ fontSize: 13, padding: "20px 0" }}>All SKUs healthy.</div>
              ) : (
                data.inventory.lowStock.map((l) => (
                  <div className="pm-pill" key={l.seller_sku}>
                    <span className="nm" style={{ fontSize: 12.5 }}>{l.product_name || l.seller_sku}</span>
                    <StatusBadge tone={l.fulfillable_quantity === 0 ? "terra" : "gold"}>{l.fulfillable_quantity} left</StatusBadge>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <SectionLabel>Settlement reconciliation</SectionLabel>
          <DataTable columns={settlementCols} rows={data.settlements} rowKey={(s) => s.settlement_id} empty="No settlements ingested yet. They arrive ~fortnightly." />

          <SectionLabel>Recent orders</SectionLabel>
          <DataTable columns={orderCols} rows={data.orders.recent.slice(0, 15)} rowKey={(o) => o.id} empty="No orders synced." />
        </>
      )}
    </div>
  );
}
