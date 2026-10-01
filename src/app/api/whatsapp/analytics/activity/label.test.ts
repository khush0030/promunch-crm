import { describe, expect, it } from "vitest";
import { orderLabel } from "./label";

describe("orderLabel", () => {
  it("adds exactly one hash", () => {
    expect(orderLabel(342929)).toBe("#342929");
    expect(orderLabel("#342929")).toBe("#342929");
    expect(orderLabel("##342929")).toBe("#342929");
  });
  it("is empty for a missing number", () => {
    expect(orderLabel(null)).toBe("");
    expect(orderLabel("")).toBe("");
  });
});
