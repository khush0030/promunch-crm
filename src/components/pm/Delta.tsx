// Period-over-period change chip. null renders nothing; 0 renders "±0%".
// Positive is good (green) unless `invert` is set (e.g. costs, where up is bad).
export const DELTA_TIP = "Change vs the previous period of the same length";

export function Delta({
  value,
  tip = DELTA_TIP,
  invert = false,
  unit = "%",
}: {
  value: number | null;
  tip?: string;
  invert?: boolean;
  // "%" for a percent change (e.g. revenue); "pts" for a change already
  // expressed in percentage points (e.g. a repeat-buyer rate), where the
  // number itself must not be re-read as a percent of a percent.
  unit?: "%" | "pts";
}) {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  let tone: "good" | "bad" | "flat" = "flat";
  if (rounded > 0) tone = invert ? "bad" : "good";
  if (rounded < 0) tone = invert ? "good" : "bad";
  const unitText = unit === "%" ? "%" : " pts";
  const text = rounded === 0 ? `±0${unitText}` : `${rounded > 0 ? "▲" : "▼"} ${Math.abs(rounded)}${unitText}`;
  return (
    <span className={`pm2-dl ${tone}`} data-tip={tip || undefined} tabIndex={tip ? 0 : undefined}>
      {text}
    </span>
  );
}

export default Delta;
