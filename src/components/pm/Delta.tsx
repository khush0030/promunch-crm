// Period-over-period change chip. null renders nothing; 0 renders "±0%".
// Positive is good (green) unless `invert` is set (e.g. costs, where up is bad).
export const DELTA_TIP = "Change vs the previous period of the same length";

export function Delta({
  value,
  tip = DELTA_TIP,
  invert = false,
}: {
  value: number | null;
  tip?: string;
  invert?: boolean;
}) {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  let tone: "good" | "bad" | "flat" = "flat";
  if (rounded > 0) tone = invert ? "bad" : "good";
  if (rounded < 0) tone = invert ? "good" : "bad";
  const text = rounded === 0 ? "±0%" : `${rounded > 0 ? "▲" : "▼"} ${Math.abs(rounded)}%`;
  return (
    <span className={`pm2-dl ${tone}`} data-tip={tip || undefined} tabIndex={tip ? 0 : undefined}>
      {text}
    </span>
  );
}

export default Delta;
