import { Fragment, type ReactNode } from "react";

export type MoneyFlowRow = { label: string; value: string; pct: number; color: string; sub?: ReactNode };

// "Where the money went" bars (Amazon overview): one row per step of the
// money flow (customers paid -> Amazon kept -> paid to you -> product cost
// -> your profit), each bar sized to a % of the top row. Ported from the
// prototype's moneyRow()/.money as pm2-money.
export function MoneyFlow({ rows }: { rows: MoneyFlowRow[] }) {
  return (
    <div className="pm2-money" role="img" aria-label={rows.map((r) => `${r.label} ${r.value}`).join(", ")}>
      {rows.map((r) => (
        <Fragment key={r.label}>
          <span className="k">{r.label}</span>
          <span className="bar" style={{ width: `${r.pct}%`, background: r.color }} />
          <span className="v">{r.value}</span>
          {r.sub != null && <span className="sub">{r.sub}</span>}
        </Fragment>
      ))}
    </div>
  );
}

export default MoneyFlow;
