// Pure parsing for coupon codes pasted into the Coupons tab.

export function parseCouponCodes(raw: string): { codes: string[]; invalid: string[]; duplicates: number } {
  const tokens = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;
  for (const t of tokens) {
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(t)) {
      invalid.push(t);
      continue;
    }
    const k = t.toUpperCase();
    if (seen.has(k)) duplicates += 1;
    else seen.add(k);
  }
  return { codes: [...seen], invalid, duplicates };
}
