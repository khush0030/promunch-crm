// Money formatting shared by dashboard metric cards. Two flavours:
// formatINR — full precision with Indian digit grouping (2,42,300).
// formatLakh — compact lakh/thousand notation for tight card/chart labels.

export function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Strip a trailing ".0" so whole numbers don't render as "9.0L"/"86.0k".
function stripTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatLakh(n: number): string {
  if (Math.abs(n) >= 1e5) return `₹${stripTrailingZero((n / 1e5).toFixed(1))}L`;
  if (Math.abs(n) >= 1e3) return `₹${stripTrailingZero((n / 1e3).toFixed(1))}k`;
  return `₹${Math.round(n)}`;
}

// Y-axis tick labels for money charts. Every tick shares ONE unit, chosen
// from the largest absolute tick (>= 1e5 → L, >= 1e3 → k, else whole ₹),
// with the fewest decimals (0 or 1) that keep all labels distinct.
// Zero always renders as "₹0"; a trailing ".0" is dropped.
export function formatAxisTicks(values: number[]): string[] {
  if (values.length === 0) return [];
  const top = Math.max(...values.map((v) => Math.abs(v)));
  const [div, suffix] = top >= 1e5 ? [1e5, "L"] : top >= 1e3 ? [1e3, "k"] : [1, ""];
  const render = (decimals: number) =>
    values.map((v) => {
      if (div === 1) return `${v < 0 ? "-" : ""}₹${Math.round(Math.abs(v))}`;
      const s = stripTrailingZero((Math.abs(v) / div).toFixed(decimals));
      if (s === "0") return "₹0";
      return `${v < 0 ? "-" : ""}₹${s}${suffix}`;
    });
  const whole = render(0);
  return new Set(whole).size === whole.length ? whole : render(1);
}
