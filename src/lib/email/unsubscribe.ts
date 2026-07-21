// One-click unsubscribe for customer marketing email (campaigns + flows).
//
// Gmail/Yahoo bulk-sender rules (2024+) require every marketing message to carry
// a List-Unsubscribe header and a working one-click endpoint. The token is a
// stateless HMAC of the contact id, so the link never expires and needs no DB
// lookup to validate — tampering fails the signature check.
//
// Server-only. Never import from a client component.
//
// Pure crypto/URL helpers only (no DB) so they stay unit-testable and cheap to
// import. The DB-touching suppression write lives in ./apply-unsubscribe.

import { createHmac, timingSafeEqual } from "node:crypto";

function signingSecret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) {
    // Fail closed: without the secret we cannot prove a link is genuine, and a
    // marketing send with no working unsubscribe is a compliance violation.
    throw new Error(
      "UNSUBSCRIBE_SECRET is not set. Add it in Vercel env (and .env.local) before sending marketing email.",
    );
  }
  return s;
}

/** CRM's own public base URL (where these routes live), no trailing slash. */
export function appBaseUrl(): string {
  return (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, "");
}

/** `base64url(contactId).base64url(HMAC-SHA256(contactId))` */
export function makeUnsubToken(contactId: string): string {
  const sig = createHmac("sha256", signingSecret()).update(contactId).digest();
  return `${Buffer.from(contactId).toString("base64url")}.${sig.toString("base64url")}`;
}

/** Returns the contact id if the token is authentic, else null. */
export function verifyUnsubToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let contactId: string;
  try {
    contactId = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!contactId) return null;
  const expected = createHmac("sha256", signingSecret()).update(contactId).digest();
  let given: Buffer;
  try {
    given = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? contactId : null;
}

/** Full one-click endpoint for the List-Unsubscribe header and footer link. */
export function unsubscribeUrl(contactId: string): string {
  return `${appBaseUrl()}/api/public/unsubscribe?token=${encodeURIComponent(makeUnsubToken(contactId))}`;
}

/** RFC 8058 headers to attach to every marketing send. */
export function marketingHeaders(contactId: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl(contactId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
