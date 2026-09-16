import { KpiStrip, Kpi, Card, BarChart, Table, Pill } from "@/components/pm";
import type { TableCol, BarSeries } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import type { AmazonMetrics, AmazonSettlement } from "@/lib/amazon/economics";
import { fmtDate, PERIOD_LABEL } from "../format";

export function PayoutsTab({ data }: { data: AmazonMetrics }) {
  const { payouts, settlements, period } = data;
  const deposited = [...settlements].filter((s) => !s.scheduled).sort((a, b) => (a.depositDate ?? "").localeCompare(b.depositDate ?? ""));

  const cats = deposited.map((s) => fmtDate(s.depositDate));
  // BarChart draws a single-series bar chart against a zero-based, all-positive
  // axis; it has no baseline for a negative bar. A settlement can legitimately
  // deposit a negative amount (refunds outweighing sales in that period) — floor
  // the chart's height at 0 so that rare case doesn't render a broken bar. The
  // real (possibly negative) figure is still what's labelled above the bar via
  // BarChart's `fmt`, and the table below always shows the true amount.
  const series: BarSeries[] = [{ name: "Paid out", color: "var(--pm-s-amz)", values: deposited.map((s) => Math.max(0, s.deposit)) }];

  const cols: TableCol<AmazonSettlement>[] = [
    { h: "Deposited", render: (s) => fmtDate(s.depositDate) },
    { h: "Period", render: (s) => `${fmtDate(s.periodStart)} to ${fmtDate(s.periodEnd)}` },
    { h: "Sales", num: true, render: (s) => formatINR(s.gross) },
    { h: "Amazon kept", num: true, render: (s) => `−${formatINR(s.fees)}` },
    { h: "Refunds", num: true, render: (s) => `−${formatINR(Math.abs(s.refunds))}` },
    { h: "Paid to bank", num: true, render: (s) => formatINR(s.deposit) },
    {
      h: "Check",
      render: (s) =>
        s.matched ? (
          <Pill tone="good">Matched</Pill>
        ) : (
          <Pill
            tone="warn"
            tip={`Amazon's line items add to ${formatINR(s.lineSum)} but the deposit was ${formatINR(s.deposit)}. Usually a reserve held for returns.`}
          >
            {formatINR(Math.abs(s.variance))} short
          </Pill>
        ),
    },
  ];

  return (
    <>
      <KpiStrip cols={3}>
        <Kpi label={`Paid out, ${PERIOD_LABEL[period]}`} value={formatLakh(payouts.paidOut)} sub={`${payouts.count} payouts`} />
        <Kpi label="Matched" value={`${payouts.matched} of ${settlements.length}`} sub="reconcile within ₹50" />
        <Kpi
          label="Needs a look"
          value={formatINR(payouts.needsLook)}
          sub={settlements.find((s) => !s.matched) ? `short on ${fmtDate(settlements.find((s) => !s.matched)!.depositDate)}` : "all matched"}
        />
      </KpiStrip>

      <Card title="What you kept per payout" basis="₹ deposited">
        {cats.length === 0 ? (
          <div className="pm2-empty">No payouts yet</div>
        ) : (
          <BarChart cats={cats} series={series} fmt={formatLakh} labels />
        )}
      </Card>

      <Card title="Payouts" basis="from Amazon settlement reports">
        <Table
          cols={cols}
          rows={settlements}
          rowKey={(s) => s.id}
          card={(s) => ({
            title: `${fmtDate(s.depositDate)} · ${formatINR(s.deposit)}`,
            value: s.matched ? <Pill tone="good">Matched</Pill> : <Pill tone="warn">{formatINR(Math.abs(s.variance))} short</Pill>,
            meta: `${fmtDate(s.periodStart)} to ${fmtDate(s.periodEnd)} · sales ${formatINR(s.gross)}`,
          })}
          empty="No settlements in this period"
        />
      </Card>
    </>
  );
}

export default PayoutsTab;
