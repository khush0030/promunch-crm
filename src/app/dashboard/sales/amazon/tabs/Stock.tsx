import { formatLakh } from "@/lib/metrics/money";
import { sortForStock } from "@/lib/amazon/economics";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { ChartCard } from "../../insights-ui";
import { RunwayRow, RunwayNote, stockTakeaway } from "../parts";
import s from "../../insights.module.css";

// Amazon · Stock section: every product as a runway bar, worst first.
export function StockTab({ data }: { data: AmazonMetrics }) {
  const { stock } = data;
  const rows = sortForStock(data.skus);

  return (
    <>
      <ChartCard id="amz-stock-all" title="Stock left" basis={`${rows.length} products · at today's selling speed`} takeaway={stockTakeaway(data.skus)}>
        <p className={s.facts2}>
          <span>
            <b>{stock.outOfStock}</b> out of stock
          </span>
          <span>
            <b>{stock.under14Days}</b> under 14 days
          </span>
          <span>
            <b>{formatLakh(stock.lostProfitPerDay)}</b> profit lost per day, right now
          </span>
        </p>
        <div className={s.keys} style={{ marginTop: 0, marginBottom: 12 }}>
          <span>
            <i style={{ background: "var(--pm-terra)" }} />
            Under 7 days
          </span>
          <span>
            <i style={{ background: "#D99A00" }} />7 to 21
          </span>
          <span>
            <i style={{ background: "#7DB68D" }} />
            Over 21
          </span>
        </div>
        {rows.length === 0 ? (
          <p className={s.empty}>No Amazon products yet</p>
        ) : (
          <div className={s.runway}>
            {rows.map((x) => (
              <RunwayRow key={x.sku} sku={x} links />
            ))}
          </div>
        )}
        <RunwayNote />
      </ChartCard>
    </>
  );
}

export default StockTab;
