"use client";

import { useState } from "react";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { sortForProfit } from "@/lib/amazon/economics";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";
import { ChartCard } from "../../insights-ui";
import { ProfitKeys, ProfitRow, profitTakeaway } from "../parts";
import s from "../../insights.module.css";

const LIMIT = 8;

// Amazon · Product profit: every product's split of each ₹ a customer pays,
// with an inline cost-price editor for products that have none yet.
export function ProfitTab({ data, onCostSaved }: { data: AmazonMetrics; onCostSaved: () => void }) {
  const rows = sortForProfit(data.skus);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, LIMIT);
  const withProfit = data.skus.filter((x) => x.profit != null);
  const missingCost = data.skus.filter((x) => x.costPerUnit == null && x.units > 0);
  const best = withProfit.length
    ? withProfit.reduce((a, b) => ((b.keepPerUnit ?? -Infinity) > (a.keepPerUnit ?? -Infinity) ? b : a))
    : null;
  const periodLabel = PERIOD_LABEL[data.period];

  return (
    <>
      <ChartCard id="amz-profit-all" title="Where each ₹ of sales goes" basis={`${periodLabel} · per pack`} takeaway={profitTakeaway(data.skus)}>
        <p className={s.facts2} title={data.money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}>
          <span>
            <b>{formatLakh(data.money.profit)}</b> profit, all products
            {data.money.costCoverage < 100 ? ` (${Math.round(data.money.costCoverage)}% of units costed)` : ""}
          </span>
          <span>
            Best per pack <b>{best ? formatINR(best.keepPerUnit ?? 0) : "–"}</b> {best?.shortTitle ?? "add cost prices first"}
          </span>
          <span title="Profit can't be calculated until you enter a cost price">
            <b>{missingCost.length}</b> {missingCost.length === 1 ? "product that sells has" : "products that sell have"} no cost price
          </span>
        </p>
        <ProfitKeys />
        {rows.length === 0 ? (
          <p className={s.empty}>No Amazon products yet</p>
        ) : (
          <div className={s.pfl}>
            {shown.map((x) => (
              <ProfitRow key={x.sku} sku={x} onCostSaved={onCostSaved} />
            ))}
          </div>
        )}
        {rows.length > LIMIT && (
          <button type="button" className={s.txtLink} style={{ marginTop: 14 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </ChartCard>
    </>
  );
}

export default ProfitTab;
