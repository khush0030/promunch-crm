import type { ReactNode } from "react";

export type KpiTone = "g" | "o" | "t" | "b";

const STROKE: Record<KpiTone, string> = {
  g: "var(--pm-green)",
  o: "var(--pm-gold)",
  t: "var(--pm-terra)",
  b: "var(--pm-blue)",
};

// Decorative sparkline matching the prototype. Points are a fixed gentle shape;
// direction follows the delta so it reads as up/down without implying a series.
function Spark({ tone, dir }: { tone: KpiTone; dir: "up" | "down" | "flat" }) {
  const points =
    dir === "down"
      ? "0,8 11,10 23,9 34,12 46,13 57,15 68,16 80,18"
      : dir === "flat"
      ? "0,16 11,15 23,16 34,14 46,15 57,14 68,15 80,14"
      : "0,22 11,20 23,21 34,16 46,17 57,11 68,9 80,5";
  return (
    <svg className="spark" viewBox="0 0 80 28" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={STROKE[tone]} strokeWidth="2" />
    </svg>
  );
}

// KPI tile: label + icon chip, big value, optional delta + sub + sparkline.
export function KpiCard({
  label,
  value,
  icon,
  tone = "g",
  delta,
  deltaDir = "up",
  sub,
  spark = false,
  valueColor,
  valueStyle,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
  delta?: ReactNode;
  deltaDir?: "up" | "down" | "flat";
  sub?: ReactNode;
  spark?: boolean;
  valueColor?: string;
  valueStyle?: React.CSSProperties;
}) {
  const hasFooter = delta != null || sub != null || spark;
  return (
    <div className="pm-kpi">
      <div className="top">
        <span className="lab">{label}</span>
        {icon != null && <span className={`ic pm-ic-${tone}`}>{icon}</span>}
      </div>
      <div className="num" style={{ color: valueColor, ...valueStyle }}>
        {value}
      </div>
      {hasFooter && (
        <div className="row2">
          <div>
            {delta != null && (
              <div className={`delta ${deltaDir}`}>{delta}</div>
            )}
            {sub != null && <div className="sub">{sub}</div>}
          </div>
          {spark && <Spark tone={tone} dir={deltaDir} />}
        </div>
      )}
    </div>
  );
}

export default KpiCard;
