import { ArrowRight, PackageX } from "lucide-react";
import { MoneyFlow } from "@/components/pm";
import type { MoneyFlowRow } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import { sortForProfit, sortForStock } from "@/lib/amazon/economics";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import type { AmazonTabKey } from "../types";
import { PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";
import { Kpi, DeltaText, ChartCard, signedINR } from "../../insights-ui";
import { RunwayRow, RunwayNote, stockTakeaway, ProfitKeys, ProfitRow, profitTakeaway, PayoutRow } from "../parts";
import s from "../../insights.module.css";

const OVERVIEW_ROWS = 5;

// Amazon · Overview, the one-page view: headline numbers, a heads-up when
// something that sells is out of stock, where the money went, stock runway,
// profit split and payouts. Each block links to its full tab.
export function OverviewTab({ data, onTab }: { data: AmazonMetrics; onTab: (tab: AmazonTabKey) => void }) {
  const { money, refunds, stock, payouts, skus, settlements } = data;
  const periodLabel = PERIOD_LABEL[data.period];

  const outOfStockSkus = skus.filter((x) => x.outOfStock);
  const inboundTotal = outOfStockSkus.reduce((a, x) => a + (x.inbound ?? 0), 0);

  const pct = (v: number) => (money.customersPaid ? Math.round((v / money.customersPaid) * 1000) / 10 : 0);
  const moneyRows: MoneyFlowRow[] = [
    { label: "Customers paid", value: formatINR(money.customersPaid), pct: 100, color: "var(--pm-muted)" },
    {
      label: "Amazon kept",
      value: `−${formatINR(money.amazonKept)}`,
      pct: pct(money.amazonKept),
      color: "var(--pm-s-amz)",
      sub: `referral ${pct(money.amazonKeptBreakdown.referral)}% · FBA shipping ${pct(money.amazonKeptBreakdown.fba)}% · closing and promos ${pct(
        money.amazonKeptBreakdown.closingOther + money.amazonKeptBreakdown.promo,
      )}%`,
    },
    { label: "Paid to you", value: formatINR(money.paidToYou), pct: pct(money.paidToYou), color: "var(--pm-cyan)" },
    {
      label: "Product cost",
      value: `−${formatINR(money.productCost)}`,
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

  const stockRows = sortForStock(skus).slice(0, OVERVIEW_ROWS);
  const profitRows = sortForProfit(skus).slice(0, OVERVIEW_ROWS);
  const recentPayouts = [...settlements]
    .sort((a, b) => (b.depositDate ?? "").localeCompare(a.depositDate ?? ""))
    .slice(0, 3);

  const tabLink = (tab: AmazonTabKey, label: string) => (
    <button type="button" className={s.txtLink} onClick={() => onTab(tab)}>
      {label}
      <ArrowRight />
    </button>
  );

  return (
    <>
      <div className={`${s.kpis} ${s.k4}`}>
        <Kpi label="Customers paid" value={formatLakh(money.customersPaid)}>
          <DeltaText value={pctChange(money.customersPaid, money.customersPaidPrev)} /> · {data.orders.count.toLocaleString("en-IN")} orders
        </Kpi>
        <Kpi label="Paid to you" value={formatLakh(money.paidToYou)} red>
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
              Amazon pays you <em className={s.plain}>{keptShare}%</em> of what customers pay
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

      <div className={s.g2}>
        <ChartCard
          id="amz-stock"
          title="Stock left"
          right={tabLink("stock", `All ${stock.total}`)}
          takeaway={stockTakeaway(skus)}
        >
          {stockRows.length === 0 ? (
            <p className={s.empty}>No Amazon products yet</p>
          ) : (
            <div className={s.runway}>
              {stockRows.map((x) => (
                <RunwayRow key={x.sku} sku={x} />
              ))}
            </div>
          )}
          <RunwayNote />
        </ChartCard>

        <ChartCard
          id="amz-profit"
          title="Where each ₹ of sales goes"
          right={tabLink("profit", "All products")}
          takeaway={profitTakeaway(skus)}
        >
          <ProfitKeys />
          {profitRows.length === 0 ? (
            <p className={s.empty}>No Amazon products yet</p>
          ) : (
            <div className={s.pfl}>
              {profitRows.map((x) => (
                <ProfitRow key={x.sku} sku={x} onAddCost={() => onTab("profit")} />
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        id="amz-payouts"
        title="Payouts"
        right={tabLink("payouts", "All payouts")}
        takeaway={
          payouts.count > 0 && payouts.paidOut < 0 ? (
            <>
              Payouts net to <em className={s.neg}>{signedINR(payouts.paidOut)}</em> across {payouts.count}{" "}
              {payouts.count === 1 ? "payout" : "payouts"}
            </>
          ) : payouts.count > 0 ? (
            <>
              Amazon paid out <em className={s.plain}>{formatLakh(payouts.paidOut)}</em> in {payouts.count}{" "}
              {payouts.count === 1 ? "payout" : "payouts"}
            </>
          ) : (
            "No payouts in this period yet"
          )
        }
      >
        {recentPayouts.length === 0 ? (
          <p className={s.empty}>No settlements in this period</p>
        ) : (
          <div className={s.pay}>
            {recentPayouts.map((st) => (
              <PayoutRow key={st.id} st={st} />
            ))}
          </div>
        )}
      </ChartCard>
    </>
  );
}

export default OverviewTab;
