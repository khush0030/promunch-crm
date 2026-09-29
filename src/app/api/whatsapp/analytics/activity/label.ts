// "#1234" whether the stored order_number is 1234 or "#1234" (never "##1234").
export function orderLabel(n: unknown): string {
  const raw = String(n ?? "").trim().replace(/^#+/, "");
  return raw ? `#${raw}` : "";
}
