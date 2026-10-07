// `tipValues` is optional and only feeds the hover tooltip text — useful when
// `values` had to be adjusted for the chart's geometry (e.g. floored at 0
// because the chart has no negative baseline) but the tooltip should still
// say the real number. Falls back to `values` when omitted.
export type BarSeries = { name: string; color: string; values: number[]; tipValues?: number[] };

import { niceMax, axisLabels } from "./LineChart";
import type { YFormat } from "./LineChart";

type Fmt = (v: number) => string;

const PT = 14;
const PB = 26;

// Hand-written SVG stacked bar chart. `labels` prints each bar's total above
// it (below it for a negative bar). Negative values draw below a zero line.
// `highlight` (a bar index) keeps that bar full colour and mutes the rest.
// Desktop (640 wide) and phone (360 wide, fewer category labels) SVGs are
// both rendered and swapped by CSS. A legend shows when there are 2+ series.
export function BarChart({
  cats,
  series,
  fmt,
  yFormat,
  labels = false,
  aria = "Bar chart",
  height = 200,
  highlight,
}: {
  cats: string[];
  series: BarSeries[];
  fmt?: Fmt;
  yFormat?: YFormat;
  labels?: boolean;
  aria?: string;
  height?: number;
  highlight?: number;
}) {
  return (
    <>
      <div className="pm2-chart">
        <div className="pm2-chart-d">
          <BarSvg cats={cats} series={series} fmt={fmt} yFormat={yFormat} labels={labels} aria={aria} W={640} pl={50} maxXLabels={16} h={height} highlight={highlight} />
        </div>
        <div className="pm2-chart-m">
          <BarSvg cats={cats} series={series} fmt={fmt} yFormat={yFormat} labels={labels && cats.length <= 8} aria={aria} W={360} pl={46} maxXLabels={6} h={height} highlight={highlight} />
        </div>
      </div>
      {series.length > 1 && (
        <div className="pm2-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function BarSvg({
  cats,
  series,
  fmt,
  yFormat,
  labels,
  aria,
  W,
  pl,
  maxXLabels,
  h,
  highlight,
}: {
  cats: string[];
  series: BarSeries[];
  fmt?: Fmt;
  yFormat?: YFormat;
  labels: boolean;
  aria: string;
  W: number;
  pl: number;
  maxXLabels: number;
  h: number;
  highlight?: number;
}) {
  const pr = 12;
  const f = (v: number) => (fmt ? fmt(v) : String(Math.round(v)));
  if (cats.length === 0) return null;
  const totals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  // Positive and negative parts stack away from zero separately.
  const pos = cats.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const neg = cats.map((_, i) => series.reduce((a, s) => a + Math.min(0, s.values[i] ?? 0), 0));
  const peak = Math.max(0, ...pos);
  const trough = Math.min(0, ...neg);
  const pad = labels ? 1.12 : 1.02;
  let max = peak > 0 ? niceMax(peak * pad) : 0;
  let min = trough < 0 ? -niceMax(-trough * pad) : 0;
  if (max === 0 && min === 0) max = 1;
  // Keep both sides on one step so the zero line lands on a tick.
  if (min < 0 && max > 0) {
    const stepV = Math.max(max, -min) / 2;
    max = Math.ceil(max / stepV) * stepV;
    min = -Math.ceil(-min / stepV) * stepV;
  }
  const bw = (W - pl - pr) / cats.length;
  const y = (v: number) => PT + ((max - v) / (max - min)) * (h - PT - PB);
  const ticks = [0, 1, 2, 3, 4].map((t) => min + ((max - min) / 4) * t);
  const tickText = axisLabels(ticks, yFormat, fmt);
  const step = Math.max(1, Math.ceil(cats.length / maxXLabels));
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={aria}>
      {ticks.map((v, t) => {
        return (
          <g key={`t${t}`}>
            <line className="grid" x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
            <text x={pl - 6} y={y(v) + 3.5} textAnchor="end">
              {tickText[t]}
            </text>
          </g>
        );
      })}
      {min < 0 && <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} stroke="var(--pm-muted)" strokeWidth={1} />}
      {cats.map((c, i) => {
        let up = 0;
        let down = 0;
        const muted = highlight != null && highlight !== i;
        const segs = series.map((s, si) => {
          const v = s.values[i] ?? 0;
          const from = v >= 0 ? up : down;
          const to = from + v;
          if (v >= 0) up = to;
          else down = to;
          const top = y(Math.max(from, to));
          const hgt = Math.abs(y(from) - y(to));
          return (
            <rect
              key={si}
              x={pl + i * bw + bw * 0.22}
              y={top}
              width={bw * 0.56}
              height={Math.max(hgt - (si < series.length - 1 ? 2 : 0), 0)}
              fill={s.color}
              fillOpacity={muted ? 0.3 : 1}
            />
          );
        });
        return (
          <g key={`c${i}`}>
            {segs}
            {(i % step === 0 || i === cats.length - 1) && (
              <text x={pl + i * bw + bw / 2} y={h - 8} textAnchor="middle">
                {c}
              </text>
            )}
            {labels && (
              <text className="lbl" x={pl + i * bw + bw / 2} y={totals[i] < 0 ? y(neg[i]) + 14 : y(pos[i]) - 5} textAnchor="middle">
                {f(totals[i])}
              </text>
            )}
            <rect
              className="hit"
              x={pl + i * bw}
              y={PT}
              width={bw}
              height={h - PT - PB}
              data-tip={`${c}: ${series.map((s) => `${s.name} ${f(s.tipValues?.[i] ?? s.values[i] ?? 0)}`).join(" · ")}`}
            />
          </g>
        );
      })}
    </svg>
  );
}

export default BarChart;
