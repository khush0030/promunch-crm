import { describe, it, expect } from "vitest";

process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

import {
  signContactToken,
  verifyContactToken,
  withContactToken,
  parseTrackPayload,
  pickBrowseCandidates,
  filterEligible,
  browseEntityRef,
  type StorefrontEventRow,
  type ContactConsent,
} from "./browse-abandon";
import { makeUnsubToken } from "./unsubscribe";

const CONTACT = "11111111-2222-3333-4444-555555555555";
const H = 3_600_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("pm_c contact token", () => {
  it("round-trips a contact id", () => {
    expect(verifyContactToken(signContactToken(CONTACT))).toBe(CONTACT);
  });

  it("rejects a tampered signature", () => {
    const [a, b] = signContactToken(CONTACT).split(".");
    expect(verifyContactToken(`${a}.${b}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });

  it("rejects a swapped contact id", () => {
    const [, b, c] = signContactToken(CONTACT).split(".");
    const other = Buffer.from("99999999-2222-3333-4444-555555555555").toString("base64url");
    expect(verifyContactToken(`${other}.${b}.${c}`)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    const [a, b, c] = signContactToken(CONTACT).split(".");
    const later = (parseInt(b, 36) + 86_400).toString(36);
    expect(verifyContactToken(`${a}.${later}.${c}`)).toBeNull();
  });

  it("expires", () => {
    const tok = signContactToken(CONTACT, { ttlDays: 1, now: NOW });
    expect(verifyContactToken(tok, NOW + 23 * H)).toBe(CONTACT);
    expect(verifyContactToken(tok, NOW + 25 * H)).toBeNull();
  });

  it("is not interchangeable with an unsubscribe token", () => {
    expect(verifyContactToken(makeUnsubToken(CONTACT))).toBeNull();
  });

  it("never throws on junk", () => {
    for (const junk of [undefined, null, 42, "", "a.b.c", "x".repeat(500), "..", "%%%.%%%.%%%"]) {
      expect(verifyContactToken(junk)).toBeNull();
    }
  });

  it("appends pm_c to storefront links and leaves mailto alone", () => {
    const u = new URL(withContactToken("https://promunch.in/products/crunchies?utm_source=email", CONTACT));
    expect(u.searchParams.get("utm_source")).toBe("email");
    expect(verifyContactToken(u.searchParams.get("pm_c"))).toBe(CONTACT);
    expect(withContactToken("mailto:hello@promunch.in", CONTACT)).toBe("mailto:hello@promunch.in");
  });
});

describe("parseTrackPayload", () => {
  const good = {
    event: "product_viewed",
    clientId: "abc12345-client",
    email: "  Foo@Example.COM ",
    pm_c: "tok",
    product: {
      id: "gid://shopify/Product/8123456789",
      variant_id: "gid://shopify/ProductVariant/4412345678",
      handle: "crunchies",
      title: "Peri Peri Crunchies",
      url: "https://promunch.in/products/crunchies",
      image: "//cdn.shopify.com/x.png",
      price: "149.00",
      currency: "INR",
    },
    url: "https://promunch.in/products/crunchies?pm_c=tok",
    evil: "<script>",
  };

  it("normalises a valid product view", () => {
    const p = parseTrackPayload(good)!;
    expect(p.event).toBe("product_viewed");
    expect(p.email).toBe("foo@example.com");
    expect(p.contactToken).toBe("tok");
    expect(p.product).toEqual({
      product_id: "8123456789",
      variant_id: "4412345678",
      handle: "crunchies",
      title: "Peri Peri Crunchies",
      url: "https://promunch.in/products/crunchies",
      image: "https://cdn.shopify.com/x.png",
      price: 149,
      currency: "INR",
    });
    expect(p).not.toHaveProperty("evil");
  });

  it("rejects unknown events, bad client ids and non-objects", () => {
    expect(parseTrackPayload({ ...good, event: "page_viewed" })).toBeNull();
    expect(parseTrackPayload({ ...good, clientId: "x" })).toBeNull();
    expect(parseTrackPayload({ ...good, clientId: "bad id with spaces!" })).toBeNull();
    expect(parseTrackPayload(null)).toBeNull();
    expect(parseTrackPayload([good])).toBeNull();
    expect(parseTrackPayload("str")).toBeNull();
  });

  it("requires a product on product_viewed but not on checkout_started", () => {
    expect(parseTrackPayload({ ...good, product: null })).toBeNull();
    expect(parseTrackPayload({ ...good, event: "checkout_started", product: null })?.product).toBeNull();
  });

  it("drops invalid emails and javascript: urls instead of rejecting", () => {
    const p = parseTrackPayload({
      ...good,
      email: "not-an-email",
      url: "javascript:alert(1)",
      product: { ...good.product, url: "javascript:x", price: -5 },
    })!;
    expect(p.email).toBeNull();
    expect(p.url).toBeNull();
    expect(p.product?.url).toBeNull();
    expect(p.product?.price).toBeNull();
  });
});

function ev(partial: Partial<StorefrontEventRow> & { hoursAgo: number }): StorefrontEventRow {
  return {
    client_id: partial.client_id ?? "client-aaaa",
    contact_id: partial.contact_id ?? null,
    email: partial.email === undefined ? "a@x.com" : partial.email,
    event: partial.event ?? "product_viewed",
    product: partial.product === undefined ? { title: "Crunchies", url: "https://promunch.in/products/c", image: null, price: 149 } : partial.product,
    created_at: new Date(NOW - partial.hoursAgo * H).toISOString(),
  };
}

describe("pickBrowseCandidates", () => {
  it("picks a viewer idle for 1-24h with the latest product", () => {
    const out = pickBrowseCandidates(
      [ev({ hoursAgo: 5, product: { title: "Old" } }), ev({ hoursAgo: 3, product: { title: "Newest", price: 99 } })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("a@x.com");
    expect(out[0].product.title).toBe("Newest");
    expect(out[0].viewedAt).toBe(new Date(NOW - 3 * H).toISOString());
  });

  it("skips someone still browsing (view within the last hour)", () => {
    expect(pickBrowseCandidates([ev({ hoursAgo: 5 }), ev({ hoursAgo: 0.5 })], NOW)).toHaveLength(0);
  });

  it("ignores views older than 24h and anonymous views", () => {
    expect(pickBrowseCandidates([ev({ hoursAgo: 30 }), ev({ hoursAgo: 3, email: null })], NOW)).toHaveLength(0);
  });

  it("skips when they added to cart after viewing (by email)", () => {
    expect(pickBrowseCandidates([ev({ hoursAgo: 5 }), ev({ hoursAgo: 4, event: "product_added_to_cart" })], NOW)).toHaveLength(0);
  });

  it("skips when an anonymous checkout came from the same device", () => {
    const out = pickBrowseCandidates(
      [ev({ hoursAgo: 5 }), ev({ hoursAgo: 4, event: "checkout_started", email: null, product: null })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("does not let a cart event BEFORE the views disqualify", () => {
    const out = pickBrowseCandidates([ev({ hoursAgo: 10, event: "product_added_to_cart" }), ev({ hoursAgo: 5 })], NOW);
    expect(out).toHaveLength(1);
  });

  it("does not cross-contaminate different visitors", () => {
    const out = pickBrowseCandidates(
      [
        ev({ hoursAgo: 5, email: "a@x.com", client_id: "client-aaaa" }),
        ev({ hoursAgo: 5, email: "b@x.com", client_id: "client-bbbb" }),
        ev({ hoursAgo: 4, email: null, client_id: "client-bbbb", event: "product_added_to_cart" }),
      ],
      NOW,
    );
    expect(out.map((c) => c.email)).toEqual(["a@x.com"]);
  });
});

describe("filterEligible", () => {
  const cand = pickBrowseCandidates([ev({ hoursAgo: 3 })], NOW);
  const contact: ContactConsent = {
    id: CONTACT,
    email: "a@x.com",
    first_name: "Asha",
    status: "active",
    accepts_marketing: true,
    email_consent: null,
  };
  const base = () => ({
    contactsByEmail: new Map([["a@x.com", { ...contact }]]),
    suppressed: new Set<string>(),
    orderedEmails: new Set<string>(),
    recentlyEnrolledContactIds: new Set<string>(),
  });

  it("keeps a consenting contact", () => {
    const out = filterEligible(cand, base());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ contactId: CONTACT, firstName: "Asha" });
  });

  it("accepts email_consent=subscribed as consent", () => {
    const f = base();
    f.contactsByEmail.set("a@x.com", { ...contact, accepts_marketing: null, email_consent: "subscribed" });
    expect(filterEligible(cand, f)).toHaveLength(1);
  });

  it.each([
    ["unknown contact", (f: ReturnType<typeof base>) => f.contactsByEmail.clear()],
    ["no positive consent", (f: ReturnType<typeof base>) => f.contactsByEmail.set("a@x.com", { ...contact, accepts_marketing: null })],
    ["opted out", (f: ReturnType<typeof base>) => f.contactsByEmail.set("a@x.com", { ...contact, accepts_marketing: false })],
    ["unsubscribed status", (f: ReturnType<typeof base>) => f.contactsByEmail.set("a@x.com", { ...contact, status: "unsubscribed" })],
    ["suppressed", (f: ReturnType<typeof base>) => f.suppressed.add("a@x.com")],
    ["ordered in last 7 days", (f: ReturnType<typeof base>) => f.orderedEmails.add("a@x.com")],
    ["browse email in last 7 days", (f: ReturnType<typeof base>) => f.recentlyEnrolledContactIds.add(CONTACT)],
  ])("drops: %s", (_label, mutate) => {
    const f = base();
    mutate(f);
    expect(filterEligible(cand, f)).toHaveLength(0);
  });
});

describe("browseEntityRef", () => {
  it("is stable per contact per view day", () => {
    expect(browseEntityRef(CONTACT, "2026-09-30T05:00:00.000Z")).toBe(`${CONTACT}:2026-09-30`);
    expect(browseEntityRef(CONTACT, "2026-09-30T23:00:00.000Z")).toBe(browseEntityRef(CONTACT, "2026-09-30T01:00:00.000Z"));
  });
});
