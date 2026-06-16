"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

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
  { key: "d7", label: "7 days" },
  { key: "d30", label: "30 days" },
  { key: "d90", label: "90 days" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const inr = (n: number) =>
  "₹" + (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth={1} />
      {rows.map((s, i) => {
        const cx = i * slotW + slotW / 2;
        const g = Number(s.gross_sales) || 0;
        const n = Number(s.total_deposit) || 0;
        const gy = y(g), ny = y(n);
        const feePct = g ? Math.round((Math.abs(Number(s.fees_total) || 0) / g) * 100) : 0;
        return (
          <g key={s.settlement_id}>
            <rect x={cx - barW - 1} y={Math.min(gy, zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - gy))} rx={2} fill="var(--blue, #6366f1)" opacity={0.45} />
            <rect x={cx + 1} y={Math.min(ny, zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - ny))} rx={2} fill={n >= 0 ? "var(--green)" : "var(--accent)"} />
            <text x={cx} y={Math.min(gy, ny) - 6} textAnchor="middle" fontSize={9} fill="var(--muted)">{feePct}% fee</text>
            <text x={cx} y={H - 16} textAnchor="middle" fontSize={9} fill="var(--muted)">{fmtDate(s.period_end)}</text>
            <text x={cx} y={H - 4} textAnchor="middle" fontSize={9} fill={n >= 0 ? "var(--green)" : "var(--accent)"}>{inrShort(n)}</text>
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

  const r = data?.financials[range];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Amazon</h1>
          <div className="sub">
            Sales, fees, net &amp; settlement reconciliation from Seller Central (SP-API)
            {data ? ` · ${data.orders.total} orders · ${data.inventory.skuCount} SKUs synced` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="chips">
            {RANGES.map((p) => (
              <button key={p.key} type="button" className={`chip${range === p.key ? " active" : ""}`} onClick={() => setRange(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={load} aria-label="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="card card-pad muted">Loading Amazon financials…</div>
      ) : !data || !r ? (
        <div className="card card-pad muted">No Amazon data yet. Run the sync.</div>
      ) : (
        <>
          {/* ---- financial KPIs ---- */}
          <div className="kpi-grid section">
            <div className="kpi">
              <div className="label">Gross sales</div>
              <div className="value">{inr(r.gross)}</div>
              <div className="delta flat">{r.events} finance events</div>
            </div>
            <div className="kpi">
              <div className="label">Amazon fees</div>
              <div className="value" style={{ color: "var(--accent)" }}>{inr(r.fees)}</div>
              <div className="delta flat">{r.feePct}% of gross · ref {inr(r.referralFee)} · FBA {inr(r.fbaFee)}</div>
            </div>
            <div className="kpi">
              <div className="label">Net (after margin)</div>
              <div className="value" style={{ color: r.net >= 0 ? "var(--green)" : "var(--accent)" }}>{inr(r.net)}</div>
              <div className="delta flat">what you actually keep</div>
            </div>
            <div className="kpi">
              <div className="label">Promotions</div>
              <div className="value">{inr(r.promo)}</div>
              <div className="delta flat">discounts applied</div>
            </div>
          </div>

          {/* ---- settlement trend chart ---- */}
          {data.settlements.length > 0 && (
            <div className="card card-pad section">
              <div className="card-title">Sales vs net payout by settlement</div>
              <div className="card-sub" style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--blue, #6366f1)", opacity: 0.45 }} /> Gross sales
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--green)" }} /> Net deposit (red if negative) · fee% above
                </span>
              </div>
              <div style={{ marginTop: 12 }}>
                <SettlementChart data={data.settlements} />
              </div>
            </div>
          )}

          {/* ---- settlement reconciliation ---- */}
          <div className="card card-pad section">
            <div className="card-title">Settlement reconciliation</div>
            <div className="card-sub">Sum of settlement line items vs the actual bank deposit. A variance is unaccounted money.</div>
            {data.settlements.length === 0 ? (
              <div className="empty">No settlements ingested yet. They arrive ~fortnightly.</div>
            ) : (
              <table className="tbl" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Period</th><th>Gross</th><th>Fees</th><th>Refunds</th>
                    <th>Deposit</th><th>Variance</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settlements.map((s) => (
                    <tr key={s.settlement_id}>
                      <td>{fmtDate(s.period_start)} – {fmtDate(s.period_end)}</td>
                      <td>{inr(s.gross_sales)}</td>
                      <td style={{ color: "var(--accent)" }}>{inr(s.fees_total)}</td>
                      <td>{inr(s.refunds_total)}</td>
                      <td><strong>{inr(s.total_deposit)}</strong></td>
                      <td style={{ color: Math.abs(s.variance) < 1 ? "var(--muted)" : "var(--accent)" }}>{inr(s.variance)}</td>
                      <td>
                        <span className={`pill ${s.reconciled ? "green" : "red"}`}>
                          {s.reconciled ? "Reconciled" : "Variance"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="section" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
            {/* ---- recent orders ---- */}
            <div className="card card-pad">
              <div className="card-title">Recent orders</div>
              {data.orders.recent.length === 0 ? (
                <div className="empty">No orders synced.</div>
              ) : (
                <table className="tbl" style={{ marginTop: 12 }}>
                  <thead><tr><th>Order</th><th>Date</th><th>Channel</th><th>Status</th><th>Total</th></tr></thead>
                  <tbody>
                    {data.orders.recent.slice(0, 15).map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{o.id}</td>
                        <td>{fmtDate(o.date)}</td>
                        <td>{o.channel}</td>
                        <td>{o.status}</td>
                        <td>{inr(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ---- low stock ---- */}
            <div className="card card-pad">
              <div className="card-title">Low FBA stock</div>
              <div className="card-sub">≤ 10 fulfillable units</div>
              {data.inventory.lowStock.length === 0 ? (
                <div className="empty">All SKUs healthy.</div>
              ) : (
                <table className="tbl" style={{ marginTop: 12 }}>
                  <thead><tr><th>SKU / product</th><th>Left</th><th>Inbound</th></tr></thead>
                  <tbody>
                    {data.inventory.lowStock.map((l) => (
                      <tr key={l.seller_sku}>
                        <td>{l.product_name || l.seller_sku}</td>
                        <td style={{ color: l.fulfillable_quantity === 0 ? "var(--accent)" : "var(--amber)" }}>
                          {l.fulfillable_quantity}
                        </td>
                        <td>{l.inbound_shipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
