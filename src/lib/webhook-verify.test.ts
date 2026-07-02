import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyShopifyHmac, verifySvix } from "./webhook-verify";

const SHOPIFY_SECRET = "shpss_test_secret";
function shopifySig(body: string, secret = SHOPIFY_SECRET) {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyShopifyHmac", () => {
  const body = JSON.stringify({ id: 1, email: "a@b.com" });

  it("accepts a correctly signed body", () => {
    expect(verifyShopifyHmac(body, shopifySig(body), SHOPIFY_SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyShopifyHmac(body + "x", shopifySig(body), SHOPIFY_SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyShopifyHmac(body, shopifySig(body, "other"), SHOPIFY_SECRET)).toBe(false);
  });

  it("fails closed when the secret is missing", () => {
    expect(verifyShopifyHmac(body, shopifySig(body), undefined)).toBe(false);
  });

  it("fails closed when the header is missing", () => {
    expect(verifyShopifyHmac(body, null, SHOPIFY_SECRET)).toBe(false);
  });

  it("does not throw on a malformed header", () => {
    expect(verifyShopifyHmac(body, "!!!not-base64!!!", SHOPIFY_SECRET)).toBe(false);
  });
});

describe("verifySvix", () => {
  const rawBody = JSON.stringify({ type: "email.delivered" });
  const rawSecret = "supersecretvalue";
  const whsec = "whsec_" + Buffer.from(rawSecret).toString("base64");
  const svixId = "msg_123";
  const svixTs = "1700000000";

  function svixSig(body = rawBody, secret = whsec, id = svixId, ts = svixTs) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return `v1,${sig}`;
  }

  it("accepts a valid signature", () => {
    expect(verifySvix({ secret: whsec, svixId, svixTs, svixSig: svixSig(), rawBody })).toBe(true);
  });

  it("accepts when one of several space-separated sigs matches", () => {
    const sig = `v1,deadbeef ${svixSig()}`;
    expect(verifySvix({ secret: whsec, svixId, svixTs, svixSig: sig, rawBody })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySvix({ secret: whsec, svixId, svixTs, svixSig: svixSig(), rawBody: rawBody + "x" })).toBe(false);
  });

  it("fails closed when the secret is missing", () => {
    expect(verifySvix({ secret: undefined, svixId, svixTs, svixSig: svixSig(), rawBody })).toBe(false);
  });

  it("fails closed when any svix header is missing (the H5 bypass)", () => {
    expect(verifySvix({ secret: whsec, svixId: null, svixTs, svixSig: svixSig(), rawBody })).toBe(false);
    expect(verifySvix({ secret: whsec, svixId, svixTs: null, svixSig: svixSig(), rawBody })).toBe(false);
    expect(verifySvix({ secret: whsec, svixId, svixTs, svixSig: null, rawBody })).toBe(false);
  });
});
