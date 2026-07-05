"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, DownloadCloud, IndianRupee, Minus, Wallet, Tag, CircleCheck, Package, TrendingDown, Percent } from "lucide-react";
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
type SkuEcon = {
  sku: string; title: string; asin: string | null; isFba: boolean;
  units30: number; units90: number; gross90: number; promo90: number;
  referral90: number; fba90: number; closing90: number; otherFees90: number; net90: number;
  refundUnits90: number; refundNet90: number;
  avgPrice: number; feesPerUnit: number; feePct: number; netPerUnit: number;
  cogs: number | null; profitPerUnit: number | null; marginPct: number | null;
  velocity: number; fulfillable: number | null; inbound: number | null; daysCover: number | null;
  outOfStock: boolean; lostRevenuePerDay: number; lostNetPerDay: number; lostProfitPerDay: number | null;
};
type Data = {
  ok: boolean;
  financials: { today: Roll; d7: Roll; d30: Roll; d90: Roll };
  orders: { recent: Order[]; total: number };
  inventory: { lowStock: LowStock[]; skuCount: number };
  skuEconomics: SkuEcon[];
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

// Inline COGS editor. Amazon can't tell us our own cost of goods, so this is
// the one manual input on the page — everything else derives from SP-API data.
function CogsCell({ row, onSaved }: { row: SkuEcon; onSaved: () => void }) {
  const toast = useToast();
  const [val, setVal] = useState(row.cogs != null ? String(row.cogs) : "");
  const [saving, setSaving] = useState(false);
  async function save() {
    const c = Number(val);
    if (val === "" || !Number.isFinite(c) || c < 0) return;
    if (row.cogs != null && Math.abs(c - row.cogs) < 0.005) return;
    setSaving(true);
    try {
      const res = await fetch("/api/amazon/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller_sku: row.sku, cost_per_unit: c }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "save failed");
      toast.push({ kind: "success", text: `COGS saved: ${row.sku} = ₹${c}/unit` });
      onSaved();
    } catch (e) {
      toast.push({ kind: "error", text: `COGS save failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setSaving(false);
    }
  }
  return (
    <input
      type="number"
      min={0}
      step="0.5"
      value={val}
      placeholder="₹/unit"
      disabled={saving}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 76, padding: "4px 6px", fontSize: 12.5, textAlign: "right",
        border: "1px solid var(--pm-line)", borderRadius: 6,
        background: "var(--pm-bg, transparent)", color: "inherit",
      }}
      aria-label={`Cost per unit for ${row.sku}`}
    />
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

  // Stockout economics: FBA is what actually sells (fast delivery); when FBA
  // stock hits 0 we assume the sale is lost, not recaptured by 7-8 day MFN.
  const econ = data?.skuEconomics ?? [];
  const oos = econ.filter((s) => s.outOfStock && s.velocity > 0);
  const lowCover = econ.filter((s) => !s.outOfStock && s.velocity > 0 && s.daysCover != null && s.daysCover <= 14);
  const bleedNet = oos.reduce((a, s) => a + s.lostNetPerDay, 0);
  const bleedRev = oos.reduce((a, s) => a + s.lostRevenuePerDay, 0);
  const stockRisk: SkuEcon[] = [...oos.sort((a, b) => b.lostNetPerDay - a.lostNetPerDay), ...lowCover.sort((a, b) => (a.daysCover ?? 99) - (b.daysCover ?? 99))];

  const riskCols: Column<SkuEcon>[] = [
    {
      header: "Product",
      cell: (s) => (
        <div style={{ maxWidth: 320 }}>
          <div className="pm-b7" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
          <div className="pm-dim" style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>{s.sku}</div>
        </div>
      ),
    },
    {
      header: "Stock",
      cell: (s) =>
        s.outOfStock ? (
          <StatusBadge tone="terra">OUT</StatusBadge>
        ) : (
          <StatusBadge tone="gold">{s.fulfillable} left · {s.daysCover}d</StatusBadge>
        ),
    },
    { header: "Sells/day", cell: (s) => <span>{s.velocity}</span> },
    {
      header: "Lost payout/day",
      cell: (s) => (s.outOfStock ? <span className="pm-b7" style={{ color: "var(--pm-terra)" }}>{inr0(s.lostNetPerDay)}</span> : <span className="pm-dim">—</span>),
    },
    {
      header: "Lost sales/day",
      cell: (s) => (s.outOfStock ? <span style={{ color: "var(--pm-terra)" }}>{inr0(s.lostRevenuePerDay)}</span> : <span className="pm-dim">—</span>),
    },
    {
      header: "Inbound",
      cell: (s) => (s.inbound ? <span>{s.inbound} on the way</span> : <span className="pm-dim">none</span>),
    },
  ];

  const econCols: Column<SkuEcon>[] = [
    {
      header: "Product",
      cell: (s) => (
        <div style={{ maxWidth: 300 }}>
          <div className="pm-b7" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
          <div className="pm-dim" style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>
            {s.sku}{s.isFba ? "" : " · MFN"}
          </div>
        </div>
      ),
    },
    {
      header: "Units 90d",
      cell: (s) => (
        <div>
          <span className="pm-b7">{s.units90}</span>
          <span className="pm-dim" style={{ fontSize: 11 }}> ({s.units30} in 30d)</span>
          {s.refundUnits90 > 0 && (
            <div style={{ color: "var(--pm-terra)", fontSize: 11 }}>−{s.refundUnits90} refunded</div>
          )}
        </div>
      ),
    },
    { header: "Avg price", cell: (s) => inr0(s.avgPrice) },
    {
      header: "Amazon takes",
      cell: (s) => (
        <div title={`per unit: referral ${inr0(s.units90 ? -s.referral90 / s.units90 : 0)} · FBA ${inr0(s.units90 ? -s.fba90 / s.units90 : 0)} · closing ${inr0(s.units90 ? -s.closing90 / s.units90 : 0)} · other ${inr0(s.units90 ? -s.otherFees90 / s.units90 : 0)}`}>
          <span style={{ color: "var(--pm-terra)" }}>{inr0(s.feesPerUnit)}</span>
          <span className="pm-dim" style={{ fontSize: 11 }}> · {s.feePct}%</span>
        </div>
      ),
    },
    { header: "Net/unit", cell: (s) => <span className="pm-b7">{inr0(s.netPerUnit)}</span> },
    { header: "COGS", cell: (s) => <CogsCell key={`${s.sku}:${s.cogs ?? "unset"}`} row={s} onSaved={load} /> },
    {
      header: "Profit/unit",
      cell: (s) =>
        s.profitPerUnit != null ? (
          <div>
            <span className="pm-b7" style={{ color: s.profitPerUnit >= 0 ? "var(--pm-green)" : "var(--pm-terra)" }}>{inr0(s.profitPerUnit)}</span>
            <span className="pm-dim" style={{ fontSize: 11 }}> · {s.marginPct}%</span>
          </div>
        ) : (
          <span className="pm-dim" style={{ fontSize: 11.5 }}>set COGS →</span>
        ),
    },
    {
      header: "Stock",
      cell: (s) =>
        !s.isFba ? (
          <StatusBadge tone="gold">MFN</StatusBadge>
        ) : s.outOfStock ? (
          <StatusBadge tone="terra">OUT</StatusBadge>
        ) : (
          <StatusBadge tone={s.daysCover != null && s.daysCover <= 14 ? "gold" : "green"}>
            {s.fulfillable}{s.daysCover != null ? ` · ${s.daysCover}d` : ""}
          </StatusBadge>
        ),
    },
  ];

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

          {stockRisk.length > 0 && (
            <>
              <SectionLabel>Stockout cost — FBA</SectionLabel>
              <Panel
                title={oos.length > 0 ? `Losing ~${inr0(bleedNet)}/day in payout (${inr0(bleedNet * 30)}/month)` : "No stockouts — but thin cover ahead"}
                icon={<TrendingDown className="tic" />}
                caption={
                  oos.length > 0
                    ? `${oos.length} selling SKU(s) at zero FBA stock · ~${inr0(bleedRev)}/day in sales. Assumes no recapture via MFN (7-8 day delivery).`
                    : "SKUs under 14 days of cover at current sales rate."
                }
              >
                <DataTable columns={riskCols} rows={stockRisk} rowKey={(s) => s.sku} empty="All FBA SKUs healthy." />
              </Panel>
            </>
          )}

          <SectionLabel>SKU unit economics — last 90 days</SectionLabel>
          <Panel
            title="What each SKU actually earns"
            icon={<Percent className="tic" />}
            caption="Fees are what Amazon really charged per finance event, not rate-card estimates. Enter COGS (your landed cost per unit) to see true profit. Velocity uses 30d sales, falling back to the 90d rate for stocked-out SKUs."
          >
            <DataTable columns={econCols} rows={econ} rowKey={(s) => s.sku} empty="No per-SKU finance data yet. Run the sync." />
          </Panel>

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
