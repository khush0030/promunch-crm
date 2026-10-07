import { formatLakh } from "@/lib/metrics/money";
import { sortForStock } from "@/lib/amazon/economics";
import type { AmazonMetrics } from "@/lib/amazon/economics";
import { Kpi, ChartCard } from "../../insights-ui";
import { RunwayRow, RunwayNote, stockTakeaway } from "../parts";
import s from "../../insights.module.css";

// Amazon · Stock: every product as a runway bar, worst first.
export function StockTab({ data }: { data: AmazonMetrics }) {
  const { stock } = data;
  const rows = sortForStock(data.skus);

  return (
    <>
      <div className={s.kpis}>
        <Kpi label="Out of stock" value={stock.outOfStock}>
          {stock.outOfStock === 1 ? "product" : "products"}
        </Kpi>
        <Kpi label="Under 14 days" value={stock.under14Days}>
          {stock.under14Days === 1 ? "product" : "products"}
        </Kpi>
        <Kpi label="Profit lost" value={formatLakh(stock.lostProfitPerDay)}>
          per day, right now
        </Kpi>
      </div>

      <ChartCard id="amz-stock-all" title="Stock left" basis={`${rows.length} products`} takeaway={stockTakeaway(data.skus)}>
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
