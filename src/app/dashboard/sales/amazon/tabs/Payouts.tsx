import { BarChart, Table } from "@/components/pm";
import type { TableCol, BarSeries } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import type { AmazonMetrics, AmazonSettlement } from "@/lib/amazon/economics";
import { fmtDate, PERIOD_LABEL } from "../format";
import { Kpi, ChartCard, signedINR } from "../../insights-ui";
import { PayoutTag } from "../parts";
import s from "../../insights.module.css";

export function PayoutsTab({ data }: { data: AmazonMetrics }) {
  const { payouts, settlements, period } = data;
  const deposited = [...settlements].filter((x) => !x.scheduled).sort((a, b) => (a.depositDate ?? "").localeCompare(b.depositDate ?? ""));

  const cats = deposited.map((x) => fmtDate(x.depositDate));
  // A settlement can deposit a negative amount (refunds or a reserve
  // clawback outweighing sales); BarChart draws those below the zero line.
  const negCount = deposited.filter((x) => x.deposit < 0).length;
  const hasNegativeDeposit = negCount > 0;
  const series: BarSeries[] = [{ name: "Paid out", color: "var(--pm-s-amz)", values: deposited.map((x) => x.deposit) }];
  const biggest = deposited.length ? deposited.reduce((a, b) => (b.deposit > a.deposit ? b : a)) : null;
  const firstShort = settlements.find((x) => !x.matched && !x.scheduled);

  const cols: TableCol<AmazonSettlement>[] = [
    { h: "Deposited", render: (x) => fmtDate(x.depositDate) },
    { h: "Period", render: (x) => `${fmtDate(x.periodStart)} to ${fmtDate(x.periodEnd)}` },
    { h: "Sales", num: true, render: (x) => formatINR(x.gross) },
    { h: "Amazon kept", num: true, render: (x) => `−${formatINR(x.fees)}` },
    { h: "Refunds", num: true, render: (x) => `−${formatINR(Math.abs(x.refunds))}` },
    { h: "Paid to bank", num: true, render: (x) => signedINR(x.deposit) },
    { h: "Check", render: (x) => <PayoutTag st={x} /> },
  ];

  return (
    <>
      <div className={s.kpis}>
        <Kpi label={`Paid out · ${PERIOD_LABEL[period]}`} value={payouts.paidOut < 0 ? `−${formatLakh(-payouts.paidOut)}` : formatLakh(payouts.paidOut)}>
          {payouts.count} {payouts.count === 1 ? "payout" : "payouts"}
        </Kpi>
        <Kpi label="Matched" value={`${payouts.matched} of ${settlements.length}`}>
          reconcile within ₹50
        </Kpi>
        <Kpi label="Needs a look" value={formatINR(payouts.needsLook)}>
          {firstShort ? `short on ${fmtDate(firstShort.depositDate)}` : "all matched"}
        </Kpi>
      </div>

      <ChartCard
        id="amz-payout-chart"
        title="What you kept per payout"
        basis="₹ deposited"
        takeaway={
          biggest ? (
            <>
              Biggest payout <em className={s.plain}>{formatLakh(biggest.deposit)}</em> on {fmtDate(biggest.depositDate)}
            </>
          ) : undefined
        }
      >
        {cats.length === 0 ? (
          <p className={s.empty}>No payouts yet</p>
        ) : (
          <>
            <BarChart cats={cats} series={series} fmt={formatLakh} yFormat="money" labels aria="Amazon payouts per deposit" />
            {hasNegativeDeposit && (
              <p className={s.note}>{negCount === 1 ? "One payout was" : `${negCount} payouts were`} negative (refunds or a reserve clawback); those bars sit below the line.</p>
            )}
          </>
        )}
      </ChartCard>

      <ChartCard id="amz-payout-table" title="Payouts" basis="from Amazon settlement reports">
        <Table
          cols={cols}
          rows={settlements}
          rowKey={(x) => x.id}
          card={(x) => ({
            title: `${fmtDate(x.depositDate)} · ${signedINR(x.deposit)}`,
            value: <PayoutTag st={x} />,
            meta: `${fmtDate(x.periodStart)} to ${fmtDate(x.periodEnd)} · sales ${formatINR(x.gross)}`,
          })}
          empty="No settlements in this period"
        />
      </ChartCard>
    </>
  );
}

export default PayoutsTab;
