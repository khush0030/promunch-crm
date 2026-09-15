import type { ReactNode } from "react";
import { Delta } from "./Delta";

// Joined strip of headline numbers. Use 4 (default) or 3 columns; on phones
// it reflows to two-up. No sparklines: the number, the change, one sub line.
export function KpiStrip({ cols = 4, children }: { cols?: 4 | 3; children: ReactNode }) {
  return <div className={`pm2-kpis${cols === 3 ? " k3" : ""}`}>{children}</div>;
}

export function Kpi({
  label,
  value,
  delta = null,
  sub,
  tip,
  deltaTip,
  invert,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: number | null;
  sub?: ReactNode;
  tip?: string;
  deltaTip?: string;
  invert?: boolean;
}) {
  return (
    <div className="pm2-kpi" data-tip={tip || undefined} tabIndex={tip ? 0 : undefined}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      <div className="s">
        <Delta value={delta} tip={deltaTip} invert={invert} />
        {sub != null && <span>{sub}</span>}
      </div>
    </div>
  );
}
