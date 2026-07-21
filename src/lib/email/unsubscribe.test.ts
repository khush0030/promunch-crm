import { describe, it, expect } from "vitest";

// Set before importing the modules' functions are exercised (describe bodies run
// at collection time, before any beforeAll hook).
process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
process.env.SITE_APP_URL = "https://crm.example.com";

import {
  makeUnsubToken,
  verifyUnsubToken,
  unsubscribeUrl,
  marketingHeaders,
} from "./unsubscribe";
import { renderMarketingEmail } from "./layout";

const CONTACT = "11111111-2222-3333-4444-555555555555";

describe("unsubscribe token", () => {
  it("round-trips a contact id", () => {
    const token = makeUnsubToken(CONTACT);
    expect(verifyUnsubToken(token)).toBe(CONTACT);
  });

  it("rejects a tampered signature", () => {
    const token = makeUnsubToken(CONTACT);
    const [payload] = token.split(".");
    expect(verifyUnsubToken(`${payload}.AAAAAAAA`)).toBeNull();
  });

  it("rejects a swapped payload (signature no longer matches)", () => {
    const token = makeUnsubToken(CONTACT);
    const other = Buffer.from("99999999-0000").toString("base64url");
    const sig = token.split(".")[1];
    expect(verifyUnsubToken(`${other}.${sig}`)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyUnsubToken("")).toBeNull();
    expect(verifyUnsubToken("no-dot")).toBeNull();
    expect(verifyUnsubToken("a.b.c")).toBeNull();
  });
});

describe("marketing headers", () => {
  it("emit RFC 8058 one-click headers pointing at the CRM endpoint", () => {
    const h = marketingHeaders(CONTACT);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h["List-Unsubscribe"]).toMatch(
      /^<https:\/\/crm\.example\.com\/api\/public\/unsubscribe\?token=.+>$/,
    );
  });

  it("builds a verifiable url", () => {
    const url = unsubscribeUrl(CONTACT);
    const token = decodeURIComponent(url.split("token=")[1]);
    expect(verifyUnsubToken(token)).toBe(CONTACT);
  });
});

describe("renderMarketingEmail", () => {
  const html = renderMarketingEmail({
    contactId: CONTACT,
    bodyHtml: "<p>Hello there</p>",
    previewText: "A tasty preview",
  });

  it("includes the body, brand and tagline", () => {
    expect(html).toContain("<p>Hello there</p>");
    expect(html).toContain("PROMUNCH");
    expect(html).toContain("Your Munchy Pal");
  });

  it("always includes a working unsubscribe link", () => {
    const m = html.match(/\/api\/public\/unsubscribe\?token=([^"&]+)/);
    expect(m).not.toBeNull();
    expect(verifyUnsubToken(decodeURIComponent(m![1]))).toBe(CONTACT);
  });

  it("has no em dashes in customer copy", () => {
    expect(html).not.toContain("—");
  });
});
