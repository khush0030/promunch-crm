"use client";

import { useState } from "react";
import { Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { fmtDate } from "../format";
import { ChartCard } from "../../insights-ui";
import s from "../../insights.module.css";

type OrderRow = AmazonMetrics["orders"]["recent"][number];

function statusTone(status: string): string {
  const v = status.toLowerCase();
  if (v.includes("cancel")) return "";
  if (v.includes("pending") || v.includes("unshipped")) return s.warn;
  if (v.includes("ship")) return s.good;
  return "";
}

function Status({ status }: { status: string }) {
  return <span className={`${s.tg} ${statusTone(status)}`}>{status || "Unknown"}</span>;
}

const LIMIT = 8;

export function OrdersTab({ data }: { data: AmazonMetrics }) {
  const rows = data.orders.recent;
  const [all, setAll] = useState(false);
  const waiting = rows.filter((o) => {
    const v = o.status.toLowerCase();
    return v.includes("pending") || v.includes("unshipped");
  }).length;

  const cols: TableCol<OrderRow>[] = [
    { h: "Order", render: (o) => o.id },
    { h: "Date", render: (o) => fmtDate(o.date) },
    { h: "Status", render: (o) => <Status status={o.status} /> },
    { h: "Items", num: true, render: (o) => o.items },
    { h: "Total", num: true, render: (o) => formatINR(o.total) },
  ];

  return (
    <ChartCard
      id="amz-orders"
      title="Amazon orders"
      basis={`latest ${rows.length}`}
      takeaway={
        rows.length === 0 ? undefined : waiting > 0 ? (
          <>
            <em className={s.plain}>{waiting}</em> of the latest {rows.length} {waiting === 1 ? "is" : "are"} waiting to ship
          </>
        ) : (
          `None of the latest ${rows.length} are waiting to ship`
        )
      }
    >
      <Table
        cols={cols}
        rows={all ? rows : rows.slice(0, LIMIT)}
        rowKey={(o) => o.id}
        card={(o) => ({
          title: o.id,
          value: formatINR(o.total),
          meta: (
            <>
              {fmtDate(o.date)} · {o.items} items · <Status status={o.status} />
            </>
          ),
        })}
        empty="No orders yet"
      />
      {rows.length > LIMIT && (
          <button type="button" className={s.txtLink} style={{ marginTop: 14 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
    </ChartCard>
  );
}

export default OrdersTab;
