// Conic-gradient coverage donut. `done` (green) + `bad` (terra) + remainder
// (neutral, ineligible). Values are percentages 0–100; remainder is implied.
export function Ring({
  done,
  bad = 0,
  label,
  value,
}: {
  done: number;
  bad?: number;
  label?: string;
  value?: string;
}) {
  const a = Math.max(0, Math.min(100, done));
  const b = Math.max(0, Math.min(100 - a, bad));
  const background = `conic-gradient(var(--pm-green) 0 ${a}%, var(--pm-terra) ${a}% ${a + b}%, var(--pm-border) ${a + b}% 100%)`;
  return (
    <div className="pm-ring" style={{ background }}>
      <div className="in">
        <b>{value ?? `${Math.round(a)}%`}</b>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
}

export default Ring;
