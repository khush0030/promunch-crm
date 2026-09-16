import { KpiStrip, Kpi, Card, StockRow } from "@/components/pm";
import { formatLakh } from "@/lib/metrics/money";
import { sortForStock } from "@/lib/amazon/economics";
import type { AmazonMetrics, AmazonSku } from "@/lib/amazon/economics";

// Worst-first stripe colour: crit = out of stock or under 7 days, warn =
// 7-21 days, good = over 21 days, line = no estimate / ships from you.
function stripeColor(s: AmazonSku): string {
  if (s.outOfStock) return "var(--pm-terra)";
  if (typeof s.daysLeft === "number") {
    if (s.daysLeft < 7) return "var(--pm-terra)";
    if (s.daysLeft <= 21) return "var(--pm-orange)";
    return "var(--pm-green)";
  }
  return "var(--pm-line)";
}

function detailLine(s: AmazonSku): string {
  const parts: string[] = [];
  parts.push(s.fulfillmentChannel === "MFN" ? "Stock not tracked by Amazon" : `${s.fulfillable ?? 0} available`);
  parts.push(`sells ${s.velocityPerDay}/day`);
  if (s.fulfillmentChannel !== "MFN") {
    parts.push(s.inbound ? `${s.inbound} on the way` : "none inbound");
  }
  return parts.join(" · ");
}

export function StockTab({ data }: { data: AmazonMetrics }) {
  const { stock } = data;
  const rows = sortForStock(data.skus);

  return (
    <>
      <KpiStrip cols={3}>
        <Kpi label="Out of stock" value={stock.outOfStock} sub={stock.outOfStock === 1 ? "product" : "products"} />
        <Kpi label="Under 14 days" value={stock.under14Days} sub={stock.under14Days === 1 ? "product" : "products"} />
        <Kpi label="Profit lost" value={formatLakh(stock.lostProfitPerDay)} sub="per day, right now" />
      </KpiStrip>

      <div className="pm2-legend" style={{ margin: 0 }}>
        <span>
          <i style={{ background: "var(--pm-terra)" }} />
          Under 7 days
        </span>
        <span>
          <i style={{ background: "var(--pm-orange)" }} />
          7 to 21
        </span>
        <span>
          <i style={{ background: "var(--pm-green)" }} />
          Over 21
        </span>
        <span style={{ color: "var(--pm-hint)" }}>from the last 30 days of sales</span>
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <div className="pm2-empty">No Amazon products yet</div>
        ) : (
          rows.map((s) => {
            const atRisk = s.outOfStock || (typeof s.daysLeft === "number" && s.daysLeft < 14);
            return (
              <StockRow
                key={s.sku}
                color={stripeColor(s)}
                title={s.shortTitle}
                detail={detailLine(s)}
                asin={s.asin}
                days={s.outOfStock ? 0 : typeof s.daysLeft === "number" ? s.daysLeft : null}
                label={s.outOfStock ? "Out of stock" : s.fulfillmentChannel === "MFN" ? "Ships from you" : s.daysLeft === null ? "No estimate" : "days left"}
                action={
                  atRisk ? (
                    <a
                      className="pm2-btn sm pri"
                      href="https://sellercentral.amazon.in/fba/sendtoamazon"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Restock
                    </a>
                  ) : undefined
                }
              />
            );
          })
        )}
      </Card>
    </>
  );
}

export default StockTab;
