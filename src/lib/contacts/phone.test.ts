import { describe, it, expect } from "vitest";
import { toContactPhone } from "./phone";

describe("toContactPhone", () => {
  it("adds +91 to a bare Indian mobile", () => {
    expect(toContactPhone("9876500011")).toBe("+919876500011");
    expect(toContactPhone("98765 00011")).toBe("+919876500011");
  });
  it("keeps numbers that already carry the country code", () => {
    expect(toContactPhone("+91 98765 43210")).toBe("+919876543210");
    expect(toContactPhone("919876543210")).toBe("+919876543210");
    expect(toContactPhone("+1 415 555 0100")).toBe("+14155550100");
  });
  it("drops a trunk 0 or 00", () => {
    expect(toContactPhone("09876500011")).toBe("+919876500011");
    expect(toContactPhone("00919876500011")).toBe("+919876500011");
  });
  it("rejects things that are not phones", () => {
    expect(toContactPhone("12345")).toBeNull();
    expect(toContactPhone("")).toBeNull();
    expect(toContactPhone(null)).toBeNull();
  });
});
