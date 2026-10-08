import { normalizePhone } from "@/lib/influencers/normalize";

/**
 * Phone as stored on contacts: "+" + digits with country code, the same shape
 * Shopify-synced contacts use. A bare 10-digit number is an Indian mobile
 * (+91); a leading 0 or 00 is dropped. Returns null when it can't be a phone.
 */
export function toContactPhone(raw: unknown): string | null {
  const digits = normalizePhone(raw);
  return digits ? `+${digits}` : null;
}
