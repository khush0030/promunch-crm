export type BarSeries = { name: string; color: string; values: number[] };

import { niceMax } from "./LineChart";

type Fmt = (v: number) => string;

const PT = 14;
const PB = 26;

// Hand-written SVG stacked bar chart. `labels` prints each bar's total above
// it. Desktop (640 wide) and phone (360 wide, fewer category labels) SVGs are
// both rendered and swapped by CSS. A legend shows when there are 2+ series.
export function BarChart({
  cats,
  series,
  fmt,
  labels = false,
  aria = "Bar chart",
  height = 200,
}: {
  cats: string[];
  series: BarSeries[];
  fmt?: Fmt;
  labels?: boolean;
  aria?: string;
  height?: number;
}) {
  return (
    <>
      <div className="pm2-chart">
        <div className="pm2-chart-d">
          <BarSvg cats={cats} series={series} fmt={fmt} labels={labels} aria={aria} W={640} pl={50} maxXLabels={16} h={height} />
        </div>
        <div className="pm2-chart-m">
          <BarSvg cats={cats} series={series} fmt={fmt} labels={labels && cats.length <= 8} aria={aria} W={360} pl={46} maxXLabels={6} h={height} />
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
  labels,
  aria,
  W,
  pl,
  maxXLabels,
  h,
}: {
  cats: string[];
  series: BarSeries[];
  fmt?: Fmt;
  labels: boolean;
  aria: string;
  W: number;
  pl: number;
  maxXLabels: number;
  h: number;
}) {
  const pr = 12;
  const f = (v: number) => (fmt ? fmt(v) : String(Math.round(v)));
  if (cats.length === 0) return null;
  const totals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const peak = Math.max(0, ...totals);
  const max = niceMax(peak * (labels ? 1.12 : 1.02));
  const bw = (W - pl - pr) / cats.length;
  const y = (v: number) => PT + (1 - v / max) * (h - PT - PB);
  const step = Math.max(1, Math.ceil(cats.length / maxXLabels));
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={aria}>
      {[0, 1, 2, 3, 4].map((t) => {
        const v = (max / 4) * t;
        return (
          <g key={`t${t}`}>
            <line className="grid" x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
            <text x={pl - 6} y={y(v) + 3.5} textAnchor="end">
              {f(v)}
            </text>
          </g>
        );
      })}
      {cats.map((c, i) => {
        let acc = 0;
        const segs = series.map((s, si) => {
          const v = s.values[i] ?? 0;
          const top = y(acc + v);
          const hgt = y(acc) - top;
          acc += v;
          return (
            <rect key={si} x={pl + i * bw + bw * 0.22} y={top} width={bw * 0.56} height={Math.max(hgt - (si < series.length - 1 ? 2 : 0), 0)} fill={s.color} />
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
              <text className="lbl" x={pl + i * bw + bw / 2} y={y(totals[i]) - 5} textAnchor="middle">
                {f(totals[i])}
              </text>
            )}
            <rect
              className="hit"
              x={pl + i * bw}
              y={PT}
              width={bw}
              height={h - PT - PB}
              data-tip={`${c}: ${series.map((s) => `${s.name} ${f(s.values[i] ?? 0)}`).join(" · ")}`}
            />
          </g>
        );
      })}
    </svg>
  );
}

export default BarChart;
