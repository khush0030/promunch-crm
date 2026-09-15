export type LineSeries = { name: string; color: string; values: number[]; dash?: boolean };

type Fmt = (v: number) => string;

// Round the axis top up to 4 even steps of a round multiple of 10^k so tick
// labels read as round numbers.
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const raw = v / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((c) => c >= raw) ?? 10 * mag;
  return step * 4;
}

const H = 220;
const PT = 14;
const PB = 26;

// Hand-written SVG line chart. The last point of each series is labelled
// directly (no legend lookup). Two SVGs are rendered: a 640-wide one for
// desktop and a 360-wide one with fewer x labels for phones, swapped by CSS
// so axis text stays legible at phone width. Hover a column for the values.
export function LineChart({
  series,
  labels,
  fmt,
  aria,
  height = H,
}: {
  series: LineSeries[];
  labels: string[];
  fmt?: Fmt;
  aria: string;
  height?: number;
}) {
  return (
    <div className="pm2-chart">
      <div className="pm2-chart-d">
        <LineSvg series={series} labels={labels} fmt={fmt} aria={aria} W={640} pl={50} pr={116} maxXLabels={6} h={height} />
      </div>
      <div className="pm2-chart-m">
        <LineSvg series={series} labels={labels} fmt={fmt} aria={aria} W={360} pl={46} pr={108} maxXLabels={3} h={height} />
      </div>
    </div>
  );
}

function LineSvg({
  series,
  labels,
  fmt,
  aria,
  W,
  pl,
  pr,
  maxXLabels,
  h,
}: {
  series: LineSeries[];
  labels: string[];
  fmt?: Fmt;
  aria: string;
  W: number;
  pl: number;
  pr: number;
  maxXLabels: number;
  h: number;
}) {
  const f = (v: number) => (fmt ? fmt(v) : String(Math.round(v)));
  const n = Math.max(labels.length, ...series.map((s) => s.values.length));
  if (n === 0) return null;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)) * 1.05);
  const plotW = W - pl - pr;
  const x = (i: number) => pl + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PT + (1 - v / max) * (h - PT - PB);
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  const step = Math.max(1, Math.ceil(n / maxXLabels));

  // End labels: place at the last point, then push apart so they never overlap.
  const ends = series
    .map((s, idx) => {
      const last = s.values[s.values.length - 1] ?? 0;
      return { idx, s, last, ly: y(last) + 4 };
    })
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].ly - ends[i - 1].ly < 15) ends[i].ly = ends[i - 1].ly + 15;
  }

  const colW = plotW / n;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={aria}>
      {ticks.map((v, t) => (
        <g key={`t${t}`}>
          <line className="grid" x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
          <text x={pl - 6} y={y(v) + 3.5} textAnchor="end">
            {f(v)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        (i % step === 0 && (i === 0 || n - 1 - i >= step * 0.9)) || i === n - 1 ? (
          <text key={`x${i}`} x={x(i)} y={h - 8} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"}>
            {l}
          </text>
        ) : null,
      )}
      {series.map((s, si) => {
        const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
        const lastI = s.values.length - 1;
        return (
          <g key={`s${si}`}>
            <path
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dash ? 1.5 : 2}
              strokeDasharray={s.dash ? "4 4" : undefined}
              strokeLinejoin="round"
            />
            {!s.dash && lastI >= 0 && (
              <circle cx={x(lastI)} cy={y(s.values[lastI])} r={3.5} fill={s.color} stroke="var(--pm-card)" strokeWidth={2} />
            )}
          </g>
        );
      })}
      {ends.map(({ idx, s, last, ly }) => (
        <text key={`e${idx}`} className="lbl" x={W - pr + 8} y={ly} style={s.dash ? { fill: "var(--pm-hint)" } : undefined}>
          {s.name}
          {s.dash ? "" : ` ${f(last)}`}
        </text>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={`h${i}`}
          className="hit"
          x={x(i) - colW / 2}
          y={PT}
          width={colW}
          height={h - PT - PB}
          data-tip={`${labels[i] ?? ""}: ${series.map((s) => `${s.name} ${s.values[i] == null ? "n/a" : f(s.values[i])}`).join(" · ")}`}
        />
      ))}
    </svg>
  );
}

export default LineChart;
