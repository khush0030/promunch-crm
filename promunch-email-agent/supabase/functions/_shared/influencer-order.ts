// Influencer kit orders (owner-approved Oct 7 2026).
//
// The influencer tracker ships barter kits as Shopify ₹0 orders tagged
// "Influencer" + "influencer:<handle>" (src/lib/influencers/shopify-dispatch.ts).
// Those orders are gifts, not purchases, so they:
//   * SKIP every WhatsApp + email automation (order confirmation, sweep,
//     review / replenishment / custom journeys, order_placed email flows,
//     abandoned-cart conversion, order_fulfilled custom flows),
//   * are still stored in shopify_orders, with is_creator = true so revenue,
//     RFM, warm audience, Brevo and analytics exclude them like HYPD seeds,
//   * tag the buyer's CRM contact "influencer" + "creator" and store the
//     Instagram link in contacts.properties.instagram_url.
// The built-in Shopify shipping-update WhatsApp (tracking link) is NOT skipped:
// the creator still gets told the kit shipped.
//
// Pure helpers only (no Deno / DB access) so they are unit-testable.

/** The tag the dispatch route stamps on every influencer kit order. */
export const INFLUENCER_TAG = "influencer";
/** Tags added to the creator's CRM contact. */
export const INFLUENCER_CONTACT_TAGS = ["influencer", "creator"] as const;
/** Start of the note the dispatch route writes (fallback signal if tags are missing). */
const INFLUENCER_NOTE_PREFIX = "promunch influencer kit";

/** Order tags as a lowercase, trimmed list. Shopify REST sends a comma string; GraphQL/drafts an array. */
export function orderTagList(order: any): string[] {
  const raw = order?.tags;
  const parts = Array.isArray(raw) ? raw.map((t) => String(t ?? "")) : String(raw ?? "").split(",");
  return parts.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/**
 * True for an influencer kit order: a tag "influencer" or "influencer:<handle>"
 * (case-insensitive, comma string or array), or the dispatch note as a
 * belt-and-braces fallback. Biased toward silence: any of the signals is enough.
 */
export function isInfluencerOrder(order: any): boolean {
  if (!order) return false;
  for (const t of orderTagList(order)) {
    if (t === INFLUENCER_TAG || t.startsWith(`${INFLUENCER_TAG}:`)) return true;
  }
  const note = String(order?.note ?? "").trim().toLowerCase();
  return note.startsWith(INFLUENCER_NOTE_PREFIX);
}

/** "influencer:<handle>" tag -> the IG handle (lowercase, no @). Null when absent or invalid. */
export function influencerHandleFromOrder(order: any): string | null {
  for (const t of orderTagList(order)) {
    if (!t.startsWith(`${INFLUENCER_TAG}:`)) continue;
    const h = t.slice(INFLUENCER_TAG.length + 1).trim().replace(/^@+/, "");
    if (/^[a-z0-9._]{1,30}$/.test(h)) return h;
  }
  return null;
}

/** Canonical Instagram profile link for a handle. */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@+/, "").toLowerCase()}`;
}

/**
 * The tags + properties to write on the creator's CRM contact, merged onto
 * what is already there (never removes an existing tag or property).
 * instagram_url is only set when we know the handle.
 */
export function influencerContactFields(
  existing: { tags?: unknown; properties?: unknown } | null | undefined,
  handle: string | null,
): { tags: string[]; properties: Record<string, unknown> } {
  const tags: string[] = Array.isArray(existing?.tags) ? existing!.tags.map((t) => String(t)) : [];
  const have = new Set(tags.map((t) => t.toLowerCase()));
  for (const t of INFLUENCER_CONTACT_TAGS) if (!have.has(t)) tags.push(t);
  const p = existing?.properties;
  const properties: Record<string, unknown> =
    p && typeof p === "object" && !Array.isArray(p) ? { ...(p as Record<string, unknown>) } : {};
  if (handle) properties.instagram_url = instagramUrl(handle);
  return { tags, properties };
}
