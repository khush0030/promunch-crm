// Pure helper for the Amazon ASIN suggestion in Reputation settings (unit-tested).
import type { AsinSuggestion } from "./types";

/**
 * Pure: sum units per ASIN, top 10 by units. Only PROMUNCH listings count:
 * the same Amazon seller account also sells the sister brand Vama (soya
 * mince, flour, chunks), which brand monitoring must not track.
 */
export function topAsins(
  rows: { asin: string | null; title: string | null; quantity_ordered: number | null }[],
  n = 10,
): AsinSuggestion[] {
  const m = new Map<string, AsinSuggestion>();
  for (const r of rows) {
    const asin = (r.asin ?? "").trim().toUpperCase();
    if (!asin) continue;
    const cur = m.get(asin) ?? { asin, title: r.title ?? null, units: 0 };
    cur.units += Number(r.quantity_ordered ?? 0) || 0;
    if (!cur.title && r.title) cur.title = r.title;
    m.set(asin, cur);
  }
  return [...m.values()]
    .filter((a) => /promunch/i.test(a.title ?? ""))
    .sort((a, b) => b.units - a.units || a.asin.localeCompare(b.asin)).slice(0, n);
}

