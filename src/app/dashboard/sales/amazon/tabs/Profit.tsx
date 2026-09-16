"use client";

import { useState } from "react";
import { KpiStrip, Kpi, Card, Pill } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { sortForProfit } from "@/lib/amazon/economics";
import type { AmazonMetrics, AmazonSku } from "@/lib/amazon/economics";
import { PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";

function CostEditor({ sku, onSaved, onCancel }: { sku: string; onSaved: () => void; onCancel: () => void }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const cost = Number(val);
    if (val === "" || !Number.isFinite(cost) || cost < 0) {
      setErr("enter a valid ₹ amount");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/amazon/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller_sku: sku, cost_per_unit: cost }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        min={0}
        step="0.5"
        autoFocus
        value={val}
        placeholder="₹ per unit"
        disabled={saving}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        style={{
          width: 96,
          padding: "5px 8px",
          fontSize: 13,
          border: "1px solid var(--pm-border)",
          borderRadius: 6,
          background: "var(--pm-card)",
          color: "inherit",
        }}
        aria-label={`Cost per unit for ${sku}`}
      />
      <button type="button" className="pm2-btn sm pri" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </button>
      {err && <span style={{ color: "var(--pm-terra)", fontSize: 12 }}>{err}</span>}
    </div>
  );
}

function ProfitRow({ sku, onCostSaved }: { sku: AmazonSku; onCostSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const hasCost = sku.costPerUnit != null;

  return (
    <div className="pm2-stock-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
      <div>
        <div className="t">{sku.shortTitle}</div>
        {hasCost ? (
          <>
            <div className="pm2-stack" style={{ height: 14, margin: "6px 0 4px" }} role="img" aria-label={`Amazon keeps ₹${Math.round(sku.amazonKeepsPerUnit)}, product cost ₹${Math.round(sku.costPerUnit ?? 0)}, you keep ₹${Math.round(sku.keepPerUnit ?? 0)}`}>
              <div style={{ flex: Math.max(sku.amazonKeepsPerUnit, 0.01), background: "var(--pm-s-amz)" }} data-tip={`Amazon keeps ₹${Math.round(sku.amazonKeepsPerUnit)}`} tabIndex={0} />
              <div style={{ flex: Math.max(sku.costPerUnit ?? 0, 0.01), background: "var(--pm-hint)" }} data-tip={`Product cost ₹${Math.round(sku.costPerUnit ?? 0)}`} tabIndex={0} />
              <div style={{ flex: Math.max(sku.keepPerUnit ?? 0, 0.01), background: "var(--pm-green)" }} data-tip={`You keep ₹${Math.round(sku.keepPerUnit ?? 0)}`} tabIndex={0} />
            </div>
            <div className="m">
              <span>
                Customer pays <b>{formatINR(sku.avgPrice)}</b>
              </span>
              <span>Amazon {formatINR(sku.amazonKeepsPerUnit)}</span>
              <span>Cost {formatINR(sku.costPerUnit ?? 0)}</span>
              <span style={{ color: "var(--pm-green)", fontWeight: 600 }}>You keep {formatINR(sku.keepPerUnit ?? 0)}</span>
            </div>
          </>
        ) : editing ? (
          <div className="m" style={{ marginTop: 6 }}>
            <span>
              Customer pays <b>{formatINR(sku.avgPrice)}</b>
            </span>
            <CostEditor
              sku={sku.sku}
              onSaved={() => {
                setEditing(false);
                onCostSaved();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="m">
            <span>
              Customer pays <b>{formatINR(sku.avgPrice)}</b>
            </span>
            <Pill tone="warn" tip="Profit can't be calculated until you enter a cost price">
              Enter cost price to see profit
            </Pill>
          </div>
        )}
      </div>
      <div className="days">
        {hasCost ? (
          <>
            <b>{formatINR(sku.profit ?? 0)}</b>
            <small>{sku.units} sold · 30d</small>
          </>
        ) : !editing ? (
          <button type="button" className="pm2-btn sm" onClick={() => setEditing(true)}>
            Set cost
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ProfitTab({ data, onCostSaved }: { data: AmazonMetrics; onCostSaved: () => void }) {
  const rows = sortForProfit(data.skus);
  const withProfit = data.skus.filter((s) => s.profit != null);
  const missingCost = data.skus.filter((s) => s.costPerUnit == null && s.units > 0);
  const best = withProfit.length
    ? withProfit.reduce((a, b) => ((b.keepPerUnit ?? -Infinity) > (a.keepPerUnit ?? -Infinity) ? b : a))
    : null;

  return (
    <>
      <KpiStrip cols={3}>
        <Kpi
          label="Profit, all products"
          value={formatLakh(data.money.profit)}
          delta={null}
          sub={
            data.money.costCoverage < 100
              ? `${PERIOD_LABEL[data.period]} · ${Math.round(data.money.costCoverage)}% of units costed`
              : PERIOD_LABEL[data.period]
          }
          tip={data.money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}
        />
        <Kpi label="Best" value={best ? formatINR(best.keepPerUnit ?? 0) + " / pack" : "—"} sub={best?.shortTitle ?? ""} />
        <Kpi
          label="Missing cost price"
          value={missingCost.length}
          sub={missingCost.length === 1 ? "product" : "products"}
          tip="Profit can't be calculated until you enter a cost price"
        />
      </KpiStrip>

      <div className="pm2-legend" style={{ margin: 0 }}>
        <span>
          <i style={{ background: "var(--pm-s-amz)" }} />
          Amazon keeps
        </span>
        <span>
          <i style={{ background: "var(--pm-hint)" }} />
          Product cost
        </span>
        <span>
          <i style={{ background: "var(--pm-green)" }} />
          You keep
        </span>
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <div className="pm2-empty">No Amazon products yet</div>
        ) : (
          rows.map((s) => <ProfitRow key={s.sku} sku={s} onCostSaved={onCostSaved} />)
        )}
      </Card>
    </>
  );
}

export default ProfitTab;
