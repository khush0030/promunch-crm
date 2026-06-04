// Shared config for Shopify -> WhatsApp automated journeys.
// Used by shopify-wa (enrolment) and wa-journey-tick (delivery).

export const SITE_URL = Deno.env.get("PROMUNCH_SITE_URL") ?? "https://promunch.in";
// NOTE: /pages/reviews 404s. The real write-a-review page is /pages/review-submission
// (verified live). Override per-store with PROMUNCH_REVIEW_URL.
export const REVIEW_URL = Deno.env.get("PROMUNCH_REVIEW_URL") ?? `${SITE_URL}/pages/review-submission`;

// Timed journeys: journey_key -> approved template + delay from enrolment.
// Event-driven messages (order_confirmation, shipping_update) are NOT here —
// shopify-wa sends those immediately.
export const TIMED_JOURNEYS: Record<string, { template: string; language: string; delayHours: number }> = {
  abandoned_checkout:     { template: "abandoned_cart_recovery", language: "en", delayHours: 4 },
  review_request:         { template: "review_request",         language: "en", delayHours: 24 * 7 },  // 7d: delivery takes ~6d, never ask before it arrives
  replenishment_reminder: { template: "replenishment_reminder", language: "en", delayHours: 24 * 30 },
};

// Normalise a raw phone string to a Meta wa_id (digits only, India default).
// Returns null when the input cannot be a valid number.
export function toWaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);   // strip trunk 0
  if (d.length === 10) d = "91" + d;                          // bare Indian mobile
  if (d.length < 11 || d.length > 15) return null;            // implausible
  return d;
}

// First usable name from a Shopify customer/address-ish object.
export function firstName(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t) return t.split(/\s+/)[0];
  }
  return "there";
}
