import { describe, expect, it } from "vitest";
import { whenSentence } from "./statusSentence";

describe("whenSentence", () => {
  it("reads naturally without a time", () => {
    expect(whenSentence("Cancelled", null)).toBe("Cancelled.");
    expect(whenSentence("Cancelled", undefined)).toBe("Cancelled.");
    expect(whenSentence("Paused", "not a date")).toBe("Paused.");
  });

  it("includes the India time when known", () => {
    const out = whenSentence("Cancelled", "2026-09-30T10:40:00Z");
    expect(out.startsWith("Cancelled on ")).toBe(true);
    expect(out).toMatch(/30 Sept?,? 4:10\s?pm\.$/i);
    expect(out).not.toContain("–");
  });
});
