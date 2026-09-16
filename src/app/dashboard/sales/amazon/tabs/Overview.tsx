import { KpiStrip, Kpi, Card, MoneyFlow, Pill, Callout } from "@/components/pm";
import type { MoneyFlowRow } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import { pctChange } from "@/lib/metrics/period";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import type { AmazonTabKey } from "../types";
import { fmtDate, PERIOD_LABEL, COST_COVERAGE_TIP } from "../format";

// Amazon · Overview: the crit stock callout (only when something with sales
// is actually out), the 4 headline KPIs, the "Where the money went" bars and
// three small facts linking into the other tabs.
export function OverviewTab({ data, onTab }: { data: AmazonMetrics; onTab: (tab: AmazonTabKey) => void }) {
  const { money, refunds, stock, payouts, skus } = data;

  const outOfStockSkus = skus.filter((s) => s.outOfStock);
  const inboundTotal = outOfStockSkus.reduce((a, s) => a + (s.inbound ?? 0), 0);

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
          ? `from the cost prices you entered · cost prices cover ${Math.round(money.costCoverage)}% of units sold`
          : "from the cost prices you entered",
    },
    { label: "Your profit", value: formatINR(money.profit), pct: pct(money.profit), color: "var(--pm-green)" },
  ];

  return (
    <>
      {outOfStockSkus.length > 0 && (
        <Callout
          tone="crit"
          title={
            outOfStockSkus.length === 1
              ? `${outOfStockSkus[0].shortTitle} is out of stock. Losing ${formatLakh(stock.lostProfitPerDay)}/day.`
              : `${outOfStockSkus.length} products are out of stock. Losing ${formatLakh(stock.lostProfitPerDay)} a day.`
          }
          body={inboundTotal > 0 ? `${inboundTotal.toLocaleString("en-IN")} units on the way` : "Nothing on the way"}
          action={
            <button type="button" className="pm2-btn sm" onClick={() => onTab("stock")}>
              Stock
            </button>
          }
        />
      )}

      <KpiStrip>
        <Kpi
          label="Customers paid"
          value={formatLakh(money.customersPaid)}
          delta={pctChange(money.customersPaid, money.customersPaidPrev)}
          sub={`${data.orders.count.toLocaleString("en-IN")} orders`}
        />
        <Kpi
          label="Paid to you"
          value={formatLakh(money.paidToYou)}
          delta={pctChange(money.paidToYou, money.paidToYouPrev)}
          sub="after Amazon's fees"
        />
        <Kpi
          label="Your profit"
          value={formatLakh(money.profit)}
          delta={pctChange(money.profit, money.profitPrev)}
          sub={money.costCoverage < 100 ? `after product cost · ${Math.round(money.costCoverage)}% of units costed` : "after product cost"}
          tip={money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}
        />
        <Kpi
          label="Profit margin"
          value={`${Math.round(money.marginPct)}%`}
          delta={Math.round(money.marginPct - money.marginPctPrev)}
          deltaUnit="pts"
          sub={money.costCoverage < 100 ? `of sales · ${Math.round(money.costCoverage)}% of units costed` : "of sales"}
          tip={money.costCoverage < 100 ? COST_COVERAGE_TIP : undefined}
        />
      </KpiStrip>

      <Card title="Where the money went" basis={PERIOD_LABEL[data.period]}>
        <MoneyFlow rows={moneyRows} />
      </Card>

      <div className="pm2-g3">
        <Card
          title="Stock"
          foot={
            <button type="button" className="pm2-lnk" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => onTab("stock")}>
              Stock →
            </button>
          }
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>{stock.atRisk}</span>
            <span style={{ color: "var(--pm-muted)", fontSize: 13 }}>
              of {stock.total} products
              <br />
              at risk
            </span>
          </div>
        </Card>

        <Card title="Refunds">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>{refunds.pct}%</span>
          </div>
          <div style={{ color: "var(--pm-muted)", fontSize: 13, marginTop: 4 }}>
            {refunds.count} refunds · {formatINR(refunds.amount)}
          </div>
        </Card>

        <Card
          title="Last payout"
          foot={
            <button type="button" className="pm2-lnk" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => onTab("payouts")}>
              Payouts →
            </button>
          }
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>
              {payouts.last ? formatLakh(payouts.last.deposit) : "—"}
            </span>
            {payouts.last && <Pill tone={payouts.last.matched ? "good" : "warn"}>{payouts.last.matched ? "Matched" : `₹${Math.round(Math.abs(payouts.last.variance)).toLocaleString("en-IN")} short`}</Pill>}
          </div>
          <div style={{ color: "var(--pm-muted)", fontSize: 13, marginTop: 4 }}>
            {payouts.last ? fmtDate(payouts.last.depositDate) : "no payouts yet"}
            {payouts.next ? ` · next ${fmtDate(payouts.next.depositDate)}` : ""}
          </div>
        </Card>
      </div>
    </>
  );
}

export default OverviewTab;
