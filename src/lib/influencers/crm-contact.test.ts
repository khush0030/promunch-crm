import { describe, expect, it } from "vitest";
import { cleanEmail, influencerContactFields, instagramUrl, isLinkValue, phoneVariants } from "./crm-contact";

describe("instagramUrl", () => {
  it("builds a canonical profile link", () => {
    expect(instagramUrl("riya.eats")).toBe("https://instagram.com/riya.eats");
    expect(instagramUrl(" @Riya.Eats ")).toBe("https://instagram.com/riya.eats");
  });
});

describe("influencerContactFields", () => {
  it("adds influencer + creator tags and the instagram link, keeping everything else", () => {
    const r = influencerContactFields({ tags: ["hyped"], properties: { utm_source: "ig" } }, "riya.eats");
    expect(r.tags).toEqual(["hyped", "influencer", "creator"]);
    expect(r.properties).toEqual({ utm_source: "ig", instagram_url: "https://instagram.com/riya.eats" });
  });
  it("does not duplicate tags (case-insensitive)", () => {
    expect(influencerContactFields({ tags: ["Influencer", "creator"] }, null).tags).toEqual(["Influencer", "creator"]);
  });
  it("handles a missing row and non-object properties", () => {
    expect(influencerContactFields(null, "abc")).toEqual({
      tags: ["influencer", "creator"],
      properties: { instagram_url: "https://instagram.com/abc" },
    });
    expect(influencerContactFields({ tags: null, properties: ["x"] }, null).properties).toEqual({});
  });
});

describe("phoneVariants / cleanEmail / isLinkValue", () => {
  it("covers the stored phone forms", () => {
    expect(phoneVariants("919876543210").sort()).toEqual(["+919876543210", "919876543210", "9876543210"].sort());
  });
  it("validates emails", () => {
    expect(cleanEmail(" Riya@Example.com ")).toBe("riya@example.com");
    expect(cleanEmail("nope")).toBeNull();
    expect(cleanEmail(null)).toBeNull();
  });
  it("only links http(s) values", () => {
    expect(isLinkValue("https://instagram.com/abc")).toBe(true);
    expect(isLinkValue("javascript:alert(1)")).toBe(false);
    expect(isLinkValue(42)).toBe(false);
  });
});
