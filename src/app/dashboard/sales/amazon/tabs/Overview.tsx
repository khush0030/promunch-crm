import { PackageX } from "lucide-react";
import { MoneyFlow } from "@/components/pm";
import type { MoneyFlowRow } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import type { AmazonTabKey } from "../types";
import { PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";
import { Kpi, DeltaText, ChartCard } from "../../insights-ui";
import s from "../../insights.module.css";

// Amazon · top of the one-page view: headline tiles, a heads-up when
// something that sells is out of stock, and where the money went. Stock,
// profit, payouts and orders follow as their own sections on the same page.
export function OverviewTab({ data, onTab }: { data: AmazonMetrics; onTab: (tab: AmazonTabKey) => void }) {
  const { money, refunds, stock, skus } = data;
  const periodLabel = PERIOD_LABEL[data.period];

  const outOfStockSkus = skus.filter((x) => x.outOfStock);
  const inboundTotal = outOfStockSkus.reduce((a, x) => a + (x.inbound ?? 0), 0);

  const pct = (v: number) => (money.customersPaid ? Math.round((v / money.customersPaid) * 1000) / 10 : 0);
  const moneyRows: MoneyFlowRow[] = [
    { label: "Customers paid", value: formatINR(money.customersPaid), pct: 100, color: "var(--pm-muted)" },
    {
      label: "Amazon kept",
      value: `−${formatINR(Math.abs(money.amazonKept))}`,
      pct: pct(money.amazonKept),
      color: "var(--pm-s-amz)",
      sub: `referral ${pct(money.amazonKeptBreakdown.referral)}% · FBA shipping ${pct(money.amazonKeptBreakdown.fba)}% · closing and promos ${pct(
        money.amazonKeptBreakdown.closingOther + money.amazonKeptBreakdown.promo,
      )}%`,
    },
    { label: "You earned", value: formatINR(money.paidToYou), pct: pct(money.paidToYou), color: "var(--pm-cyan)", sub: "after Amazon's fees and refunds" },
    {
      label: "Product cost",
      value: `−${formatINR(Math.abs(money.productCost))}`,
      pct: pct(money.productCost),
      color: "var(--pm-hint)",
      sub:
        money.costCoverage < 100
          ? `from the cost prices you entered · they cover ${Math.round(money.costCoverage)}% of units sold`
          : "from the cost prices you entered",
    },
    { label: "Your profit", value: formatINR(money.profit), pct: pct(money.profit), color: "var(--pm-green)" },
  ];
  const keptShare = money.customersPaid > 0 ? Math.round((money.paidToYou / money.customersPaid) * 100) : null;


  return (
    <>
      <div className={`${s.kpis} ${s.k4}`}>
        <Kpi label="Customers paid" value={formatLakh(money.customersPaid)}>
          <DeltaText value={pctChange(money.customersPaid, money.customersPaidPrev)} /> · {data.orders.count.toLocaleString("en-IN")} orders
        </Kpi>
        <Kpi label="You earned" value={formatLakh(money.paidToYou)} title="What customers paid minus Amazon's fees and refunds. Bank deposits are under Payouts and land later.">
          <DeltaText value={pctChange(money.paidToYou, money.paidToYouPrev)} /> · after Amazon&apos;s fees
        </Kpi>
        <Kpi label="Your profit" value={formatLakh(money.profit)} title={money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}>
          <DeltaText value={pctChange(money.profit, money.profitPrev)} />
          {money.costCoverage < 100 ? ` · ${Math.round(money.costCoverage)}% of units costed` : " · after product cost"}
        </Kpi>
        <Kpi label="Profit margin" value={`${Math.round(money.marginPct)}%`} title={money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}>
          <DeltaText value={money.marginPct - money.marginPctPrev} unit="pts" /> · of sales
        </Kpi>
      </div>

      {outOfStockSkus.length > 0 && (
        <div className={s.alert}>
          <span className={s.alertIc} aria-hidden>
            <PackageX />
          </span>
          <div className={s.alertM}>
            <b>
              {outOfStockSkus.length === 1
                ? `${outOfStockSkus[0].shortTitle} is out of stock. Losing ${formatLakh(stock.lostProfitPerDay)} a day.`
                : `${outOfStockSkus.length} products are out of stock. Losing ${formatLakh(stock.lostProfitPerDay)} a day.`}
            </b>
            <span>{inboundTotal > 0 ? `${inboundTotal.toLocaleString("en-IN")} units on the way` : "Nothing on the way"}</span>
          </div>
          <button type="button" className="pm2-btn sm" onClick={() => onTab("stock")}>
            See stock
          </button>
        </div>
      )}

      <ChartCard
        id="amz-money"
        title="Where the money went"
        basis={periodLabel}
        takeaway={
          keptShare != null ? (
            <>
              You earn <em className={s.plain}>{keptShare}%</em> of what customers pay
            </>
          ) : (
            "No Amazon sales in this period"
          )
        }
      >
        <MoneyFlow rows={moneyRows} />
        <div className={s.foot}>
          <span>
            Refunds <b>{refunds.pct}%</b>
          </span>
          <span>
            {refunds.count.toLocaleString("en-IN")} refunds · {formatINR(refunds.amount)}
          </span>
        </div>
      </ChartCard>

    </>
  );
}

export default OverviewTab;
