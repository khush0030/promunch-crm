"use client";
import { useId } from "react";

export type Series = { label: string; color: string; points: number[] };

// Soft-fill multi-series area chart, hand-rolled SVG to match the repo's chart
// style (no chart lib). Y auto-scales to the max across series; X is evenly
// spaced. `fmtY` formats axis ticks (e.g. ₹…k).
export function AreaChart({
  series,
  height = 228,
  fmtY = (n) => String(n),
}: {
  series: Series[];
  height?: number;
  fmtY?: (n: number) => string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const W = 600;
  const H = height;
  const padL = 44;
  const padB = 22;
  const padT = 10;
  const padR = 6;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <div className="pm-chartbox" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--pm-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="11" fill="var(--pm-hint)">
              {fmtY(g)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const line = s.points.map((p, i) => `${x(i)},${y(p)}`).join(" ");
          const area = `${padL},${y(0)} ${line} ${x(s.points.length - 1)},${y(0)}`;
          return (
            <g key={si}>
              <defs>
                <linearGradient id={`${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={area} fill={`url(#${uid}-${si})`} />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type Segment = { label: string; value: number; color: string };

// Conic-gradient donut with a centred total. Segments render in order.
export function ChannelDonut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Segment[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const stops = segments
    .map((sg, i) => {
      const before = segments.slice(0, i).reduce((s, x) => s + x.value, 0);
      const start = (before / total) * 100;
      const end = ((before + sg.value) / total) * 100;
      return `${sg.color} ${start}% ${end}%`;
    })
    .join(", ");
  return (
    <div className="pm-donutwrap">
      <div className="pm-donutbox">
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: `conic-gradient(${stops})`,
            WebkitMask: "radial-gradient(circle 56px at center, transparent 98%, #000 100%)",
            mask: "radial-gradient(circle 56px at center, transparent 98%, #000 100%)",
          }}
        />
        <div className="pm-donutctr">
          <b>{centerValue}</b>
          <span>{centerLabel}</span>
        </div>
      </div>
    </div>
  );
}
