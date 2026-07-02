import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "./auth-domains";

describe("isAllowedEmail", () => {
  it("accepts allowed domains (case-insensitive)", () => {
    expect(isAllowedEmail("a@promunch.in")).toBe(true);
    expect(isAllowedEmail("A@Trypromunch.IN")).toBe(true);
    expect(isAllowedEmail("x@vippysoya.com")).toBe(true);
  });

  it("rejects disallowed domains", () => {
    expect(isAllowedEmail("a@gmail.com")).toBe(false);
    expect(isAllowedEmail("a@promunch.in.evil.com")).toBe(false);
  });

  it("rejects malformed / empty input", () => {
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail("noatsign")).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
  });

  it("uses the last @ segment (defeats a@promunch.in@evil.com)", () => {
    expect(isAllowedEmail("a@promunch.in@evil.com")).toBe(false);
  });
});
