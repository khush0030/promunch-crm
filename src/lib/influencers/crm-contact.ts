// Pure helpers for the creator's CRM contact (no server imports, testable).
//
// Owner-approved Oct 7 2026: an influencer kit order is stored in the CRM, the
// creator's `contacts` row carries the tags "influencer" + "creator", and their
// Instagram link lives in the custom-fields column `contacts.properties`
// under `instagram_url`. Mirrors the edge side
// (promunch-email-agent/supabase/functions/_shared/influencer-order.ts), which
// applies the same merge when the Shopify order webhook lands.

export const INFLUENCER_CONTACT_TAGS = ["influencer", "creator"] as const;

/** Canonical Instagram profile link for a handle. */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.trim().replace(/^@+/, "").toLowerCase()}`;
}

/**
 * Tags + properties for the creator's contact, merged onto the existing row.
 * Never removes a tag or property; tag match is case-insensitive.
 */
export function influencerContactFields(
  existing: { tags?: unknown; properties?: unknown } | null | undefined,
  handle: string | null,
): { tags: string[]; properties: Record<string, unknown> } {
  const tags: string[] = Array.isArray(existing?.tags) ? (existing.tags as unknown[]).map((t) => String(t)) : [];
  const have = new Set(tags.map((t) => t.toLowerCase()));
  for (const t of INFLUENCER_CONTACT_TAGS) if (!have.has(t)) tags.push(t);
  const p = existing?.properties;
  const properties: Record<string, unknown> =
    p && typeof p === "object" && !Array.isArray(p) ? { ...(p as Record<string, unknown>) } : {};
  if (handle) properties.instagram_url = instagramUrl(handle);
  return { tags, properties };
}

/** "+919876543210", "919876543210", "9876543210": the forms one phone takes in contacts. */
export function phoneVariants(waId: string): string[] {
  const v = new Set([waId, `+${waId}`]);
  if (waId.startsWith("91") && waId.length === 12) v.add(waId.slice(2));
  return [...v];
}

/** A plausible email, lowercased, or null. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** True when a custom-property value should render as a link (http/https only). */
export function isLinkValue(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim());
}
