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
