// GTIN (EAN-13 / UPC-A / EAN-8 / GTIN-14) validation for product feeds.
//
// Shopify's variant "Barcode" field is free text, so a typo or a leftover SKU
// can end up there. Merchant Center and Meta both disapprove an item whose
// GTIN fails the GS1 check digit, which is worse than sending no GTIN at all,
// so feeds emit only values that pass this check.

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Normalise a raw barcode and return it only if it is a valid GTIN:
 * whitespace stripped, digits only, length 8/12/13/14, correct GS1 mod-10
 * check digit. Anything else returns null.
 */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, "");
  if (!/^\d+$/.test(s) || !VALID_LENGTHS.has(s.length)) return null;
  return gs1CheckDigit(s.slice(0, -1)) === Number(s[s.length - 1]) ? s : null;
}

/**
 * GS1 mod-10 check digit for the given digits (the GTIN without its last
 * digit). Weights alternate 3,1,3,1... starting from the rightmost digit.
 */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}
