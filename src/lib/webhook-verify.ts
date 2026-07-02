import { createHmac, timingSafeEqual } from "node:crypto";

// Shared webhook signature verification. Both verifiers FAIL CLOSED: a missing
// secret or signature returns false (audit C4/H5). Extracted from the individual
// route handlers so the logic is DRY and unit-tested.

// Shopify signs the raw body: base64(HMAC-SHA256(body, secret)).
export function verifyShopifyHmac(
  rawBody: string,
  header: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Svix signature (Resend). Header is a space-separated list of `v1,<sig>` parts;
// the signed content is `${id}.${timestamp}.${body}` and the key is the
// base64-decoded `whsec_...` secret.
export function verifySvix(opts: {
  secret: string | undefined;
  svixId: string | null;
  svixTs: string | null;
  svixSig: string | null;
  rawBody: string;
}): boolean {
  const { secret, svixId, svixTs, svixSig, rawBody } = opts;
  if (!secret || !svixId || !svixTs || !svixSig) return false;
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key)
      .update(`${svixId}.${svixTs}.${rawBody}`)
      .digest("base64");
    return svixSig.split(" ").some((part) => {
      const sig = part.split(",")[1];
      if (!sig) return false;
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  } catch {
    return false;
  }
}
