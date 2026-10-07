"use client";

import { formatLakh, formatINR } from "@/lib/metrics/money";
import { sortForProfit } from "@/lib/amazon/economics";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";
import { Kpi, ChartCard } from "../../insights-ui";
import { ProfitKeys, ProfitRow, profitTakeaway } from "../parts";
import s from "../../insights.module.css";

// Amazon · Product profit: every product's split of each ₹ a customer pays,
// with an inline cost-price editor for products that have none yet.
export function ProfitTab({ data, onCostSaved }: { data: AmazonMetrics; onCostSaved: () => void }) {
  const rows = sortForProfit(data.skus);
  const withProfit = data.skus.filter((x) => x.profit != null);
  const missingCost = data.skus.filter((x) => x.costPerUnit == null && x.units > 0);
  const best = withProfit.length
    ? withProfit.reduce((a, b) => ((b.keepPerUnit ?? -Infinity) > (a.keepPerUnit ?? -Infinity) ? b : a))
    : null;
  const periodLabel = PERIOD_LABEL[data.period];

  return (
    <>
      <div className={s.kpis}>
        <Kpi label="Profit, all products" value={formatLakh(data.money.profit)} title={data.money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}>
          {data.money.costCoverage < 100 ? `${periodLabel} · ${Math.round(data.money.costCoverage)}% of units costed` : periodLabel}
        </Kpi>
        <Kpi label="Best per pack" value={best ? formatINR(best.keepPerUnit ?? 0) : "–"}>
          {best?.shortTitle ?? "add cost prices first"}
        </Kpi>
        <Kpi label="Missing cost price" value={missingCost.length} title="Profit can't be calculated until you enter a cost price">
          {missingCost.length === 1 ? "product that sells" : "products that sell"}
        </Kpi>
      </div>

      <ChartCard id="amz-profit-all" title="Where each ₹ of sales goes" basis={`${periodLabel} · per pack`} takeaway={profitTakeaway(data.skus)}>
        <ProfitKeys />
        {rows.length === 0 ? (
          <p className={s.empty}>No Amazon products yet</p>
        ) : (
          <div className={s.pfl}>
            {rows.map((x) => (
              <ProfitRow key={x.sku} sku={x} onCostSaved={onCostSaved} />
            ))}
          </div>
        )}
      </ChartCard>
    </>
  );
}

export default ProfitTab;
