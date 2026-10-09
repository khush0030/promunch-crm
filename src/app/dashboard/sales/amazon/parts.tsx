"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import type { AmazonSettlement, AmazonSku } from "@/lib/amazon/economics";
import { fmtDate } from "./format";
import { shortName, signedINR } from "../insights-ui";
import s from "../insights.module.css";

// Shared Amazon pieces: stock runway bars, profit split bars, payout rows.
// Used by the one-page Overview (top few rows) and by the full-list tabs.

// ---------------------------------------------------------------- stock

export const RUNWAY_SCALE_DAYS = 60; // the bar's full width; the mark sits at 30

type RunwayTone = "bad" | "warn" | "good" | "none";

function runwayTone(sku: AmazonSku): RunwayTone {
  if (sku.outOfStock) return "bad";
  if (typeof sku.daysLeft === "number") {
    if (sku.daysLeft < 7) return "bad";
    if (sku.daysLeft <= 21) return "warn";
    return "good";
  }
  return "none";
}

export function isAtRisk(sku: AmazonSku): boolean {
  return sku.outOfStock || (typeof sku.daysLeft === "number" && sku.daysLeft < 14);
}

const TONE_TEXT: Record<RunwayTone, string> = { bad: s.badT, warn: s.warnT, good: s.goodT, none: s.muted };

function daysText(sku: AmazonSku): string {
  if (sku.outOfStock) return "Out of stock";
  if (sku.fulfillmentChannel === "MFN" || sku.daysLeft === "untracked") return "Ships from you";
  if (sku.daysLeft === null) return "No estimate";
  return `${sku.daysLeft} ${sku.daysLeft === 1 ? "day" : "days"}`;
}

function stockLine(sku: AmazonSku): string {
  const parts: string[] = [];
  if (sku.fulfillmentChannel === "MFN") parts.push("stock not tracked by Amazon");
  else parts.push(`${(sku.fulfillable ?? 0).toLocaleString("en-IN")} left`);
  parts.push(`sells ${sku.velocityPerDay} a day`);
  if (sku.fulfillmentChannel !== "MFN") parts.push(sku.inbound ? `${sku.inbound.toLocaleString("en-IN")} on the way` : "none on the way");
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export function RunwayRow({ sku, links = false }: { sku: AmazonSku; links?: boolean }) {
  const tone = runwayTone(sku);
  const width =
    !sku.outOfStock && typeof sku.daysLeft === "number" ? Math.max(0, Math.min(100, (sku.daysLeft / RUNWAY_SCALE_DAYS) * 100)) : 0;
  const atRisk = isAtRisk(sku);
  return (
    <div className={s.rw}>
      <div className={s.rwT}>
        <b title={sku.title}>{sku.shortTitle}</b>
        {sku.outOfStock ? (
          <span className={`${s.tg} ${s.bad}`}>Out of stock</span>
        ) : (
          <span className={`${s.rwD} ${TONE_TEXT[tone]}`}>{daysText(sku)}</span>
        )}
      </div>
      <div className={s.rwBar} role="img" aria-label={`${sku.shortTitle}: ${daysText(sku)}`}>
        <i className={tone === "none" || width === 0 ? s.none : s[tone]} style={{ width: `${width}%` }} />
        {sku.fulfillmentChannel !== "MFN" && <span className={s.rwMark} title="30 days" />}
      </div>
      <div className={s.rwS}>
        <span>{stockLine(sku)}</span>
        {links && sku.asin && (
          <a href={`https://www.amazon.in/dp/${sku.asin}`} target="_blank" rel="noopener noreferrer">
            amazon.in ↗
          </a>
        )}
        {links && (
          <a className="pm2-d-only" href="https://sellercentral.amazon.in/inventory" target="_blank" rel="noopener noreferrer">
            Seller Central ↗
          </a>
        )}
        {atRisk && (
          <a href="https://sellercentral.amazon.in/fba/sendtoamazon" target="_blank" rel="noopener noreferrer">
            Restock ↗
          </a>
        )}
      </div>
    </div>
  );
}

// One sentence on the worst stock position.
export function stockTakeaway(skus: AmazonSku[]): ReactNode {
  const out = skus.filter((x) => x.outOfStock);
  if (out.length > 1)
    return (
      <>
        <em className={s.plain}>{out.length} products</em> are out of stock
      </>
    );
  if (out.length === 1)
    return (
      <>
        {shortName(out[0].shortTitle)} is <em className={s.plain}>out of stock</em>
      </>
    );
  const soonest = skus
    .filter((x) => typeof x.daysLeft === "number")
    .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))[0];
  if (!soonest) return "No stock estimate yet";
  const d = soonest.daysLeft as number;
  if (d > 30) return "Every product has over 30 days of stock";
  return (
    <>
      {shortName(soonest.shortTitle)} runs out in <em className={d < 7 ? s.neg : s.plain}>{d} {d === 1 ? "day" : "days"}</em>
    </>
  );
}

export function RunwayNote() {
  return <p className={s.note}>At the last 30 days&apos; selling speed. The line marks 30 days; bars left of it need a shipment soon.</p>;
}

// ---------------------------------------------------------------- profit

export const FEE_COLOR = "#B9B0A3";
export const COST_COLOR = "#E0C9A6";
export const KEEP_COLOR = "var(--pm-green)";

export function ProfitKeys() {
  return (
    <div className={s.keys} style={{ marginTop: 0, marginBottom: 12 }}>
      <span>
        <i style={{ background: FEE_COLOR }} />
        Amazon keeps
      </span>
      <span>
        <i style={{ background: COST_COLOR }} />
        Your cost
      </span>
      <span>
        <i style={{ background: KEEP_COLOR }} />
        You keep
      </span>
    </div>
  );
}

export function CostEditor({ sku, onSaved, onCancel }: { sku: string; onSaved: () => void; onCancel: () => void }) {
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
    <div className={s.costEd}>
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
        className={s.costIn}
        aria-label={`Cost per unit for ${sku}`}
      />
      <button type="button" className="pm2-btn sm" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" className={s.txtLink} disabled={saving} onClick={onCancel}>
        Cancel
      </button>
      {err && <span className={s.costErr}>{err}</span>}
    </div>
  );
}

// One product's split of each ₹ a customer pays. Without a cost price the
// cost + profit part is hatched and the row offers "Add cost": on the
// Overview that jumps to the Product profit tab (`onAddCost`), on the tab it
// opens the inline editor (`onCostSaved`).
export function ProfitRow({
  sku,
  onAddCost,
  onCostSaved,
}: {
  sku: AmazonSku;
  onAddCost?: () => void;
  onCostSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasCost = sku.costPerUnit != null;
  const fees = Math.max(sku.amazonKeepsPerUnit, 0);
  const cost = Math.max(sku.costPerUnit ?? 0, 0);
  const keep = sku.keepPerUnit ?? 0;
  const rest = Math.max(sku.avgPrice - fees, 0);
  const profit = sku.profit ?? 0;
  const sales = sku.avgPrice * sku.units;

  return (
    <div className={s.pf}>
      <div className={s.pfT}>
        <b title={sku.title}>{sku.shortTitle}</b>
        {hasCost ? (
          <span className={`${s.pfV} ${profit < 0 ? s.badT : s.goodT}`}>{formatLakh(profit)}</span>
        ) : !editing ? (
          <button type="button" className={s.txtLink} onClick={() => (onCostSaved ? setEditing(true) : onAddCost?.())}>
            Add cost +
          </button>
        ) : null}
      </div>
      <div
        className={s.pfBar}
        role="img"
        aria-label={
          hasCost
            ? `Amazon keeps ${formatINR(fees)}, your cost ${formatINR(cost)}, you keep ${formatINR(keep)} per pack`
            : `Amazon keeps ${formatINR(fees)} per pack, cost not entered`
        }
      >
        <i style={{ flex: Math.max(fees, 0.01), background: FEE_COLOR }} data-tip={`Amazon keeps ${formatINR(fees)} a pack`} />
        {hasCost ? (
          <>
            <i style={{ flex: Math.max(cost, 0.01), background: COST_COLOR }} data-tip={`Your cost ${formatINR(cost)} a pack`} />
            {keep > 0 && <i style={{ flex: keep, background: KEEP_COLOR }} data-tip={`You keep ${formatINR(keep)} a pack`} />}
          </>
        ) : (
          rest > 0 && <i className={s.miss} style={{ flex: rest }} />
        )}
      </div>
      <div className={s.pfS}>
        {hasCost ? (
          <>
            <span>
              {formatINR(sku.avgPrice)} a pack · Amazon {formatINR(fees)} · cost {formatINR(cost)}
            </span>
            <span className={keep < 0 ? s.badT : s.keep}>you keep {formatINR(keep)}</span>
            <span>{sku.units.toLocaleString("en-IN")} sold</span>
          </>
        ) : (
          <span>
            {formatLakh(sales)} sales · {sku.units.toLocaleString("en-IN")} sold · profit unknown until you add the cost
          </span>
        )}
      </div>
      {editing && (
        <CostEditor
          sku={sku.sku}
          onSaved={() => {
            setEditing(false);
            onCostSaved?.();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function profitTakeaway(skus: AmazonSku[]): ReactNode {
  const withProfit = skus.filter((x) => x.profit != null);
  if (withProfit.length === 0) return "Add cost prices to see profit";
  const best = withProfit.reduce((a, b) => ((b.profit ?? 0) > (a.profit ?? 0) ? b : a));
  if ((best.profit ?? 0) <= 0) return "No product made a profit in this period";
  return (
    <>
      {shortName(best.shortTitle)} makes the most, <em>{formatLakh(best.profit ?? 0)}</em>
    </>
  );
}

// ---------------------------------------------------------------- payouts

export function PayoutTag({ st }: { st: AmazonSettlement }) {
  if (st.scheduled) return <span className={`${s.tg} ${s.tgInfo}`}>Scheduled</span>;
  if (st.matched) return <span className={`${s.tg} ${s.good}`}>Matched to orders</span>;
  return (
    <span
      className={`${s.tg} ${s.warn}`}
      data-tip={`Amazon's line items add to ${formatINR(st.lineSum)} but the deposit was ${formatINR(st.deposit)}. Usually a reserve held for returns.`}
      tabIndex={0}
    >
      {formatINR(Math.abs(st.variance))} short
    </span>
  );
}

export function PayoutRow({ st }: { st: AmazonSettlement }) {
  return (
    <div className={s.py}>
      <div className={s.pyA}>
        <b>{signedINR(st.deposit)}</b>
        <span>
          {st.scheduled ? "due" : "paid"} {fmtDate(st.depositDate)}
        </span>
      </div>
      <div className={s.pyM}>
        <PayoutTag st={st} />
        <span className={s.pyS}>
          {fmtDate(st.periodStart)} to {fmtDate(st.periodEnd)} · sales {formatLakh(st.gross)}
        </span>
      </div>
    </div>
  );
}
