"use client";

import { useState } from "react";
import { BarChart, Table } from "@/components/pm";
import type { TableCol, BarSeries } from "@/components/pm";
import { formatLakh, formatINR } from "@/lib/metrics/money";
import type { AmazonMetrics, AmazonSettlement } from "@/lib/amazon/economics";
import { fmtDate, PERIOD_LABEL } from "../format";
import { ChartCard, signedINR } from "../../insights-ui";
import { PayoutTag } from "../parts";
import s from "../../insights.module.css";

const LIMIT = 6;

export function PayoutsTab({ data }: { data: AmazonMetrics }) {
  const { payouts, settlements, period } = data;
  const [all, setAll] = useState(false);
  const shownRows = all ? settlements : settlements.slice(0, LIMIT);
  const deposited = [...settlements].filter((x) => !x.scheduled).sort((a, b) => (a.depositDate ?? "").localeCompare(b.depositDate ?? ""));

  const cats = deposited.map((x) => fmtDate(x.depositDate));
  // A settlement can deposit a negative amount (refunds or a reserve
  // clawback outweighing sales); BarChart draws those below the zero line.
  const negCount = deposited.filter((x) => x.deposit < 0).length;
  const hasNegativeDeposit = negCount > 0;
  const series: BarSeries[] = [{ name: "Settled to bank", color: "var(--pm-s-amz)", values: deposited.map((x) => x.deposit) }];
  const biggest = deposited.length ? deposited.reduce((a, b) => (b.deposit > a.deposit ? b : a)) : null;
  const firstShort = settlements.find((x) => !x.matched && !x.scheduled);
  // Match check only counts payouts that already reached the bank; a
  // scheduled one has not happened yet, so it is shown separately.
  const matchedDone = deposited.filter((x) => x.matched).length;
  const scheduledCount = settlements.length - deposited.length;
  const needsLook = deposited.filter((x) => !x.matched).reduce((a, x) => a + Math.abs(x.variance), 0);

  const cols: TableCol<AmazonSettlement>[] = [
    { h: "Deposited", render: (x) => fmtDate(x.depositDate) },
    { h: "Period", render: (x) => `${fmtDate(x.periodStart)} to ${fmtDate(x.periodEnd)}` },
    { h: "Sales", num: true, render: (x) => formatINR(x.gross) },
    { h: "Amazon kept", num: true, render: (x) => `−${formatINR(Math.abs(x.fees))}` },
    { h: "Refunds", num: true, render: (x) => `−${formatINR(Math.abs(x.refunds))}` },
    { h: "Paid to bank", num: true, render: (x) => signedINR(x.deposit) },
    { h: "Check", render: (x) => <PayoutTag st={x} /> },
  ];

  return (
    <>
      <ChartCard
        id="amz-payout-chart"
        title="Settled to your bank"
        basis="₹ per settlement"
        takeaway={
          biggest ? (
            <>
              Biggest settlement <em className={s.plain}>{formatLakh(biggest.deposit)}</em> on {fmtDate(biggest.depositDate)}
            </>
          ) : undefined
        }
      >
        <p className={s.facts2}>
          <span>
            Settled to your bank <b>{payouts.paidOut < 0 ? `−${formatLakh(-payouts.paidOut)}` : formatLakh(payouts.paidOut)}</b> in {PERIOD_LABEL[period]} ·{" "}
            {payouts.count} {payouts.count === 1 ? "payout" : "payouts"}
          </span>
          <span>
            <b>
              {matchedDone} of {deposited.length}
            </b>{" "}
            matched (within ₹50){scheduledCount > 0 ? ` · ${scheduledCount} scheduled` : ""}
          </span>
          <span>
            Needs a look <b>{formatINR(needsLook)}</b> {firstShort ? `short on ${fmtDate(firstShort.depositDate)}` : "all matched"}
          </span>
        </p>
        <p className={s.note}>
          {payouts.paidOut < 0
            ? "Amazon took back more than it paid in these settlements (refunds or a reserve held for returns), so the total is below zero. "
            : ""}
          This is money that actually reached your bank. &ldquo;You earned&rdquo; above counts each sale when it happens, so the two differ.
        </p>
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

      <ChartCard id="amz-payout-table" title="Every payout" basis="from Amazon settlement reports">
        <Table
          cols={cols}
          rows={shownRows}
          rowKey={(x) => x.id}
          card={(x) => ({
            title: `${fmtDate(x.depositDate)} · ${signedINR(x.deposit)}`,
            value: <PayoutTag st={x} />,
            meta: `${fmtDate(x.periodStart)} to ${fmtDate(x.periodEnd)} · sales ${formatINR(x.gross)}`,
          })}
          empty="No settlements in this period"
        />
        {settlements.length > LIMIT && (
          <button type="button" className={s.txtLink} style={{ marginTop: 14 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${settlements.length}`}
          </button>
        )}
      </ChartCard>
    </>
  );
}

export default PayoutsTab;
