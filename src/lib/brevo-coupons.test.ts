import { describe, expect, it } from "vitest";
import { parseCouponCodes } from "./brevo-coupons";

describe("parseCouponCodes", () => {
  it("splits on commas, spaces and newlines, uppercases and dedupes", () => {
    expect(parseCouponCodes("pm-a1b2, PM-A1B2\nPM_C3D4;  PMX9")).toEqual({ codes: ["PM-A1B2", "PM_C3D4", "PMX9"], invalid: [], duplicates: 1 });
  });
  it("reports invalid codes", () => {
    expect(parseCouponCodes("ok123 no! ab").invalid).toEqual(["no!", "ab"]);
  });
});
