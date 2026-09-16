// Small date/time helpers shared by the Amazon tabs.

export const PERIOD_LABEL: Record<"7d" | "30d" | "90d", string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

// Tooltip for any profit/margin KPI when costCoverage < 100 — those figures
// only account for SKUs with a cost price entered, not every unit sold.
export const COST_COVERAGE_TIP = "Only products with a cost price entered count. Set cost prices on the Product profit tab for a full figure.";

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// "synced N min ago" caption next to the period picker.
export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}
