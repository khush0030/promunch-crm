import type { ReactNode } from "react";

export type HBarItem = {
  label: string;
  value: number;
  text: ReactNode;
  sub?: ReactNode;
  color?: string;
  tip?: string;
};

// Horizontal bars: label, track, value. On phones the label sits on its own line.
export function HBars({ items, max }: { items: HBarItem[]; max?: number }) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value));
  return (
    <div className="pm2-hb">
      {items.map((x, i) => (
        <HBarRow key={`${x.label}-${i}`} item={x} max={top} />
      ))}
    </div>
  );
}

function HBarRow({ item: x, max }: { item: HBarItem; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (x.value / max) * 100)) : 0;
  return (
    <>
      <span className="lab" title={x.label}>
        {x.label}
      </span>
      <span className="trk" data-tip={x.tip || undefined} tabIndex={x.tip ? 0 : undefined}>
        <span className="fill" style={{ width: `${pct}%`, background: x.color || "var(--pm-cyan)" }} />
      </span>
      <span className="val">
        {x.text}
        {x.sub != null && <small>{x.sub}</small>}
      </span>
    </>
  );
}

export default HBars;
