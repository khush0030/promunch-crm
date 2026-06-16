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
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

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
