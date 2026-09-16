import type { ReactNode } from "react";

// One row of the Amazon Stock tab: a coloured stripe, product name + one
// detail line (with links to the Amazon listing and Seller Central), and a
// big "days left" number (or a text label when there is no number to show:
// out of stock, no estimate, or ships-from-you/MFU). Ported from the
// prototype's .stock-row/.amz-link/.days as pm2-stock-row/pm2-amz-link.
export function StockRow({
  color,
  title,
  detail,
  asin,
  days,
  label,
  action,
}: {
  color: string;
  title: string;
  detail: string;
  asin?: string | null;
  // A number renders as the big figure; null renders `label` alone (no
  // number) — used for "No estimate" and "Ships from you".
  days: number | null;
  // Caption under the number ("days left"), or the sole line of text when
  // `days` is null, or the caption when `days` is 0 ("Out of stock").
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="pm2-stock-row">
      <i style={{ background: color }} />
      <div>
        <div className="t">{title}</div>
        <div className="m">
          <span>{detail}</span>
          {asin && (
            <a className="pm2-amz-link" href={`https://www.amazon.in/dp/${asin}`} target="_blank" rel="noopener noreferrer">
              amazon.in/dp/{asin} ↗
            </a>
          )}
          <a
            className="pm2-amz-link pm2-d-only"
            href="https://sellercentral.amazon.in/inventory"
            target="_blank"
            rel="noopener noreferrer"
          >
            Seller Central ↗
          </a>
        </div>
      </div>
      <div className="days">
        {days == null ? (
          <small>{label}</small>
        ) : (
          <>
            <b style={{ color }}>{days}</b>
            <small>{days === 0 ? label : "days left"}</small>
          </>
        )}
        {action != null && <div style={{ marginTop: 6 }}>{action}</div>}
      </div>
    </div>
  );
}

export default StockRow;
