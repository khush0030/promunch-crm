import { describe, expect, it } from "vitest";
import { gs1CheckDigit, normalizeGtin } from "./gtin";

describe("gs1CheckDigit", () => {
  it("matches published GS1 examples", () => {
    expect(gs1CheckDigit("400638133393")).toBe(1); // EAN-13 4006381333931
    expect(gs1CheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
    expect(gs1CheckDigit("9638507")).toBe(4); // EAN-8 96385074
  });

  it("computes the Indian (890 prefix) example", () => {
    expect(gs1CheckDigit("890123456789")).toBe(0);
  });
});

describe("normalizeGtin", () => {
  it("accepts valid EAN-13s", () => {
    expect(normalizeGtin("4006381333931")).toBe("4006381333931");
    expect(normalizeGtin("5901234123457")).toBe("5901234123457");
    expect(normalizeGtin("8901234567890")).toBe("8901234567890");
    expect(normalizeGtin("8900000000005")).toBe("8900000000005");
  });

  it("accepts valid GTIN-8, GTIN-12 and GTIN-14", () => {
    expect(normalizeGtin("96385074")).toBe("96385074");
    expect(normalizeGtin("036000291452")).toBe("036000291452");
    expect(normalizeGtin("10012345678902")).toBe("10012345678902");
  });

  it("trims and strips internal whitespace", () => {
    expect(normalizeGtin("  8901234567890 ")).toBe("8901234567890");
    expect(normalizeGtin("890 1234 56789 0")).toBe("8901234567890");
    expect(normalizeGtin("\t4006381333931\n")).toBe("4006381333931");
  });

  it("rejects a wrong check digit", () => {
    expect(normalizeGtin("8901234567892")).toBeNull();
    expect(normalizeGtin("4006381333932")).toBeNull();
    expect(normalizeGtin("96385075")).toBeNull();
  });

  it("rejects wrong lengths", () => {
    expect(normalizeGtin("890123456789")).toBeNull(); // 12 digits, bad UPC check
    expect(normalizeGtin("1234567")).toBeNull(); // 7
    expect(normalizeGtin("89012345678901")).toBeNull(); // 14, bad check
    expect(normalizeGtin("890123456789012")).toBeNull(); // 15
    expect(normalizeGtin("12345678901")).toBeNull(); // 11
  });

  it("rejects non-digits", () => {
    expect(normalizeGtin("890123456789O")).toBeNull(); // letter O
    expect(normalizeGtin("8901-2345-6789-0")).toBeNull();
    expect(normalizeGtin("PM-CRUNCH-100G")).toBeNull();
    expect(normalizeGtin("-8901234567890")).toBeNull();
  });

  it("returns null for empty and missing values", () => {
    expect(normalizeGtin("")).toBeNull();
    expect(normalizeGtin("   ")).toBeNull();
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin(undefined)).toBeNull();
  });
});
