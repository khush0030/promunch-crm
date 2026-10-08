"use client";

// Small plain-SVG charts for the Reputation Overview (no chart library).
// Follows the dataviz rules: 2px lines, >= 8px end dots with a 2px surface
// ring, hairline solid axes, thin bars with a 4px rounded data end, text in
// text tokens (never the series colour), hover tooltip + a hidden table for
// screen readers. Colours come from CSS tokens (--orm-pos / --orm-neg,
// validated light + dark for colour-blind separation).

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "../reputation.module.css";

function useWidth<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) =>
      setW(Math.floor(e[0].contentRect.width)),
    );
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export type LinePoint = {
  key: string;
  label: string;
  value: number | null;
  tip: string;
};

/**
 * One-series line over time (weekly). Null values leave a gap. The last real
 * point gets an end dot + its value; hover/focus a column for the tooltip.
 */
export function LineChart({
  points,
  min,
  max,
  height = 120,
  ticks,
  format,
  ariaLabel,
  compact,
}: {
  points: LinePoint[];
  min: number;
  max: number;
  height?: number;
  ticks?: number[];
  format: (v: number) => string;
  ariaLabel: string;
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = ticks ? 28 : 4;
  const padR = compact ? 30 : 36;
  const padT = 8;
  const padB = compact ? 4 : 22;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) =>
    padT +
    plotH -
    ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * plotH;

  // path with gaps at nulls
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  const lastIdx = points.map((p) => p.value != null).lastIndexOf(true);
  // lone points (no neighbour) still need a visible mark
  const lone = points
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        p.value != null &&
        i !== lastIdx &&
        points[i - 1]?.value == null &&
        points[i + 1]?.value == null,
    );
  const colW = n ? plotW / Math.max(1, n - 1) : 0;
  const hp = hover != null ? points[hover] : null;

  return (
    <div
      ref={ref}
      className={s.chart}
      style={{ height }}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks?.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y(t)}
                y2={y(t)}
                className={s.gridLine}
              />
              <text
                x={padL - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className={s.axisText}
              >
                {t}
              </text>
            </g>
          ))}
          {!ticks && (
            <line
              x1={padL}
              x2={width - padR}
              y1={padT + plotH}
              y2={padT + plotH}
              className={s.gridLine}
            />
          )}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              className={s.crosshair}
            />
          )}
          <path d={d} className={s.line} />
          {lone.map(({ p, i }) => (
            <circle
              key={p.key}
              cx={x(i)}
              cy={y(p.value as number)}
              r={3}
              className={s.dotSmall}
            />
          ))}
          {lastIdx >= 0 && (
            <>
              <circle
                cx={x(lastIdx)}
                cy={y(points[lastIdx].value as number)}
                r={5}
                className={s.dot}
              />
              <text
                x={x(lastIdx) + 9}
                y={y(points[lastIdx].value as number)}
                dy="0.32em"
                className={s.endLabel}
              >
                {format(points[lastIdx].value as number)}
              </text>
            </>
          )}
          {hp && hp.value != null && hover !== lastIdx && (
            <circle
              cx={x(hover as number)}
              cy={y(hp.value)}
              r={4.5}
              className={s.dot}
            />
          )}
          {!compact && n > 0 && (
            <>
              <text
                x={x(0)}
                y={height - 4}
                textAnchor="start"
                className={s.axisText}
              >
                {points[0].label}
              </text>
              <text
                x={x(n - 1)}
                y={height - 4}
                textAnchor="end"
                className={s.axisText}
              >
                {points[n - 1].label}
              </text>
            </>
          )}
          {points.map((p, i) => (
            <rect
              key={p.key}
              x={x(i) - colW / 2}
              y={0}
              width={Math.max(colW, 12)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            >
              <title>{p.tip}</title>
            </rect>
          ))}
        </svg>
      )}
      {hp && width > 0 && (
        <div
          className={s.tip}
          style={{
            left: Math.min(Math.max(x(hover as number), 70), width - 70),
            top: compact ? -30 : -6,
          }}
          aria-hidden="true"
        >
          {hp.tip}
        </div>
      )}
      <SrTable
        caption={ariaLabel}
        head={["Week", "Value"]}
        rows={points.map((p) => [
          p.label,
          p.value == null ? "No data" : format(p.value),
        ])}
      />
    </div>
  );
}

/** Visually hidden table twin of a chart (screen readers, copy). */
export function SrTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className={s.srOnly}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type DivergingRow = {
  key: string;
  label: string;
  left: number;
  right: number;
  tip: string;
};

/**
 * Diverging horizontal bars on a shared zero axis: complaints grow left
 * (--orm-neg), praise grows right (--orm-pos). Counts sit at the bar ends.
 */
export function DivergingBars({
  rows,
  leftLabel,
  rightLabel,
  caption,
}: {
  rows: DivergingRow[];
  leftLabel: string;
  rightLabel: string;
  caption: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.left, r.right]));
  const pct = (v: number) => `${(v / max) * 82}%`;
  return (
    <div className={s.div}>
      <div className={s.divLegend} aria-hidden="true">
        <span className={s.divLegL}>
          <i className={s.swNeg} />
          {leftLabel}
        </span>
        <span className={s.divLegR}>
          {rightLabel}
          <i className={s.swPos} />
        </span>
      </div>
      <ul className={s.divRows} aria-hidden="true">
        {rows.map((r) => (
          <li key={r.key} className={s.divRow} title={r.tip}>
            <span className={s.divLabel}>{r.label}</span>
            <span className={s.divBars}>
              <span className={s.divHalfL}>
                {r.left > 0 && <span className={s.divCount}>{r.left}</span>}
                <span
                  className={s.barNeg}
                  style={{ width: r.left ? pct(r.left) : 0 }}
                />
              </span>
              <span className={s.divHalfR}>
                <span
                  className={s.barPos}
                  style={{ width: r.right ? pct(r.right) : 0 }}
                />
                {r.right > 0 && <span className={s.divCount}>{r.right}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <SrTable
        caption={caption}
        head={["Topic", leftLabel, rightLabel]}
        rows={rows.map((r) => [r.label, r.left, r.right])}
      />
    </div>
  );
}

/** Thin single-hue bars, value at the tip (star mix: 5 to 1 stars). */
export function MixBars({
  rows,
  caption,
}: {
  rows: { key: string; label: string; value: number; tip: string }[];
  caption: string;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <>
      <ul className={s.mix} aria-hidden="true">
        {rows.map((r) => (
          <li key={r.key} title={r.tip}>
            <span className={s.mixL}>{r.label}</span>
            <span className={s.mixTrack}>
              <span
                className={s.mixBar}
                style={{ width: r.value ? `${(r.value / max) * 100}%` : 0 }}
              />
            </span>
            <span className={s.mixV}>
              {total ? `${Math.round((r.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
      <SrTable
        caption={caption}
        head={["Stars", "Reviews"]}
        rows={rows.map((r) => [r.label, r.value])}
      />
    </>
  );
}
