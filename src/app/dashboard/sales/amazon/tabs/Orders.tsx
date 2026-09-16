import { Card, Table, Pill } from "@/components/pm";
import type { TableCol, PillTone } from "@/components/pm";
import { formatINR } from "@/lib/metrics/money";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { fmtDate } from "../format";

type OrderRow = AmazonMetrics["orders"]["recent"][number];

function statusTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s.includes("cancel")) return "crit";
  if (s.includes("pending") || s.includes("unshipped")) return "warn";
  if (s.includes("ship")) return "good";
  return "neu";
}

export function OrdersTab({ data }: { data: AmazonMetrics }) {
  const cols: TableCol<OrderRow>[] = [
    { h: "Order", render: (o) => o.id },
    { h: "Date", render: (o) => fmtDate(o.date) },
    { h: "Status", render: (o) => <Pill tone={statusTone(o.status)}>{o.status || "Unknown"}</Pill> },
    { h: "Items", num: true, render: (o) => o.items },
    { h: "Total", num: true, render: (o) => formatINR(o.total) },
  ];

  return (
    <Card title="Orders" basis="latest 50">
      <Table
        cols={cols}
        rows={data.orders.recent}
        rowKey={(o) => o.id}
        card={(o) => ({
          title: o.id,
          value: formatINR(o.total),
          meta: (
            <>
              {fmtDate(o.date)} · {o.items} items · <Pill tone={statusTone(o.status)}>{o.status || "Unknown"}</Pill>
            </>
          ),
        })}
        empty="No orders yet"
      />
    </Card>
  );
}

export default OrdersTab;
