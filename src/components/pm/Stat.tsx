import type { ReactNode } from "react";

export type StatItem = { n: ReactNode; l: ReactNode; color?: string };

// 3-up (or n-up) inline stat block — big number over a small label.
export function StatLine({ items }: { items: StatItem[] }) {
  return (
    <div className="pm-statline">
      {items.map((s, i) => (
        <div className="pm-stat" key={i}>
          <div className="n" style={{ color: s.color }}>{s.n}</div>
          <div className="l">{s.l}</div>
        </div>
      ))}
    </div>
  );
}

export default StatLine;
