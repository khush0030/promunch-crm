import type { ReactNode } from "react";

// Horizontal labelled progress bar. `pct` 0–100 drives the fill width; `color`
// is a token (defaults to green).
export function MiniBar({
  label,
  value,
  pct,
  color = "var(--pm-green)",
  valueColor,
  style,
}: {
  label: ReactNode;
  value: ReactNode;
  pct: number;
  color?: string;
  valueColor?: string;
  style?: React.CSSProperties;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="pm-mbar" style={style}>
      <div className="t">
        <span className="k">{label}</span>
        <span className="v" style={{ color: valueColor }}>{value}</span>
      </div>
      <div className="track">
        <span className="fill" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export default MiniBar;
